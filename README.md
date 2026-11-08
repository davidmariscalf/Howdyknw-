
## Aplicación nativa para Android TV / Google TV

**Añadida:** android-tv/ incluye una app Android (APK) que usa AudioRecord para captar audio de un micrófono que el propio sistema Android ofrezca a la aplicación. No es una extracción del micrófono de la televisión si el sistema no lo expone. Requiere permiso RECORD_AUDIO, activación visible y transmisión en primer plano; se para al salir de la pantalla. No realiza grabación local.

**APK de prueba:** GitHub Actions compila android-tv/app y publica el archivo howdyknw-android-tv-debug como artefacto descargable. Consulta:
https://github.com/davidmariscalf/Howdyknw-/actions/workflows/android-tv.yml

Uso:
1. Arranca el servidor web de Howdyknw y accede mediante HTTPS (Tailscale Serve es una opción).
2. Descarga la APK debug de la última compilación Android TV satisfactoria e instálala en tu televisión Android/Google TV con consentimiento y acceso al dispositivo.
3. En el navegador receptor abre la pestaña Audio en directo, introduce una sala y pulsa Escuchar ahora.
4. En la app Android TV introduce la URL **wss://** del servidor y el mismo código de sala.
5. Inicia la captura en la pantalla de la TV y autoriza RECORD_AUDIO. Si AudioRecord tiene entrada válida, se enviará audio PCM16 en directo y el receptor lo reproducirá.
6. Pulsa DETENER. La aplicación también corta la captura cuando pierde el primer plano.

Para instalar la APK debug por ADB en un Android TV que permita depuración USB o por red:

~~~sh
adb install -r android-tv/app/build/outputs/apk/debug/app-debug.apk
~~~

El sistema de Android puede proporcionar una entrada de audio integrada, USB o similar. Un micrófono del mando reservado al asistente, una TV sin micrófono accesible o webOS/Tizen sin API de captura **no funcionan con este adaptador**. La aplicación web sigue siendo compatible con navegadores de otros dispositivos que admitan getUserMedia.

Detalles: [android-tv/README.md](android-tv/README.md).

# Howdyknw — TV Privacy Lab

**Laboratorio de privacidad para analizar una Smart TV propia.**

## Qué funciona

| Función | Estado |
|---|---|
| Captura de tráfico desde un router, gateway o puerto espejo | Implementado con TShark |
| Análisis de IP, puertos, DNS, TLS SNI (si es visible) y bytes | Implementado |
| Comparación de dos capturas: encendida vs. reposo | Implementado |
| Panel web: demo, búsqueda, dos sesiones A/B y exportación CSV | Implementado |
| Audio WebRTC desde micrófono voluntariamente activado en otro dispositivo | Implementado en código; pruebas físicas pendientes |
| Escuchar el micrófono interno de una LG en standby | No disponible / no verificado |
| Identificar exactamente el contenido cifrado que envía LG | No disponible solo con captura de red |

La demostración de Gamers Nexus de 2026 utilizó una TV modificada/comprometida. No prueba que todos los televisores LG graben de forma continua en condiciones normales. LG niega la grabación ambiental continua. La API pública de webOS TV no da acceso general al flujo de audio bruto de los micrófonos desde aplicaciones corrientes.

## Arquitectura

~~~text
                      TV LG (propia)
                            |
                       Red doméstica
                            |
         Router/gateway o puerto de red espejo
                            |
                  tshark -> .pcapng
                            |
            howdyknw.py analyze -> JSON
                            |
               dashboard.html (local)
                            |
           Destinos / DNS / SNI / comparación

       Módulo de audio interno: pendiente
       (requiere acceso auténtico y autorizado
        al propio dispositivo, modelo por modelo)
~~~

## Requisitos

- Python 3.10 o superior.
- Wireshark con TShark instalado: https://www.wireshark.org/
- Acceso a un punto de captura que vea el tráfico real del televisor.
- Un dispositivo propio o permiso para probarlo.

**Importante:** un ordenador cualquiera conectado a la misma Wi-Fi normalmente NO ve todas las conexiones unicast de la televisión. Un informe vacío no demuestra ausencia de tráfico.

