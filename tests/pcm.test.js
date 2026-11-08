"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {decodeFrame,BYTES_PER_FRAME,SAMPLE_RATE}=require("../public/pcm-playback.js");

test("PCM payload uses exactly 20 ms of mono 16kHz 16-bit audio",()=>{
  assert.equal(SAMPLE_RATE,16000);
  assert.equal(BYTES_PER_FRAME,640);
  const raw=Buffer.alloc(640);
  raw.writeInt16LE(32767,0);
  raw.writeInt16LE(-32768,2);
  const frame=decodeFrame(raw.toString("base64"));
  assert.equal(frame.length,320);
  assert.ok(frame[0]>0.999);
  assert.equal(frame[1],-1);
  assert.equal(frame[2],0);
});
test("PCM decoder rejects malformed/short/long transmissions",()=>{
  assert.equal(decodeFrame("AAA"),null);
  assert.equal(decodeFrame(Buffer.alloc(3).toString("base64")),null);
  assert.equal(decodeFrame(Buffer.alloc(642).toString("base64")),null);
  assert.equal(decodeFrame(null),null);
});
