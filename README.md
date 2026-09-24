# Bot WhatsApp Railway — corregido

## Corrección importante

El servidor Express escucha en `0.0.0.0` usando el puerto `PORT` de Railway. Esto permite que el dominio público de Railway pueda abrir `/qr`.

Start Command:
`npm start`

También funciona:
`node index.js`

## QR

Después de desplegar y generar un dominio público en Railway:

`https://TU-DOMINIO.up.railway.app/qr`

Si todavía está generando el QR, la página se actualiza automáticamente.

## Variables

`GROUP_ID=ID_DEL_GRUPO`
`TIMEZONE=America/Mexico_City`

## Comandos

`/id`
`/prueba`
`/ayuda`
`/texto TU MENSAJE`
`/borrartexto`

Para una foto:
- envía la foto al grupo
- responde a la foto con `/foto`

Para quitarla:
`/borrarfoto`

## Persistencia

Crea un Volume en Railway y móntalo en:

`/app`

Esto conserva:
- `/app/auth_info`
- `/app/bot_data`

Así no se pierde la sesión ni la configuración al reiniciar.

## Horario

Lunes a viernes:
8:00 AM
9:00 AM
10:00 AM

Zona:
`America/Mexico_City`
