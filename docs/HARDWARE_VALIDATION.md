# Plan de validación física — Howdyknw

Este documento separa qué demuestra el software de lo que todavía necesita hardware y permisos.

## Identificación del dispositivo

Registrar antes de empezar:

- Marca, modelo exacto y año.
- Versión de firmware y webOS, si corresponde.
- Presencia y ubicación comprobadas de micrófonos (TV, mando, accesorio), o «desconocido».
- Funciones de voz activadas y desactivadas, con una foto de la pantalla de configuración cuando sea posible.
- IP IPv4, IPv6, MAC y topología de red, sin subir identificadores personales al repo público.
- Tipo de punto de captura: router, gateway, mirror/SPAN o acceso al propio dispositivo.

## Preparación de captura

1. Ejecutar tshark -D y seleccionar la interfaz correcta.
2. Verificar tráfico del televisor con una acción de red conocida, por ejemplo abrir una página de una app.
3. Verificar que las tramas capturadas salen de la IP observada. No atribuir paquetes de otros dispositivos.
4. Capturar IPv4 e IPv6 si la TV utiliza ambos protocolos.
5. Usar ventanas de la misma duración. Mantener constantes otros aparatos y la configuración del router.
6. Conservar cada PCAP original localmente, y su resumen JSON. Calcular SHA-256 si se van a publicar conclusiones reproducibles.

## Matriz de experimentos

| Caso | Alimentación | Voz | Actividad | Qué mide |
|---|---|---|---|---|
| A | Encendida | Desactivada | 3 min sin interacción | Línea base de red |
| B | Encendida | Activada, sin palabra clave | 3 min sin interacción | Diferencias respecto de A |
| C | Encendida | Voz activada explícitamente | Frase ficticia y conocida, con participantes informados | Variación de tráfico ligada temporalmente a una acción |
| D | Standby, enchufada | Configuración documentada | 3 min sin interacción | Tráfico que sigue existiendo en reposo |
| E | Desenchufada | No disponible | Control negativo | Que el punto de captura no atribuya paquetes a una TV apagada físicamente |
| F | Encendida, sin Internet | Configuración documentada | Frase ficticia, si el modelo lo permite | Posibles respuestas locales (sin inferir grabación) |

*Atención:* las pruebas de voz solo se realizan con consentimiento de quienes están presentes. Evitar frases privadas o identificables.

## Criterios de evidencia

- Tráfico capturado: VERIFICADO solamente si el punto de captura y las direcciones de origen están comprobados.
- Dominio SNI/DNS: VERIFICADO únicamente como metadato visible; no identificarlo automáticamente como destinatario de audio.
- Transferencia de audio: NO VERIFICADA salvo que exista acceso legítimo a registros/contenido del propio televisor con evidencia técnica suficiente.
- Micrófono interno: NO VERIFICADO si se usó un micrófono de móvil u ordenador.
- Standby: no confundir pantalla apagada, suspensión, standby y desconexión eléctrica.
- Volumen de tráfico: comparar por ventana equivalente o normalizar por duración. No atribuir volumen genérico a voz.

## Validación de audio WebRTC

1. Servidor Node activo y accessible desde ambas URL seguras HTTPS.
2. Confirmación expresa de los presentes en el emisor.
3. Permiso del navegador y estado «MICRÓFONO ENCENDIDO» visibles.
4. Receptor conectado al mismo código: escuchar sonido de prueba que *el emisor* produce voluntariamente.
5. Verificar que detener cierra pistas y reproducción.
6. Repetir con auriculares para evitar acoples.
7. Probar móviles diferentes: Android y, si hay, iOS. Verificar permiso en cada uno.
8. Probar desde otra red; si falla WebRTC, comprobar el mecanismo TURN. STUN no garantiza conectividad.
9. Probar suspensión de pantalla: documentar interrupción si el sistema operativo detiene el navegador.

## Criterios para afirmar «terminado»

- Pruebas Python + Node + sintaxis de JavaScript: PASS en GitHub Actions.
- Prueba del panel con demo sintética en navegador real: PASS.
- Importación de PCAP real desde punto de captura probado: PASS.
- Comprobación A/B con duración y condiciones documentadas: PASS.
- Transmisión de audio de emisor a receptor físico por HTTPS: PASS.
- Acceso al micrófono interno de LG: solo se marca como PASS después de confirmar modelo, API/interfaz autorizada y prueba independiente. No existe un adaptador universal implementado.

No presentar tests sintéticos como si fueran mediciones de la televisión real.
