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
      const audio=$("audioPlayer");audio.srcObject=event.streams[0];
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
  try{session.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:false,autoGainControl:true},video:false});}
  catch(err){$("startSource").disabled=false;return setStatus("source","No se ha activado el micrófono: "+err.message,"error");}
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
function bytes(n){if(!Number.isFinite(n))return "—";const units=["B","KB","MB","GB","TB"];let k=0;while(n>=1024&&k<units.length-1){n/=1024;k++;}return n.toFixed(k?1:0)+" "+units[k];}
function renderReport(data,kind){
  if(!data||!Array.isArray(data.destinations))throw new Error("Formato JSON inválido: falta destinations.");
  const legacy=data.source==="tshark_capture";
  const items=data.destinations.map(item=>({
    ...item,
    domains:Array.isArray(item.domains)?item.domains:(Array.isArray(item.tls_sni)?item.tls_sni:[]),
    sent_bytes:Number(item.sent_bytes??item.bytes??0),
    received_bytes:legacy?null:Number(item.received_bytes??0)
  }));
  $("metricDestinations").textContent=String(items.length);
  $("metricSent").textContent=bytes(items.reduce((sum,i)=>sum+(Number(i.sent_bytes)||0),0));
  $("metricReceived").textContent=legacy?"No medido":bytes(items.reduce((sum,i)=>sum+(Number(i.received_bytes)||0),0));
  $("metricPackets").textContent=items.reduce((sum,i)=>sum+(Number(i.packets)||0),0).toLocaleString("es-ES");
  const tv=String(data.tv_ip||"no indicada");const t=data.updated_at?new Date(data.updated_at).toLocaleString("es-ES"):(data.last_outbound_utc||"sin fecha");
  $("networkStatus").textContent=(kind==="import"?"Archivo importado":"Informe del servidor")+" · TV "+tv+" · "+t+(legacy?" · solo tráfico saliente":"");
  const body=$("destinationRows");body.replaceChildren();
  const ordered=[...items].sort((a,b)=>((b.sent_bytes||0)+(b.received_bytes||0))-((a.sent_bytes||0)+(a.received_bytes||0)));
  for(const i of ordered.slice(0,300)){
    const tr=document.createElement("tr");
    for(const val of [i.ip||"—",Array.isArray(i.domains)?i.domains.join(", ")||"Desconocido":"Desconocido",
      bytes(Number(i.sent_bytes)||0),legacy?"No medido":bytes(Number(i.received_bytes)||0),Number(i.packets||0).toLocaleString("es-ES")]){
      const td=document.createElement("td");td.textContent=val;tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if(!items.length){const tr=document.createElement("tr");const td=document.createElement("td");td.colSpan=5;td.className="empty-cell";td.textContent="No se observaron conexiones en esta captura.";tr.appendChild(td);body.appendChild(tr);}
}
let imported=false;
async function refreshReport(force=false){
  if(imported&&!force)return;
  if(force)imported=false;
  try{const r=await fetch("/api/report",{cache:"no-store"});if(!r.ok)throw Error("Sin informe");
    renderReport(await r.json(),"server");
  }catch{if(force || $("metricDestinations").textContent==="—")$("networkStatus").textContent="Sin informe de red. Ejecuta el monitor o importa un archivo JSON.";}
}
$("reloadReport").addEventListener("click",()=>refreshReport(true));
$("uploadReport").addEventListener("change",async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{renderReport(JSON.parse(await file.text()),"import");imported=true;}
  catch(e){$("networkStatus").textContent="No se pudo importar el informe: "+e.message;}
});
$("copyCommand").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText("python tv_monitor.py --interface 1 --tv-ip 192.168.1.50");$("copyCommand").textContent="Copiado ✓";}
  catch{$("copyCommand").textContent="Selecciona el texto para copiar";}
});
refreshReport();setInterval(()=>refreshReport(false),4000);
