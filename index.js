const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const cron = require("node-cron");
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = process.env.TIMEZONE || "America/Mexico_City";
const GROUP_ID = process.env.GROUP_ID || "";

const DATA_DIR = path.join(__dirname, "bot_data");
const AUTH_DIR = path.join(__dirname, "auth_info");
const IMAGE_PATH = path.join(DATA_DIR, "reminder.jpg");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_TEXT = `🔔 RECORDATORIO DE PAGO

Te recordamos realizar tu pago todos los días a la siguiente cuenta bancaria:

💳 4169160867151483

Una vez realizado la transferencia, envía tu pago aquí en el grupo.

📝 ASUNTO:
Pon el # de tu día (1-60) o # de semana (1-12).

⚠️ IMPORTANTE:
Pasarte de las 11:00 AM genera una penalización con mora de $100 por hora.

Cuida tu historial crediticio. Recuerda que fuiste recomendado como un cliente puntual; no rompas la confianza del asesor que te recomendó.

✅ Si ya realizaste tu pago, ignora este mensaje.

📋 Recuerda que el asesor te tiene que firmar tu tarjeta de Crefiser.`;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return {
        text: saved.text || DEFAULT_TEXT,
        image: fs.existsSync(IMAGE_PATH)
      };
    }
  } catch (e) {
    console.error("Error leyendo configuración:", e);
  }
  return { text: DEFAULT_TEXT, image: fs.existsSync(IMAGE_PATH) };
}

function saveText(text) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ text }, null, 2), "utf8");
}

let config = loadConfig();
let currentQr = null;
let sock = null;

async function sendReminder(jid, prefix = "") {
  if (!sock || !jid) return;

  const text = prefix + config.text;

  if (fs.existsSync(IMAGE_PATH)) {
    await sock.sendMessage(jid, {
      image: fs.readFileSync(IMAGE_PATH),
      caption: text
    });
  } else {
    await sock.sendMessage(jid, { text });
  }
}

async function isGroupAdmin(jid, sender) {
  try {
    if (!jid?.endsWith("@g.us") || !sender) return false;
    const metadata = await sock.groupMetadata(jid);
    const participant = metadata.participants.find(p => p.id === sender);
    return !!participant && (participant.admin === "admin" || participant.admin === "superadmin");
  } catch (e) {
    console.error("No se pudo comprobar administrador:", e);
    return false;
  }
}

function getSender(msg) {
  return msg.key.participant || msg.key.remoteJid;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Recordatorios Pagos", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQr = qr;
      console.log("\n=== QR NUEVO: abre la URL /qr de Railway ===\n");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      currentQr = null;
      console.log("✅ BOT DE WHATSAPP CONECTADO.");
      console.log(`🌐 QR/status: /qr`);
      console.log(`📢 Grupo: ${GROUP_ID || "NO CONFIGURADO"}`);
    }

    if (connection === "close") {
      currentQr = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Conexión cerrada. Código:", statusCode);

      if (shouldReconnect) {
        setTimeout(startBot, 5000);
      } else {
        console.log("🚪 Sesión cerrada. Borra el Volume/auth_info y vuelve a vincular.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid?.endsWith("@g.us")) return;

      const sender = getSender(msg);
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      const command = text.trim();

      // /id
      if (command.toLowerCase() === "/id") {
        await sock.sendMessage(remoteJid, {
          text: `🆔 ID DE ESTE GRUPO:\n\n${remoteJid}\n\nGROUP_ID=${remoteJid}`
        });
        return;
      }

      // Solo el grupo configurado puede controlar el bot.
      if (remoteJid !== GROUP_ID) return;

      // /prueba
      if (command.toLowerCase() === "/prueba") {
        await sendReminder(remoteJid, "🧪 PRUEBA DEL BOT\n\n");
        return;
      }

      // Comandos de administración.
      const admin = await isGroupAdmin(remoteJid, sender);
      if (!admin) return;

      // /ayuda
      if (command.toLowerCase() === "/ayuda") {
        await sock.sendMessage(remoteJid, {
          text:
`🤖 COMANDOS DEL BOT

/id
Muestra el ID de este grupo.

/prueba
Envía inmediatamente el recordatorio.

/texto NUEVO TEXTO
Cambia el texto automático.

/borrartexto
Regresa al texto predeterminado.

/foto
Responde a una foto con /foto para guardarla como imagen del recordatorio.

/borrarfoto
Quita la imagen del recordatorio.

/ayuda
Muestra estos comandos.`
        });
        return;
      }

      // /texto
      if (command.toLowerCase().startsWith("/texto ")) {
        const newText = command.slice(7).trim();

        if (!newText) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Escribe el texto después de /texto."
          });
          return;
        }

        config.text = newText;
        saveText(newText);

        await sock.sendMessage(remoteJid, {
          text: "✅ Texto automático actualizado correctamente."
        });
        return;
      }

      // /borrartexto
      if (command.toLowerCase() === "/borrartexto") {
        config.text = DEFAULT_TEXT;
        saveText(DEFAULT_TEXT);

        await sock.sendMessage(remoteJid, {
          text: "✅ Se restauró el texto automático original."
        });
        return;
      }

      // /borrarfoto
      if (command.toLowerCase() === "/borrarfoto") {
        if (fs.existsSync(IMAGE_PATH)) fs.unlinkSync(IMAGE_PATH);
        config.image = false;

        await sock.sendMessage(remoteJid, {
          text: "✅ Se eliminó la foto del recordatorio."
        });
        return;
      }

      // /foto: se usa respondiendo a una imagen.
      if (command.toLowerCase() === "/foto") {
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted?.imageMessage) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Responde a una foto con /foto para guardarla como imagen automática."
          });
          return;
        }

        const fakeMsg = {
          key: {
            remoteJid,
            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
            participant: msg.message.extendedTextMessage.contextInfo.participant
          },
          message: quoted
        };

        const buffer = await downloadMediaMessage(
          fakeMsg,
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        fs.writeFileSync(IMAGE_PATH, buffer);
        config.image = true;

        await sock.sendMessage(remoteJid, {
          text: "✅ Foto guardada. A partir de ahora aparecerá junto al texto automático."
        });
      }
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error);
    }
  });

  // Lunes a viernes: 8, 9 y 10 AM.
  cron.schedule(
    "0 8,9,10 * * 1-5",
    async () => {
      if (!GROUP_ID) {
        console.log("⚠️ No se envió recordatorio: falta GROUP_ID.");
        return;
      }

      try {
        await sendReminder(GROUP_ID);
        console.log(`📨 Recordatorio automático enviado a ${GROUP_ID}`);
      } catch (error) {
        console.error("❌ Error enviando recordatorio:", error);
      }
    },
    { timezone: TIMEZONE }
  );
}

