# Howdyknw: conexión con televisión en otra casa o ciudad

**Este es el circuito real.** No hace falta que TV y móvil estén en la misma red.

~~~text
  TV (otra casa)                 Servidor HTTPS/WSS                  Móvil (fuera)
  App Howdyknw --WSS cifrado--> Howdyknw Node.js --WSS cifrado--> Receptor web
       │                               │                                  │
  Iniciar visible                Reenvía audio PCM                    Escuchar
  + permiso                     Solo en memoria                      + auriculares
~~~

La función de **retransmisión WSS** usa el servidor como intermediario, así que funciona a través de NAT/CGNAT sin contratar TURN. **Howdyknw 1.3 cifra el PCM con AES-256-GCM en el dispositivo de origen y lo descifra únicamente en el receptor.** El servidor ya no necesita acceder al audio original. Se requiere una **clave de audio independiente del código de sala** y el servidor remoto rechaza PCM sin cifrar. No confundas esto con el modo WebRTC, que usa DTLS-SRTP y puede necesitar TURN. Consulta [el protocolo E2EE](END_TO_END_ENCRYPTION.md) para los límites de seguridad, especialmente si el propio hosting puede alterar el JavaScript entregado al navegador.

El micrófono de la TV solo se inicia allí, por una persona informada y con permiso. Cerrar la app o pulsar Detener termina la transmisión; no es un sistema para escuchar secretamente el ambiente ni para activar una televisión en standby.

## Opción principal: servidor Railway ya desplegado

- **Web del receptor y fuente:** https://howdyknw-production.up.railway.app/
- **URL para la app Android TV:** `wss://howdyknw-production.up.railway.app/`
- **Comprobación externa realizada el 9 de noviembre de 2026:** `GET /api/health` obtuvo HTTP 200 y un navegador externo abrió el WebSocket WSS mediante el botón «Comprobar servidor».
- **Prueba audible sin micrófono:** en la web, genera un código de sala y una clave de audio, comparte la invitación segura con el receptor, pulsa «Escuchar ahora» en el móvil y después «Probar audio cifrado (2 s, sin micrófono)» en el emisor. Se envía un tono sintético suave en tramas AES-GCM. La prueba no requiere permisos de micro y no demuestra acceso al micrófono de una TV.
- **Prueba real con Android TV:** instala APK 1.3, utiliza el mismo código de sala y clave de audio, pulsa «Iniciar audio» de forma visible y comprueba el nivel PCM y la recepción.

La conexión real desde una TV, la reproducción de un micrófono físico y la disponibilidad continuada durante días no han sido verificadas todavía.

## Opción alternativa A: publicar temporalmente desde tu propio ordenador

