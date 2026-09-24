const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const P = require("pino");
const qrcode = require("qrcode-terminal");
const cron = require("node-cron");

const TIMEZONE = process.env.TIMEZONE || "America/Mexico_City";
const GROUP_ID = process.env.GROUP_ID || "";

const MESSAGE = `🔔 RECORDATORIO DE PAGO

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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Recordatorio Pagos", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n=== ESCANEA ESTE QR CON WHATSAPP ===\n");
      qrcode.generate(qr, { small: true });
      console.log("\nWhatsApp > Dispositivos vinculados > Vincular dispositivo\n");
    }

    if (connection === "open") {
      console.log("✅ Bot de WhatsApp conectado.");

      if (GROUP_ID) {
        console.log(`📢 Grupo configurado: ${GROUP_ID}`);
      } else {
        console.log("⚠️ GROUP_ID no está configurado.");
        console.log("Dentro del grupo escribe /id para obtenerlo.");
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Conexión cerrada. Código:", statusCode);

      if (shouldReconnect) {
        console.log("🔄 Intentando reconectar...");
        setTimeout(startBot, 5000);
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
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      const command = text.trim().toLowerCase();

      // Obtener ID del grupo.
      if (command === "/id") {
        if (!remoteJid?.endsWith("@g.us")) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Este comando solamente funciona dentro de un grupo."
          });
          return;
        }

        await sock.sendMessage(remoteJid, {
          text:
            `🆔 ID DE ESTE GRUPO:\n\n${remoteJid}\n\n` +
            `Cópialo en Railway como:\n\n` +
            `GROUP_ID=${remoteJid}`
        });

        console.log(`🆔 ID solicitado: ${remoteJid}`);
        return;
      }

      // Prueba manual del mensaje.
      if (command === "/prueba") {
        if (!GROUP_ID) {
          await sock.sendMessage(remoteJid, {
            text: "⚠️ Primero configura GROUP_ID en Railway usando el comando /id."
          });
          return;
        }

        if (remoteJid !== GROUP_ID) {
          await sock.sendMessage(remoteJid, {
            text: "❌ Este grupo no es el grupo configurado para los recordatorios."
          });
          return;
        }

        await sock.sendMessage(GROUP_ID, {
          text: "🧪 PRUEBA DEL BOT\n\n" + MESSAGE
        });

        console.log(`🧪 Prueba enviada a ${GROUP_ID}`);
      }
    } catch (error) {
      console.error("❌ Error procesando comando:", error);
    }
  });

  // Recordatorios automáticos: lunes a viernes a las 8, 9 y 10 AM.
  cron.schedule(
    "0 8,9,10 * * 1-5",
    async () => {
      if (!GROUP_ID) {
        console.log("⚠️ No se envió recordatorio: falta GROUP_ID.");
        return;
      }

      try {
        await sock.sendMessage(GROUP_ID, { text: MESSAGE });
        console.log(`📨 Recordatorio automático enviado a ${GROUP_ID}`);
      } catch (error) {
        console.error("❌ Error enviando recordatorio:", error);
      }
    },
    { timezone: TIMEZONE }
  );

  setInterval(() => {}, 60 * 60 * 1000);
}

startBot().catch((error) => {
  console.error("❌ Error iniciando el bot:", error);
  process.exit(1);
});
