"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {parseInvite,buildInvite,validInvite}=require("../public/pairing.js");

test("one-scan QR link safely imports the room and independent E2EE key",()=>{
  const room="M4KP8D3RU9QB",key="A9C10A62EE29BABBEBB8EEB3D398B67B";
  const link=buildInvite("https://howdyknw-production.up.railway.app/",room,key);
  const url=new URL(link);
  assert.equal(url.hostname,"howdyknw-production.up.railway.app");
  assert.equal(url.search,"","secret must never be in HTTP query");
  assert.equal(url.pathname,"/");
  assert.ok(!url.origin.includes(key));
  assert.deepEqual(parseInvite(url.hash),{room,audioKey:key});
  assert.ok(validInvite(room,key));
});

test("pairing rejects unsafe endpoints, incomplete keys and duplicated URL params",()=>{
  assert.throws(()=>buildInvite("http://insecure.example/","ABCD1234","1234567890abcdef"),/HTTPS/);
  assert.throws(()=>buildInvite("https://trusted.example/","short","1234567890abcdef"),/Sala/);
  assert.equal(parseInvite("#room=ABCD1234"),null);
  assert.equal(parseInvite("#room=ABCD1234&audioKey=short"),null);
  assert.equal(parseInvite("#room=ABCD1234&room=OVERWRITE1234&audioKey=1234567890abcdef"),null);
  assert.equal(parseInvite("#room=ABCD1234&audioKey=1234567890abcdef&audioKey=1234567890abcdef"),null);
  assert.equal(parseInvite("#room=ABCDEFGH&audioKey="+("z".repeat(180))),null);
  assert.equal(parseInvite(100),null);
});
