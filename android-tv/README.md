# Howdyknw Native TV Audio

Aplicación Android TV / Google TV (versión 1.5.1) y Android 8.0+ para capturar el **micrófono real expuesto por el sistema** mediante AudioRecord y transmitirlo, con consentimiento y permiso, al navegador receptor de Howdyknw.

No es una solución para capturar el micrófono del mando que solo es accesible por el asistente del fabricante. No tiene servicios de arranque ni grabación en segundo plano; al abandonar la pantalla detiene el audio.

## Compilar

Con Android Studio, abre la carpeta android-tv y sincroniza Gradle. Utiliza Android SDK 35 y JDK 17; compila APK debug con el menú Build > Build APK(s), o usa Gradle 8.9:

    gradle :app:assembleDebug

El APK resultante estará en app/build/outputs/apk/debug/app-debug.apk.

## Preparar el receptor

1. Arranca el servidor raíz Howdyknw: npm install && npm start.
2. Publica HTTPS mediante Tailscale Serve o un proxy privado con certificado válido.
3. En un móvil/ordenador abre la web, pestaña Audio en directo, e introduce un código de sala de 8 a 16 caracteres en el receptor. Pulsa Escuchar ahora.
4. En la TV instala la APK 1.5.1. Introduce la URL **wss://** del mismo servidor y el MISMO código de sala. La TV también muestra una **clave de audio independiente** de 32 caracteres: escríbela en el receptor web (campo «Clave de audio»).
5. Con todos los presentes informados, pulsa INICIAR AUDIO y acepta RECORD_AUDIO cuando el sistema lo solicite. La TV cifra cada trama PCM con AES-256-GCM antes de enviarla.
6. La TV mostrará el dispositivo de entrada elegido, el estado TRANSMITIENDO y el nivel de entrada PCM. El receptor descifrará las tramas con la clave compartida, o mostrará error si no coincide.
7. Pulsa DETENER; la transmisión se apaga. Al salir de la pantalla también se apaga.

El servidor no conserva grabaciones ni las tramas de audio: retransmite a los oyentes presentes en la sala. En redes ajenas necesita permiso y una configuración de acceso adecuada.

## Pantalla y pistas independientes (versión 1.5)

En Android TV 1.5.1 elige primero si quieres compartir **sonido de las aplicaciones**, **voz del micrófono** (desactivada por defecto) o **solo pantalla**. Después selecciona **COMPARTIR PANTALLA Y AUDIO · PEDIR PERMISO**, acepta `RECORD_AUDIO` solo si procede y confirma el permiso oficial de pantalla en Android. Escoge **pantalla completa** cuando el sistema ofrezca esa opción. La app inicia `ScreenShareService`, un servicio foreground visible con una notificación permanente y botón **DETENER AHORA**; al salir de la interfaz para abrir otra app se mantiene la proyección hasta que la detengas o el sistema la revoque.

La imagen se transmite como fotogramas JPEG (640 × 360) de 1 imagen/s, o hasta 2 imágenes/s si se activa la opción de vista previa rápida. La velocidad superior consume más ancho de banda. En el receptor se ven y se descifran con la misma clave de audio. Los canales PCM `voice` (micrófono ambiente) y `tv` (captura de reproducción autorizada de otra app) son independientes, con reguladores de volumen e indicadores de señal.

Esto no permite capturar HDMI/HDCP, aplicaciones DRM protegidas o cualquier audio de aplicaciones que se hayan opuesto a `AudioPlaybackCapture`. Si el micrófono oye la TV por los altavoces, la pista de voz también puede contener ese sonido. La app no es capaz de realizar separación perfecta de fuentes a partir de una mezcla grabada.

La captura de pantalla es opcional y requiere autorización expresa para **cada sesión**. No hay grabaciones guardadas ni captura oculta. La función no se ha validado todavía en un televisor real.

Manual completo: [Pantalla y audio separados](../docs/SCREEN_AND_SEPARATE_AUDIO.md).

## Recuperación del micrófono (versión 1.4)

La app incluye ahora un mecanismo visible y **voluntario** cuando no funciona el micrófono PCM:

1. Al pulsar **INICIAR AUDIO**, solicita el permiso Android `RECORD_AUDIO` si hace falta. No hay captura antes de concederlo.
2. Si el permiso existe, prueba secuencialmente las fuentes públicas de Android **MIC**, **VOICE_RECOGNITION** y **DEFAULT**. Libera cada `AudioRecord` fallido antes de probar el siguiente.
3. Si hay un micrófono silenciado por Android, muestra instrucciones para revisar el interruptor de privacidad sin intentar cambiarlo.
4. Si la entrada se inicia pero no se aprecia señal PCM durante varios segundos, aparece una indicación para hablar cerca del micrófono o pulsar **REINTENTAR Y PROBAR OTRA ENTRADA**. Este botón cambia el orden de fuentes y reconecta de forma visible.
5. Si el permiso está denegado, pulsa **ABRIR AJUSTES DEL PERMISO DE MICRÓFONO**, revisa los permisos y vuelve a intentarlo.
6. Si la TV no expone PCM, prueba **RECONOCIMIENTO DE VOZ DEL SISTEMA** o **ABRIR TECLADO DE LA TV**. Esas alternativas devuelven solamente texto y hay que pulsar **COMPARTIR SOLO EL TEXTO** para enviarlo al receptor.

