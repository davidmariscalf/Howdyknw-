"use strict";
const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WebSocket=require("ws");
const {server,wss}=require("../server");

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
  assert.match(await page.text(),/HOWDYKNW/);
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
