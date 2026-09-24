const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const QRCode = require("qrcode");
const cron = require("node-cron");
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const TIMEZONE = process.env.TIMEZONE || "America/Mexico_City";
const GROUP_ID = process.env.GROUP_ID || "";

const AUTH_DIR = process.env.AUTH_DIR || "/app/auth_info";
const DATA_DIR = process.env.DATA_DIR || "/app/bot_data";
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const IMAGE_FILE = path.join(DATA_DIR, "reminder.jpg");

fs.mkdirSync(AUTH_DIR, { recursive: true });
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

function loadText() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return data.text || DEFAULT_TEXT;
    }
  } catch (e) {
    console.error("Error leyendo configuración:", e);
  }
  return DEFAULT_TEXT;
}

function saveText(text) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ text }, null, 2), "utf8");
}

let automaticText = loadText();
let currentQR = null;
let sock = null;
let connected = false;

async function sendReminder(jid, prefix = "") {
  const text = prefix + automaticText;

  if (fs.existsSync(IMAGE_FILE)) {
    await sock.sendMessage(jid, {
      image: fs.readFileSync(IMAGE_FILE),
      caption: text
    });
  } else {
    await sock.sendMessage(jid, { text });
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Crefiser Recordatorios", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      console.log("📱 QR disponible en /qr");
    }

    if (connection === "open") {
      connected = true;
      currentQR = null;
      console.log("✅ BOT DE WHATSAPP CONECTADO");
      console.log(`📢 GROUP_ID: ${GROUP_ID || "NO CONFIGURADO"}`);
    }

    if (connection === "close") {
      connected = false;
      currentQR = null;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("❌ WhatsApp desconectado. Código:", statusCode);

      if (shouldReconnect) {
        setTimeout(() => startWhatsApp().catch(console.error), 5000);
      } else {
        console.log("🚪 Sesión cerrada. Será necesario volver a vincular.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message) return;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid?.endsWith("@g.us")) return;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      const command = text.trim();

      // Obtener ID del grupo.
      if (command.toLowerCase() === "/id") {
        await sock.sendMessage(remoteJid, {
          text: `🆔 ID DE ESTE GRUPO:\n\n${remoteJid}\n\nGROUP_ID=${remoteJid}`
        });
        return;
      }

      // Solo acepta comandos de administración en el grupo configurado.
      if (!GROUP_ID || remoteJid !== GROUP_ID) return;

      if (command.toLowerCase() === "/prueba") {
        await sendReminder(remoteJid, "🧪 PRUEBA DEL BOT\n\n");
        return;
      }

      if (command.toLowerCase() === "/ayuda") {
        await sock.sendMessage(remoteJid, {
          text:
`🤖 COMANDOS

/id → muestra el ID del grupo
/prueba → envía una prueba
/ayuda → muestra comandos

/texto TU MENSAJE → cambia el texto automático
/borrartexto → restaura el texto original

/foto → responde a una foto con este comando
/borrarfoto → elimina la foto`
        });
        return;
      }

      if (command.toLowerCase().startsWith("/texto ")) {
        const newText = command.substring(7).trim();

        if (!newText) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Escribe el nuevo texto después de /texto."
          });
          return;
        }

        automaticText = newText;
        saveText(automaticText);

        await sock.sendMessage(remoteJid, {
          text: "✅ Texto automático actualizado."
        });
        return;
      }

      if (command.toLowerCase() === "/borrartexto") {
        automaticText = DEFAULT_TEXT;
        saveText(DEFAULT_TEXT);

        await sock.sendMessage(remoteJid, {
          text: "✅ Texto original restaurado."
        });
        return;
      }

      if (command.toLowerCase() === "/borrarfoto") {
        if (fs.existsSync(IMAGE_FILE)) fs.unlinkSync(IMAGE_FILE);

        await sock.sendMessage(remoteJid, {
          text: "✅ Foto eliminada del recordatorio."
        });
        return;
      }

      if (command.toLowerCase() === "/foto") {
        const context = msg.message.extendedTextMessage?.contextInfo;
        const quoted = context?.quotedMessage;

        if (!quoted?.imageMessage) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Responde a una foto con /foto."
          });
          return;
        }

        const quotedMessage = {
          key: {
            remoteJid,
            id: context.stanzaId,
            participant: context.participant
          },
          message: quoted
        };

        const buffer = await downloadMediaMessage(
          quotedMessage,
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        fs.writeFileSync(IMAGE_FILE, buffer);

        await sock.sendMessage(remoteJid, {
          text: "✅ Foto guardada para los recordatorios."
        });
      }
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error);
    }
  });

  // Lunes a viernes a las 8:00, 9:00 y 10:00 AM.
  cron.schedule("0 8,9,10 * * 1-5", async () => {
    if (!GROUP_ID || !connected) {
      console.log("⚠️ No se envió recordatorio: falta GROUP_ID o WhatsApp no está conectado.");
      return;
    }

    try {
      await sendReminder(GROUP_ID);
      console.log(`📨 Recordatorio automático enviado a ${GROUP_ID}`);
    } catch (error) {
      console.error("❌ Error enviando recordatorio:", error);
    }
  }, { timezone: TIMEZONE });
}

