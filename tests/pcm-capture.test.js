"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {Encoder,toBase64}=require("../public/pcm-capture");
test("PCM 48k → 16k packs one 20ms mono frame",()=>{
  let frames=[];
  const e=new Encoder(48000,b=>frames.push(b));
  e.push(new Float32Array(960).fill(0.5));
  assert.equal(frames.length,1);
  assert.equal(frames[0].length,640);
  assert.equal(toBase64(frames[0]).length,856);
  assert.equal(frames[0][0],255);
  assert.equal(frames[0][1],63);
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
