# Howdyknw — TV Privacy Lab

**Laboratorio de privacidad para analizar una Smart TV propia.**

## Qué funciona

| Función | Estado |
|---|---|
| Captura de tráfico desde un router, gateway o puerto espejo | Implementado con TShark |
| Análisis de IP, puertos, DNS, TLS SNI (si es visible) y bytes | Implementado |
| Comparación de dos capturas: encendida vs. reposo | Implementado |
| Panel visual local, sin anuncios ni servidores externos | Implementado |
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

## Módulo web con audio entre dispositivos

Además del laboratorio de tráfico `howdyknw.py` / `dashboard.html`, el repositorio incluye una **web interactiva Node.js** en `public/`, con señalización WebSocket y audio WebRTC entre equipos autorizados. **Este módulo usa el micrófono del teléfono o del ordenador próximo a la TV, no el micrófono interno del televisor.** No permite extraer audio ambiental de una LG en reposo.

Instalación desde el directorio raíz:

~~~sh
npm install
npm start
~~~

Abre `http://localhost:3000` en el ordenador para probar emisor y receptor en pestañas separadas. Para conectar dos dispositivos distintos, publica el servidor Node.js bajo **HTTPS** (el permiso del micrófono no funciona en HTTP LAN normal) y comparte el código generado por la web. En redes con NAT estricto configura un TURN mediante `TURN_URLS`, `TURN_USERNAME` y `TURN_CREDENTIAL`. La web **no graba el audio** en el servidor y muestra el micrófono activo.

El panel de conexiones acepta archivos JSON generados con `tv_monitor.py` y también los informes de tráfico saliente generados por `howdyknw.py analyze`. El script adicional `tv_monitor.py` captura metadatos en vivo o analiza un PCAP y genera `data/report.json` para su visualización automática en la web:

~~~sh
tshark -D
python tv_monitor.py --interface 1 --tv-ip 192.168.1.30
# Alternativa: python tv_monitor.py --pcap captures/on.pcapng --tv-ip 192.168.1.30
~~~

Sustituye la interfaz y la IP por las reales. **Estar conectado a la misma Wi-Fi no garantiza ver los paquetes del televisor**. Los informes únicamente contienen destinos y metadatos capturados, no contenido de comunicaciones cifradas.

Pruebas del módulo web: `npm run check && npm test`. La prueba física de la TV y del audio entre dispositivos requiere esos equipos conectados.