// Servidor web de Railway.
// IMPORTANTE: 0.0.0.0 permite que el dominio público de Railway pueda acceder.
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
body{font-family:Arial;text-align:center;background:#f3f4f6;padding:30px}
.card{max-width:500px;margin:auto;background:white;padding:28px;border-radius:20px;box-shadow:0 5px 25px #0002}
a{display:inline-block;background:#111;color:white;padding:14px 22px;border-radius:10px;text-decoration:none}
</style>
</head>
<body>
<div class="card">
<h1>🤖 Bot de WhatsApp</h1>
<p>Estado: <b>${connected ? "Conectado ✅" : "Esperando conexión..."}</b></p>
<a href="/qr">📱 Abrir QR</a>
</div>
</body>
</html>`);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    whatsapp: connected ? "connected" : "waiting",
    groupConfigured: Boolean(GROUP_ID)
  });
});

app.get("/qr", async (req, res) => {
  if (connected) {
    return res.type("html").send(`
<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp conectado</title></head>
<body style="font-family:Arial;text-align:center;padding:40px">
<h1>✅ WhatsApp ya está conectado</h1>
<p>No necesitas escanear otro QR.</p>
</body></html>`);
  }

  if (!currentQR) {
    return res.type("html").send(`
<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3">
<title>Generando QR</title></head>
<body style="font-family:Arial;text-align:center;padding:40px">
<h1>⏳ Generando QR...</h1>
<p>Esta página se actualizará automáticamente.</p>
</body></html>`);
  }

  const qrData = await QRCode.toDataURL(currentQR, {
    width: 360,
    margin: 4,
    errorCorrectionLevel: "M"
  });

  res.set("Cache-Control", "no-store");

  res.type("html").send(`
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20">
<title>Vincular WhatsApp</title>
<style>
body{font-family:Arial;text-align:center;background:#f3f4f6;padding:20px}
.card{max-width:460px;margin:auto;background:white;padding:25px;border-radius:20px;box-shadow:0 5px 25px #0002}
img{width:360px;max-width:92%;display:block;margin:20px auto}
</style>
</head>
<body>
<div class="card">
<h1>📱 Vincular WhatsApp</h1>
<p>WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
<img src="${qrData}" alt="QR WhatsApp">
<p>El QR se actualiza automáticamente.</p>
</div>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Servidor iniciado en 0.0.0.0:${PORT}`);
  console.log(`🔗 Abre /qr en el dominio público de Railway`);
  startWhatsApp().catch(error => {
    console.error("❌ Error iniciando WhatsApp:", error);
  });
});
