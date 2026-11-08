"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {normalizeReport,compareReports,csvExport}=require("../public/report-utils.js");
const on=require("../public/examples/encendida.json");
const standby=require("../public/examples/reposo.json");

test("accepts both monitoring formats and aggregates by IP",()=>{
  const a=normalizeReport(on),b=normalizeReport(standby);
  assert.equal(a.tv_ip,"192.168.1.50");
  assert.equal(a.totals.sent,54500);
  assert.equal(a.totals.received,279000);
  assert.equal(a.destinations.length,3);
  assert.ok(a.destinations.some(d=>d.ports.includes("53")));
  assert.equal(b.totals.sent,23000);
  assert.equal(b.totals.received,0);
  assert.equal(b.duration_seconds,180);
  assert.ok(b.destinations.some(d=>d.domains.includes("heartbeat.example")));
});
test("same destination with multiple ports is one IP in the interface",()=>{
  const r=normalizeReport({...standby,destinations:[
    {ip:"203.0.113.1",port:"443",bytes:300,packets:2,tls_sni:["example.org"]},
    {ip:"203.0.113.1",port:"853",bytes:400,packets:3,tls_sni:["other.example"]}
  ]});
  assert.equal(r.destinations.length,1);
  assert.equal(r.totals.sent,700);
  assert.deepEqual(r.destinations[0].ports,["443","853"]);
  assert.deepEqual(r.destinations[0].domains,["example.org","other.example"]);
});
test("comparison shows new and absent IPs and checks duration",()=>{
  const diff=compareReports(normalizeReport(on),normalizeReport(standby));
  assert.deepEqual(diff.newIps,["203.0.113.87"]);
  assert.deepEqual(diff.absentIps,["198.51.100.45","192.168.1.1"]);
  assert.equal(diff.sharedIps,1);
  assert.equal(diff.comparableDuration,true);
});
test("mismatched devices and unsupported JSON are not silently compared",()=>{
  assert.throws(()=>compareReports(normalizeReport(on),
    normalizeReport({...standby,tv_ip:"192.168.1.31"})),/IP de TV/);
  assert.throws(()=>normalizeReport({destinations:[],tv_ip:"192.168.1.50"}),/Formato/);
  assert.throws(()=>normalizeReport({destinations:"oops",tv_ip:"192.168.1.50"}),/válido/);
});
test("CSV export keeps malicious domain text inert",()=>{
  const d=normalizeReport({...on,destinations:[{
    ip:"203.0.113.1",domains:['=HYPERLINK("https://bad.example")'],ports:[443],
    sent_bytes:10,received_bytes:4,packets:1
  }]});
  const csv=csvExport(d);
  assert.match(csv,/'=HYPERLINK/);
  assert.match(csv,/\r\n/);
  assert.match(csv,/203\.0\.113\.1/);
});
