"use strict";
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PUBLIC_DIR = path.join(__dirname, "public");
const REPORT_FILE = process.env.TV_REPORT_FILE || path.join(__dirname, "data", "report.json");
const MIME = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".svg":"image/svg+xml",".json":"application/json; charset=utf-8"};
const REMOTE_MODE = process.env.REMOTE_MODE === "1" || process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
const rooms = new Map();
const MAX_LISTENERS = 4;
const peers = new Map();
function getIceServers(){
  const servers=[{urls:"stun:stun.l.google.com:19302"}];
  const urls=process.env.TURN_URLS?.split(",").map(s=>s.trim()).filter(Boolean);
  if(urls?.length)servers.push({
    urls,username:process.env.TURN_USERNAME||"",
    credential:process.env.TURN_CREDENTIAL||""
  });
  return servers;
}

const requestHandler = async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (!["GET", "HEAD"].includes(req.method)) {res.writeHead(405);return res.end();}
  let pathname;
  try {pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);} catch {res.writeHead(400);return res.end();}
  if (pathname === "/api/health") return json(res, 200, {status:"ok", service:"howdyknw"});
  if (pathname === "/api/config") return json(res,200,{iceServers:getIceServers(),requiresE2EE:REMOTE_MODE});
  if (pathname === "/api/report") {
    if (REMOTE_MODE && process.env.ALLOW_REMOTE_REPORT !== "1") return json(res,403,{error:"El informe local de la TV está deshabilitado en el servidor remoto"});
    try {
      const report = JSON.parse(await fs.promises.readFile(REPORT_FILE, "utf8"));
      return json(res,200,report);
    } catch (e) {return json(res,404,{error:"No hay informe de tráfico todavía"});}
  }
  let filepath = path.resolve(PUBLIC_DIR, "." + (pathname === "/" ? "/index.html" : pathname));
  if (filepath !== PUBLIC_DIR && !filepath.startsWith(PUBLIC_DIR + path.sep)) {res.writeHead(403);return res.end();}
  try {
    const st = await fs.promises.stat(filepath);
    if (!st.isFile()) throw Error("Not a file");
    res.writeHead(200,{"Content-Type":MIME[path.extname(filepath)]||"application/octet-stream","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"});
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filepath).pipe(res);
  } catch {res.writeHead(404);res.end("No encontrado");}
};
const useTls = Boolean(process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE);
const server = useTls ? https.createServer({
  cert: fs.readFileSync(process.env.TLS_CERT_FILE),
  key: fs.readFileSync(process.env.TLS_KEY_FILE)
}, requestHandler) : http.createServer(requestHandler);
function json(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
const wss = new WebSocketServer({server,maxPayload:180000,verifyClient:({req},done)=>{
  // Browsers must use the app's host, not a foreign webpage.
  // Android clients omit Origin; some TV runtimes use non-HTTP origins.
  const origin=req.headers.origin;
  if(!origin || origin==="null" || !/^https?:\/\//i.test(origin))return done(true);
  let allowed=false;
  try{
    const host=new URL(origin).host.toLowerCase();
    const expected=(req.headers.host||"").toLowerCase();
    const extras=(process.env.ALLOWED_WS_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
    allowed=host===expected || extras.includes(new URL(origin).origin);
  }catch{}
  return done(allowed,403,allowed?undefined:"Origen web no permitido");
}});
function heartbeatSweep(){
  for(const client of wss.clients){
    if(client.readyState!==WebSocket.OPEN)continue;
    if(client.awaitingPong){client.terminate();continue;}
    client.awaitingPong=true;
    try{client.ping();}catch{client.terminate();}
  }
}
const heartbeatTimer=setInterval(heartbeatSweep,25000);
heartbeatTimer.unref();
wss.on("close",()=>clearInterval(heartbeatTimer));
function send(ws,msg){if(ws && ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}
function getRoom(code){if(!rooms.has(code))rooms.set(code,{source:null,listeners:new Map()});return rooms.get(code);}
function notifyListenerCount(room){
  send(room.source,{type:"listener-count",count:room.listeners.size});
}
function leave(ws){
  if(!ws.room)return;
  const room=rooms.get(ws.room);
  if(room){
    if(ws.role==="source"&&room.source===ws){
      room.source=null;
      for(const listener of room.listeners.values())send(listener,{type:"source-offline"});
    }
    if(ws.role==="listener"){
      room.listeners.delete(ws.id);
      send(room.source,{type:"listener-left",id:ws.id});
      notifyListenerCount(room);
    }
    if(!room.source && room.listeners.size===0)rooms.delete(ws.room);
  }
  peers.delete(ws.id);ws.room=null;
}
wss.on("connection",ws=>{
  if (wss.clients.size > 80) {ws.close(1013,"Servidor lleno");return;}
  ws.id=crypto.randomUUID();
  // Handshake sockets must join a room promptly; never hold idle capacity indefinitely.
  ws.joinTimeout=setTimeout(()=>{if(!ws.room)ws.close(1008,"Tiempo de unión agotado");},15000);
  ws.joinTimeout.unref();
  ws.awaitingPong=false;
  ws.on("pong",()=>{ws.awaitingPong=false;});
  ws.messageWindow=Date.now();ws.messageCount=0;
  ws.room=null;ws.role=null;ws.audioTransport="webrtc";ws.frameWindowStart=0;ws.frameCount=0;ws.mediaCounts={voice:0,tv:0,screen:0};ws.transcriptCount=0;
  ws.on("message",raw=>{
    const now=Date.now();
    if(now-ws.messageWindow>1000){ws.messageWindow=now;ws.messageCount=0;}
    if(++ws.messageCount>135){ws.close(1008,"Frecuencia de mensajes excesiva");return;}
    let m;
    try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:"error",message:"JSON inválido"});}
    if (!m || typeof m !== "object" || Array.isArray(m)) return send(ws,{type:"error",message:"Mensaje no válido"});
    if(m.type==="join"&&!ws.room){
      const roomCode=String(m.room||"").toUpperCase().trim();
      const role=m.role;
      if(!/^[A-Z0-9]{8,16}$/.test(roomCode)||!["source","listener"].includes(role))return send(ws,{type:"error",message:"Sala o rol no válido"});
      if(role==="source"&&REMOTE_MODE&&m.transport==="pcm16"){
        return send(ws,{type:"error",message:"El servidor público exige cifrado de extremo a extremo: actualiza Howdyknw y configura la clave de audio"});
      }
      const room=getRoom(roomCode);
      if(role==="source"&&room.source)return send(ws,{type:"error",message:"Esta sala ya tiene un micrófono activo"});
      if(role==="listener"&&room.listeners.size >= MAX_LISTENERS)return send(ws,{type:"error",message:"Sala llena: máximo 4 receptores"});
      clearTimeout(ws.joinTimeout);
      ws.room=roomCode;ws.role=role;
      ws.audioTransport=role==="source"&&["pcm16","pcm-e2ee","text"].includes(m.transport)?m.transport:"webrtc";
      peers.set(ws.id,ws);
      if(role==="source"){
        room.source=ws;
        // Send join configuration BEFORE offers, important for TV runtimes.
        send(ws,{type:"joined",id:ws.id,role,room:roomCode,sourceOnline:true,listenerCount:room.listeners.size,sourceTransport:ws.audioTransport,iceServers:getIceServers()});
        notifyListenerCount(room);
        for(const listener of room.listeners.values()){
          send(listener,{type:"source-mode",transport:ws.audioTransport});
          if(ws.audioTransport==="webrtc")send(ws,{type:"listener-joined",id:listener.id});
        }
      }else{
        room.listeners.set(ws.id,ws);
        send(ws,{type:"joined",id:ws.id,role,room:roomCode,sourceOnline:!!room.source,listenerCount:room.listeners.size,sourceTransport:room.source?.audioTransport||null,iceServers:getIceServers()});
        notifyListenerCount(room);
        if(room.source&&room.source.audioTransport==="webrtc")send(room.source,{type:"listener-joined",id:ws.id});
      }
      return;
    }
    // System TV keyboard / recognizer returns TEXT only. Never label it as microphone audio.
    // The user sends each transcript explicitly; no server-side saving or automatic dictation.
    if(m.type==="transcript"&&ws.role==="source"&&ws.room&&ws.audioTransport==="text"){
      const room=rooms.get(ws.room);
      if(!room||room.source!==ws||typeof m.text!=="string")return;
      const cleaned=m.text.trim();
      if(!cleaned||cleaned.length>1000||ws.transcriptCount++>3){
        return send(ws,{type:"error",message:"Transcripción inválida o límite superado"});
      }
      let delivered=0;
      for(const listener of room.listeners.values()){
        if(listener.bufferedAmount<200000){
          send(listener,{type:"transcript",text:cleaned,format:"text",audioAvailable:false});
          delivered++;
        }
      }
      send(ws,{type:"transcript-sent",listeners:delivered});
      return;
    }
    // Opaque AES-GCM frames. Relay has no secret and cannot decrypt the payload.
    if(m.type==="encrypted-frame"&&ws.role==="source"&&ws.room&&ws.audioTransport==="pcm-e2ee"){
      const room=rooms.get(ws.room);
      if(!room||room.source!==ws||typeof m.data!=="string"||
          !/^[A-Za-z0-9+/]{891}=$/.test(m.data))return;
      const timestamp=Date.now();
      if(timestamp-ws.frameWindowStart>=1000){ws.frameWindowStart=timestamp;ws.frameCount=0;}
      if(++ws.frameCount>65)return;
      for(const listener of room.listeners.values()){
        if(listener.bufferedAmount<200000)send(listener,{type:"encrypted-frame",data:m.data});
      }
      return;
    }
    if(m.type==="media-status"&&ws.role==="source"&&ws.room&&
       ws.audioTransport==="pcm-e2ee"&&typeof m.text==="string"){
      const room=rooms.get(ws.room);
      if(room?.source!==ws)return;
      const line=m.text.trim().slice(0,180);
      if(!line)return;
      for(const listener of room.listeners.values())send(listener,
        {type:"media-status",text:line});
      return;
    }
    // MediaProjection opt-in stream: AES-GCM ciphertext only, with distinct
    // authenticated voice/TV audio channels and encrypted screen JPEG previews.
    if((m.type==="media-frame"||m.type==="screen-frame")&&
       ws.role==="source"&&ws.room&&ws.audioTransport==="pcm-e2ee"){
      const kind=m.type==="screen-frame"?"screen":m.channel;
      if(!["voice","tv","screen"].includes(kind) ||
          (m.type==="media-frame"&&kind==="screen") ||
          typeof m.data!=="string")return;
      const audio=kind!=="screen";
      if(audio&&!/^[A-Za-z0-9+/]{891}=$/.test(m.data))return;
      if(!audio&&(m.data.length<40||m.data.length>120040||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data)||
          m.data.length%4!==0))return;
      const room=rooms.get(ws.room);
      if(!room||room.source!==ws||room.listeners.size===0)return;
      const timestamp=Date.now();
      if(timestamp-ws.frameWindowStart>=1000){
        ws.frameWindowStart=timestamp;ws.frameCount=0;
        ws.mediaCounts={voice:0,tv:0,screen:0};
      }
      if(++ws.mediaCounts[kind]>(audio?60:2))return;
      const outbound=audio?
        {type:"media-frame",channel:kind,data:m.data}:
        {type:"screen-frame",data:m.data};
      for(const listener of room.listeners.values()){
        if(listener.bufferedAmount<(audio?210000:120000))send(listener,outbound);
      }
      return;
    }
    // Native Android TV/Google TV: explicit mic capture, 16 kHz mono, 16-bit PCM.
    // Limit frames and listener backpressure to avoid turning this into a general file relay.
    if(m.type==="audio-frame"&&ws.role==="source"&&ws.room&&ws.audioTransport==="pcm16"){
      const room=rooms.get(ws.room);
      if(!room||room.source!==ws||typeof m.pcm!=="string"||!/^[A-Za-z0-9+/]{854}==$/.test(m.pcm))return;
      const now=Date.now();
      if(now-ws.frameWindowStart>=1000){ws.frameWindowStart=now;ws.frameCount=0;}
      if(++ws.frameCount>65)return;
      for(const listener of room.listeners.values()){
        if(listener.bufferedAmount<200000)send(listener,{type:"audio-frame",pcm:m.pcm});
      }
      return;
    }
    if(m.type==="signal"&&ws.room&&typeof m.to==="string"&&m.data&&typeof m.data==="object"){
      const target=peers.get(m.to),room=rooms.get(ws.room);
      if(!target||target.room!==ws.room||!room)return;
      if(!((ws===room.source&&target.role==="listener")||(ws.role==="listener"&&target===room.source)))return;
      return send(target,{type:"signal",from:ws.id,data:m.data});
    }
  });
  ws.on("close",()=>{clearTimeout(ws.joinTimeout);leave(ws);});
  ws.on("error",()=>{clearTimeout(ws.joinTimeout);leave(ws);});
});
if(require.main===module){
  const port=Number(process.env.PORT||3000);
  const host=process.env.HOST||(REMOTE_MODE?"0.0.0.0":"127.0.0.1");
  server.listen(port,host,()=>console.log("Howdyknw funcionando en "+(useTls?"https":"http")+"://"+(host==="0.0.0.0"?"localhost":host)+":"+port+(host==="0.0.0.0"?" (expuesto en todas las interfaces)":"")));
}
module.exports={server,wss,rooms,heartbeatSweep};
