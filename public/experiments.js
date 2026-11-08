"use strict";
(function (root, factory) {
  const api=factory();
  if (typeof module==="object"&&module.exports)module.exports=api;
  if (root)root.HowdyExperiment=api;
  if(typeof document!=="undefined"){
    const $=id=>document.getElementById(id);
    $("exportExperiment").addEventListener("click",()=>{
      try{
        const result=api.makeRecord({
          model:$("tvModel").value,
          firmware:$("tvFirmware").value,
          power_state:$("tvPowerState").value,
          voice_mode:$("tvVoiceMode").value,
          observation:$("tvObservation").value,
          configured_tv_ip:$("tvIp").value
        }, new Date().toISOString());
        const blob=new Blob([JSON.stringify(result,null,2)+"\n"],{type:"application/json"});
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");
        a.href=url;a.download="howdyknw-auditoria-"+result.observed_at.slice(0,10)+".json";
        a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
        $("experimentStatus").textContent="Acta creada localmente. Evidencia: observación manual no verificada.";
      }catch(err){
        $("experimentStatus").textContent=err.message;
      }
    });
  }
})(typeof window!=="undefined"?window:null,function(){
  function trim(value,max){
    return typeof value==="string"?value.trim().slice(0,max):"";
  }
  function makeRecord(values,isoDate){
    if(!values||typeof values!=="object")throw Error("Faltan datos del experimento.");
    const model=trim(values.model,120);
    const observation=trim(values.observation,4000);
    if(!model)throw Error("Indica el modelo exacto de TV para guardar el acta.");
    if(!observation)throw Error("Añade una observación concreta antes de exportar.");
    if(Number.isNaN(Date.parse(isoDate)))throw Error("Fecha inválida.");
    const power=trim(values.power_state,50);
    const voice=trim(values.voice_mode,70);
    if(!["encendida","standby","desenchufada"].includes(power))
      throw Error("Estado de alimentación no válido.");
    if(!["desconocida","desactivada","activada-sin-comando","activada-por-comando"].includes(voice))
      throw Error("Modo de voz no válido.");
    return {
      schema:1,
      source:"howdyknw_manual_experiment",
      observed_at:new Date(isoDate).toISOString(),
      tv_model:model,
      tv_firmware:trim(values.firmware,120)||null,
      configured_tv_ip:trim(values.configured_tv_ip,128)||null,
      tv_power_state:power,
      voice_mode:voice,
      observation,
      evidence_level:"manual-not-verified",
      internal_microphone_audio_access:false,
      recording_attached:false,
      note:"Los datos del acta los proporciona quien realiza la prueba. No verifica captura de audio ni transmisión de voz."
    };
  }
  return {makeRecord};
});
