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

## Alternativa: teclado de Tizen

Cuando getUserMedia no permita el micrófono, **ABRIR TECLADO** enfoca un campo de texto ordinario. Si el teclado Samsung instalado tiene un botón de dictado, úsalo con una frase de prueba y comprueba que el texto aparece. No todas las versiones de Tizen ofrecen dictado.

**COMPARTIR TEXTO** requiere consentimiento y una sala configurada. Solo envía las palabras visibles al receptor Howdyknw; no descarga ni transmite el audio interno utilizado por el reconocimiento de voz. El receptor muestra «No es una grabación de audio».

Ninguna aplicación obtiene más permisos al declararse falsamente teclado. El acceso a audio depende de las APIs y del firmware. La app Tizen todavía necesita empaquetado, firma y validación sobre una Samsung física.


## Firmar e instalar el paquete .wgt (Samsung TV real)

Una Samsung TV **no acepta un paquete sin firma válida**. La cuenta Samsung Developers y el certificado de distribución asociado al DUID del televisor son requisitos reales; no es posible generar desde GitHub una firma equivalente a la del propietario. Nunca subas archivos .p12, perfiles ni contraseñas al repositorio.

1. Instala Tizen Studio, la Samsung TV Extension y la Samsung Certificate Extension.
2. Abre *Tools > Certificate Manager*, selecciona **Samsung > TV** y crea un perfil de autor y distribuidor que incluya el DUID de tu TV.
3. En tu ordenador, ejecuta `bash tizen-tv/package-with-profile.sh TU_PERFIL_SAMSUNG` desde el repositorio; este script invoca `tizen build-web` y `tizen package -t wgt -s TU_PERFIL_SAMSUNG`.
4. Activa el modo desarrollador en el televisor y permite instalaciones desde Tizen Studio. Conéctalo y despliega el WGT desde Device Manager, o con las herramientas Tizen/SDB.
5. Abre la aplicación y valida sus permisos de Internet y micrófono en el modelo real.

GitHub Actions genera únicamente un **ZIP con el proyecto fuente verificado** en el flujo [Samsung Tizen source checks](https://github.com/davidmariscalf/Howdyknw-/actions/workflows/samsung-tizen.yml). Ese ZIP no es un WGT firmado y no debe presentarse como una aplicación Samsung instalable.

Fuentes oficiales:
- https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html
- https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html
