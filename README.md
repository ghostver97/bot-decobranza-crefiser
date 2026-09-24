# Bot WhatsApp — versión Railway

## Lo que incluye

- QR limpio en una página web de Railway: `/qr`
- No depende del QR deforme de la terminal.
- `/id` obtiene el ID del grupo.
- `/prueba` envía una prueba inmediata.
- `/texto NUEVO TEXTO` cambia el mensaje automático.
- `/borrartexto` restaura el texto original.
- Responder a una foto con `/foto` la guarda para usarla junto al texto.
- `/borrarfoto` elimina la foto.
- `/ayuda` muestra los comandos.
- Los cambios de texto/foto se guardan en `bot_data`.
- Recordatorios automáticos lunes-viernes a las 8, 9 y 10 AM.
- Solo administradores del grupo configurado pueden cambiar texto/foto.

## Railway

Variables de entorno:

GROUP_ID=ID_DEL_GRUPO
TIMEZONE=America/Mexico_City

Railway asigna PORT automáticamente.

## QR

Después de desplegar, abre el dominio público de Railway y agrega `/qr`.

Ejemplo:
https://TU-DOMINIO.up.railway.app/qr

El dominio exacto lo proporciona Railway.

## Volume

MUY IMPORTANTE: monta un Volume de Railway en:

/app/auth_info

y otro, o el mismo Volume, de forma que también conserve:

/app/bot_data

Así no se pierde la sesión de WhatsApp ni el texto/foto personalizados cuando el servicio se reinicie.

## Comandos

/id
/prueba
/ayuda

/texto NUEVO TEXTO
/borrartexto

Para poner una foto:
1. Envía una foto al grupo.
2. Responde a esa foto escribiendo `/foto`.

Para quitarla:
/borrarfoto

## Horario

0 8,9,10 * * 1-5

Zona horaria:
America/Mexico_City
