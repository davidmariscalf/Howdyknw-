"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
function read(p){return fs.readFileSync(path.join(root,p),"utf8");}
function ids(html){
  const list=[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]);
  assert.equal(new Set(list).size,list.length,"No puede haber IDs duplicados en la interfaz");
  return new Set(list);
}
function referencedIds(js){
  return [...js.matchAll(/\$\(["']([a-zA-Z0-9_-]+)["']\)/g)].map(m=>m[1]);
}

test("la interfaz web tiene todas las referencias reales del JS",()=>{
  const html=read("public/index.html");
  const available=ids(html);
  for(const name of ["public/app.js","public/experiments.js"]){
    for(const id of referencedIds(read(name))){
      assert.ok(available.has(id),name+" utiliza un ID inexistente: "+id);
    }
  }
  for(const src of html.matchAll(/<script\s+src=["']\/([^"']+)["']/g)){
    assert.ok(fs.existsSync(path.join(root,"public",src[1])),"Script no encontrado: "+src[1]);
  }
  assert.ok(available.has("relayMode"));
  assert.ok(available.has("sourceListeners"));
  assert.ok(available.has("listenerVolume"));
});

test("la interfaz Samsung tiene todas las referencias de elementos",()=>{
  const html=read("tizen-tv/index.html");
  const available=ids(html);
  for(const id of referencedIds(read("tizen-tv/app.js"))){
    assert.ok(available.has(id),"Tizen usa un ID inexistente: "+id);
  }
  assert.ok(available.has("listenerCount"));
});
