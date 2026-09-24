# Bot de WhatsApp — Recordatorios de pago

## Comandos

### `/id`
Escríbelo dentro del grupo para obtener el ID del grupo.

Después coloca ese valor en Railway:

`GROUP_ID=ID_DEL_GRUPO`

### `/prueba`
Escríbelo dentro del grupo configurado para enviar inmediatamente una prueba del recordatorio.

Si funciona, el bot enviará:

`🧪 PRUEBA DEL BOT`

seguido del mensaje de pago.

## Horario automático

Lunes a viernes:
- 8:00 AM
- 9:00 AM
- 10:00 AM

Zona horaria:
`America/Mexico_City`

## Railway

Variables:
- `GROUP_ID`
- `TIMEZONE=America/Mexico_City`

Para conservar la sesión de WhatsApp, monta un Volume en Railway para `./auth_info`.