// Servidor web para Railway y QR limpio.
const app = express();

app.get("/", (req, res) => {
  res.type("html").send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Bot WhatsApp</title>
      <style>
        body{font-family:Arial,sans-serif;text-align:center;padding:30px;background:#f5f5f5}
        .card{max-width:520px;margin:auto;background:white;padding:25px;border-radius:18px;box-shadow:0 5px 25px #0002}
        a{display:inline-block;padding:13px 20px;background:#111;color:white;border-radius:10px;text-decoration:none}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🤖 Bot de WhatsApp</h1>
        <p>Estado: <b>${sock ? "activo" : "iniciando"}</b></p>
        <a href="/qr">Abrir QR para vincular WhatsApp</a>
      </div>
    </body>
    </html>
  `);
});

app.get("/qr", async (req, res) => {
  if (!currentQr) {
    res.type("html").send(`
      <!doctype html><html lang="es"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>WhatsApp conectado</title>
      <style>body{font-family:Arial;text-align:center;padding:40px}</style>
      </head><body>
      <h1>✅ WhatsApp conectado</h1>
      <p>Si necesitas vincular otra sesión, espera a que aparezca un QR nuevo.</p>
      <a href="/qr">Actualizar</a>
      </body></html>
    `);
    return;
  }

  const dataUrl = await QRCode.toDataURL(currentQr, {
    width: 360,
    margin: 4,
    errorCorrectionLevel: "M"
  });

  res.type("html").send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Vincular WhatsApp</title>
      <style>
        body{font-family:Arial,sans-serif;text-align:center;padding:20px;background:#f5f5f5}
        .card{max-width:450px;margin:auto;background:#fff;padding:25px;border-radius:20px;box-shadow:0 5px 25px #0002}
        img{width:360px;max-width:90%;image-rendering:auto}
        .steps{text-align:left;line-height:1.6}
        button{padding:12px 18px;border:0;border-radius:10px;cursor:pointer}
      </style>
    </head>
    <body>
      <div class="card">
        <h1>📱 Vincular WhatsApp</h1>
        <p>Escanea este código desde WhatsApp → Dispositivos vinculados.</p>
        <img src="${dataUrl}" alt="QR de WhatsApp">
        <div class="steps">
          <b>Pasos:</b>
          <ol>
            <li>Abre WhatsApp en tu teléfono.</li>
            <li>Ve a <b>Dispositivos vinculados</b>.</li>
            <li>Selecciona <b>Vincular un dispositivo</b>.</li>
            <li>Escanea este QR.</li>
          </ol>
        </div>
        <button onclick="location.reload()">🔄 Actualizar QR</button>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor web iniciado en el puerto ${PORT}`);
  startBot().catch(error => {
    console.error("❌ Error iniciando bot:", error);
    process.exit(1);
  });
});