Esta recuperación **no puede activar un micrófono que Android no expone**, ni la entrada reservada del mando/asistente. Si las tres fuentes fallan o son silenciosas, es posible que un micrófono USB compatible o un teléfono cercano con permiso sea la única opción de audio real.

El campo WSS se inicializa con el dominio público de Railway de Howdyknw. Debe corresponder a un servidor al que el receptor también se conecte, y la sala y clave cifrada deben coincidir.

## Límites técnicos

- No funciona en televisores que no ejecutan Android, ni en Android TV donde AudioRecord/RECORD_AUDIO no tiene entrada accesible.
- No permite escuchar la TV apagada/en standby, ni saltar permisos del sistema, ni micrófonos reservados al mando/asistente.
- Solo emite en primer plano, sin grabación persistente ni inicio automático.
- La salida debe usar WSS confiable (HTTPS/Tailscale). No admite WS de texto claro desde la APK.
- PCM 16 kHz mono 16-bit, cifrado en origen mediante AES-256-GCM con etiqueta de integridad. La tasa de audio antes de cifrado/base64 es de unos 256 kbit/s. El servidor NO recibe los bytes PCM originales.
- El audio que detecta puede ser del micrófono interno, USB u otra entrada disponible. La pantalla informa de la ruta de audio observada.
- Un dispositivo Android TV sin micrófono o con acceso restringido mostrará fallo, no audio simulado.
- Se ha preparado código fuente y compilación automatizada; para afirmar compatibilidad con tu modelo concreto hace falta una prueba física.

Documentación Android: https://developer.android.com/media/platform/mediarecorder

## Alternativa 1.3: teclado y reconocimiento del sistema

Esta opción **no intenta suplantar a Gboard, alterar los permisos de Android ni recuperar audio interno**. Utiliza controles Android reales.

1. Cuando AudioRecord falle o no haya micrófono accesible, entra en «ALTERNATIVA: TECLADO Y DICTADO DEL SISTEMA».
2. Selecciona **ABRIR TECLADO DE LA TV**. Android abrirá el método de entrada configurado. Si Gboard para TV dispone del botón de micrófono, selecciónalo y dicta una frase de prueba.
3. Si no aparece el dictado del teclado, prueba **PROBAR RECONOCIMIENTO DE VOZ DEL SISTEMA**. Abre el reconocedor instalado, si existe; la app recibe únicamente sus palabras transcritas.
4. Comprueba que el texto aparece en el campo. **Nada se envía automáticamente** al servidor.
5. Con el receptor web ya conectado a la sala, confirma el consentimiento y pulsa **COMPARTIR SOLO EL TEXTO CON MI SALA**. Se envía un mensaje de texto y el receptor lo muestra en «Texto de la televisión».
6. Esta función no transmite audio. El modo teclado puede funcionar cuando AudioRecord no entrega audio, pero **no desbloquea el micrófono crudo**. Si el dictado también está bloqueado, muestra el fallo.

La API RecognizerIntent puede utilizar servidores ajenos para procesar voz, dependiendo del proveedor instalado. Evita frases privadas. Howdyknw no guarda ni retransmite el audio usado por el reconocedor.

Documentación oficial:
- https://developer.android.com/training/tv/get-started/onscreen-keyboard
- https://developer.android.com/reference/android/speech/RecognizerIntent

La compilación Android TV 1.5.0 de prueba está publicada como artefacto de GitHub Actions:
https://github.com/davidmariscalf/Howdyknw-/actions/workflows/android-tv.yml

Las pruebas automáticas verifican la compilación, pero la compatibilidad con cada micrófono necesita una TV real. Samsung/Tizen tiene un módulo de texto separado.

## Cambios de la versión 1.3

- El panel muestra **cuántos receptores hay conectados a la sala**. Este número indica conexiones, no confirma que el usuario haya escuchado correctamente.
- El medidor local de audio puede seguir funcionando cuando no hay oyentes, pero la app **no envía tramas PCM al servidor con cero receptores**. Con el primer oyente conectado, reanuda el envío mientras la aplicación continúe visible y autorizada.
- El servidor ahora libera conexiones caídas mediante latidos WebSocket; si el emisor pierde la conexión, detiene el micrófono. No se reinicia en segundo plano.

Las mejoras del servidor y del receptor web se encuentran en el proyecto raíz. Informe de auditoría: [docs/AUDIT_2026-11-09.md](../docs/AUDIT_2026-11-09.md).

## Cifrado completo: interoperable con el navegador

Desde 1.3 esta app usa exclusivamente el transporte `pcm-e2ee` y mensajes `encrypted-frame`: cada trama se cifra con AES-256-GCM en la TV. La clave privada se deriva con PBKDF2-SHA256 (150 000 iteraciones, sal basada en la sala). El servidor no recibe la clave, solo la trama opaca. Para escuchar desde el móvil, introduce primero la clave privada de la pantalla TV en el receptor web.

Las claves están separadas del código de sala: compartir el código por sí solo **no permite descifrar el audio**. El servidor remoto no admite la app anterior de audio PCM sin cifrar. La validación JVM compara la derivación y AES-GCM con vectores criptográficos independientes y el APK se compila con GitHub Actions.

El cifrado no concede permiso adicional de micrófono. Si tu fabricante lo bloquea, sigue disponible únicamente la ruta de texto dictado cuando el sistema la ofrece. Más detalles: [protocolo E2EE](../docs/END_TO_END_ENCRYPTION.md).
