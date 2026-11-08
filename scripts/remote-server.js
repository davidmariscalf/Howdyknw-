"use strict";
// Opt-in privacy-preserving mode for publicly accessible Tailscale Funnel.
process.env.REMOTE_MODE="1";
const {server}=require("../server");
const port=Number(process.env.PORT||3000);
const host="127.0.0.1";
server.listen(port,host,()=>{
  console.log("Howdyknw preparado para acceso remoto en http://127.0.0.1:"+port);
  console.log("Publica este puerto usando 'tailscale funnel 3000' en otro terminal.");
  console.log("La API de informes de red privados queda deshabilitada en modo remoto.");
});
