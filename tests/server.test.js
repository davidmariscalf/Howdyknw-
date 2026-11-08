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
