# Howdyknw 1.3 — Cifrado de extremo a extremo para PCM

## Estado de la implementación

Desde la versión 1.3, **Android TV envía exclusivamente PCM cifrado** y el servidor iniciado en modo público (`npm run remote` o Railway con `NODE_ENV=production`) **rechaza fuentes PCM sin cifrar**. El receptor descifra cada tramo en el navegador con una clave independiente del código de sala.

El servidor ve el código de sala, estado de conexión, tráfico cifrado y número de receptores, pero **no recibe la clave de audio ni recibe muestras PCM originales**.

## Emparejamiento: televisión lejana y móvil

1. Arranca el servidor de Howdyknw con `npm run remote` y publica HTTPS mediante Tailscale Funnel. Alternativamente, conecta un hosting compatible con WebSocket continuo.
2. Abre Howdyknw en la TV Android con APK **1.3.0 o posterior**. Introduce la URL WSS y el código de sala (8–16 letras y números). La pantalla tiene una **clave de audio privada** aleatoria (32 caracteres hexadecimales). Anota esa clave o compártela únicamente con el receptor.
3. En el móvil abre la web HTTPS del servidor, entra en el panel receptor y escribe **el mismo código de sala y la misma clave de audio** en sus campos separados.
4. Pulsa **Escuchar ahora**. En la TV pulsa **Iniciar audio** y autoriza el micrófono con todas las personas presentes informadas. Si la TV ofrece un micrófono PCM, la app enviará mensajes `encrypted-frame` y el navegador descifrará el audio.
5. Si la clave no coincide, el receptor mostrará un error de autenticación y **no reproducirá** los datos cifrados.
6. No se envían muestras de audio cuando la sala no tiene receptores; abandonar la app TV corta la captura.

Para un navegador como emisor, selecciona **Modo distancia**, deja marcado **Cifrado extremo a extremo**, genera tu clave privada y comparte el código + clave. Puedes pulsar **Copiar invitación con clave privada** para crear un enlace que utiliza fragmentos `#room=...&audioKey=...`; el fragmento no se envía al servidor en una solicitud HTTP normal, pero quien obtenga el enlace podrá escuchar mientras la fuente comparta el mismo secreto.

## Protocolo

- Muestra de entrada: 20 ms de PCM16 mono a 16 kHz, **640 bytes** por trama.
- Material de clave: contraseña/clave aleatoria independiente, de 16–128 caracteres; el código de sala no es la contraseña criptográfica.
- Derivación: PBKDF2-HMAC-SHA256, 150 000 iteraciones, sal UTF-8 `howdyknw-e2ee-v1|<ROOM>`, longitud 256 bits. Un secreto **verdaderamente aleatorio de 128 bits o más** es recomendable para prevenir ataques de diccionario.
- Cifrado autenticado: AES-256-GCM con IV de 12 bytes aleatorios *nuevos para cada trama* y etiqueta GCM de 16 bytes.
- Sobre cifrado: `IV(12) || ciphertext(640) || authTag(16)` = **668 bytes**, en una cadena Base64 de 892 caracteres. El servidor retransmite exactamente esa cadena opaca, sin clave ni función de descifrado.
- Descifrado: Web Crypto `subtle.decrypt` en el navegador receptor. Se rechazan etiquetas incorrectas, claves erróneas y tramas repetidas dentro de una ventana de 8192 IV.
- Envío: sobre WebSocket seguro WSS. La seguridad del tránsito WSS **se suma**, pero no sustituye, al cifrado extremo a extremo PCM.
- Modo web WebRTC de Tizen/navegador: utiliza cifrado WebRTC (DTLS-SRTP), una ruta distinta del PCM AES-GCM aquí descrito.
- Texto dictado desde teclado: **no está incluido en el cifrado PCM**; se transmite como texto por WSS solo cuando el usuario pulsa Compartir.

## Limitaciones y modelo de amenazas

La seguridad protege el contenido PCM frente a un **servidor de retransmisión que solo ve tramas cifradas**. No protege frente a un televisor o receptor ya comprometido, un usuario que comparta la clave, o un operador de hosting malicioso que modifique el JavaScript servido al navegador receptor para robarla. Para afrontar este último escenario, el receptor necesitaría usar una aplicación previamente instalada y autenticada, o archivos estáticos verificados independientes del relay.

El servidor también puede observar **metadatos**: quién se conecta, duración, volumen de datos y patrones temporales. No hay rotación automática de claves durante una sesión, auditoría criptográfica de terceros, certificados de aplicación para verificar identidad del emisor ni validación física del hardware.

El cifrado no desbloquea el micrófono interno de ningún fabricante. En televisores que no exponen PCM, solo sigue disponible la función de texto si el teclado del sistema la permite.

## Verificación automatizada

- `tests/e2ee.test.js`: roundtrip JavaScript AES-GCM, clave incorrecta, tampering y rechazo de retransmisiones repetidas.
- `tests/server.test.js`: transmisión de envolturas cifradas, aislamiento por sala, rechazo de PCM sin cifrar en sala cifrada.
- `tests/remote.test.js`: arranque del servidor público, rechazo de fuentes PCM sin cifrar, envío de trama cifrada entre dos clientes independientes y descifrado en el destino.
- `android-tv/tests/AudioCryptoSmoke.java`: JVM, comparación de PBKDF2 y AES-GCM con vectores independientes, integridad, clave incorrecta y tamaño de tramas.
- GitHub Actions: ejecución de los tests y compilación Android TV.

**Estas pruebas no demuestran que un micrófono específico funcione en un televisor físico ni que el servidor esté desplegado por Internet.** Para eso hay que probar el APK en una TV con acceso real y el receptor en otra red.
