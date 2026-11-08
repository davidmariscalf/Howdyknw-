"use strict";
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.HowdyPcm=api;
})(typeof window!=="undefined"?window:null,function(){
  const SAMPLE_RATE=16000, BYTES_PER_FRAME=640;
  function decodeFrame(base64){
    if(typeof base64!=="string"||!(/^[A-Za-z0-9+/]{854}==$/.test(base64)))return null;
    const binary=typeof atob==="function"?atob(base64):Buffer.from(base64,"base64").toString("binary");
    if(binary.length!==BYTES_PER_FRAME)return null;
    const pcm=new Float32Array(BYTES_PER_FRAME/2);
    for(let i=0;i<pcm.length;i++){
      let value=binary.charCodeAt(i*2)|(binary.charCodeAt(i*2+1)<<8);
      if(value&0x8000)value-=0x10000;
      pcm[i]=value/32768;
    }
    return pcm;
  }
  class Player {
    constructor(){this.context=null;this.cursor=0;this.frames=0;}
    async enable(){
      const Audio=typeof window!=="undefined"?(window.AudioContext||window.webkitAudioContext):null;
      if(!Audio)throw Error("El navegador no permite reproducir PCM con Web Audio.");
      if(!this.context)this.context=new Audio({latencyHint:"interactive"});
      await this.context.resume();
    }
    play(frame){
      const values=decodeFrame(frame);
      const ctx=this.context;
      if(!values||!ctx||ctx.state!=="running")return false;
      const buffer=ctx.createBuffer(1,values.length,SAMPLE_RATE);
      buffer.copyToChannel(values,0);
      const node=ctx.createBufferSource();
      node.buffer=buffer;
      node.connect(ctx.destination);
      const now=ctx.currentTime;
      // Small latency buffer, reset if a slow listener falls far behind.
      if(this.cursor<now+0.06||this.cursor>now+0.5)this.cursor=now+0.12;
      node.start(this.cursor);
      this.cursor+=values.length/SAMPLE_RATE;
      this.frames++;
      return true;
    }
    stop(){
      const ctx=this.context;
      this.context=null;this.cursor=0;this.frames=0;
      if(ctx)void ctx.close().catch(()=>{});
    }
  }
  return {SAMPLE_RATE,BYTES_PER_FRAME,decodeFrame,Player};
});
