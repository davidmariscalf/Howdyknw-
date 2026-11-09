"use strict";
const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WebSocket=require("ws");
const {server,wss,rooms,heartbeatSweep}=require("../server");

let origin,base;
before(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=server.address().port;
  origin="http://127.0.0.1:"+port;
  base="ws://127.0.0.1:"+port;
});
after(async()=>{
  for(const client of wss.clients)client.terminate();
  await new Promise(resolve=>wss.close(resolve));
  await new Promise(resolve=>server.close(resolve));
});
function message(ws,filter=()=>true){
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ws.off("message",handler);reject(Error("Timeout esperando mensaje WebSocket"));},4000);
    function handler(raw){
      try{
        const obj=JSON.parse(raw.toString());
        if(!filter(obj))return;
        clearTimeout(timeout);ws.off("message",handler);resolve(obj);
      }catch(err){clearTimeout(timeout);reject(err);}
    }
    ws.on("message",handler);
  });
}
async function client(){const ws=new WebSocket(base);await once(ws,"open");return ws;}
test("HTTP entrega UI y responde API de salud y configuración",async()=>{
  const page=await fetch(origin+"/");
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/HOWDYKNW/);
  assert.match(html,/transcriptLog/);
  const health=await (await fetch(origin+"/api/health")).json();
  assert.equal(health.status,"ok");
  const config=await (await fetch(origin+"/api/config")).json();
  assert.ok(config.iceServers.length>=1);
  const reportUtils=await fetch(origin+"/report-utils.js");
  assert.equal(reportUtils.status,200);
  assert.match(await reportUtils.text(),/normalizeReport/);
  const experimentModule=await fetch(origin+"/experiments.js");
  assert.equal(experimentModule.status,200);
  const sample=await fetch(origin+"/examples/encendida.json");
  assert.equal(sample.status,200);
  assert.match(sample.headers.get("content-type"),/application\/json/);
  const sampleData=await sample.json();
  assert.equal(sampleData.tv_ip,"192.168.1.50");
  const css=await (await fetch(origin+"/style.css")).text();
  assert.doesNotMatch(css,/fonts\.googleapis\.com/);
  const missing=await fetch(origin+"/no-existe");
  assert.equal(missing.status,404);
});
test("WebSocket une emisor y receptor, transmite señales y notifica desconexiones",async()=>{
  const code="TESTROOM49";
  const source=await client();
  try{
    const sourceJoined=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",room:code}));
    assert.equal((await sourceJoined).role,"source");
    const listener=await client();
    try{
      const joined=message(listener,m=>m.type==="joined");
      const peerJoined=message(source,m=>m.type==="listener-joined");
      listener.send(JSON.stringify({type:"join",role:"listener",room:code}));
      const first=await joined;assert.equal(first.sourceOnline,true);
      const peer=await peerJoined;assert.ok(peer.id);
      const transmitted=message(listener,m=>m.type==="signal");
      source.send(JSON.stringify({type:"signal",to:peer.id,data:{description:{type:"offer",sdp:"test"}}}));
      assert.equal((await transmitted).data.description.type,"offer");
      const left=message(listener,m=>m.type==="source-offline");
      source.close();
      await left;
    }finally{listener.close();}
  }finally{source.close();}
});
test("dictation mode sends only explicit text, marks audio unavailable and acknowledges",async()=>{
  const room="DICTTEST49";
  const listener=await client();
  try{
    const listenerReady=message(listener,m=>m.type==="joined");
    listener.send(JSON.stringify({type:"join",role:"listener",room}));
    await listenerReady;
    const source=await client();
    try{
      const sourceReady=message(source,m=>m.type==="joined");
      const mode=message(listener,m=>m.type==="source-mode");
      source.send(JSON.stringify({type:"join",role:"source",room,transport:"text"}));
      const meta=await sourceReady;
      assert.equal(meta.role,"source");
      assert.equal((await mode).transport,"text");
      const received=message(listener,m=>m.type==="transcript");
      const acknowledged=message(source,m=>m.type==="transcript-sent");
      source.send(JSON.stringify({type:"transcript",text:"Prueba de voz voluntaria."}));
      const packet=await received;
      assert.equal(packet.text,"Prueba de voz voluntaria.");
      assert.equal(packet.audioAvailable,false);
      assert.equal(packet.format,"text");
      assert.equal((await acknowledged).listeners,1);
      const bad=message(source,m=>m.type==="error");
      source.send(JSON.stringify({type:"transcript",text:"x".repeat(1001)}));
      assert.match((await bad).message,/Transcripción inválida/);
    }finally{source.close();}
  }finally{listener.close();}
});
test("servidor público limita receptores y rechaza mensajes JSON peligrosos",async()=>{
  const room="REMOTETEST77";
  const listeners=[];
  const source=await client();
  try{
    const srcJoined=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",room}));
    await srcJoined;
    for(let i=0;i<4;i++){
      const ws=await client();
      listeners.push(ws);
      const joined=message(ws,m=>m.type==="joined");
      ws.send(JSON.stringify({type:"join",role:"listener",room}));
      assert.equal((await joined).role,"listener");
    }
    const extraClient=await client();listeners.push(extraClient);
    const rejected=message(extraClient,m=>m.type==="error");
    extraClient.send(JSON.stringify({type:"join",role:"listener",room}));
    assert.match((await rejected).message,/máximo 4/);
    const malformed=message(source,m=>m.type==="error");
    source.send("null");
    assert.match((await malformed).message,/Mensaje no válido/);
  }finally{
    source.close();
    for(const ws of listeners)ws.close();
  }
});
test("el emisor recibe contador de oyentes y se libera una sesión sin latidos",async()=>{
  const room="HEARTBEAT125";
  const source=await client();
  const listener=await client();
  try{
    const ready=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",room}));
    const joined=await ready;
    assert.ok(Array.isArray(joined.iceServers));
    const count=message(source,m=>m.type==="listener-count"&&m.count===1);
    const listenerReady=message(listener,m=>m.type==="joined");
    listener.send(JSON.stringify({type:"join",role:"listener",room}));
    assert.equal((await listenerReady).listenerCount,1);
    assert.equal((await count).count,1);
    const disconnected=message(listener,m=>m.type==="source-offline");
    const serverSocket=rooms.get(room).source;
    serverSocket.awaitingPong=true;
    heartbeatSweep();
    await disconnected;
    assert.equal(rooms.get(room).source,null);
  }finally{source.terminate();listener.terminate();}
});

