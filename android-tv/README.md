# Howdyknw Native TV Audio

Aplicación Android TV / Google TV (versión 1.1) y Android 8.0+ para capturar el **micrófono real expuesto por el sistema** mediante AudioRecord y transmitirlo, con consentimiento y permiso, al navegador receptor de Howdyknw.

No es una solución para capturar el micrófono del mando que solo es accesible por el asistente del fabricante. No tiene servicios de arranque ni grabación en segundo plano; al abandonar la pantalla detiene el audio.

## Compilar

Con Android Studio, abre la carpeta android-tv y sincroniza Gradle. Utiliza Android SDK 35 y JDK 17; compila APK debug con el menú Build > Build APK(s), o usa Gradle 8.9:

    gradle :app:assembleDebug

El APK resultante estará en app/build/outputs/apk/debug/app-debug.apk.

## Preparar el receptor

1. Arranca el servidor raíz Howdyknw: npm install && npm start.
2. Publica HTTPS mediante Tailscale Serve o un proxy privado con certificado válido.
3. En un móvil/ordenador abre la web, pestaña Audio en directo, e introduce un código de sala de 8 a 16 caracteres en el receptor. Pulsa Escuchar ahora.
4. En la TV instala la APK. Introduce la URL **wss://** del mismo servidor (por ejemplo wss://ordenador.tu-tailnet.ts.net/) y el MISMO código de sala.
5. Con todos los presentes informados, pulsa INICIAR AUDIO y acepta RECORD_AUDIO cuando el sistema lo solicite.
6. La TV mostrará el dispositivo de entrada elegido, el estado TRANSMITIENDO y el nivel de entrada PCM. El receptor empezará a reproducir las tramas de 16 kHz.
7. Pulsa DETENER; la transmisión se apaga. Al salir de la pantalla también se apaga.

El servidor no conserva grabaciones ni las tramas de audio: retransmite a los oyentes presentes en la sala. En redes ajenas necesita permiso y una configuración de acceso adecuada.

## Límites técnicos

- No funciona en televisores que no ejecutan Android, ni en Android TV donde AudioRecord/RECORD_AUDIO no tiene entrada accesible.
- No permite escuchar la TV apagada/en standby, ni saltar permisos del sistema, ni micrófonos reservados al mando/asistente.
- Solo emite en primer plano, sin grabación persistente ni inicio automático.
- La salida debe usar WSS confiable (HTTPS/Tailscale). No admite WS de texto claro desde la APK.
- PCM 16 kHz mono 16-bit; la tasa transmitida de audio sin comprimir es de aprox. 256 kbit/s antes del formato JSON/base64.
- El audio que detecta puede ser del micrófono interno, USB u otra entrada disponible. La pantalla informa de la ruta de audio observada.
- Un dispositivo Android TV sin micrófono o con acceso restringido mostrará fallo, no audio simulado.
- Se ha preparado código fuente y compilación automatizada; para afirmar compatibilidad con tu modelo concreto hace falta una prueba física.

Documentación Android: https://developer.android.com/media/platform/mediarecorder

## Alternativa 1.1: teclado y reconocimiento del sistema

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

La compilación Android TV 1.1.0 de prueba está publicada como artefacto de GitHub Actions:
https://github.com/davidmariscalf/Howdyknw-/actions/workflows/android-tv.yml

Las pruebas automáticas verifican la compilación, pero la compatibilidad con cada micrófono necesita una TV real. Samsung/Tizen tiene un módulo de texto separado.
