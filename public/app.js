"use strict";
const $=id=>document.getElementById(id);
const ROOM_PATTERN=/^[A-Z0-9]{8,16}$/;
const session={source:null,listener:null,stream:null,relayContext:null,peers:new Map(),incoming:null,ice:{iceServers:[{urls:"stun:stun.l.google.com:19302"}]}};
let pcmPlayer=null;
let pcmSource=null;
let nativeAudioMode=false;
let listenerKeyPromise=null;
let remoteRequiresE2EE=false;
try{$("sourceSecret").value=HowdyE2EE.makeSecret();}
catch{$("sourceSecret").value="";}
$("newAudioKey").addEventListener("click",()=>{
  if(session.stream)return;
  try{
    $("sourceSecret").value=HowdyE2EE.makeSecret();
    setStatus("source","Clave de audio nueva. Compártela únicamente con el receptor.");
  }catch{
    setStatus("source","La generación segura de clave requiere HTTPS o localhost.","error");
  }
});
const volumeControl=$("listenerVolume");
function applyListenerVolume(){
  const volume=Number(volumeControl.value)/100;
  $("volumeValue").textContent=Math.round(volume*100)+" %";
  $("audioPlayer").volume=volume;
  pcmPlayer?.setVolume(volume);
}
volumeControl.addEventListener("input",applyListenerVolume);
applyListenerVolume();
function setNativeMode(active){
  nativeAudioMode=active;
  $("pcmNotice").hidden=!active;
  $("audioPlayer").hidden=active;
  if(active)setStatus("listener","Audio nativo de TV disponible. Esperando tramas PCM…","live");
}
function browserRequirements(){
  const secure=window.isSecureContext===true;
  const mic=Boolean(navigator.mediaDevices?.getUserMedia);
  const rtc=typeof window.RTCPeerConnection==="function";
  const ws=typeof window.WebSocket==="function";
  const el=$("audioSupport");
  el.textContent=(!secure?"Sin contexto seguro: usa HTTPS o localhost. ":
    "Contexto HTTPS/localhost válido. ")+
    (!mic?"Este navegador no permite activar el micrófono. ":"API de micrófono disponible (requiere permiso). ")+
    (!rtc?"WebRTC no compatible. ":"WebRTC compatible. ")+
    (!ws?"WebSocket no disponible. ":"Señalización disponible.");
  el.classList.toggle("unsupported",!secure||!mic||!rtc||!ws);
}
function updateRemoteAccessInfo(){
  const hostname=location.hostname;
  const local=/^(?:localhost$|127\\.|10\\.|192\\.168\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.|\\[?::1\\]?$)/i.test(hostname) ||
    hostname.endsWith(".local");
  const secure=location.protocol==="https:";
  const publicUrl=secure&&!local;
  const wssUrl=(secure?"wss://":"ws://")+location.host+"/";
  $("remoteServerAddress").textContent=wssUrl;
  $("remoteAccessStatus").textContent=publicUrl?
    "Dirección HTTPS configurada: puedes utilizarla desde otras redes si el alojamiento es públicamente accesible.":
    "Servidor local: para usar otra red, publica esta app en una URL HTTPS o usa una red privada con Tailscale.";
}
$("copyRemoteAddress").addEventListener("click",async()=>{
  const url=$("remoteServerAddress").textContent;
  try{
    await navigator.clipboard.writeText(url);
    $("copyRemoteAddress").textContent="Dirección copiada ✓";
  }catch{
    $("copyRemoteAddress").textContent="Selecciona y copia la dirección";
  }
});
updateRemoteAccessInfo();
$("probeConnection").addEventListener("click",async()=>{
  const button=$("probeConnection");
  button.disabled=true;
  const status=$("probeStatus");
  status.textContent="Probando HTTP del servidor…";
  try{
    const res=await fetch("/api/health",{cache:"no-store"});
    if(!res.ok)throw Error("HTTP "+res.status);
    const payload=await res.json();
    if(payload.status!=="ok")throw Error("Respuesta de salud inesperada");
    status.textContent="HTTP correcto. Probando la conexión WebSocket…";
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);
      const timeout=setTimeout(()=>{ws.close();reject(Error("Tiempo de conexión agotado"));},6000);
      ws.onopen=()=>{clearTimeout(timeout);ws.close();resolve();};
      ws.onerror=()=>{clearTimeout(timeout);ws.close();reject(Error("WebSocket bloqueado por servidor, red o proxy"));};
    });
    status.textContent="Servidor accesible por HTTP y WebSocket desde ESTE dispositivo. Audio y acceso externo no comprobados.";
  }catch(err){status.textContent="Fallo de conexión: "+err.message;}
  finally{button.disabled=false;}
});
const tabs=document.querySelectorAll(".tab");
const panes={audio:$("pane-audio"),network:$("pane-network")};
function showTab(name){
  for(const tab of tabs){const active=tab.dataset.tab===name;tab.classList.toggle("selected",active);tab.setAttribute("aria-selected",String(active));}
  for(const [key,pane] of Object.entries(panes))pane.hidden=key!==name;
}
tabs.forEach(t=>t.addEventListener("click",()=>showTab(t.dataset.tab)));
function makeCode(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";const bits=crypto.getRandomValues(new Uint8Array(12));return [...bits].map(x=>alphabet[x%alphabet.length]).join("");}
function setStatus(kind,message,state=""){
  const node=$(kind+"Status");node.className="status"+(state?" "+state:"");
  $(kind+"Message").textContent=message;
}
function wsOpen(){return new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host);}
function signal(ws,to,data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"signal",to,data}));}
function peer(ws,to,isSource){
  const pc=new RTCPeerConnection(session.ice);
  const holder={pc,candidates:[]};
  if(isSource){
    for(const track of session.stream.getAudioTracks())pc.addTrack(track,session.stream);
  }else{
    pc.ontrack=event=>{
      const audio=$("audioPlayer");audio.srcObject=event.streams?.[0] || new MediaStream([event.track]);
      audio.play().catch(()=>setStatus("listener","Audio recibido: pulsa ▶ para reproducir.","live"));
    };
  }
  pc.onicecandidate=event=>{if(event.candidate)signal(ws,to,{candidate:event.candidate.toJSON()});};
  pc.onconnectionstatechange=()=>{
    const s=pc.connectionState;
    if(isSource){
      if(["failed","disconnected"].includes(s))setStatus("source","Micrófono activo; conexión con un oyente interrumpida.","live");
    }else if(s==="connected")setStatus("listener","Escuchando audio en directo.","live");
    else if(["failed","disconnected"].includes(s))setStatus("listener","Conexión de audio "+s+". Comprueba red/TURN.","error");
  };
  return holder;
}
async function acceptSignal(holder,data,ws,from){
  if(data.description){
    await holder.pc.setRemoteDescription(data.description);
    for(const ice of holder.candidates)await holder.pc.addIceCandidate(ice);
    holder.candidates.length=0;
    if(data.description.type==="offer"){
      await holder.pc.setLocalDescription(await holder.pc.createAnswer());
      signal(ws,from,{description:holder.pc.localDescription});
    }
  }
  if(data.candidate){
    if(holder.pc.remoteDescription)await holder.pc.addIceCandidate(data.candidate);
    else holder.candidates.push(data.candidate);
  }
}
function closeSource(){
  pcmSource?.stop();pcmSource=null;
  if(session.relayContext){
    void session.relayContext.close().catch(()=>{});
    session.relayContext=null;
  }
  $("relayMode").disabled=false;
  $("encryptAudio").disabled=remoteRequiresE2EE;
  $("sourceSecret").disabled=false;
  $("newAudioKey").disabled=false;
  for(const entry of session.peers.values())entry.pc.close();
  session.peers.clear();
  session.stream?.getTracks().forEach(t=>t.stop());session.stream=null;
  const ws=session.source;session.source=null;if(ws)ws.close();
  $("startSource").disabled=false;$("stopSource").disabled=true;
  $("micNotice").hidden=true;$("sourceListeners").textContent="Receptores conectados: 0";
  setStatus("source","Micrófono apagado.");
}
function closeListener(){
  pcmPlayer?.stop();pcmPlayer=null;
  listenerKeyPromise=null;
  setNativeMode(false);
  session.incoming?.pc.close();session.incoming=null;
  $("audioPlayer").srcObject=null;
  const ws=session.listener;session.listener=null;if(ws)ws.close();
  $("startListener").disabled=false;$("stopListener").disabled=true;
  $("listenerMetrics").textContent="Audio recibido: sin datos todavía.";
  setStatus("listener","Esperando conexión.");
}
$("stopSource").addEventListener("click",closeSource);
$("stopListener").addEventListener("click",closeListener);
$("generateRoom").addEventListener("click",()=>{
  if(session.stream)return;
  const code=makeCode();$("sourceRoom").value=code;$("listenerRoom").value=code;
});
$("sourceRoom").value=makeCode();
const inviteParams=new URLSearchParams(location.hash.slice(1));
$("listenerRoom").value=(inviteParams.get("room")||new URLSearchParams(location.search).get("room"))?.trim().toUpperCase()||$("sourceRoom").value;
if(inviteParams.has("audioKey"))$("listenerSecret").value=inviteParams.get("audioKey").slice(0,128);
$("sourceRoom").addEventListener("input",()=>{if(!session.listener)$("listenerRoom").value=$("sourceRoom").value.toUpperCase();});
$("copyRoom").addEventListener("click",async()=>{
  const url=new URL(location.href);url.search="";url.hash="room="+encodeURIComponent($("sourceRoom").value.trim().toUpperCase());
  try{await navigator.clipboard.writeText(url.href);$("copyRoom").textContent="¡Enlace copiado! ✓";}
  catch{$("copyRoom").textContent="Enlace: "+url.href;}
});
$("copySecureInvite").addEventListener("click",async()=>{
  const room=$("sourceRoom").value.trim().toUpperCase();
  const secret=$("sourceSecret").value.trim();
  if(!ROOM_PATTERN.test(room)||!HowdyE2EE.validSecret(secret))
    return setStatus("source","Introduce sala válida y clave privada antes de compartir.","error");
  const url=new URL(location.href);
  url.search="";
  url.hash=new URLSearchParams({room,audioKey:secret}).toString();
  try{
    await navigator.clipboard.writeText(url.href);
    $("copySecureInvite").textContent="Invitación cifrada copiada ✓";
  }catch{
    $("copySecureInvite").textContent="No se pudo copiar: revisa permisos del portapapeles";
  }
});
async function configureIce(){
  try{const r=await fetch("/api/config",{cache:"no-store"});if(r.ok){const data=await r.json();if(Array.isArray(data.iceServers))session.ice={iceServers:data.iceServers};
    if(data.requiresE2EE===true){
      remoteRequiresE2EE=true;
      // Public relay: use the actually supported encrypted PCM route by default.
      // WebRTC remains available when explicitly deselecting the distance mode.
      $("relayMode").checked=true;
      $("encryptAudio").checked=true;
      $("encryptAudio").disabled=true;
      $("remoteAccessStatus").textContent="Servidor remoto activo · cifrado PCM obligatorio · conexión WSS disponible.";
    }}}catch{}
}
configureIce();
browserRequirements();
$("startSource").addEventListener("click",async()=>{
  const room=$("sourceRoom").value.trim().toUpperCase();
  const viaRelay=$("relayMode").checked;
  const encryptedMode=viaRelay&&(remoteRequiresE2EE||$("encryptAudio").checked);
  let sourceKey=null,cryptoQueue=Promise.resolve(),queuedFrames=0,relayListeners=0;
  if(encryptedMode&&!HowdyE2EE.validSecret($("sourceSecret").value.trim()))
    return setStatus("source","El cifrado requiere una clave independiente de 16 caracteres o más.","error");
  if(!ROOM_PATTERN.test(room))return setStatus("source","Introduce un código de 8 a 16 caracteres.","error");
  if(!$("consentMic").checked)return setStatus("source","Confirma primero que la transmisión se realiza con conocimiento de los participantes.","error");
  if(!navigator.mediaDevices?.getUserMedia)return setStatus("source","El micrófono exige HTTPS o localhost.","error");
  if(viaRelay){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return setStatus("source","Este navegador no admite captura Web Audio PCM.","error");
    try{
      // Start audio context as part of the original user gesture.
      session.relayContext=new Audio();
      void session.relayContext.resume().catch(()=>{});
    }catch(err){
      return setStatus("source","No se pudo iniciar el motor de audio: "+err.message,"error");
    }
  }
  $("startSource").disabled=true;setStatus("source","Solicitando permiso del micrófono...");
  try{session.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:true},video:false});}
  catch(err){
    if(session.relayContext){void session.relayContext.close().catch(()=>{});session.relayContext=null;}
    $("startSource").disabled=false;return setStatus("source","No se ha activado el micrófono: "+err.message,"error");
  }
  if(encryptedMode){
    try{sourceKey=await HowdyE2EE.deriveKey($("sourceSecret").value.trim(),room);}
    catch(err){closeSource();return setStatus("source","No se pudo derivar la clave de audio: "+err.message,"error");}
  }
  for(const track of session.stream.getAudioTracks()){track.addEventListener("ended",()=>{if(session.stream){closeSource();setStatus("source","El sistema detuvo el micrófono.","error");}},{once:true});}
  $("micNotice").hidden=false;$("stopSource").disabled=false;
  $("relayMode").disabled=true;
  $("encryptAudio").disabled=true;
  $("sourceSecret").disabled=true;
  $("newAudioKey").disabled=true;
  $("sourceRoom").value=room;
  const ws=wsOpen();session.source=ws;
  setStatus("source","Micrófono encendido. Conectando...","live");
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",role:"source",room,transport:encryptedMode?"pcm-e2ee":viaRelay?"pcm16":"webrtc"}));
  ws.onmessage=async event=>{
    if(session.source!==ws)return;
    try{
      const msg=JSON.parse(event.data);
      if(msg.type==="error"){closeSource();return setStatus("source",msg.message,"error");}
      if(msg.type==="listener-count"){
        relayListeners=Math.max(0,Number(msg.count)||0);
        $("sourceListeners").textContent="Receptores conectados: "+relayListeners;
        if(viaRelay&&pcmSource)setStatus("source",relayListeners?
          "● Transmitiendo audio a "+relayListeners+" receptor(es).":"● Micrófono activo; esperando receptor. No se envía audio.","live");
      }
      if(msg.type==="joined"){
        if(Number.isInteger(msg.listenerCount)){
          relayListeners=msg.listenerCount;
          $("sourceListeners").textContent="Receptores conectados: "+relayListeners;
        }
        if(Array.isArray(msg.iceServers))session.ice={iceServers:msg.iceServers};
        if(viaRelay){
          try{
            pcmSource=new HowdyPcmCapture.Capture(session.stream,bytes=>{
              if(!HowdyPcmCapture.canRelay(relayListeners,ws.readyState===WebSocket.OPEN,ws.bufferedAmount))return;
              if(!encryptedMode){
                ws.send(JSON.stringify({type:"audio-frame",pcm:HowdyPcmCapture.toBase64(bytes)}));
                return;
              }
              if(queuedFrames>=5)return;
              queuedFrames++;
              cryptoQueue=cryptoQueue.then(async()=>{
                const data=await HowdyE2EE.encryptFrame(sourceKey,bytes);
                if(HowdyPcmCapture.canRelay(relayListeners,ws.readyState===WebSocket.OPEN,ws.bufferedAmount))
                  ws.send(JSON.stringify({type:"encrypted-frame",data}));
              }).catch(e=>{
                if(session.source===ws){closeSource();setStatus("source","Error de cifrado: "+e.message,"error");}
              }).finally(()=>queuedFrames--);
            },session.relayContext);
            await pcmSource.start();
            setStatus("source",relayListeners>0?
              (encryptedMode?"● Transmitiendo audio cifrado de extremo a extremo. Sala: ":"● Retransmitiendo audio por WSS. Sala: ")+room:
              "● Micrófono activo; esperando receptor. Sin enviar muestras.","live");
          }catch(err){
            closeSource();
            return setStatus("source","El navegador no admite retransmisión PCM: "+err.message,"error");
          }
        }else setStatus("source","Micrófono activo. Sala: "+room,"live");
      }
      if(msg.type==="listener-joined"){
        if(viaRelay)return;
        if(session.peers.has(msg.id))return;
        const p=peer(ws,msg.id,true);session.peers.set(msg.id,p);
        await p.pc.setLocalDescription(await p.pc.createOffer());
        signal(ws,msg.id,{description:p.pc.localDescription});
      }
      if(msg.type==="listener-left"){session.peers.get(msg.id)?.pc.close();session.peers.delete(msg.id);}
      if(msg.type==="signal"&&session.peers.has(msg.from))await acceptSignal(session.peers.get(msg.from),msg.data,ws,msg.from);
    }catch(e){setStatus("source","Error de audio: "+e.message,"error");}
  };
  ws.onclose=()=>{if(session.source===ws){closeSource();setStatus("source","Se perdió la conexión del servidor.","error");}};
  ws.onerror=()=>setStatus("source","Fallo de señalización.","error");
});
let transcriptCount=0;
function showRemoteTranscript(value){
  if(typeof value!=="string"||!value.trim())return;
  const log=$("transcriptLog");
  if(transcriptCount===0)log.replaceChildren();
  const entry=document.createElement("p");
  entry.textContent=value.slice(0,1000);
  log.appendChild(entry);
  transcriptCount++;
  while(log.children.length>10)log.firstChild.remove();
  setStatus("listener","Texto de dictado recibido. No es audio ni micrófono interno verificado.","live");
}
$("clearTranscript").addEventListener("click",()=>{
  transcriptCount=0;
  $("transcriptLog").textContent="Aquí aparecerá el texto compartido voluntariamente desde el teclado o reconocedor de la TV.";
});
// Fallback for television browsers: use the OS-provided keyboard for optional
// voice dictation. This path sees text only, never any microphone samples.
let sourceTextSocket=null;
function endSourceText(message){
  const old=sourceTextSocket;sourceTextSocket=null;
  if(old)old.close();
  $("shareSourceText").disabled=false;
  $("sourceTextStatus").textContent=message;
}
$("openSourceKeyboard").addEventListener("click",()=>{
  if(session.stream)closeSource();
  $("sourceText").focus();
  $("sourceTextStatus").textContent="Teclado solicitado. El dictado depende del teclado que incluya esta TV.";
});
$("shareSourceText").addEventListener("click",()=>{
  if(session.stream){$("sourceTextStatus").textContent="Detén el audio antes de compartir texto.";return;}
  if(!$("consentMic").checked){$("sourceTextStatus").textContent="Confirma primero el consentimiento de los presentes.";return;}
  const text=$("sourceText").value.trim();
  const room=$("sourceRoom").value.trim().toUpperCase();
  if(!ROOM_PATTERN.test(room)){$("sourceTextStatus").textContent="Código de sala no válido.";return;}
  if(!text||text.length>1000){$("sourceTextStatus").textContent="Introduce entre 1 y 1000 caracteres.";return;}
  if(sourceTextSocket){$("sourceTextStatus").textContent="El texto ya se está enviando.";return;}
  let ws;
  try{ws=wsOpen();}catch(e){$("sourceTextStatus").textContent="No se pudo crear la conexión de texto.";return;}
  sourceTextSocket=ws;$("shareSourceText").disabled=true;
  $("sourceTextStatus").textContent="Conectando para compartir SOLO TEXTO…";
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",role:"source",transport:"text",room}));
  ws.onmessage=ev=>{
    let message;
    try{message=JSON.parse(ev.data);}catch{return;}
    if(message.type==="joined")ws.send(JSON.stringify({type:"transcript",text}));
    else if(message.type==="transcript-sent")endSourceText(
      "Texto entregado a "+message.listeners+" receptor(es). Audio no disponible en este modo.");
    else if(message.type==="error")endSourceText("Servidor: "+message.message);
  };
  ws.onerror=()=>{if(sourceTextSocket===ws)endSourceText("Error de conexión de texto.");};
  ws.onclose=()=>{if(sourceTextSocket===ws)endSourceText("Conexión cerrada sin confirmación.");};
});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden&&sourceTextSocket)endSourceText("Envío detenido al ocultar la aplicación.");
});
$("startListener").addEventListener("click",()=>{
  const room=$("listenerRoom").value.trim().toUpperCase();
  let encryptedStream=false,invalidKeyAlerted=false,decryptQueue=Promise.resolve(),pendingDecrypt=0;
  const enableEncryptedMode=()=>{
    encryptedStream=true;
    const secret=$("listenerSecret").value.trim();
    if(!HowdyE2EE.validSecret(secret)){
      listenerKeyPromise=null;
      setStatus("listener","Audio CIFRADO: introduce la clave de audio privada (mínimo 16 caracteres) y reconecta.","error");
      return;
    }
    listenerKeyPromise=HowdyE2EE.deriveKey(secret,room).then(key=>new HowdyE2EE.FrameDecryptor(key));
    void listenerKeyPromise.catch(error=>setStatus("listener","Clave no disponible: "+error.message,"error"));
    setStatus("listener","Audio cifrado: verificando clave y esperando tramas.","live");
  };
  if(!ROOM_PATTERN.test(room))return setStatus("listener","Introduce el código de sala correcto.","error");
  $("startListener").disabled=true;$("stopListener").disabled=false;
  setNativeMode(false);
  try{
    pcmPlayer=new HowdyPcm.Player();
    pcmPlayer.setVolume(Number(volumeControl.value)/100);
    void pcmPlayer.enable().catch(e=>setStatus("listener","Web Audio no disponible: "+e.message,"error"));
  }catch(e){setStatus("listener","El navegador no admite PCM: "+e.message,"error");}
  const ws=wsOpen();session.listener=ws;
  setStatus("listener","Conectando a la sala...");
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",role:"listener",room}));
  ws.onmessage=async event=>{
    try{
      const msg=JSON.parse(event.data);
      if(msg.type==="error"){closeListener();return setStatus("listener",msg.message,"error");}
      if(msg.type==="joined"){
        encryptedStream=msg.sourceTransport==="pcm-e2ee";
        setNativeMode(msg.sourceTransport==="pcm16"||encryptedStream);
        if(encryptedStream)enableEncryptedMode();
        if(msg.sourceTransport==="text")setStatus("listener","Conectado a modo dictado: se enviará TEXTO, no audio.","live");
        else if(!nativeAudioMode)setStatus("listener",msg.sourceOnline?"Conectado. Esperando sonido...":"Sala abierta; esperando el micrófono.");
      }
      if(msg.type==="source-mode"){
        encryptedStream=msg.transport==="pcm-e2ee";
        listenerKeyPromise=null;
        setNativeMode(msg.transport==="pcm16"||encryptedStream);
        if(encryptedStream)enableEncryptedMode();
        if(msg.transport==="text")setStatus("listener","Conectado a modo dictado: esperando texto.","live");
      }
      if(msg.type==="transcript"&&msg.audioAvailable===false)showRemoteTranscript(msg.text);
      if(msg.type==="encrypted-frame"&&encryptedStream){
        if(listenerKeyPromise&&pendingDecrypt<8){
          pendingDecrypt++;
          decryptQueue=decryptQueue.then(async()=>{
            const decryptor=await listenerKeyPromise;
            const raw=await decryptor.decryptFrame(msg.data);
            if(session.listener!==ws)return;
            if(pcmPlayer?.play(HowdyE2EE.rawToPcmBase64(raw))){
              if(pcmPlayer.frames===1)setStatus("listener","● Audio descifrado de extremo a extremo.","live");
              if(pcmPlayer.frames%25===0)$("listenerMetrics").textContent=
                "Audio cifrado recibido: "+pcmPlayer.frames+" tramas.";
            }
          }).catch(error=>{
            if(session.listener===ws&&!invalidKeyAlerted){
              invalidKeyAlerted=true;
              setStatus("listener","No se puede descifrar el audio. Comprueba la clave compartida.","error");
            }
          }).finally(()=>pendingDecrypt--);
        }
      }
      if(msg.type==="audio-frame"&&nativeAudioMode){
        if(pcmPlayer?.play(msg.pcm)){
          if(pcmPlayer.frames===1)setStatus("listener","Recibiendo audio PCM en directo.","live");
          if(pcmPlayer.frames%25===0)$("listenerMetrics").textContent="Audio PCM recibido: "+pcmPlayer.frames+" tramas (20 ms cada una).";
        }else if(pcmPlayer?.context?.state==="suspended"){
          setStatus("listener","El navegador ha bloqueado el sonido: vuelve a pulsar Escuchar ahora.","error");
        }
      }
      if(msg.type==="source-offline"){
        $("listenerMetrics").textContent="El emisor se ha desconectado.";
        setNativeMode(false);
        session.incoming?.pc.close();session.incoming=null;$("audioPlayer").srcObject=null;
        setStatus("listener","El dispositivo que transmite se ha desconectado.");
      }
      if(msg.type==="signal"){
        if(!session.incoming)session.incoming=peer(ws,msg.from,false);
        await acceptSignal(session.incoming,msg.data,ws,msg.from);
      }
    }catch(e){setStatus("listener","Error de audio: "+e.message,"error");}
  };
  ws.onclose=()=>{if(session.listener===ws){closeListener();setStatus("listener","Se perdió la conexión del servidor.","error");}};
  ws.onerror=()=>setStatus("listener","Fallo de conexión.","error");
});