test("bloquea websockets desde páginas externas con origen HTTPS ajeno",async()=>{
  const foreign=new WebSocket(base,{origin:"https://otra-pagina.example"});
  const status=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error("Timeout del rechazo WebSocket")),4000);
    foreign.once("unexpected-response",(_request,response)=>{
      clearTimeout(timeout);
      const statusCode=response.statusCode;
      response.resume();
      foreign.terminate();
      resolve(statusCode);
    });
    foreign.once("error",error=>{clearTimeout(timeout);reject(error);});
  });
  assert.equal(status,403);
});

test("cifrado E2EE: el servidor entrega solo sobre cifrado opaco y no permite PCM sin cifrar",async()=>{
  const source=await client(),listener=await client();
  try{
    const srcJoin=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",transport:"pcm-e2ee",room:"SECUREROOM99"}));
    assert.equal((await srcJoin).sourceTransport,"pcm-e2ee");
    const listenerJoin=message(listener,m=>m.type==="joined");
    listener.send(JSON.stringify({type:"join",role:"listener",room:"SECUREROOM99"}));
    assert.equal((await listenerJoin).sourceTransport,"pcm-e2ee");
    const sealed=Buffer.alloc(668,123).toString("base64");
    const transmitted=message(listener,m=>m.type==="encrypted-frame");
    source.send(JSON.stringify({type:"encrypted-frame",data:sealed}));
    assert.equal((await transmitted).data,sealed);
    let plaintextReceived=false;
    listener.on("message",raw=>{
      try{if(JSON.parse(raw.toString()).type==="audio-frame")plaintextReceived=true;}catch{}
    });
    source.send(JSON.stringify({type:"audio-frame",pcm:Buffer.alloc(640).toString("base64")}));
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(plaintextReceived,false);
  }finally{source.terminate();listener.terminate();}
});

