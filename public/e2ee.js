"use strict";
/**
 * Howdyknw E2EE v1: AES-256-GCM per 20ms PCM frame, independent of WSS.
 * Secret is entered at source and receiver, never transferred to the relay.
 * PBKDF2(SHA-256, 150000, salt="howdyknw-e2ee-v1|"+room).
 * Envelope = 12-byte random nonce || 640-byte PCM ciphertext || 16-byte tag.
 * The WSS server only forwards the opaque base64 envelope.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.HowdyE2EE=api;
})(typeof window!=="undefined"?window:null,function(){
  const cryptoApi=typeof globalThis.crypto!=="undefined"&&globalThis.crypto.subtle
    ?globalThis.crypto:typeof require==="function"?require("node:crypto").webcrypto:null;
  const encoder=new TextEncoder();
  const FRAME_SIZE=640, ENVELOPE_SIZE=668;
  function validSecret(secret){
    return typeof secret==="string"&&secret.length>=16&&secret.length<=128;
  }
  function makeSecret(){
    if(!cryptoApi)throw Error("Web Crypto requiere HTTPS");
    // 20 random bytes, hex-encoded: 160 bits, easier to enter on TV than Base64.
    const bytes=cryptoApi.getRandomValues(new Uint8Array(20));
    return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
  }
  function asBase64(bytes){
    if(typeof btoa==="function"){
      let result="";
      for(const b of bytes)result+=String.fromCharCode(b);
      return btoa(result);
    }
    return Buffer.from(bytes).toString("base64");
  }
  function fromBase64(value){
    if(typeof value!=="string"||!/^[A-Za-z0-9+/]{891}=$/.test(value))throw Error("Trama cifrada inválida");
    return typeof atob==="function"
      ?Uint8Array.from(atob(value),c=>c.charCodeAt(0))
      :new Uint8Array(Buffer.from(value,"base64"));
  }
  async function deriveKey(secret,room){
    if(!cryptoApi)throw Error("Web Crypto no disponible");
    if(!validSecret(secret)||!/^[A-Z0-9]{8,16}$/.test(room))
      throw Error("Clave de audio (mínimo 16 caracteres) o sala inválida");
    const input=await cryptoApi.subtle.importKey("raw",encoder.encode(secret),"PBKDF2",false,["deriveKey"]);
    return cryptoApi.subtle.deriveKey({
      name:"PBKDF2",hash:"SHA-256",iterations:150000,
      salt:encoder.encode("howdyknw-e2ee-v1|"+room)
    },input,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  async function encryptFrame(key,raw){
    const data=new Uint8Array(raw);
    if(data.length!==FRAME_SIZE)throw Error("Trama PCM no válida");
    const iv=cryptoApi.getRandomValues(new Uint8Array(12));
    const ciphertext=new Uint8Array(await cryptoApi.subtle.encrypt(
      {name:"AES-GCM",iv,tagLength:128},key,data));
    const envelope=new Uint8Array(ENVELOPE_SIZE);
    envelope.set(iv,0);envelope.set(ciphertext,12);
    return asBase64(envelope);
  }
  async function decryptFrame(key,value){
    const envelope=fromBase64(value);
    if(envelope.length!==ENVELOPE_SIZE)throw Error("Tamaño de trama cifrada incorrecto");
    const raw=await cryptoApi.subtle.decrypt({
      name:"AES-GCM",iv:envelope.slice(0,12),tagLength:128
    },key,envelope.slice(12));
    if(raw.byteLength!==FRAME_SIZE)throw Error("PCM descifrado inválido");
    return new Uint8Array(raw);
  }
  // V2 packets authenticate their media channel, so a relay cannot relabel
  // microphone speech as TV playback or turn audio data into a screen frame.
  const MEDIA_KINDS=new Set(["voice","tv","screen"]);
  function mediaContext(kind){
    if(!MEDIA_KINDS.has(kind))throw Error("Canal multimedia no válido");
    return encoder.encode("howdyknw-media-v2|"+kind);
  }
  function decodeEnvelope(packet){
    if(typeof packet!=="string"||packet.length>130000||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(packet) ||packet.length%4!==0)
      throw Error("Sobre multimedia inválido");
    const bytes=typeof atob==="function"?
      Uint8Array.from(atob(packet),c=>c.charCodeAt(0)):
      new Uint8Array(Buffer.from(packet,"base64"));
    if(bytes.length<29 ||bytes.length>90028)throw Error("Tamaño multimedia incorrecto");
    return bytes;
  }
  async function encryptMedia(key,raw,kind){
    const data=new Uint8Array(raw);
    if(!cryptoApi ||data.length<1||data.length>90000||
       (kind!=="screen"&&data.length!==FRAME_SIZE))
      throw Error("Contenido multimedia no válido");
    const iv=cryptoApi.getRandomValues(new Uint8Array(12));
    const encrypted=new Uint8Array(await cryptoApi.subtle.encrypt(
      {name:"AES-GCM",iv,tagLength:128,additionalData:mediaContext(kind)},key,data));
    const envelope=new Uint8Array(12+encrypted.length);
    envelope.set(iv);envelope.set(encrypted,12);
    return asBase64(envelope);
  }
  async function decryptMedia(key,packet,kind){
    const bytes=decodeEnvelope(packet);
    const raw=await cryptoApi.subtle.decrypt({
      name:"AES-GCM",iv:bytes.slice(0,12),tagLength:128,
      additionalData:mediaContext(kind)
    },key,bytes.slice(12));
    if((kind==="voice"||kind==="tv")&&raw.byteLength!==FRAME_SIZE)
      throw Error("Tamaño PCM incorrecto");
    return new Uint8Array(raw);
  }
  class FrameDecryptor{
    constructor(key){
      this.key=key;
      this.recent=new Set();
    }
    async decryptMedia(packet,kind){
      const nonce=typeof packet==="string"?packet.slice(0,16):"";
      if(this.recent.has(nonce))throw Error("Contenido multimedia repetido");
      const result=await decryptMedia(this.key,packet,kind);
      this.recent.add(nonce);
      if(this.recent.size>8192)this.recent.delete(this.recent.values().next().value);
      return result;
    }
    async decryptFrame(packet,kind=null){
      if(typeof packet!=="string"||!/^[A-Za-z0-9+/]{891}=$/.test(packet))
        throw Error("Trama cifrada inválida");
      // Exactly 12 nonce bytes = 16 Base64 characters.
      const nonce=packet.slice(0,16);
      if(this.recent.has(nonce))throw Error("Trama cifrada repetida");
      const raw=kind===null?await decryptFrame(this.key,packet):await decryptMedia(this.key,packet,kind);
      this.recent.add(nonce);
      if(this.recent.size>8192)this.recent.delete(this.recent.values().next().value);
      return raw;
    }
  }
  function rawToPcmBase64(bytes){
    if(bytes.length!==FRAME_SIZE)throw Error("Tamaño PCM inválido");
    return asBase64(bytes);
  }
  return {deriveKey,encryptFrame,decryptFrame,encryptMedia,decryptMedia,makeSecret,rawToPcmBase64,validSecret,FrameDecryptor,FRAME_SIZE,ENVELOPE_SIZE};
});
