# Howdyknw — TV Audio & Privacy Lab

Proyecto multisoporte para estudiar el tráfico de red de televisores propios y **probar de forma visible y autorizada** las entradas de voz que cada plataforma realmente permite.

> **Límite técnico fundamental:** no existe un permiso universal para descargar audio del micrófono interno de cualquier TV. Llamar «teclado» a una aplicación no desbloquea un micrófono reservado por el fabricante. El modo teclado usa el método de entrada real del televisor y devuelve **texto, no audio**.

## Tres maneras de utilizarlo

| Plataforma | Audio en directo | Teclado/dictado del sistema | Estado |
|---|---|---|---|
| Android TV / Google TV | AudioRecord (solo si Android permite abrir una entrada PCM real) | Gboard/IME o reconocimiento por Intent; texto compartido manualmente | APK debug 1.1 compilada, hardware pendiente |
| Samsung Tizen | getUserMedia/WebRTC si existen y están permitidos | Campo de texto, teclado Tizen y compartir texto manualmente | Código fuente; falta firma Tizen y prueba física |
| Navegador en Smart TV / móvil / PC | getUserMedia/WebRTC cuando existe | Campo de texto y teclado del dispositivo (voz si existe) | Integrado en la web; depende del navegador |

No se permite lectura silenciosa del micrófono, ejecución oculta en standby ni acceso a audio del mando reservado al asistente. La opción de voz de Gboard puede usar un servicio de reconocimiento remoto del proveedor.

## Inicio del servidor y receptor web

Requiere Node.js 20 o superior:

~~~sh
git clone https://github.com/davidmariscalf/Howdyknw-.git
cd Howdyknw-
npm install
npm start
~~~

Abre **http://localhost:3000** desde el mismo ordenador.

El servidor acepta conexiones WebSocket para WebRTC, audio PCM16 nativo y **mensajes de texto separados**. El receptor web distingue claramente la transcripción del audio. No almacena el contenido de audio ni los textos enviados como historial.

### Acceso desde la TV

El micrófono web requiere HTTPS o localhost. Puedes usar Tailscale en ambos dispositivos y exponer el servidor mediante:

~~~sh
tailscale serve 3000
~~~

Abre la URL HTTPS proporcionada en la TV y en el receptor. Usa el mismo código de sala. El dispositivo que transmite necesita permiso y consentimiento. Si una red no permite WebRTC directo, configura TURN con TURN_URLS, TURN_USERNAME y TURN_CREDENTIAL.

El audio PCM16 de Android TV se transporta por WSS al servidor; no necesita WebRTC en el emisor. El modo web/Tizen utiliza WebRTC si está disponible.

## Android TV / Google TV — APK 1.1

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
