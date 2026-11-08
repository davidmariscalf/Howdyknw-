"use strict";
/* Audio capture for explicit WSS relaying across separate networks.
 * Uses the browser's authorized microphone track. Audio does not originate
 * from restricted TV hardware. The relay server can access PCM in transit. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 if(root)root.HowdyPcmCapture=api;
})(typeof window!=="undefined"?window:null,function(){
 class Encoder{
   constructor(inputRate,onFrame){
     if(!Number.isFinite(inputRate)||inputRate<16000)throw Error("Frecuencia de audio no válida");
     this.sampleRate=inputRate;this.callback=onFrame;this.phase=0;
     this.buffer=new Uint8Array(640);this.offset=0;
   }
   push(input){
     for(let i=0;i<input.length;i++){
       this.phase+=16000;
       if(this.phase<this.sampleRate)continue;
       this.phase-=this.sampleRate;
       const value=Math.max(-1,Math.min(1,input[i]||0));
       const pcm=value<0?Math.round(value*32768):Math.round(value*32767);
       this.buffer[this.offset++]=pcm&255;
       this.buffer[this.offset++]=(pcm>>8)&255;
       if(this.offset===640){
         this.callback(this.buffer);
         this.buffer=new Uint8Array(640);this.offset=0;
       }
     }
   }
 }
 class Capture{
   constructor(stream,onFrame){this.stream=stream;this.onFrame=onFrame;this.context=null;this.processor=null;this.source=null;this.mute=null;}
   async start(){
     const Ctx=window.AudioContext||window.webkitAudioContext;
     if(!Ctx)throw Error("Web Audio no disponible");
     const context=new Ctx();
     try{
       if(typeof context.createScriptProcessor!=="function")
         throw Error("El navegador no permite la captura PCM para retransmisión");
       const encoder=new Encoder(context.sampleRate,this.onFrame);
       const source=context.createMediaStreamSource(this.stream);
       const processor=context.createScriptProcessor(2048,1,1);
       const mute=context.createGain();mute.gain.value=0;
       processor.onaudioprocess=e=>{
         e.outputBuffer.getChannelData(0).fill(0);
         encoder.push(e.inputBuffer.getChannelData(0));
       };
       source.connect(processor);processor.connect(mute);mute.connect(context.destination);
       this.context=context;this.source=source;this.processor=processor;this.mute=mute;
       await context.resume();
     }catch(e){await context.close();throw e;}
   }
   stop(){
     if(this.processor)this.processor.onaudioprocess=null;
     for(const node of [this.source,this.processor,this.mute]){
       try{node?.disconnect();}catch{}
     }
     this.context?.close().catch(()=>{});
     this.context=null;this.source=null;this.processor=null;this.mute=null;
   }
 }
 function toBase64(bytes){
   let result="";
   for(let i=0;i<bytes.length;i++)result+=String.fromCharCode(bytes[i]);
   return btoa(result);
 }
 return {Encoder,Capture,toBase64};
});
