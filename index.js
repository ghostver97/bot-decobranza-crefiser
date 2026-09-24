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

const AUTH_DIR = process.env.AUTH_DIR || "/app/storage/auth_info";
const DATA_DIR = process.env.DATA_DIR || "/app/storage/bot_data";
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const IMAGE_FILE = path.join(DATA_DIR, "reminder.jpg");
const VIDEO_FILE = path.join(DATA_DIR, "reminder.mp4");

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

// Carga la configuración persistente
function loadConfig() {
  const defaultConfig = {
    text: DEFAULT_TEXT,
    hours: "8,9,10",
    days: "1-5"
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return { ...defaultConfig, ...data };
    }
  } catch (e) {
    console.error("Error leyendo configuración:", e);
  }
  return defaultConfig;
}

function saveConfig(data) {
  try {
    const current = loadConfig();
    const updated = { ...current, ...data };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf8");
  } catch (e) {
    console.error("Error guardando configuración:", e);
  }
}

let botConfig = loadConfig();
let currentQR = null;
let sock = null;
let connected = false;
let cronJob = null;

async function sendReminder(jid, prefix = "") {
  const text = prefix + botConfig.text;

  if (fs.existsSync(VIDEO_FILE)) {
    await sock.sendMessage(jid, {
      video: fs.readFileSync(VIDEO_FILE),
      caption: text
    });
  } else if (fs.existsSync(IMAGE_FILE)) {
    await sock.sendMessage(jid, {
      image: fs.readFileSync(IMAGE_FILE),
      caption: text
    });
  } else {
    await sock.sendMessage(jid, { text });
  }
}

