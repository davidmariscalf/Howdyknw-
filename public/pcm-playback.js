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
    constructor(sharedContext=null){
      this.context=sharedContext;
      this.ownsContext=!sharedContext;
      this.output=null;this.volume=0.75;this.cursor=0;this.frames=0;
    }
    async enable(){
      if(!this.context){
        const Audio=typeof window!=="undefined"?(window.AudioContext||window.webkitAudioContext):null;
        if(!Audio)throw Error("El navegador no permite reproducir PCM con Web Audio.");
        this.context=new Audio({latencyHint:"interactive"});
        this.ownsContext=true;
      }
      if(!this.output){
        this.output=this.context.createGain();
        this.output.gain.value=this.volume;
        this.output.connect(this.context.destination);
      }
      await this.context.resume();
    }
    setVolume(value){
      const normalized=Math.min(1,Math.max(0,Number(value)||0));
      this.volume=normalized;
      if(this.output) this.output.gain.value=normalized;
    }
    play(frame){
      const values=decodeFrame(frame);
      const ctx=this.context;
      if(!values||!ctx||ctx.state!=="running")return false;
      const buffer=ctx.createBuffer(1,values.length,SAMPLE_RATE);
      buffer.copyToChannel(values,0);
      const node=ctx.createBufferSource();
      node.buffer=buffer;
      node.connect(this.output||ctx.destination);
      const now=ctx.currentTime;
      // Small latency buffer, reset if a slow listener falls far behind.
      if(this.cursor<now+0.06||this.cursor>now+0.5)this.cursor=now+0.12;
      node.start(this.cursor);
      this.cursor+=values.length/SAMPLE_RATE;
      this.frames++;
      return true;
    }
    stop(){
      const ctx=this.context,output=this.output,owned=this.ownsContext;
      this.context=null;this.output=null;this.cursor=0;this.frames=0;
      if(output)try{output.disconnect();}catch{}
      if(ctx&&owned)void ctx.close().catch(()=>{});
    }
  }
  return {SAMPLE_RATE,BYTES_PER_FRAME,decodeFrame,Player};
});
