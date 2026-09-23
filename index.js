const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const cron = require('node-cron');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CLIENTES_FILE = path.join(__dirname, 'clientes.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Servidor HTTP simple para mantener vivo el contenedor en Railway
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Financiera CREFICER en linea.');
}).listen(PORT, () => {
  console.log(`[HTTP] Servidor listo en el puerto ${PORT}`);
});

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function readJson(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Error leyendo ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error guardando ${filePath}:`, err);
  }
}

let cronIniciado = false;

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 15000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n=================================================');
        console.log('--- ESCANEA ESTE CODIGO QR CON TU WHATSAPP ---');
        console.log('=================================================\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`Conexion cerrada (status: ${statusCode}). Reintentando en 6s...`);

        if (shouldReconnect) {
          setTimeout(startBot, 6000);
        } else {
          console.log('Sesion desconectada.');
        }
      } else if (connection === 'open') {
        console.log('\n========================================');
        console.log('CONEXION EXITOSA. BOT ACTIVO.');
        console.log('========================================\n');

        if (!cronIniciado) {
          iniciarRutinaCron(sock);
          cronIniciado = true;
        }
      }
    });

    // Respuestas y Comandos
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      const m = messages[0];
      if (!m.message || m.key.fromMe) return;

      const senderJid = m.key.remoteJid;
      const senderNumber = senderJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        '';

      const cleanText = text.trim();
      const configActual = readJson(CONFIG_FILE, {});
      const esAdmin = senderNumber.includes(configActual.adminNumber);

      if (cleanText.toLowerCase() === '.pago') {
        await sock.sendMessage(senderJid, { text: configActual.infoPago });
        return;
      }

      if (!cleanText.startsWith('.') || !esAdmin) return;

      const [cmd, ...args] = cleanText.split(' ');
      const parametro = args.join(' ').trim();

      if (cmd.toLowerCase() === '.menu' || cmd.toLowerCase() === '.ayuda') {
        const menu = 
`📋 *PANEL DE CONTROL - ${configActual.nombreFinanciera}*

*Clientes:*
🔹 *.agregar Nombre | Teléfono | Monto | Frecuencia | DiaSemana*
   _Ejemplo:_ .agregar Juan Perez | 5212941112233 | $150 | diario
🔹 *.clientes* (Ver lista)
🔹 *.eliminar <teléfono>*

*Configuracion:*
🔹 *.nombre <Nuevo Nombre>*
🔹 *.plantilla <Mensaje>*
🔹 *.setpago <Datos bancarios>*
🔹 *.cobrar* (Disparo manual)`;
        await sock.sendMessage(senderJid, { text: menu });
        return;
      }

      if (cmd.toLowerCase() === '.nombre') {
        if (!parametro) return;
        configActual.nombreFinanciera = parametro;
        writeJson(CONFIG_FILE, configActual);
        await sock.sendMessage(senderJid, { text: `✅ Nombre: *${parametro}*` });
        return;
      }

      if (cmd.toLowerCase() === '.plantilla') {
        if (!parametro) return;
        configActual.plantillaRecordatorio = parametro;
        writeJson(CONFIG_FILE, configActual);
        await sock.sendMessage(senderJid, { text: '✅ Plantilla actualizada.' });
        return;
      }

      if (cmd.toLowerCase() === '.setpago') {
        if (!parametro) return;
        configActual.infoPago = parametro;
        writeJson(CONFIG_FILE, configActual);
        await sock.sendMessage(senderJid, { text: '✅ Metodo de pago actualizado.' });
        return;
      }

      if (cmd.toLowerCase() === '.clientes') {
        const clientes = readJson(CLIENTES_FILE, []);
        if (clientes.length === 0) {
          await sock.sendMessage(senderJid, { text: 'No hay clientes registrados.' });
          return;
        }
        let lista = `👥 *CLIENTES REGISTRADOS (${clientes.length})*\n\n`;
        clientes.forEach((c, idx) => {
          lista += `${idx + 1}. *${c.nombre}*\n   Tel: ${c.telefono}\n   Monto: ${c.monto} | Tipo: ${c.frecuencia}\n\n`;
        });
        await sock.sendMessage(senderJid, { text: lista });
        return;
      }

      if (cmd.toLowerCase() === '.agregar') {
        const partes = parametro.split('|').map(p => p.trim());
        if (partes.length < 4) {
          await sock.sendMessage(senderJid, { text: '⚠️ Formato: .agregar Nombre | Teléfono | Monto | Frecuencia | [diaSemana]' });
          return;
        }
        const [nombre, telefono, monto, frecuencia, dia] = partes;
        const clientes = readJson(CLIENTES_FILE, []);
        clientes.push({
          nombre,
          telefono: telefono.replace(/[^0-9]/g, ''),
          monto,
          frecuencia: frecuencia.toLowerCase(),
          diaSemana: dia !== undefined ? parseInt(dia) : null,
          activo: true
        });
        writeJson(CLIENTES_FILE, clientes);
        await sock.sendMessage(senderJid, { text: `✅ Cliente *${nombre}* registrado.` });
        return;
      }

      if (cmd.toLowerCase() === '.eliminar') {
        const tel = parametro.replace(/[^0-9]/g, '');
        let clientes = readJson(CLIENTES_FILE, []);
        clientes = clientes.filter(c => c.telefono !== tel);
        writeJson(CLIENTES_FILE, clientes);
        await sock.sendMessage(senderJid, { text: `✅ Cliente eliminado.` });
        return;
      }

      if (cmd.toLowerCase() === '.cobrar') {
        await sock.sendMessage(senderJid, { text: '🚀 Ejecutando cobranza...' });
        await procesarCobranza(sock);
        await sock.sendMessage(senderJid, { text: '🏁 Cobranza finalizada.' });
        return;
      }
    });

  } catch (err) {
    console.error('Error iniciando socket:', err);
    setTimeout(startBot, 8000);
  }
}

function iniciarRutinaCron(sock) {
  const config = readJson(CONFIG_FILE, {});
  const cronHorario = config.horaEnvio || '30 8 * * *';
  const tz = config.timezone || 'America/Mexico_City';

  cron.schedule(cronHorario, async () => {
    console.log('--- Cobranza automatica iniciada ---');
    await procesarCobranza(sock);
  }, { timezone: tz });
}

async function procesarCobranza(sock) {
  const clientes = readJson(CLIENTES_FILE, []);
  const config = readJson(CONFIG_FILE, {});
  const hoy = new Date();
  const diaSemanaHoy = hoy.getDay();

  for (const cliente of clientes) {
    if (!cliente.activo) continue;

    let leToca = false;
    if (cliente.frecuencia === 'diario') {
      leToca = true;
    } else if (cliente.frecuencia === 'semanal' && cliente.diaSemana === diaSemanaHoy) {
      leToca = true;
    }

    if (leToca) {
      const jid = `${cliente.telefono}@s.whatsapp.net`;
      let mensaje = (config.plantillaRecordatorio || '')
        .replace(/{nombre}/g, cliente.nombre)
        .replace(/{monto}/g, cliente.monto)
        .replace(/{financiera}/g, config.nombreFinanciera);

      try {
        await sock.sendMessage(jid, { text: mensaje });
        console.log(`Recordatorio enviado a: ${cliente.nombre}`);
      } catch (e) {
        console.error(`Fallo envio a ${cliente.telefono}:`, e);
      }

      await delay(Math.floor(Math.random() * 5000) + 5000);
    }
  }
}

startBot();
