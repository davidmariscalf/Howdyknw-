"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {Encoder,toBase64,canRelay}=require("../public/pcm-capture");
test("PCM 48k → 16k packs one 20ms mono frame",()=>{
  let frames=[];
  const e=new Encoder(48000,b=>frames.push(b));
  e.push(new Float32Array(960).fill(0.5));
  assert.equal(frames.length,1);
  assert.equal(frames[0].length,640);
  assert.equal(toBase64(frames[0]).length,856);
  assert.equal(frames[0][0],0);
  assert.equal(frames[0][1],64);
});
test("PCM 44.1k → 16k maintains sample cadence",()=>{
  let frames=0;
  const e=new Encoder(44100,()=>{frames++});
  e.push(new Float32Array(44100).fill(-1));
  assert.equal(frames,50);
});
test("invalid sample rate rejected",()=>{
  assert.throws(()=>new Encoder(0,()=>{}),/Frecuencia/);
});

test("no microphone audio leaves browser without a receiver or under backlog",()=>{
  assert.equal(canRelay(0,true,0),false);
  assert.equal(canRelay(1,false,0),false);
  assert.equal(canRelay(1,true,128000),false);
  assert.equal(canRelay(1,true,127999),true);
  assert.equal(canRelay(4,true,0),true);
  assert.equal(canRelay(-1,true,0),false);
});