## Uso

Identifica en los ajustes de red de tu TV su dirección IP. Ejemplo: 192.168.1.30. Identifica la interfaz correcta en la máquina de captura:

~~~sh
tshark -D
~~~

Ejemplo de captura con la TV encendida (sustituye la IP y la interfaz 1):

~~~sh
python howdyknw.py capture --tv-ip 192.168.1.30 --interface 1 --seconds 180 --out captures/on.pcapng
python howdyknw.py analyze --tv-ip 192.168.1.30 --pcap captures/on.pcapng --label encendida --out reports/on.json
~~~

Pon la TV en standby con el mando, manteniéndola conectada a la electricidad y realiza otra captura del mismo tiempo:

~~~sh
python howdyknw.py capture --tv-ip 192.168.1.30 --interface 1 --seconds 180 --out captures/standby.pcapng
python howdyknw.py analyze --tv-ip 192.168.1.30 --pcap captures/standby.pcapng --label standby --out reports/standby.json
~~~

Compara:

~~~sh
python howdyknw.py compare --before reports/on.json --after reports/standby.json --out reports/diff.json
~~~

Abre dashboard.html con tu navegador y carga reports/on.json y reports/standby.json. El panel procesa todo en el propio navegador, sin enviar archivos fuera.

En Windows, si TShark no está en PATH, indica su ruta con la opción global, antes del comando:

~~~powershell
python howdyknw.py --tshark "C:\Program Files\Wireshark\tshark.exe" analyze --tv-ip 192.168.1.30 --pcap captures/on.pcapng --out reports/on.json
~~~


## Audio en directo entre dos dispositivos (micrófono externo)

El repositorio también contiene una aplicación web de Node.js con WebRTC. Permite transmitir en directo el **micrófono del dispositivo emisor** a un receptor, con activación explícita y permiso del navegador. Esto **no equivale a escuchar el micrófono interno de LG**.

Requiere Node.js 20 o superior:

~~~sh
npm install
npm start
~~~

Abre http://localhost:3000 en el ordenador servidor. La interfaz contiene una pestaña de audio y otra de red. Para usar el micrófono de otro dispositivo, la página de origen debe cargarse en un contexto seguro (HTTPS o localhost), y tanto emisor como receptor deben acceder al mismo servicio y compartir el código de sala.

El navegador pide permiso para usar el micrófono; no se activa de forma oculta. La transmisión no sustituye el diagnóstico de la televisión y no representa prueba de lo que una LG capta.

Además, existe un monitor de red en tiempo real basado en TShark:

~~~sh
python tv_monitor.py --interface 1 --tv-ip 192.168.1.30 --duration 180 --output data/report.json
~~~

El servidor Node.js consulta ese informe para la pestaña de red; su formato es distinto del de howdyknw.py, utilizado por dashboard.html.

## Cómo probar el micrófono sin sacar conclusiones falsas

1. Anota el **modelo exacto**, versión de webOS y si dispone de función de voz de campo lejano, «Hi LG» y/o micrófono en el Magic Remote.
2. Con las personas presentes informadas, utiliza frases de prueba ficticias (sin datos personales).
3. Documenta las condiciones: voz deshabilitada, activada sin palabra de inicio, reconocimiento activado explícitamente y standby, cuando el modelo admita esas pruebas.
4. Captura los mismos intervalos de tráfico. Si obtienes registros del **propio televisor** por medios autorizados, consérvalos localmente y compara sus marcas temporales.
5. Etiqueta las observaciones por nivel de evidencia: tráfico visible, registro del dispositivo verificado, audio interno verificado, o no comprobado.

El micrófono del teléfono o del ordenador NO equivale al de la TV. Tampoco una conexión HTTPS demuestra que se haya enviado audio. Encendido, pantalla apagada, standby y desconectado de electricidad son estados diferentes.

## Interpretación de resultados

