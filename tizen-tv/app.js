"use strict";
(function(){
  var $=function(id){return document.getElementById(id);};
  var socket=null,stream=null,peers={},roomCode="",iceServers=[{urls:"stun:stun.l.google.com:19302"}];
  var textSocket=null;
  var captureActive=false;
  function status(text,type){
    var el=$("status");el.textContent=text;el.className="status"+(type?" "+type:"");
  }
  function supports(){
    var capabilities=[];
    try{
      if(window.tizen&&tizen.systeminfo&&tizen.systeminfo.getCapability){
        capabilities.push("Micrófono indicado por Tizen: "+
          tizen.systeminfo.getCapability("http://tizen.org/feature/microphone"));
      }
    }catch(e){capabilities.push("La API Tizen no está disponible: "+e.message);}
    capabilities.push("getUserMedia: "+!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia));
    capabilities.push("RTCPeerConnection: "+!!window.RTCPeerConnection);
    $("support").textContent=capabilities.join(" · ");
  }
  function send(obj){
    if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(obj));
  }
  function sendSignal(to,data){send({type:"signal",to:to,data:data});}
  function closePeers(){
    Object.keys(peers).forEach(function(id){peers[id].close();});
    peers={};
  }
  function stop(message){
    captureActive=false;
    closePeers();
    if(stream)stream.getTracks().forEach(function(track){track.stop();});
    stream=null;
    var old=socket;socket=null;if(old)old.close();
    $("start").disabled=false;$("stop").disabled=true;
    status(message||"Micrófono apagado.","");
  }
  function makePeer(id){
    var pc=new RTCPeerConnection({iceServers:iceServers});
    peers[id]=pc;
    pc.pendingCandidates=[];
    stream.getAudioTracks().forEach(function(track){pc.addTrack(track,stream);});
    pc.onicecandidate=function(e){
      if(e.candidate)sendSignal(id,{candidate:e.candidate.toJSON?e.candidate.toJSON():e.candidate});
    };
    pc.onconnectionstatechange=function(){
      if(pc.connectionState==="failed")status("Falló la conexión con un oyente.","error");
    };
    pc.createOffer().then(function(offer){
      return pc.setLocalDescription(offer);
    }).then(function(){
      sendSignal(id,{description:pc.localDescription});
    }).catch(function(e){status("Error al negociar audio: "+e.message,"error");});
  }
  async function handleSignal(id,data){
    var pc=peers[id];
    if(!pc)return;
    if(data.description){
      await pc.setRemoteDescription(data.description);
      for(const candidate of pc.pendingCandidates){
        await pc.addIceCandidate(candidate);
      }
      pc.pendingCandidates.length=0;
    }
    if(data.candidate){
      if(pc.remoteDescription)await pc.addIceCandidate(data.candidate);
      else pc.pendingCandidates.push(data.candidate);
    }
  }
  async function start(){
    if(captureActive)return;
    var url=$("endpoint").value.trim();
    var room=$("room").value.trim().toUpperCase();
    if(!/^https:\/\/[^/]+\/?$/.test(url)){status("Usa una URL https:// válida, sin ruta.","error");return;}
    if(!/^[A-Z0-9]{8,16}$/.test(room)){status("Sala incorrecta: 8 a 16 caracteres.","error");return;}
    if(!$("consent").checked){status("Confirma primero el consentimiento de los presentes.","error");return;}
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.RTCPeerConnection){
      status("Este modelo o navegador Tizen no expone micrófono y WebRTC a la aplicación.","error");
      return;
    }
    $("start").disabled=true;
    status("Solicitando autorización de micrófono…");
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(!stream.getAudioTracks().length)throw Error("Sin pista de audio");
      roomCode=room;captureActive=true;
      $("stop").disabled=false;
      stream.getAudioTracks().forEach(function(track){
        track.addEventListener("ended",function(){if(captureActive)stop("Micrófono detenido por el sistema.");});
      });
      status("● MICRÓFONO ACTIVO · Conectando al servidor…","live");
      if(!captureActive)return;
      // No cross-origin HTTP fetch: the server supplies ICE configuration on join.
      socket=new WebSocket(url.replace(/^https:/,"wss:"));
      socket.onopen=function(){send({type:"join",role:"source",room:roomCode,transport:"webrtc"});};
      socket.onmessage=function(ev){
        var m;try{m=JSON.parse(ev.data);}catch(e){return;}
        if(m.type==="joined"){
          if(Array.isArray(m.iceServers))iceServers=m.iceServers;
          status("● TRANSMITIENDO · MICRÓFONO ACTIVO · SALA "+roomCode,"live");
        }
        if(m.type==="listener-joined"&&!peers[m.id])makePeer(m.id);
        if(m.type==="listener-left"&&peers[m.id]){peers[m.id].close();delete peers[m.id];}
        if(m.type==="signal"&&peers[m.from]){
          handleSignal(m.from,m.data).catch(function(e){status("Error de señal: "+e.message,"error");});
        }
        if(m.type==="error")stop("Servidor: "+m.message);
      };
      socket.onclose=function(){if(captureActive)stop("Se cerró la conexión del servidor.");};
      socket.onerror=function(){if(captureActive)stop("No se pudo conectar mediante WSS.");};
    }catch(e){stop("No se pudo abrir el micrófono: "+e.message);}
  }
  // An editable text field asks for the TV's *real* input method.
  // Some models offer voice dictation in the system keyboard, others do not.
  $("focusText").addEventListener("click",function(){
    $("dictationText").focus();
    $("textStatus").textContent="Teclado solicitado. Si aparece el botón de micrófono, úsalo voluntariamente.";
  });
  function finishText(message){
    var old=textSocket;
    textSocket=null;
    if(old)old.close();
    $("shareText").disabled=false;
    $("textStatus").textContent=message;
  }
  $("shareText").addEventListener("click",function(){
    if(captureActive || socket){$("textStatus").textContent="Detén el audio antes de compartir texto.";return;}
    if(textSocket){$("textStatus").textContent="El envío de texto ya está en curso.";return;}
    if(!$("consent").checked){$("textStatus").textContent="Confirma el consentimiento de los presentes.";return;}
    var value=$("dictationText").value.trim();
    var room=$("room").value.trim().toUpperCase();
    var endpoint=$("endpoint").value.trim();
    if(!value||value.length>1000){$("textStatus").textContent="El texto debe tener entre 1 y 1000 caracteres.";return;}
    if(!/^[A-Z0-9]{8,16}$/.test(room)){ $("textStatus").textContent="Código de sala inválido."; return; }
    if(!/^https:\/\/[^/?#]+\/?$/.test(endpoint)){$("textStatus").textContent="Introduce la URL HTTPS del servidor, sin ruta.";return;}
    $("shareText").disabled=true;
    $("textStatus").textContent="Compartiendo únicamente el texto visible…";
    var current=new WebSocket(endpoint.replace(/^https:/,"wss:"));
    textSocket=current;
    current.onopen=function(){
      current.send(JSON.stringify({type:"join",role:"source",transport:"text",room:room}));
    };
    current.onmessage=function(ev){
      var m;
      try{m=JSON.parse(ev.data);}catch(e){return;}
      if(m.type==="joined"){
        current.send(JSON.stringify({type:"transcript",text:value}));
      }else if(m.type==="transcript-sent"){
        finishText("Texto entregado a "+m.listeners+" receptor(es). No se ha compartido audio.");
      }else if(m.type==="error"){
        finishText("Servidor: "+m.message);
      }
    };
    current.onerror=function(){
      if(textSocket===current)finishText("No se pudo conectar por WSS.");
    };
    current.onclose=function(){
      if(textSocket===current)finishText("Se cerró la conexión antes de confirmar el envío.");
    };
  });
  $("start").addEventListener("click",function(){void start();});
  $("stop").addEventListener("click",function(){stop("Micrófono apagado manualmente.");});
  document.addEventListener("visibilitychange",function(){if(document.hidden){stop("Micrófono apagado al ocultar la app.");if(textSocket)finishText("Envío cancelado al ocultar la app.");}});
  window.addEventListener("pagehide",function(){stop("Micrófono apagado.");if(textSocket)finishText("Envío detenido.");});
  window.addEventListener("tizenhwkey",function(e){if(e.keyName==="back")stop("Micrófono apagado.");});
  supports();
})();
