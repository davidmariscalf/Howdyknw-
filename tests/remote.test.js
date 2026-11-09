"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");
const WebSocket=require("ws");
const {deriveKey,encryptFrame,decryptFrame}=require("../public/e2ee.js");

test("remote launcher serves HTTPS-ready UI but blocks local TV reports",async()=>{
  const child=spawn(process.execPath,[path.resolve(__dirname,"../scripts/remote-server.js")],{
    env:{...process.env,PORT:"0"},stdio:["ignore","pipe","pipe"]
  });
  let output="";
  let timer;
  try{
    const url=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error("Remote server startup timeout: "+output)),5000);
      child.stdout.on("data",chunk=>{
        output+=chunk.toString();
        const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if(match){clearTimeout(timer);resolve(match[0]);}
      });
      child.on("error",reject);
      child.once("exit",code=>reject(new Error("Server exited: "+code)));
    });
    const health=await fetch(url+"/api/health");
    assert.equal(health.status,200);
    const data=await fetch(url+"/api/report");
    assert.equal(data.status,403);
    assert.match((await data.json()).error,/deshabilitado/);
    const page=await fetch(url+"/");
    assert.equal(page.status,200);
    assert.equal(page.headers.get("referrer-policy"),"no-referrer");
    assert.match(await page.text(),/Modo distancia/);
    const endpoint=url.replace(/^http:/,"ws:");
    const plain=new WebSocket(endpoint);
    await once(plain,"open");
    const denied=new Promise((resolve,reject)=>{
      plain.once("message",raw=>{try{resolve(JSON.parse(raw.toString()));}catch(e){reject(e);}});
    });
    plain.send(JSON.stringify({type:"join",role:"source",room:"PUBLICROOM12",transport:"pcm16"}));
    assert.match((await denied).message,/exige cifrado de extremo a extremo/);
    plain.close();

    const source=new WebSocket(endpoint);
    const listener=new WebSocket(endpoint);
    await Promise.all([once(source,"open"),once(listener,"open")]);
    try{
      const srcReady=new Promise(resolve=>source.once("message",raw=>resolve(JSON.parse(raw.toString()))));
      source.send(JSON.stringify({type:"join",role:"source",room:"PUBLICROOM12",transport:"pcm-e2ee"}));
      assert.equal((await srcReady).sourceTransport,"pcm-e2ee");
      const listenerReady=new Promise(resolve=>listener.once("message",raw=>resolve(JSON.parse(raw.toString()))));
      listener.send(JSON.stringify({type:"join",role:"listener",room:"PUBLICROOM12"}));
      assert.equal((await listenerReady).sourceTransport,"pcm-e2ee");
      const key=await deriveKey("TOTALLY-SEPARATE-AUDIO-SECRET","PUBLICROOM12");
      const raw=new Uint8Array(640).fill(23);
      const sealed=await encryptFrame(key,raw);
      const delivered=new Promise(resolve=>listener.once("message",msg=>resolve(JSON.parse(msg.toString()))));
      source.send(JSON.stringify({type:"encrypted-frame",data:sealed}));
      const received=await delivered;
      assert.equal(received.type,"encrypted-frame");
      assert.deepEqual(await decryptFrame(key,received.data),raw);
    }finally{source.terminate();listener.terminate();}
  }finally{
    clearTimeout(timer);
    child.kill();
    try{await Promise.race([once(child,"exit"),new Promise(resolve=>setTimeout(resolve,3000))]);}catch{}
  }
});
