# Railway y GitHub: autorización del repositorio Howdyknw

**Estado comprobado el 9 de noviembre de 2026:** la integración de Railway permite ver el proyecto ya existente `howdyknw-tv-audio`, el servicio `howdyknw` y el dominio `https://howdyknw-production.up.railway.app/`, pero rechaza reconectar el origen GitHub `davidmariscalf/Howdyknw-` con el error literal `User does not have access to the repo`.

Las cuentas de Railway y GitHub pueden utilizar correos y nombres distintos. **No hace falta que los correos coincidan**: el requisito es que la instalación GitHub de Railway tenga permiso explícito de lectura del repositorio de origen.

## Solución sin crear más servicios ni incurrir en costes duplicados

1. Abre la configuración de integración GitHub de Railway desde el servicio **howdyknw** existente. No crees un proyecto nuevo.
2. Inicia la autorización de la aplicación **Railway** en GitHub con el usuario propietario de `davidmariscalf/Howdyknw-` (o con otro usuario que sea colaborador con permiso para leerlo).
3. En GitHub, revisa **Settings → Applications → Installed GitHub Apps → Railway → Configure**. Si la instalación utiliza «Only select repositories», incorpora expresamente **Howdyknw-**. Si no aparece Railway entre las instalaciones, autorízala desde el flujo de conectar GitHub en Railway.
4. Regresa al mismo servicio y selecciona `davidmariscalf/Howdyknw-`, rama `main`, sin modificar la dirección pública existente. Esto debe iniciar la compilación de la rama más reciente.
5. En `https://howdyknw-production.up.railway.app/api/config` comprueba que la respuesta incluye `features.mediaProjection=true`, `features.separateAudio=true` y `features.audioE2EE=true`. Un `/api/health` con `status:ok` **no garantiza** por sí mismo que esté publicada la versión nueva.
6. En la aplicación Android TV 1.5.1, la sesión de pantalla y audio comprueba si el servidor confirma `supportsMediaShare`. Si el servidor es antiguo, se detiene en vez de simular que se está retransmitiendo.

El acceso a un GitHub alternativo no concede automáticamente acceso al repositorio de otro propietario. Si el usuario de GitHub de Railway es diferente del propietario, hay que autorizar la instalación del propietario o conceder acceso explícito al repositorio al usuario correspondiente.

**Privacidad:** no publiques claves de audio ni códigos de sala en incidencias o registros. Las imágenes y los dos canales PCM se transmiten como sobres AES-GCM cifrados por el cliente.

**Validación física pendiente:** ninguna comprobación CI o de Railway verifica que el micrófono, la salida de reproducción o la pantalla de un televisor concreto sean realmente capturables.
