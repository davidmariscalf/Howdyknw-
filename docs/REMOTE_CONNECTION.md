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

## Opción A: publicar temporalmente desde tu propio ordenador

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

## Opción B: servidor en la nube, siempre encendido

El proyecto incluye `railway.json` para alojarlo con Railway u otro servicio compatible con Node.js y WebSockets. Usa **una sola instancia**: las salas están almacenadas en la memoria del proceso y no están sincronizadas entre réplicas. El hosting necesita TLS/HTTPS en la dirección pública, y un entorno de ejecución con `NODE_ENV=production`.

En Railway: conecta el repositorio `davidmariscalf/Howdyknw-`, rama `main`; despliega el servicio Node con `npm start`; crea un dominio HTTPS; comprueba la ruta `/api/health`. Railway establece `PORT` y la aplicación escucha automáticamente en `0.0.0.0` cuando detecta su entorno. Asegúrate de que la plataforma permite WebSockets activos. **Alojarlo puede tener costes**: no se ha contratado ni realizado un despliegue público en tu cuenta como parte de este cambio.

En modo producción, `/api/report` no devuelve los informes locales de tráfico, salvo configuración explícita `ALLOW_REMOTE_REPORT=1` (desaconsejada para un servicio público).

## Cómo conectar los dispositivos

1. Copia la URL **HTTPS real** del servidor.
2. En la televisión remota instala y abre Howdyknw para Android TV/Google TV, o la app Samsung/Tizen firmada si tienes un modelo compatible.
3. En Android TV **1.3 o posterior**, escribe la URL con prefijo **`wss://`** en el campo del servidor (ejemplo de formato: `wss://tu-equipo.ts.net/`). Para Tizen usa HTTPS.
4. Elige y comparte **un código de sala largo, aleatorio y privado**. En la TV aparece además una **clave de audio privada**, independiente de la sala, que también debes introducir en el navegador receptor.
5. En el móvil/PC receptor abre la misma dirección HTTPS, entra en Audio en directo e introduce el código. Pulsa Escuchar ahora.
6. En la televisión, ante los presentes y con su conocimiento, pulsa Iniciar audio y concede permisos. Si el sistema expone micrófono, la app Android TV **cifra PCM16 en el dispositivo** y envía tramas autenticadas por WSS; no necesita TURN.
7. En otro navegador con micrófono accesible, selecciona **Modo distancia (sin TURN)** y deja marcado **Cifrado extremo a extremo** antes de activar la captura. Es obligatorio si el servidor se publica en Internet.
8. Para terminar, pulsa Detener en la TV o deja de escuchar en el receptor. Si el sistema no permite micrófono, el teclado solo puede devolver **texto voluntariamente compartido**, no audio remoto.

## Seguridad y limitaciones

- Enlaces públicos HTTPS no implican que la aplicación esté autenticada: **el código de sala es la clave de acceso**. No lo publiques ni reutilices. La web genera un código aleatorio; evita elegir códigos predecibles.
- Con PCM 1.3, la clave de audio no se envía al servidor y este solo retransmite tramas AES-GCM cifradas. El hosting que sirve el JavaScript receptor podría modificarlo si estuviera comprometido; para esa amenaza hacen falta clientes confiables independientes.
- Las salas son temporales y no hay base de datos de sesiones. Reiniciar Node desconecta a todos.
- El servidor limita las conexiones y receptores; esto no equivale a una auditoría externa de seguridad ni a garantía de disponibilidad.
- La TV necesita estar encendida y tener instalada la app actualizada (1.3 o posterior) con permiso. Una TV webOS, Tizen, Android o de cualquier marca no expone necesariamente audio bruto de su micrófono.
- La opción de audio del navegador utiliza una API Web Audio de compatibilidad amplia pero obsoleta; algunos televisores pueden no implementarla. En Android TV se recomienda el módulo nativo.
- No hay pruebas con tu televisor ni despliegue en Internet real dentro de esta ejecución. Las pruebas de código por sí solas no sustituyen la validación de hardware.

## Despliegue intentado en Railway

El 9 de noviembre de 2026 se intentó crear un servicio en el espacio Railway conectado, pero Railway devolvió: **“Your trial has expired. Please select a plan to continue using Railway.”** No se creó un dominio, no se inició un despliegue y no se ha contratado ningún plan de pago. Es necesario activar un plan en la cuenta de Railway o usar la opción Tailscale Funnel desde un equipo propio.