Tienes que instalar [Tailscale](https://tailscale.com/) en el **ordenador servidor**, no en la televisión alejada. No hace falta instalar Tailscale en la TV ni en el receptor porque la opción Funnel publica una dirección HTTPS accesible por Internet.

En la carpeta del proyecto ejecuta:

~~~sh
npm install
npm run remote
~~~

En un **segundo terminal del mismo ordenador**:

~~~sh
tailscale funnel 3000
~~~

La primera vez Tailscale puede pedirte habilitar Funnel y HTTPS. Recibirás una URL HTTPS real con dominio `ts.net`. **No utilices un ejemplo inventado como dirección real.** El servicio queda público y el modo remoto mantiene deshabilitada la API de informes locales, así que mantén el enlace privado y genera un código de sala aleatorio. Para detener el acceso público, utiliza `tailscale funnel 3000 off` o `tailscale funnel reset`.

Fuentes oficiales: https://tailscale.com/docs/reference/tailscale-cli/funnel y https://tailscale.com/docs/features/tailscale-funnel

En este modo el ordenador debe permanecer encendido, conectado a Internet, y con Node.js y Funnel funcionando. Si se apaga, el receptor pierde la conexión.

## Opción alternativa B: otro servidor en la nube

El proyecto incluye `railway.json` para alojarlo con Railway u otro servicio compatible con Node.js y WebSockets. Usa **una sola instancia**: las salas están almacenadas en la memoria del proceso y no están sincronizadas entre réplicas. El hosting necesita TLS/HTTPS en la dirección pública, y un entorno de ejecución con `NODE_ENV=production`.

En Railway: conecta el repositorio `davidmariscalf/Howdyknw-`, rama `main`; despliega el servicio Node con `npm start`; crea un dominio HTTPS; comprueba la ruta `/api/health`. Railway establece `PORT` y la aplicación escucha automáticamente en `0.0.0.0` cuando detecta su entorno. Asegúrate de que la plataforma permite WebSockets activos. **Alojarlo puede tener costes** y el servidor indicado arriba ya se ha creado en Railway. Revisa el consumo y el plan de la cuenta.

En modo producción, `/api/report` no devuelve los informes locales de tráfico, salvo configuración explícita `ALLOW_REMOTE_REPORT=1` (desaconsejada para un servicio público).

## Cómo conectar los dispositivos

1. Abre la **URL HTTPS pública** indicada al principio de este documento (o la de tu servidor alternativo).
2. En la televisión remota instala y abre Howdyknw para Android TV/Google TV, o la app Samsung/Tizen firmada si tienes un modelo compatible.
3. En Android TV **1.3 o posterior**, introduce **`wss://howdyknw-production.up.railway.app/`**. Para Tizen utiliza la dirección HTTPS si tienes instalada una app Tizen firmada.
4. Elige y comparte **un código de sala largo, aleatorio y privado**. En la TV aparece además una **clave de audio privada**, independiente de la sala, que también debes introducir en el navegador receptor.
5. En el móvil/PC receptor abre la misma dirección HTTPS, entra en Audio en directo e introduce el código. Pulsa Escuchar ahora.
6. En la televisión, ante los presentes y con su conocimiento, pulsa Iniciar audio y concede permisos. Si el sistema expone micrófono, la app Android TV **cifra PCM16 en el dispositivo** y envía tramas autenticadas por WSS; no necesita TURN.
7. En el navegador emisor, el servidor público marca automáticamente **Modo distancia** y exige **Cifrado extremo a extremo**. También puedes utilizar el botón de tono de prueba sin usar el micrófono.
8. Para terminar, pulsa Detener en la TV o deja de escuchar en el receptor. Si el sistema no permite micrófono, el teclado solo puede devolver **texto voluntariamente compartido**, no audio remoto.

## Seguridad y limitaciones

- Enlaces públicos HTTPS no implican que la aplicación esté autenticada: **el código de sala es la clave de acceso**. No lo publiques ni reutilices. La web genera un código aleatorio; evita elegir códigos predecibles.
- Con PCM 1.3, la clave de audio no se envía al servidor y este solo retransmite tramas AES-GCM cifradas. El hosting que sirve el JavaScript receptor podría modificarlo si estuviera comprometido; para esa amenaza hacen falta clientes confiables independientes.
- Las salas son temporales y no hay base de datos de sesiones. Reiniciar Node desconecta a todos.
- El servidor limita las conexiones y receptores; esto no equivale a una auditoría externa de seguridad ni a garantía de disponibilidad.
- La TV necesita estar encendida y tener instalada la app actualizada (1.3 o posterior) con permiso. Una TV webOS, Tizen, Android o de cualquier marca no expone necesariamente audio bruto de su micrófono.
- La opción de audio del navegador utiliza una API Web Audio de compatibilidad amplia pero obsoleta; algunos televisores pueden no implementarla. En Android TV se recomienda el módulo nativo.
- El servidor HTTPS/WSS ya está desplegado y ha respondido en pruebas externas. **No existe una prueba verificada de audio de una TV física**. Las pruebas de código y las señales sintéticas no sustituyen la validación del hardware.

## Historia de despliegue Railway

La cuenta anterior devolvió inicialmente un error de período de prueba caducado. El 9 de noviembre de 2026 se creó satisfactoriamente el proyecto `howdyknw-tv-audio` en el espacio conectado «Nestea's Projects», se desplegó el repositorio principal y se asignó el dominio `howdyknw-production.up.railway.app`. Los registros de Railway confirman que Node.js arrancó en el puerto proporcionado y una prueba externa confirmó HTTP 200 y WebSocket abierto.

**Pendiente:** validar el APK en la TV real, el audio audible entre redes físicas y la sostenibilidad de costes/operación continuada.