function bytes(n) {
  if (!Number.isFinite(n)) return "—";
  const units=["B","KB","MB","GB","TB"];let k=0;
  while(n>=1024&&k<units.length-1){n/=1024;k++;}
  return n.toLocaleString("es-ES",{maximumFractionDigits:k?2:0})+" "+units[k];
}
const audit={primary:null,secondary:null,imported:false,demo:false};
function reportTimestamp(str) {
  if(!str)return "sin fecha";
  const t=Date.parse(str);
  return Number.isFinite(t)?new Date(t).toLocaleString("es-ES"):"sin fecha";
}
function renderDestinations() {
  const body=$("destinationRows");body.replaceChildren();
  const r=audit.primary;
  const q=$("destinationSearch").value.trim().toLowerCase();
  const visible=r?r.destinations.filter(d=>[d.ip,...d.domains,...d.ports].join(" ").toLowerCase().includes(q)):[];
  $("visibleCount").textContent=visible.length+" visibles"+(visible.length>500?" (se muestran 500)":"");
  for(const d of visible.slice(0,500)){
    const tr=document.createElement("tr");
    for(const val of [d.ip, d.domains.join(", ")||"No visible",d.ports.join(", ")||"—",
      bytes(d.sent_bytes),bytes(d.received_bytes),d.packets.toLocaleString("es-ES")]){
      const cell=document.createElement("td");cell.textContent=val;tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  if(!visible.length){
    const tr=document.createElement("tr"),cell=document.createElement("td");
    cell.colSpan=6;cell.className="empty-cell";
    cell.textContent=r?"Sin coincidencias en este informe.":"Aún no hay tráfico capturado. Carga un JSON o prueba el ejemplo.";
    tr.append(cell);body.append(tr);
  }
}
function renderComparison() {
  const target=$("comparisonStatus");target.classList.remove("warning");
  const a=audit.primary,b=audit.secondary;
  if(!a&&!b){target.textContent="Carga dos sesiones reales o pulsa «Ver ejemplo» para conocer cómo funciona.";return;}
  if(!a){target.classList.add("warning");target.textContent="Falta la sesión A para comparar.";return;}
  if(!b){target.textContent="Sesión A lista. Importa la sesión B del mismo televisor.";return;}
  try{
    const d=HowdyReport.compareReports(a,b);
    const newText=d.newIps.length?d.newIps.slice(0,5).join(", "):"ninguna";
    const removedText=d.absentIps.length?d.absentIps.slice(0,5).join(", "):"ninguna";
    let msg=(audit.demo?"EJEMPLO SINTÉTICO · ":"")+
      "A → B: "+d.newIps.length+" IP nuevas ("+newText+"); "+
      d.absentIps.length+" IP que dejan de verse ("+removedText+"). "+
      "Bytes salientes observados: "+bytes(a.totals.sent)+" → "+bytes(b.totals.sent)+". ";
    if(!d.comparableDuration)msg+="Atención: sin duraciones equivalentes no compares volúmenes directamente. ";
    msg+="Una diferencia de conexiones NO prueba que se enviase audio.";
    target.textContent=msg;
    if(!d.comparableDuration)target.classList.add("warning");
  }catch(e){target.classList.add("warning");target.textContent=e.message;}
}
function renderAudit() {
  const r=audit.primary;
  $("metricDestinations").textContent=r?String(r.destinations.length):"—";
  $("metricSent").textContent=r?bytes(r.totals.sent):"—";
  $("metricReceived").textContent=r?bytes(r.totals.received):"—";
  $("metricPackets").textContent=r?r.totals.packets.toLocaleString("es-ES"):"—";
  $("downloadCsv").disabled=!r;
  $("networkStatus").textContent=r?
    (audit.demo?"EJEMPLO (datos ficticios) · ":"")+
    r.label+" · TV "+r.tv_ip+" · "+reportTimestamp(r.updated_at):
    "Sin informe. Configura una captura o importa un archivo JSON.";
  renderDestinations();renderComparison();
}
function acceptReport(raw,slot="primary",kind="import"){
  const result=HowdyReport.normalizeReport(raw);
  if(kind==="import"&&audit.demo){
    // Never mix synthetic demo data into a comparison with a real capture.
    if(slot==="primary")audit.secondary=null;
    else audit.primary=null;
  }
  audit[slot]=result;
  if(kind==="import") {audit.imported=true;audit.demo=false;}
  renderAudit();
}
async function refreshReport(force=false){
  if(audit.imported&&!force)return;
  try{
    const r=await fetch("/api/report",{cache:"no-store"});
    if(!r.ok)throw Error("Sin informe");
    const data=await r.json();
    if(!audit.imported)acceptReport(data,"primary","server");
  }catch{
    if(force){
      audit.primary=null;audit.secondary=null;
      renderAudit();
    }
  }
}
async function importFromPicker(e,slot){
  const file=e.target.files?.[0];e.target.value="";
  if(!file)return;
  if(file.size>15*1024*1024){
    $("networkStatus").textContent="Archivo demasiado grande (máximo 15 MB).";return;
  }
  try{acceptReport(JSON.parse(await file.text()),slot);}
  catch(err){$("networkStatus").textContent="No se pudo importar: "+err.message;}
}
$("uploadReport").addEventListener("change",e=>importFromPicker(e,"primary"));
$("uploadCompare").addEventListener("change",e=>importFromPicker(e,"secondary"));
$("reloadReport").addEventListener("click",()=>{
  audit.imported=false;audit.demo=false;audit.primary=null;audit.secondary=null;renderAudit();
  refreshReport(true);
});
$("clearComparison").addEventListener("click",()=>{
  audit.secondary=null;renderAudit();
});
$("destinationSearch").addEventListener("input",renderDestinations);
$("loadDemo").addEventListener("click",async()=>{
  try{
    const [a,b]=await Promise.all([
      fetch("/examples/encendida.json").then(r=>{if(!r.ok)throw Error("Sin ejemplo A");return r.json();}),
      fetch("/examples/reposo.json").then(r=>{if(!r.ok)throw Error("Sin ejemplo B");return r.json();})
    ]);
    audit.primary=HowdyReport.normalizeReport(a);
    audit.secondary=HowdyReport.normalizeReport(b);
    audit.demo=true;audit.imported=true;
    renderAudit();
  }catch(err){$("networkStatus").textContent="No se pudo cargar el ejemplo: "+err.message;}
});
$("downloadCsv").addEventListener("click",()=>{
  if(!audit.primary)return;
  const contents=HowdyReport.csvExport(audit.primary);
  const blob=new Blob([contents],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=audit.demo?"howdyknw-EJEMPLO-FICTICIO.csv":"howdyknw-destinos.csv";link.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
});
function updateCaptureCommand() {
  const ip=$("tvIp").value.trim();
  const iface=$("captureInterface").value.trim();
  const seconds=$("captureSeconds").value;
  const validIP=/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)&&
    ip.split(".").every(part=>Number(part)>=0&&Number(part)<=255);
  const validIface=/^[\w. -]{1,70}$/.test(iface);
  $("copyCommand").disabled=!(validIP&&validIface);
  if(!validIP||!validIface){
    $("captureCommand").textContent="Introduce una IPv4 y una interfaz válidas.";
    $("captureWarning").textContent="No se genera un comando con valores inválidos.";
    return;
  }
  // Always quote the interface; allowed characters exclude shell expansions.
  const command='python tv_monitor.py --interface "'+iface+
    '" --tv-ip '+ip+' --duration '+seconds+' --output data/report.json';
  $("captureCommand").textContent=command;
  $("captureWarning").textContent="El equipo debe ver realmente el tráfico de la TV. Consulta primero «tshark -D».";
}
["tvIp","captureInterface","captureSeconds"].forEach(id=>
  $(id).addEventListener(id==="captureSeconds"?"change":"input",updateCaptureCommand));
$("copyCommand").addEventListener("click",async()=>{
  const value=$("captureCommand").textContent;
  if($("copyCommand").disabled)return;
  try{await navigator.clipboard.writeText(value);$("copyCommand").textContent="Copiado ✓";}
  catch{$("copyCommand").textContent="Selecciona el comando para copiar";}
});
updateCaptureCommand();
renderAudit();
refreshReport();
setInterval(()=>refreshReport(false),4000);
