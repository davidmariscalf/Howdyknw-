"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {deriveKey,encryptFrame,decryptFrame,makeSecret,rawToPcmBase64}=require("../public/e2ee.js");
const {decodeFrame}=require("../public/pcm-playback.js");

test("AES-256-GCM E2EE frames are authenticated and decrypt into original PCM",async()=>{
  const room="E2EETEST1234";
  const secret=makeSecret();
  assert.match(secret,/^[A-F0-9]{40}$/);
  const source=await deriveKey(secret,room);
  const receiver=await deriveKey(secret,room);
  const pcm=Uint8Array.from({length:640},(_,i)=>i&255);
  const sealed=await encryptFrame(source,pcm);
  assert.match(sealed,/^[A-Za-z0-9+/]{891}=$/);
  assert.equal(Buffer.from(sealed,"base64").length,668);
  assert.equal(Buffer.from(sealed,"base64").includes(pcm),false);
  const restored=await decryptFrame(receiver,sealed);
  assert.deepEqual(restored,pcm);
  assert.equal(decodeFrame(rawToPcmBase64(restored)).length,320);
  assert.notEqual(await encryptFrame(source,pcm),sealed,"nonces must differ");
});

test("wrong independent secret, wrong room, and tampered GCM frames are rejected",async()=>{
  const key=await deriveKey("MY-SEPARATE-VOICE-SECRET", "TESTRM123456");
  const bad=await deriveKey("ANOTHER-VOICE-SECRET", "TESTRM123456");
  const wrongRoom=await deriveKey("MY-SEPARATE-VOICE-SECRET", "OTHERROOM99");
  const payload=await encryptFrame(key,new Uint8Array(640).fill(91));
  await assert.rejects(()=>decryptFrame(bad,payload));
  await assert.rejects(()=>decryptFrame(wrongRoom,payload));
  const corrupted=Buffer.from(payload,"base64");
  corrupted[25]^=1;
  await assert.rejects(()=>decryptFrame(key,corrupted.toString("base64")));
  assert.rejects(()=>deriveKey("too-short","TESTRM123456"),/Clave/);
});
