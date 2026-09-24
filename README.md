# Bot WhatsApp — Railway (corrección del Volume)

## IMPORTANTE: configuración del Volume

El error que aparece cuando Railway dice:

`ENOENT: no such file or directory, open '/app/package.json'`

ocurre si el Volume está montado directamente en `/app`.

NO montes el Volume en `/app`, porque tapa `package.json`, `index.js` y el resto del proyecto.

### Montaje correcto

En Railway, configura el Volume con:

**Mount Path**
```text
/app/storage
```

El código guardará ahí:
```text
/app/storage/auth_info
/app/storage/bot_data
```

La aplicación seguirá estando en:
```text
/app
```

y Railway podrá encontrar:
```text
/app/package.json
/app/index.js
```

## Start Command

```text
npm start
```

## Variables

```text
GROUP_ID=120363429003094179@g.us
TIMEZONE=America/Mexico_City
```

No necesitas poner `AUTH_DIR` ni `DATA_DIR`; el código ya usa `/app/storage`.

## Después de cambiar el Mount Path

1. Guarda el Volume con `/app/storage`.
2. Haz Redeploy/Restart.
3. En los logs debe desaparecer el error `package.json`.
4. Debe aparecer:
   `🌐 Servidor iniciado...`
5. Abre el dominio de Railway:
   `https://TU-DOMINIO.up.railway.app/qr`

## Grupo

El ID que aparece en tu captura es:

```text
120363429003094179@g.us
```

Ese valor está escrito correctamente como `GROUP_ID`.

## Comandos del bot

Dentro del grupo:

```text
/id
/prueba
/ayuda
```

Cambiar texto:
```text
/texto TU NUEVO MENSAJE
```

Restaurar:
```text
/borrartexto
```

Para guardar una foto:
1. Envía la foto al grupo.
2. Responde a esa foto con `/foto`.

Eliminar foto:
```text
/borrarfoto
```

## Horario automático

Lunes a viernes:
- 8:00 AM
- 9:00 AM
- 10:00 AM

Zona horaria:
`America/Mexico_City`
