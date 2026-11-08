"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {makeRecord}=require("../public/experiments.js");
const sample={
  model:"LG SAMPLE 55",firmware:"webOS test",
  configured_tv_ip:"192.168.1.50",power_state:"standby",
  voice_mode:"desactivada",
  observation:"Prueba ficticia en sala; solo se documentó actividad de red."
};
test("exports valid manual record with strict evidence level",()=>{
  const out=makeRecord(sample,"2026-11-08T22:00:00Z");
  assert.equal(out.tv_power_state,"standby");
  assert.equal(out.evidence_level,"manual-not-verified");
  assert.equal(out.internal_microphone_audio_access,false);
  assert.equal(out.recording_attached,false);
  assert.ok(!JSON.stringify(out).includes("audio_verified"));
});
test("rejects missing observations and unsupported modes",()=>{
  assert.throws(()=>makeRecord({...sample,model:""},"2026-11-08T22:00:00Z"),/modelo/);
  assert.throws(()=>makeRecord({...sample,observation:""},"2026-11-08T22:00:00Z"),/observación/);
  assert.throws(()=>makeRecord({...sample,power_state:"secret"}, "2026-11-08T22:00:00Z"),/Estado/);
});
