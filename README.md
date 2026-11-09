# Howdyknw — TV Audio & Privacy Lab

Proyecto multisoporte para estudiar el tráfico de red de televisores propios y **probar de forma visible y autorizada** las entradas de voz que cada plataforma realmente permite.

> **Límite técnico fundamental:** no existe un permiso universal para descargar audio del micrófono interno de cualquier TV. Llamar «teclado» a una aplicación no desbloquea un micrófono reservado por el fabricante. El modo teclado usa el método de entrada real del televisor y devuelve **texto, no audio**.

## Novedades de la auditoría de noviembre de 2026

- Sesiones remotas: detección y liberación de conexiones WebSocket inactivas.
- Audio: **no se envían muestras PCM al servidor cuando no hay oyentes**; el origen muestra el contador de receptores.
- Recepción: volumen regulable, estadísticas de tramas y prueba de conectividad HTTP/WebSocket sin activar micrófono.
- Tizen: negociación ICE y conexión al servidor corregidas.
- Capturas: lector PCAP incremental con uso de memoria más controlado.
- Invitaciones: enlaces de sala disponibles antes de activar el micrófono y código en fragmento URL.
- Pruebas ampliadas con integridad de interfaz, latidos WebSocket, seguridad de origen y regresiones de capturas vacías.

El [informe de auditoría](docs/AUDIT_2026-11-09.md) distingue las pruebas automáticas de lo que **todavía requiere comprobarse en dispositivos físicos**.

## Recuperación de micrófono (Android TV 1.4)

La nueva APK 1.4 añade **REINTENTAR Y PROBAR OTRA ENTRADA**, comprueba el permiso `RECORD_AUDIO` y si el sistema tiene silenciado el micrófono. Cuando una fuente falla, prueba `MIC`, `VOICE_RECOGNITION` y `DEFAULT` (fuentes normales de Android, no privadas). Si el micrófono abre pero no entrega señal apreciable, informa del problema y permite cambiar manualmente de fuente, sin ocultar la captura ni transmitir audio cuando no hay receptores. También permite abrir los ajustes de permisos; si falla el PCM, mantiene la opción de teclado y reconocimiento de voz, **solo texto**.

En la fuente web ahora puedes consultar los micrófonos autorizados del navegador y elegir otro, por ejemplo un accesorio USB o un móvil cercano, antes de pulsar **Activar micrófono**. No es posible forzar la captura de un micrófono reservado por el firmware. Lee [instrucciones de recuperación Android](android-tv/README.md).

## Tres maneras de utilizarlo

| Plataforma | Audio en directo | Teclado/dictado del sistema | Estado |
|---|---|---|---|
| Android TV / Google TV | AudioRecord (solo si Android permite abrir una entrada PCM real) | Gboard/IME o reconocimiento por Intent; texto compartido manualmente | APK debug 1.4 con recuperación de entradas y PCM AES-GCM; pruebas físicas pendientes |
| Samsung Tizen | getUserMedia/WebRTC si existen y están permitidos | Campo de texto, teclado Tizen y compartir texto manualmente | Código fuente; falta firma Tizen y prueba física |
| Navegador en Smart TV / móvil / PC | getUserMedia/WebRTC cuando existe | Campo de texto y teclado del dispositivo (voz si existe) | Integrado en la web; depende del navegador |

No se permite lectura silenciosa del micrófono, ejecución oculta en standby ni acceso a audio del mando reservado al asistente. La opción de voz de Gboard puede usar un servicio de reconocimiento remoto del proveedor.

## Uso con la TV lejos (otra casa, ciudad o red)

**Compatible en la arquitectura actual.** La TV, el móvil y el servidor no tienen que estar en la misma Wi-Fi. Usa el servidor público Railway de este proyecto, o, para hospedar por tu cuenta, ejecuta `npm run remote` y `tailscale funnel 3000` desde dos terminales para obtener una URL HTTPS de Tailscale. Cada dispositivo usa la **misma dirección HTTPS/WSS y código privado**.

La app Android TV **1.4** cifra cada trama PCM con AES-256-GCM antes de enviarla al servidor WSS. Para escuchar necesitas tanto el código de sala como una **clave de audio independiente**. El servidor remoto rechaza fuentes PCM sin cifrar. En un navegador emisor selecciona **Modo distancia (sin TURN)** y activa el cifrado extremo a extremo. Detalles y límites en [cifrado E2EE](docs/END_TO_END_ENCRYPTION.md). El modo WebRTC usa DTLS-SRTP y puede necesitar TURN.

