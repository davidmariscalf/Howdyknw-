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
const rooms = new Map();
const peers = new Map();

const requestHandler = async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {res.writeHead(405);return res.end();}
  let pathname;
  try {pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);} catch {res.writeHead(400);return res.end();}
  if (pathname === "/api/health") return json(res, 200, {status:"ok", service:"howdyknw"});
  if (pathname === "/api/config") {
    const iceServers = [{urls:"stun:stun.l.google.com:19302"}];
    const urls = process.env.TURN_URLS?.split(",").map(s=>s.trim()).filter(Boolean);
    if (urls?.length) iceServers.push({urls,username:process.env.TURN_USERNAME || "", credential:process.env.TURN_CREDENTIAL || ""});
    return json(res,200,{iceServers});
  }
  if (pathname === "/api/report") {
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
const wss = new WebSocketServer({server,maxPayload:180000});
function send(ws,msg){if(ws && ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}
function getRoom(code){if(!rooms.has(code))rooms.set(code,{source:null,listeners:new Map()});return rooms.get(code);}
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
    }
    if(!room.source && room.listeners.size===0)rooms.delete(ws.room);
  }
  peers.delete(ws.id);ws.room=null;
}
wss.on("connection",ws=>{
  ws.id=crypto.randomUUID();
  ws.room=null;ws.role=null;
  ws.on("message",raw=>{
    let m;
    try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:"error",message:"JSON inválido"});}
    if(m.type==="join"&&!ws.room){
      const roomCode=String(m.room||"").toUpperCase().trim();
      const role=m.role;
      if(!/^[A-Z0-9]{8,16}$/.test(roomCode)||!["source","listener"].includes(role))return send(ws,{type:"error",message:"Sala o rol no válido"});
      const room=getRoom(roomCode);
      if(role==="source"&&room.source)return send(ws,{type:"error",message:"Esta sala ya tiene un micrófono activo"});
      ws.room=roomCode;ws.role=role;peers.set(ws.id,ws);
      if(role==="source"){
        room.source=ws;
        for(const listener of room.listeners.values())send(ws,{type:"listener-joined",id:listener.id});
      }else{
        room.listeners.set(ws.id,ws);
        if(room.source)send(room.source,{type:"listener-joined",id:ws.id});
      }
      return send(ws,{type:"joined",id:ws.id,role,room:roomCode,sourceOnline:!!room.source});
    }
    if(m.type==="signal"&&ws.room&&typeof m.to==="string"&&m.data&&typeof m.data==="object"){
      const target=peers.get(m.to),room=rooms.get(ws.room);
      if(!target||target.room!==ws.room||!room)return;
      if(!((ws===room.source&&target.role==="listener")||(ws.role==="listener"&&target===room.source)))return;
      return send(target,{type:"signal",from:ws.id,data:m.data});
    }
  });
  ws.on("close",()=>leave(ws));
  ws.on("error",()=>leave(ws));
});
if(require.main===module){
  const port=Number(process.env.PORT||3000);
  const host=process.env.HOST||"127.0.0.1";
  server.listen(port,host,()=>console.log("Howdyknw funcionando en "+(useTls?"https":"http")+"://"+(host==="0.0.0.0"?"localhost":host)+":"+port+(host==="0.0.0.0"?" (expuesto en todas las interfaces)":"")));
}
module.exports={server,wss,rooms};
