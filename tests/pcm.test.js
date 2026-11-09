"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {decodeFrame,BYTES_PER_FRAME,SAMPLE_RATE,Player}=require("../public/pcm-playback.js");

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

test("PCM playback volume is clamped safely",()=>{
  const p=new Player();
  assert.equal(p.volume,0.75);
  p.setVolume(0.3);
  assert.equal(p.volume,0.3);
  p.setVolume(2);
  assert.equal(p.volume,1);
  p.setVolume(-1);
  assert.equal(p.volume,0);
});

test("TV and voice players share a single AudioContext without one stopping the other",async()=>{
  let closed=0,created=0;
  const context={
    state:"running",currentTime:0,destination:{},
    createGain(){created++;return {gain:{value:0},connect(){},disconnect(){}};},
    createBuffer(){return {copyToChannel(){}};},
    createBufferSource(){return {connect(){},start(){}};},
    async resume(){this.state="running";},
    async close(){closed++;}
  };
  const voice=new Player(context),tv=new Player(context);
  await voice.enable();await tv.enable();
  assert.equal(created,2);
  voice.setVolume(0.25);tv.setVolume(0.75);
  assert.equal(voice.output.gain.value,0.25);
  assert.equal(tv.output.gain.value,0.75);
  const pcm=Buffer.alloc(640).toString("base64");
  assert.equal(voice.play(pcm),true);
  voice.stop();
  assert.equal(closed,0,"one channel must not close the shared audio engine");
  assert.equal(tv.play(pcm),true,"TV must keep playing when microphone track ends");
  tv.stop();
  assert.equal(closed,0);
  await context.close();
  assert.equal(closed,1);
});
