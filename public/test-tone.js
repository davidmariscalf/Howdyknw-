"use strict";
/* Safe original test signal: 440 Hz sine at approximately -20 dBFS.
 * No microphone recording is used. Frames: 20ms, 16kHz, mono PCM16.
 * The frame is encrypted by the caller; the relay sees no plaintext. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.HowdyTestTone=api;
})(typeof window!=="undefined"?window:null,function(){
  const SAMPLE_RATE=16000, SAMPLES=320, FRAME_BYTES=640;
  function frame(index){
    if(!Number.isInteger(index)||index<0||index>1000)throw Error("Índice de trama inválido");
    const out=new Uint8Array(FRAME_BYTES);
    for(let i=0;i<SAMPLES;i++){
      const sample=Math.round(Math.sin(2*Math.PI*440*(index*SAMPLES+i)/SAMPLE_RATE)*3276);
      out[2*i]=sample&255;
      out[2*i+1]=(sample>>8)&255;
    }
    return out;
  }
  return {frame,SAMPLE_RATE,SAMPLES,FRAME_BYTES};
});
