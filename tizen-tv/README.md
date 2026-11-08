# Howdyknw Tizen TV — experimental source package

Esta aplicación web Tizen para Samsung Smart TV intenta captar audio **únicamente cuando el propio televisor expone getUserMedia**, y lo transmite por WebRTC a la misma sala del servidor Howdyknw. Pide activación manual, permiso y consentimiento.

**No se ha generado un paquete Tizen firmado (.wgt)** ni probado sobre un Samsung físico. Se necesita Tizen Studio, un certificado de desarrollador y un modelo que anuncie y habilite entrada de micrófono. No permite acceder al audio reservado al mando o al asistente Bixby.

## Prueba en Tizen Studio

1. Crea/importa un proyecto TV Web App en Tizen Studio a partir de esta carpeta.
2. Configura tu propio identificador de paquete y certificado según Tizen Studio.
3. Firma y despliega en una Samsung TV con modo desarrollador habilitado.
4. Consulta las capacidades del dispositivo que muestra la app.
5. Si getUserMedia y RTCPeerConnection están disponibles, introduce tu servidor HTTPS privado y una sala, confirma el consentimiento e inicia el micrófono.
6. Conecta el navegador receptor de Howdyknw a la misma sala. Usa auriculares.
7. Para parar, pulsa Detener o sal de la app. Si el fabricante bloquea la entrada, la app mostrará el fallo.

No confundir la API Samsung Microphone (que gestiona dispositivos y efectos) o VoiceControl (para órdenes reconocidas) con la entrega de un flujo de audio bruto a terceros. La ruta implementada requiere una pista MediaStream real obtenida con getUserMedia.

Documentación:
- https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/systeminfo-api/getting-device-capabilities-using-systeminfo-api.html
- https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/microphone-api.html
- https://github.com/Samsung/tizen-docs/blob/master/docs/application/web/reference/security-privileges.md
