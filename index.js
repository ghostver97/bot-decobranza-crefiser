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

// Servidor HTTP para Railway
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
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Usando versión de WhatsApp Web: v${version.join('.')}, última: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // Identificación compatible
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000
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
      console.log(`Conexión cerrada (Código: ${statusCode}). Reconectando en 5 segundos...`);
      
      if (shouldReconnect) {
        setTimeout(() => {
          startBot();
        }, 5000);
      } else {
        console.log('Sesión cerrada permanentemente. Limpia auth_info_baileys para nuevo QR.');
      }
    } else if (connection === 'open') {
      console.log('\n========================================');
      console.log('CONEXION EXITOSA. BOT ACTIVO Y LISTO.');
      console.log('========================================\n');

      if (!cronIniciado) {
        iniciarRutinaCron(sock);
        cronIniciado = true;
      }
    }
  });

  // GESTOR DE MENSAJES Y COMANDOS
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

    if (!cleanText.startsWith('.')) return;

    const [cmd, ...args] = cleanText.split(' ');
    const parametro = args.join(' ').trim();

    if (cmd.toLowerCase() === '.menu' || cmd.toLowerCase() === '.ayuda') {
      if (!esAdmin) return;
      const menu = 
`📋 *PANEL DE CONTROL - ${configActual.nombreFinanciera}*

*Gestión de Clientes:*
🔹 *.agregar Nombre | Teléfono | Monto | Frecuencia | DiaSemana*
   _Diario:_ .agregar Carlos Ruiz | 5212221112233 | $100 | diario
   _Semanal:_ .agregar Rosa Diaz | 5212224445566 | $300 | semanal | 1
   _(1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 0=Dom)_
🔹 *.clientes* (Ver lista)
🔹 *.eliminar <teléfono>* (Dar de baja)

*Personalización:*
🔹 *.nombre <Nuevo Nombre>*
🔹 *.plantilla <Mensaje>*
🔹 *.setpago <Datos de cuentas>*

*Operaciones:*
🔹 *.cobrar* (Enviar ahora mismo)`;

      await sock.sendMessage(senderJid, { text: menu });
      return;
    }

    if (!esAdmin) return;

    if (cmd.toLowerCase() === '.nombre') {
      if (!parametro) return sock.sendMessage(senderJid, { text: '⚠️ Especifica el nuevo nombre.' });
      configActual.nombreFinanciera = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: `✅ Nombre actualizado a: *${parametro}*` });
      return;
    }

    if (cmd.toLowerCase() === '.plantilla') {
      if (!parametro) return sock.sendMessage(senderJid, { text: '⚠️ Escribe la plantilla con {nombre}, {monto} y {financiera}.' });
      configActual.plantillaRecordatorio = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: '✅ Plantilla de recordatorio guardada.' });
      return;
    }

    if (cmd.toLowerCase() === '.setpago') {
      if (!parametro) return sock.sendMessage(senderJid, { text: '⚠️ Escribe los nuevos datos de pago.' });
      configActual.infoPago = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: '✅ Datos de .pago actualizados.' });
      return;
    }

    if (cmd.toLowerCase() === '.clientes') {
      const clientes = readJson(CLIENTES_FILE, []);
      if (clientes.length === 0) return sock.sendMessage(senderJid, { text: 'No hay clientes registrados.' });
      let lista = `👥 *CLIENTES REGISTRADOS (${clientes.length})*\n\n`;
      clientes.forEach((c, idx) => {
        lista += `${idx + 1}. *${c.nombre}*\n   Tel: ${c.telefono}\n   Monto: ${c.monto} | Tipo: ${c.frecuencia}${c.frecuencia === 'semanal' ? ' (Día ' + c.diaSemana + ')' : ''}\n\n`;
      });
      await sock.sendMessage(senderJid, { text: lista });
      return;
    }

    if (cmd.toLowerCase() === '.agregar') {
      const partes = parametro.split('|').map((p) => p.trim());
      if (partes.length < 4) {
        return sock.sendMessage(senderJid, { text: '⚠️ Formato: .agregar Nombre | Teléfono | Monto | Frecuencia | [diaSemana]' });
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
      await sock.sendMessage(senderJid, { text: `✅ Cliente *${nombre}* guardado.` });
      return;
    }

    if (cmd.toLowerCase() === '.eliminar') {
      const tel = parametro.replace(/[^0-9]/g, '');
      let clientes = readJson(CLIENTES_FILE, []);
      const antes = clientes.length;
      clientes = clientes.filter((c) => c.telefono !== tel);
      if (clientes.length === antes) {
        await sock.sendMessage(senderJid, { text: `⚠️ No se encontró al cliente con teléfono ${tel}.` });
      } else {
        writeJson(CLIENTES_FILE, clientes);
        await sock.sendMessage(senderJid, { text: `✅ Cliente eliminado.` });
      }
      return;
    }

    if (cmd.toLowerCase() === '.cobrar') {
      await sock.sendMessage(senderJid, { text: '🚀 Iniciando cobranza inmediata...' });
      await procesarCobranza(sock);
      await sock.sendMessage(senderJid, { text: '🏁 Cobranza finalizada.' });
      return;
    }
  });
}

function iniciarRutinaCron(sock) {
  const config = readJson(CONFIG_FILE, {});
  const cronHorario = config.horaEnvio || '30 8 * * *';
  const tz = config.timezone || 'America/Mexico_City';

  cron.schedule(cronHorario, async () => {
    console.log('--- Ejecutando envío programado ---');
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
        console.log(`[Recordatorio Enviado] -> ${cliente.nombre} (${cliente.telefono})`);
      } catch (err) {
        console.error(`Error enviando a ${cliente.telefono}:`, err);
      }

      const espera = Math.floor(Math.random() * 6000) + 6000;
      await delay(espera);
    }
  }
}

startBot();
