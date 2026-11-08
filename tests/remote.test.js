"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path");

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
  }finally{
    clearTimeout(timer);
    child.kill();
    try{await Promise.race([once(child,"exit"),new Promise(resolve=>setTimeout(resolve,3000))]);}catch{}
  }
});