// Configura o reinicia la tarea programada con los nuevos días y horas
function scheduleReminders() {
  if (cronJob) {
    cronJob.stop();
  }

  const cronExpression = `0 ${botConfig.hours} * * ${botConfig.days}`;
  console.log(`⏰ Cron programado: "${cronExpression}" en zona ${TIMEZONE}`);

  cronJob = cron.schedule(
    cronExpression,
    async () => {
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
    },
    { timezone: TIMEZONE }
  );
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

      // Obtener ID del grupo
      if (command.toLowerCase() === "/id") {
        await sock.sendMessage(remoteJid, {
          text: `🆔 ID DE ESTE GRUPO:\n\n${remoteJid}\n\nGROUP_ID=${remoteJid}`
        });
        return;
      }

      // Solo atiende al grupo autorizado
      if (!GROUP_ID || remoteJid !== GROUP_ID) return;

      if (command.toLowerCase() === "/prueba") {
        await sendReminder(remoteJid, "🧪 PRUEBA DEL BOT\n\n");
        return;
      }

      if (command.toLowerCase() === "/ayuda") {
        await sock.sendMessage(remoteJid, {
          text:
`🤖 COMANDOS DISPONIBLES

📌 *General:*
• /id → muestra el ID del grupo
• /prueba → envía una prueba del recordatorio
• /ayuda → muestra este menú

📝 *Texto:*
• /texto TU MENSAJE → cambia el texto automático
• /borrartexto → restaura el texto original

📷 *Multimedia:*
• /foto → responde a una foto para guardarla
• /borrarfoto → elimina la foto
• /video → responde a un video para guardarlo
• /borrarvideo → elimina el video

⏰ *Horarios y Días:*
• /horario 8,9,10,11 → ajusta horas separadas por comas (formato 24h)
• /dias 1-5 → ajusta días (1-5 Lun a Vie, 1-6 Lun a Sáb)
• /verhorario → muestra el horario y días configurados`
        });
        return;
      }

      // --- TEXTO ---
      if (command.toLowerCase().startsWith("/texto ")) {
        const newText = command.substring(7).trim();
        if (!newText) {
          await sock.sendMessage(remoteJid, { text: "❌ Escribe el nuevo texto después de /texto." });
          return;
        }
        botConfig.text = newText;
        saveConfig({ text: newText });
        await sock.sendMessage(remoteJid, { text: "✅ Texto automático actualizado." });
        return;
      }

      if (command.toLowerCase() === "/borrartexto") {
        botConfig.text = DEFAULT_TEXT;
        saveConfig({ text: DEFAULT_TEXT });
        await sock.sendMessage(remoteJid, { text: "✅ Texto original restaurado." });
        return;
      }

      // --- FOTO ---
      if (command.toLowerCase() === "/foto") {
        const context = msg.message.extendedTextMessage?.contextInfo;
        const quoted = context?.quotedMessage;

        if (!quoted?.imageMessage) {
          await sock.sendMessage(remoteJid, { text: "❌ Responde a una foto con /foto." });
          return;
        }

        const quotedMessage = {
          key: { remoteJid, id: context.stanzaId, participant: context.participant },
          message: quoted
        };

        const buffer = await downloadMediaMessage(
          quotedMessage,
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        fs.writeFileSync(IMAGE_FILE, buffer);
        await sock.sendMessage(remoteJid, { text: "✅ Foto guardada para los recordatorios." });
        return;
      }

      if (command.toLowerCase() === "/borrarfoto") {
        if (fs.existsSync(IMAGE_FILE)) fs.unlinkSync(IMAGE_FILE);
        await sock.sendMessage(remoteJid, { text: "✅ Foto eliminada del recordatorio." });
        return;
      }

      // --- VIDEO ---
      if (command.toLowerCase() === "/video") {
        const context = msg.message.extendedTextMessage?.contextInfo;
        const quoted = context?.quotedMessage;

        if (!quoted?.videoMessage) {
          await sock.sendMessage(remoteJid, { text: "❌ Responde a un video con /video." });
          return;
        }

        const quotedMessage = {
          key: { remoteJid, id: context.stanzaId, participant: context.participant },
          message: quoted
        };

        const buffer = await downloadMediaMessage(
          quotedMessage,
          "buffer",
          {},
          { logger: P({ level: "silent" }) }
        );

        fs.writeFileSync(VIDEO_FILE, buffer);
        await sock.sendMessage(remoteJid, { text: "✅ Video guardado para los recordatorios." });
        return;
      }

      if (command.toLowerCase() === "/borrarvideo") {
        if (fs.existsSync(VIDEO_FILE)) fs.unlinkSync(VIDEO_FILE);
        await sock.sendMessage(remoteJid, { text: "✅ Video eliminado del recordatorio." });
        return;
      }

      // --- HORARIOS Y DÍAS ---
      if (command.toLowerCase().startsWith("/horario ")) {
        const hoursInput = command.substring(9).trim().replace(/\s+/g, "");
        if (!/^([0-9]|1[0-9]|2[0-3])(,([0-9]|1[0-9]|2[0-3]))*$/.test(hoursInput)) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Formato incorrecto. Usa números del 0 al 23 separados por comas.\nEjemplo: /horario 8,9,10,11"
          });
          return;
        }

        botConfig.hours = hoursInput;
        saveConfig({ hours: hoursInput });
        scheduleReminders();

        await sock.sendMessage(remoteJid, {
          text: `✅ Horario actualizado con éxito.\nHoras activas: ${hoursInput} hrs (Zona: ${TIMEZONE})`
        });
        return;
      }

      if (command.toLowerCase().startsWith("/dias ")) {
        const daysInput = command.substring(6).trim();
        // Acepta formato cron como 1-5, 1-6, 0-6 o números separados por coma 1,2,3,4,5
        if (!/^(\*|[0-7](-[0-7])?(,[0-7](-[0-7])?)*)$/.test(daysInput)) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Formato incorrecto.\nEjemplos válidos:\n• /dias 1-5 (Lunes a Viernes)\n• /dias 1-6 (Lunes a Sábado)\n• /dias 0-6 (Todos los días)"
          });
          return;
        }

        botConfig.days = daysInput;
        saveConfig({ days: daysInput });
        scheduleReminders();

        await sock.sendMessage(remoteJid, {
          text: `✅ Días actualizados con éxito.\nConfiguración activa: ${daysInput}`
        });
        return;
      }

      if (command.toLowerCase() === "/verhorario") {
        await sock.sendMessage(remoteJid, {
          text:
`⏰ CONFIGURACIÓN ACTUAL

• Horas: ${botConfig.hours} hrs
• Días: ${botConfig.days} (0=Dom, 1=Lun, ..., 6=Sáb)
• Zona horaria: ${TIMEZONE}
• Imagen adjunta: ${fs.existsSync(IMAGE_FILE) ? "Sí" : "No"}
• Video adjunto: ${fs.existsSync(VIDEO_FILE) ? "Sí" : "No"}`
        });
      }
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error);
    }
  });

  // Iniciar la tarea programada
  scheduleReminders();
}

// Servidor Express
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