Para evitar publicar informes de tráfico privados, el arranque `npm run remote` bloquea la API de reportes. No existe captación remota sin iniciar voluntariamente el micrófono en la TV. Para instrucciones paso a paso y limitaciones: **[Conexión con TV lejana](docs/REMOTE_CONNECTION.md)**.

## Actualización posterior al despliegue (9 de noviembre de 2026)

El servidor HTTPS/WSS que ya está en Railway está **en ejecución**, pero Railway continúa mostrando como desplegado el commit inicial `894b9005db789905714c235dae9ead2653063e7e`. Las mejoras posteriores (clave oculta, modo distancia seleccionado por defecto, test de audio sintético sin micrófono y cierre de sockets sin sala) están **en `main` de GitHub con pruebas automáticas aprobadas**, pero **todavía no están en la URL pública**.

La actualización del servicio existente intentó reconectar `davidmariscalf/Howdyknw-` a Railway, pero el conector devolvió literalmente `User does not have access to the repo` para las cuentas Railway actualmente disponibles. Para desbloquear el despliegue automático, autoriza el acceso de Railway al repositorio en la integración GitHub de la cuenta correcta, manteniendo el servicio y dominio existentes. No se ha creado un segundo servicio porque duplicaría recursos y costes sin solucionar el acceso.

## Estado público verificado (9 de noviembre de 2026)

