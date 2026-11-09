# Pantalla de Android TV y pistas separadas: Howdyknw 1.5

## Qué permite y qué no

La APK Android TV / Google TV 1.5 permite compartir, **solo después de confirmar el diálogo de Android MediaProjection**, una vista previa de lo que aparece en la pantalla del propio dispositivo y dos pistas PCM independientes:

- **Audio TV**: capturado desde las APIs de reproducción de Android de *aplicaciones que lo permitan*. Incluye tipos `USAGE_MEDIA`, `USAGE_GAME` y `USAGE_UNKNOWN`; no incluye aplicaciones que prohíban la captura ni todas las entradas HDMI.
- **Voz ambiente**: capturada desde el micrófono que Android conceda mediante `RECORD_AUDIO`, independiente del audio de reproducción. Si el micro escucha los altavoces de la TV, la pista de voz **también puede incluir parte del sonido del televisor**. No se ha creado una separación neuronal ni un algoritmo infalible para distinguir hablantes.

La imagen es una **vista previa JPEG de 1 imagen por segundo de forma predeterminada, o hasta 2 imágenes/s si activas la opción rápida (640 × 360)**; no es una transmisión de vídeo fluida de 25/60 fps. Puede mostrar negro para aplicaciones con DRM, `FLAG_SECURE` o entradas y señales que no estén en el compositor capturable. No hay acceso al contenido HDMI/HDCP protegido ni forma legítima de eliminar estas limitaciones con permisos ordinarios.

Android puede negar `MediaProjection` o `AudioPlaybackCapture` en una televisión concreta, según su versión y fabricante. **Compilar el APK y superar pruebas simuladas no demuestra que la TV real permita estas capturas.**

## Versión 1.6: emparejar sin escribir códigos

En la TV pulsa una vez **Crear sesión rápida**. Escanea su QR privado con el teléfono. La web importa sala y clave AES cifrada, y con un toque en **Conectar y escuchar** queda listo el receptor. El fragmento URL que transporta la clave se borra de la dirección visible al importarlo. Finalmente, pulsa Compartir en la TV y confirma el permiso oficial de Android. No se automatiza la autorización de pantalla ni se activa el micrófono a escondidas.

Las opciones de servidor/clave manual, micrófono independiente y teclado se mantienen accesibles en apartados desplegables.

## Activación paso a paso

1. Instala la APK 1.5 en una Android TV / Google TV propia. Para la sesión de prueba utiliza `wss://howdyknw-production.up.railway.app/` solamente cuando el servidor tenga desplegada la versión actualizada; la versión anterior del servidor **no reconocerá** fotogramas `screen-frame` ni pistas `media-frame`.
2. Genera o introduce el **mismo código de sala** en la TV y en el receptor. La TV muestra una clave privada que también debes introducir en el navegador receptor; se oculta de forma predeterminada para evitar que aparezca en la captura.
3. En el teléfono/ordenador receptor, pulsa **Escuchar ahora** (te recomendamos auriculares). Aparecen dos volúmenes independientes: **Sonido de la televisión** y **Voz del micrófono**.
4. En la TV decide primero qué compartir: **sonido de la TV** (opcional), **voz del micrófono** (**desactivada por defecto**) y **vista previa rápida** (hasta 2 imágenes/s; consume más datos). Si desmarcas ambas fuentes de audio, puedes compartir únicamente la imagen, sin solicitar permiso de micrófono. Después pulsa **COMPARTIR PANTALLA Y AUDIO · PEDIR PERMISO** y confirma el diálogo de Android. **Confirma solo si todas las personas presentes conocen la retransmisión.**
5. Una notificación permanente muestra que Howdyknw está compartiendo la pantalla y las fuentes de audio que hayas elegido. Puedes cambiar a otra aplicación: el servicio de proyección continúa en primer plano mientras lo permita Android. El receptor muestra los indicadores de canales **activados o denegados** y solo reproduce los que realmente proporcionen datos.
6. Para terminar, pulsa **DETENER COMPARTICIÓN DE PANTALLA Y AUDIO** en Howdyknw o **DETENER AHORA** en la notificación del servicio. Al cancelar la proyección desde el sistema, se deben liberar todas las capturas.

**No se enciende automáticamente** después de reiniciar, no captura en standby, no solicita permisos de forma encubierta, no guarda imágenes ni grabaciones.

## Arquitectura y seguridad

- Se utiliza `MediaProjectionManager.createScreenCaptureIntent()` con **un consentimiento nuevo por sesión**, seguido de un servicio Android visible con foreground `mediaProjection` (y `microphone` solo cuando se activa una fuente de audio). La versión Android 8/9 usa la sobrecarga antigua de servicio foreground compatible con ese sistema. La sesión invoca `MediaProjection.createVirtualDisplay()` una sola vez; se registra `MediaProjection.Callback.onStop()` para terminar cuando Android la revoque.
- Se utiliza `ImageReader` de baja frecuencia configurable (1–2 fps), con cierre de recursos y un segundo intento de compresión si el JPEG excede el tamaño permitido. El tamaño final se limita a 85 KB; el canal transmite `screen-frame`.
- El audio de reproducción usa `AudioPlaybackCaptureConfiguration` (Android 10+) y solo captura las apps con permiso efectivo de captura. El canal `tv` se diferencia por su **origen técnico**, no por haber detectado que suene una película.
- El micrófono usa `MicRecovery.open()` y el canal `voice`. Ambos son PCM16, mono 16 kHz, 20 ms/trama.
- Para cada paquete se deriva una clave AES-256 mediante el mismo secreto de audio de Howdyknw, con PBKDF2. Cada trama va cifrada con AES-GCM (nonce aleatorio nuevo) y su canal se autentica como AAD `howdyknw-media-v2|screen`, `...|tv` o `...|voice`. Cambiar el canal en el servidor invalida la autenticación y el receptor la rechaza.
- El servidor transmite únicamente sobres cifrados, con validaciones estrictas de tipos, longitudes, número de tramas y acumulación. Si no hay ningún receptor, el cliente no manda muestras ni imágenes.
- El servidor **sí puede observar metadatos** como tamaño, momento, sala, tipo de canal y los mensajes breves de estado; no puede leer los datos PCM/JPEG cifrados sin la clave.
- La misma aplicación web se descarga del servidor: como cualquier E2EE basada en JavaScript servido dinámicamente, **un servidor de distribución comprometido podría modificar el código recibido**. Esto no sustituye a una auditoría independiente ni a clientes firmados.
- El enlace de la sala NO debe divulgarse junto con la clave privada en espacios públicos.

## Comprobación de calidad y pendientes

- Pruebas Node.js: cifrado correcto, autenticación de la etiqueta de canal, rechazo de intercambio de canales, replay, imagen JPEG falsa/invalidada, límites y aislamiento entre salas.
- Smoke JVM de la clase Android `AudioCrypto` y compilación de APK debug mediante GitHub Actions.
- Prueba física aún pendiente: verificar en TV real que el firmware ofrece `MediaProjection`, que el contenido mostrado permite captura y que **la aplicación que reproduce sonido** permite `AudioPlaybackCapture`. En una película protegida puede haber imagen negra y sonido no capturable.
- En TV con Android anterior a 10, no hay soporte `AudioPlaybackCapture` de apps, aunque la proyección de pantalla pueda existir.
- Samsung Tizen, LG webOS y dispositivos HDMI externos **no están cubiertos por este módulo Android**.

Referencias oficiales:
- https://developer.android.com/media/grow/media-projection
- https://developer.android.com/media/platform/av-capture
