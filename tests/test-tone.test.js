"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {frame,SAMPLE_RATE,SAMPLES,FRAME_BYTES}=require("../public/test-tone");
const {deriveKey,encryptFrame,decryptFrame,rawToPcmBase64}=require("../public/e2ee");
const {decodeFrame}=require("../public/pcm-playback");

test("synthetic test signal is quiet, mono 16kHz, 20ms PCM16 and continuous",()=>{
  assert.equal(SAMPLE_RATE,16000);
  assert.equal(SAMPLES,320);
  assert.equal(FRAME_BYTES,640);
  let max=0,energy=0;
  for(let i=0;i<100;i++){
    const bytes=frame(i);
    assert.equal(bytes.length,640);
    for(let j=0;j<320;j++){
      let sample=bytes[2*j] | bytes[2*j+1]<<8;
      if(sample>32767)sample-=65536;
      max=Math.max(max,Math.abs(sample));
      energy+=sample*sample;
    }
  }
  assert.ok(max<=3277 && max>=3200);
  assert.ok(energy>0);
  assert.notDeepEqual(frame(0),frame(1));
  assert.throws(()=>frame(-1));
});

test("test signal survives full encryption/decryption and PCM decoding",async()=>{
  const key=await deriveKey("SAFE-DEMO-SECRET-NOT-IN-URL","TESTSIG1234");
  const encrypted=await encryptFrame(key,frame(0));
  const restored=await decryptFrame(key,encrypted);
  assert.deepEqual(restored,frame(0));
  assert.equal(decodeFrame(rawToPcmBase64(restored)).length,320);
});