**Servidor Railway desplegado** en [https://howdyknw-production.up.railway.app/](https://howdyknw-production.up.railway.app/), con WebSocket seguro en `wss://howdyknw-production.up.railway.app/`. Prueba externa independiente: `/api/health` respondió HTTP 200 y la opción de diagnóstico del navegador confirmó conexión WSS, sin pedir micrófono. El servicio ejecuta una sola instancia en producción. No hay evidencia aún de audio real de una TV física.

- El servidor público rechaza fuentes PCM sin cifrar; Android TV 1.3 envía `pcm-e2ee`.
- El formulario web preselecciona **Modo distancia** y exige cifrado PCM al reconocer que es un servidor público.
- Usa **Probar audio cifrado (2 s, sin micrófono)** con el receptor conectado para comprobar el canal con un tono sintético de bajo volumen, sin activar el micrófono.
- El proyecto Samsung sigue requiriendo una firma WGT con certificado y DUID del dispositivo; no se ha probado en una Samsung real.
- Los precios y cuotas de Railway dependen de la cuenta. Controla el consumo y las opciones de facturación; desplegar un servicio no implica uso gratuito ilimitado.

Consulta [conexión remota](docs/REMOTE_CONNECTION.md), [cifrado E2EE](docs/END_TO_END_ENCRYPTION.md) y [validación física](docs/HARDWARE_VALIDATION.md).

## Inicio del servidor y receptor web

Requiere Node.js 20 o superior:

~~~sh
git clone https://github.com/davidmariscalf/Howdyknw-.git
cd Howdyknw-
npm install
npm start
~~~

Abre **http://localhost:3000** desde el mismo ordenador.

El servidor acepta conexiones WebSocket para WebRTC, audio PCM16 cifrado E2EE nativo y **mensajes de texto separados** (no incluidos en el cifrado PCM). En modo público rechaza PCM16 sin cifrar. El receptor web distingue claramente la transcripción del audio. No almacena el contenido de audio ni los textos enviados como historial.

### Acceso desde la TV

El micrófono web requiere HTTPS o localhost. Puedes usar Tailscale en ambos dispositivos y exponer el servidor mediante:

~~~sh
tailscale serve 3000
~~~

Abre la URL HTTPS proporcionada en la TV y en el receptor. Usa el mismo código de sala. El dispositivo que transmite necesita permiso y consentimiento. Si una red no permite WebRTC directo, configura TURN con TURN_URLS, TURN_USERNAME y TURN_CREDENTIAL.

El audio PCM16 de Android TV se transporta por WSS al servidor; no necesita WebRTC en el emisor. El modo web/Tizen utiliza WebRTC si está disponible.

## Android TV / Google TV — APK 1.4

El código está en [android-tv/](android-tv/), con una compilación de APK debug por GitHub Actions:
https://github.com/davidmariscalf/Howdyknw-/actions/workflows/android-tv.yml

Instala la APK con Android Studio o ADB en un dispositivo de tu propiedad. En la app, introduce la dirección **wss://** del servidor y el código de sala.

1. **Activar micrófono**: solicita RECORD_AUDIO, abre AudioRecord cuando Android lo permite y transmite PCM16 al receptor. Muestra el dispositivo de entrada utilizado y el nivel de señal. Se detiene al dejar la aplicación.
2. **Abrir teclado de la TV**: da foco a un campo de entrada. El teclado del sistema puede ofrecer voz a texto, especialmente Gboard para Android TV.
3. **Probar reconocimiento de voz**: invoca la actividad del reconocedor instalado, cuando existe. Solo devuelve texto y puede usar servidores del proveedor.
4. **Compartir solo texto**: envía lo visible en el campo a la misma sala **solo después de pulsar el botón y confirmar consentimiento**. El receptor lo identifica como texto, no como audio.

Ni el teclado ni el reconocedor entregan el audio bruto del mando a Howdyknw. Si no hay entrada PCM ni servicio de dictado, la aplicación debe indicar la incompatibilidad.

Detalles técnicos y pasos: [android-tv/README.md](android-tv/README.md).

## Samsung / Tizen

El código está en [tizen-tv/](tizen-tv/). Puede usar audio WebRTC si el televisor expone y autoriza getUserMedia. Si no, incluye entrada de texto mediante el teclado del sistema; si este ofrece voz a texto, permite compartir manualmente la transcripción.

Necesita Tizen Studio, certificado de desarrollador y firma para producir e instalar un archivo WGT. **No hay paquete WGT firmado ni prueba en una Samsung física.** Consulta [tizen-tv/README.md](tizen-tv/README.md).

En LG webOS y otras marcas, el panel del navegador solo puede usar las APIs disponibles; el campo de texto no cambia los permisos del micrófono. No se promete acceso a un micrófono interno de webOS/Tizen bloqueado.

## Analizador de tráfico de Smart TV

Instala TShark (Wireshark) y captura desde un punto que realmente vea los paquetes de tu TV: router, gateway, punto de acceso propio o puerto espejo. Un portátil en el mismo Wi-Fi no tiene por qué ver su tráfico.

Identifica la interfaz:

~~~sh
tshark -D
~~~

Monitor en vivo (cambia IP e interfaz por las reales):

~~~sh
python tv_monitor.py --interface 1 --tv-ip 192.168.1.50 --duration 180 --output data/report.json
~~~

Analiza una captura PCAP existente:

~~~sh
python tv_monitor.py --pcap captures/on.pcapng --tv-ip 192.168.1.50 --output data/report.json
~~~

También puedes capturar y comparar dos situaciones:

~~~sh
python howdyknw.py capture --tv-ip 192.168.1.50 --interface 1 --seconds 180 --out captures/on.pcapng
python howdyknw.py analyze --tv-ip 192.168.1.50 --pcap captures/on.pcapng --label encendida --out reports/on.json
python howdyknw.py capture --tv-ip 192.168.1.50 --interface 1 --seconds 180 --out captures/standby.pcapng
python howdyknw.py analyze --tv-ip 192.168.1.50 --pcap captures/standby.pcapng --label standby --out reports/standby.json
python howdyknw.py compare --before reports/on.json --after reports/standby.json --out reports/diff.json
~~~

Importa los JSON en el panel, filtra destinos y descarga CSV. Puedes usar también dashboard.html sin servidor. Los ejemplos incluidos son sintéticos y están identificados como tales.

**Limitaciones:** DNS, IP, puertos, SNI cuando es visible y tamaño de tramas no revelan los datos exactos dentro de HTTPS ni demuestran que la TV haya transmitido conversaciones. IPv4 e IPv6 deben comprobarse ambos si el dispositivo los utiliza.

## Pruebas y estado

~~~sh
python -m unittest -v
npm run check
npm test
~~~

GitHub Actions ejecuta las pruebas de Python/Node y compila Android TV. **Que un APK compile no demuestra que funcione el audio del modelo específico de TV ni que el teclado de esa TV incluya dictado.** Antes de afirmar un resultado real, sigue el protocolo en [docs/HARDWARE_VALIDATION.md](docs/HARDWARE_VALIDATION.md).

El repositorio ignora captures/, reports/, data/ y archivos PCAP: pueden contener metadatos personales.

## Referencias

- Android TV / teclado y voz a texto: https://developer.android.com/training/tv/get-started/onscreen-keyboard
- Reconocimiento por Intent: https://developer.android.com/reference/android/speech/RecognizerIntent
- AudioRecord: https://developer.android.com/reference/android/media/AudioRecord
- Samsung Tizen: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/microphone-api.html
- LG webOS: https://webostv.developer.lge.com/develop/references/camera
- Tailscale Serve: https://tailscale.com/docs/reference/tailscale-cli/serve