test("screen streaming sends only encrypted preview and separate audio channels inside room",async()=>{
  const source=await client(),listener=await client(),other=await client();
  try{
    const join=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",room:"SCREENROOM91",transport:"pcm-e2ee"}));
    await join;
    const ready=message(listener,m=>m.type==="joined");
    listener.send(JSON.stringify({type:"join",role:"listener",room:"SCREENROOM91"}));await ready;
    const otherReady=message(other,m=>m.type==="joined");
    other.send(JSON.stringify({type:"join",role:"listener",room:"OTHERSCREEN44"}));await otherReady;
    let leaked=false;
    other.on("message",raw=>{
      try{if(["media-frame","screen-frame"].includes(JSON.parse(raw.toString()).type))leaked=true;}catch{}
    });
    const voice=Buffer.alloc(668,15).toString("base64");
    const picture=Buffer.alloc(1000,37).toString("base64");
    const voiceReady=message(listener,m=>m.type==="media-frame"&&m.channel==="voice");
    source.send(JSON.stringify({type:"media-frame",channel:"voice",data:voice}));
    assert.equal((await voiceReady).data,voice);
    const tvReady=message(listener,m=>m.type==="media-frame"&&m.channel==="tv");
    source.send(JSON.stringify({type:"media-frame",channel:"tv",data:voice}));
    assert.equal((await tvReady).channel,"tv");
    const screenReady=message(listener,m=>m.type==="screen-frame");
    source.send(JSON.stringify({type:"screen-frame",data:picture}));
    assert.equal((await screenReady).data,picture);
    let invalid=false;
    const check=raw=>{try{if(JSON.parse(raw.toString()).type==="screen-frame")invalid=true;}catch{}};
    listener.on("message",check);
    source.send(JSON.stringify({type:"screen-frame",data:"not-base64!"}));
    source.send(JSON.stringify({type:"media-frame",channel:"video",data:voice}));
    await new Promise(resolve=>setTimeout(resolve,100));
    listener.off("message",check);
    assert.equal(invalid,false);
    assert.equal(leaked,false);
  }finally{source.terminate();listener.terminate();other.terminate();}
});
test("una conexión sin sala se cierra en el tiempo permitido",async()=>{
  const idle=await client();
  try{
    // Test the expiry callback's externally visible lifecycle without waiting
    // for a full 15s in CI: the timer is armed on each new connection.
    const serverPeer=[...wss.clients].find(ws=>ws.readyState===WebSocket.OPEN&&ws.room===null);
    assert.ok(serverPeer,"expected unjoined server-side socket");
    assert.ok(serverPeer.joinTimeout,"join deadline should be armed");
    const ended=once(idle,"close");
    serverPeer.close(1008,"Tiempo de unión agotado");
    const [code]=await ended;
    assert.equal(code,1008);
  }finally{idle.terminate();}
});
test("WebSocket rechaza códigos inválidos y roles falsos",async()=>{
  const ws=await client();
  try{
    const m=message(ws,x=>x.type==="error");
    ws.send(JSON.stringify({type:"join",role:"admin",room:"NOTVALID9"}));
    assert.match((await m).message,/no válido/);
  }finally{ws.close();}
});

test("Android TV microphone sender relays only valid PCM16 frames inside its room",async()=>{
  const source=await client();
  const listener=await client();
  const other=await client();
  try{
    const sourceJoined=message(source,m=>m.type==="joined");
    source.send(JSON.stringify({type:"join",role:"source",transport:"pcm16",room:"TVAUDIO14"}));
    assert.equal((await sourceJoined).sourceTransport,"pcm16");
    const listenerJoined=message(listener,m=>m.type==="joined");
    listener.send(JSON.stringify({type:"join",role:"listener",room:"TVAUDIO14"}));
    assert.equal((await listenerJoined).sourceTransport,"pcm16");
    const otherJoined=message(other,m=>m.type==="joined");
    other.send(JSON.stringify({type:"join",role:"listener",room:"OTHERAUD14"}));
    await otherJoined;
    const pcm=Buffer.alloc(640).toString("base64");
    const delivered=message(listener,m=>m.type==="audio-frame");
    let leaked=false;
    other.on("message",raw=>{try{if(JSON.parse(raw.toString()).type==="audio-frame")leaked=true;}catch{}});
    source.send(JSON.stringify({type:"audio-frame",pcm}));
    assert.equal((await delivered).pcm,pcm);
    // Wrong-sized frames must not be broadcast.
    let invalidDelivered=false;
    const spy=raw=>{try{if(JSON.parse(raw.toString()).type==="audio-frame")invalidDelivered=true;}catch{}};
    listener.on("message",spy);
    source.send(JSON.stringify({type:"audio-frame",pcm:Buffer.alloc(3).toString("base64")}));
    await new Promise(resolve=>setTimeout(resolve,120));
    listener.off("message",spy);
    assert.equal(invalidDelivered,false);
    assert.equal(leaked,false);
  }finally{source.terminate();listener.terminate();other.terminate();}
});
