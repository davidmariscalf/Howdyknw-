"use strict";
const $=id=>document.getElementById(id);
const ROOM_PATTERN=/^[A-Z0-9]{8,16}$/;
const session={source:null,listener:null,stream:null,peers:new Map(),incoming:null,ice:{iceServers:[{urls:"stun:stun.l.google.com:19302"}]}};
const tabs=document.querySelectorAll(".tab");
const panes={audio:$("pane-audio"),network:$("pane-network")};
function showTab(name){
  for(const tab of tabs){const active=tab.dataset.tab===name;tab.classList.toggle("selected",active);tab.setAttribute("aria-selected",String(active));}
  for(const [key,pane] of Object.entries(panes))pane.hidden=key!==name;
}
tabs.forEach(t=>t.addEventListener("click",()=>showTab(t.dataset.tab)));
function makeCode(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";const bits=crypto.getRandomValues(new Uint8Array(10));return [...bits].map(x=>alphabet[x%alphabet.length]).join("");}
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
  for(const entry of session.peers.values())entry.pc.close();
  session.peers.clear();
  session.stream?.getTracks().forEach(t=>t.stop());session.stream=null;
  const ws=session.source;session.source=null;if(ws)ws.close();
  $("startSource").disabled=false;$("stopSource").disabled=true;$("copyRoom").disabled=true;
  $("micNotice").hidden=true;setStatus("source","Micrófono apagado.");
}
function closeListener(){
  session.incoming?.pc.close();session.incoming=null;
  $("audioPlayer").srcObject=null;
  const ws=session.listener;session.listener=null;if(ws)ws.close();
  $("startListener").disabled=false;$("stopListener").disabled=true;
  setStatus("listener","Esperando conexión.");
}
$("stopSource").addEventListener("click",closeSource);
$("stopListener").addEventListener("click",closeListener);
$("generateRoom").addEventListener("click",()=>{
  if(session.stream)return;
  const code=makeCode();$("sourceRoom").value=code;$("listenerRoom").value=code;
});
$("sourceRoom").value=makeCode();
$("listenerRoom").value=new URLSearchParams(location.search).get("room")?.trim().toUpperCase()||$("sourceRoom").value;
$("sourceRoom").addEventListener("input",()=>{if(!session.listener)$("listenerRoom").value=$("sourceRoom").value.toUpperCase();});
$("copyRoom").addEventListener("click",async()=>{
  const url=new URL(location.href);url.search="";url.searchParams.set("room",$("sourceRoom").value.trim().toUpperCase());
  try{await navigator.clipboard.writeText(url.href);$("copyRoom").textContent="¡Enlace copiado! ✓";}
  catch{$("copyRoom").textContent="Enlace: "+url.href;}
});
async function configureIce(){
  try{const r=await fetch("/api/config",{cache:"no-store"});if(r.ok){const data=await r.json();if(Array.isArray(data.iceServers))session.ice={iceServers:data.iceServers};}}catch{}
}
configureIce();
$("startSource").addEventListener("click",async()=>{
  const room=$("sourceRoom").value.trim().toUpperCase();
  if(!ROOM_PATTERN.test(room))return setStatus("source","Introduce un código de 8 a 16 caracteres.","error");
  if(!navigator.mediaDevices?.getUserMedia)return setStatus("source","El micrófono exige HTTPS o localhost.","error");
  $("startSource").disabled=true;setStatus("source","Solicitando permiso del micrófono...");
  try{session.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:true},video:false});}
  catch(err){$("startSource").disabled=false;return setStatus("source","No se ha activado el micrófono: "+err.message,"error");}
  for(const track of session.stream.getAudioTracks()){track.addEventListener("ended",()=>{if(session.stream){closeSource();setStatus("source","El sistema detuvo el micrófono.","error");}},{once:true});}
  $("micNotice").hidden=false;$("stopSource").disabled=false;
  $("copyRoom").disabled=false;$("sourceRoom").value=room;
  const ws=wsOpen();session.source=ws;
  setStatus("source","Micrófono encendido. Conectando...","live");
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",role:"source",room}));
  ws.onmessage=async event=>{
    try{
      const msg=JSON.parse(event.data);
      if(msg.type==="error"){closeSource();return setStatus("source",msg.message,"error");}
      if(msg.type==="joined")setStatus("source","Micrófono activo. Sala: "+room,"live");
      if(msg.type==="listener-joined"){
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
$("startListener").addEventListener("click",()=>{
  const room=$("listenerRoom").value.trim().toUpperCase();
  if(!ROOM_PATTERN.test(room))return setStatus("listener","Introduce el código de sala correcto.","error");
  $("startListener").disabled=true;$("stopListener").disabled=false;
  const ws=wsOpen();session.listener=ws;
  setStatus("listener","Conectando a la sala...");
  ws.onopen=()=>ws.send(JSON.stringify({type:"join",role:"listener",room}));
  ws.onmessage=async event=>{
    try{
      const msg=JSON.parse(event.data);
      if(msg.type==="error"){closeListener();return setStatus("listener",msg.message,"error");}
      if(msg.type==="joined")setStatus("listener",msg.sourceOnline?"Conectado. Esperando sonido...":"Sala abierta; esperando el micrófono.");
      if(msg.type==="source-offline"){
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
  link.href=url;link.download="howdyknw-destinos.csv";link.click();
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
