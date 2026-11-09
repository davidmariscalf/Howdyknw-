"use strict";
// Client-side pairing links. The encrypted audio secret is carried only in the
// URL fragment (never in the HTTP request). Remove it from address bar ASAP.
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.HowdyPairing=api;
})(typeof window!=="undefined"?window:null,function(){
  const ROOM=/^[A-Z0-9]{8,16}$/;
  function validInvite(room,key){
    return ROOM.test(room)&&typeof key==="string"&&key.length>=16&&key.length<=128;
  }
  function parseInvite(hash){
    if(typeof hash!=="string"||hash.length>400)return null;
    const params=new URLSearchParams(hash.replace(/^#/,""));
    if(params.getAll("room").length!==1||params.getAll("audioKey").length!==1)return null;
    const room=(params.get("room")||"").trim().toUpperCase();
    const audioKey=params.get("audioKey");
    return validInvite(room,audioKey)?{room,audioKey}:null;
  }
  function buildInvite(base,room,key){
    if(!validInvite(room,key))throw Error("Sala o clave de emparejamiento inválida");
    const url=new URL(base);
    if(url.protocol!=="https:"&&url.hostname!=="localhost")throw Error("Se requiere HTTPS");
    url.search="";
    url.hash=new URLSearchParams({room,audioKey:key}).toString();
    return url.href;
  }
  return {parseInvite,buildInvite,validInvite};
});