- IP + puerto: destino visible de paquetes salientes.
- SNI TLS: nombre de servidor disponible en ciertas conexiones; puede estar oculto.
- Consultas DNS: nombres solicitados, no prueba de comunicación posterior con cada dominio.
- Bytes: tamaño total de las tramas observadas, no bytes de voz.
- Comparación: diferencia de destinos entre ventanas; no prueba causalidad ni contenido.
- Si el contenido va cifrado, hace falta otra evidencia para saber qué envía.

## Pruebas de software

~~~sh
python -m unittest -v
~~~

Los tests son sintéticos y no suponen que se haya probado sobre un televisor real. La captura necesita una instalación y topología de red adecuadas.

## Fuentes

- API webOS TV de cámara/micrófono: https://webostv.developer.lge.com/develop/references/camera
- Limitaciones de API de audio en webOS TV: https://forum.webostv.developer.lge.com/t/how-to-implement-the-native-support-for-web-conferencing-utilising-lg-smart-tvs-camera-and-mic-device-capabilities/5265
- Debate sobre audio del mando (2026): https://forum.webostv.developer.lge.com/t/how-to-access-microphone-input-and-voice-recognition-on-webos-tv/28117
- Contexto y límites de la investigación: https://www.malwarebytes.com/blog/privacy/2026/09/lg-tv-flaws-could-let-attackers-listen-in-even-in-standby-mode

## Privacidad

Los archivos .pcapng y .json generados pueden incluir metadatos privados. Mantén captures/ y reports/ fuera del control de versiones.

## Conectar dos dispositivos usando HTTPS

La forma más sencilla de probarlo en tus propios equipos sin abrir un servidor al público es con Tailscale en ambos dispositivos y HTTPS habilitado en la tailnet. Con el servidor Node.js ya arrancado, en otro terminal ejecuta:

~~~sh
tailscale serve 3000
~~~

Tailscale muestra una dirección HTTPS con terminación ts.net, a la que pueden acceder los dispositivos autorizados en esa misma tailnet. Copia esa URL y utilízala tanto en el emisor como en el receptor. Instrucciones oficiales: https://tailscale.com/docs/reference/tailscale-cli/serve

El navegador necesita HTTPS o localhost para conceder el micrófono. Abrir una dirección HTTP privada de LAN normalmente no permite usarlo. Aunque WebRTC puede funcionar directamente, algunas redes necesitan TURN; el servidor lee TURN_URLS, TURN_USERNAME y TURN_CREDENTIAL del entorno si los configuras. En móviles, el sistema puede detener el micrófono al dejar la pestaña en segundo plano. El micrófono solo funciona después de confirmar el consentimiento y aceptar el permiso del navegador.

La aplicación usa STUN público por defecto para WebRTC; por ello, no es correcto decir que no contacta nunca servicios externos. El análisis y exportación de informes sí se procesan localmente y no llevan publicidad ni analítica.

## Importación de informes y pruebas A/B

En Conexiones de TV:

- Importar sesión A muestra un informe real generado con tv_monitor.py o howdyknw.py analyze.
- Importar sesión B compara las IP de destino entre dos sesiones.
- Filtrar permite buscar direcciones IP, nombres visibles y puertos.
- CSV exporta el informe actual.
- Ver ejemplo carga dos archivos de prueba inventados; están etiquetados expresamente como datos sintéticos.

Para generar un informe compatible con la web desde un archivo pcapng:

~~~sh
python tv_monitor.py --pcap captures/on.pcapng --tv-ip 192.168.1.50 --output data/report.json
~~~

El monitor actualizado admite IPv4 e IPv6, pero una ejecución filtra una dirección IP concreta. Una TV con IPv4 e IPv6 simultáneos necesita capturas separadas o un punto de monitorización que permita identificar todas las direcciones de esa TV. Para archivos PCAP, la duración indicada procede de las marcas temporales observadas, no del tiempo que tarda Python en analizar el archivo.

## Validación

~~~sh
python -m unittest -v
npm run check
npm test
~~~

GitHub Actions ejecuta las pruebas. La validación de audio real entre dos dispositivos y la captura desde una TV física sigue requiriendo que ambos equipos estén disponibles. Enviar audio desde un móvil próximo a la tele no equivale a leer el micrófono interno de la TV.
