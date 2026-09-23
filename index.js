const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const cron = require('node-cron');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CLIENTES_FILE = path.join(__dirname, 'clientes.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Servidor HTTP simple para Railway (evita que se cierre el contenedor)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot Financiera CREFICER en línea.');
}).listen(PORT, () => {
  console.log(`Servidor HTTP listo en el puerto ${PORT}`);
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

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n--- ESCANEA ESTE QR CON WHATSAPP EN RAILWAY LOGS ---\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada. Reconectando...', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('Conexión exitosa con WhatsApp. Bot activo.');
    }
  });

  // RUTINA AUTOMÁTICA DIARIA
  const config = readJson(CONFIG_FILE, {});
  const cronHorario = config.horaEnvio || '30 8 * * *';
  const tz = config.timezone || 'America/Mexico_City';

  cron.schedule(cronHorario, async () => {
    console.log('--- Ejecutando envío automático diario de recordatorios ---');
    await procesarCobranza(sock);
  }, { timezone: tz });

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

    // 1. Comando público para clientes
    if (cleanText.toLowerCase() === '.pago') {
      await sock.sendMessage(senderJid, { text: configActual.infoPago });
      return;
    }

    // Comandos restringidos al Administrador
    if (!cleanText.startsWith('.')) return;

    const [cmd, ...args] = cleanText.split(' ');
    const parametro = args.join(' ').trim();

    if (cmd.toLowerCase() === '.menu' || cmd.toLowerCase() === '.ayuda') {
      if (!esAdmin) return;
      const menu = 
`📋 *PANEL DE CONTROL - ${configActual.nombreFinanciera}*

*Gestión de Clientes:*
🔹 *.agregar Nombre | Teléfono | Monto | Frecuencia | DiaSemana*
   _Ejemplo Diario:_ .agregar Carlos Ruiz | 5212221112233 | $100 | diario
   _Ejemplo Semanal:_ .agregar Rosa Diaz | 5212224445566 | $300 | semanal | 1
   _(1=Lunes, 2=Martes, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 0=Dom)_
🔹 *.clientes* (Ver lista de clientes registrados)
🔹 *.eliminar <teléfono>* (Dar de baja un cliente)

*Personalización del Bot:*
🔹 *.nombre <Nuevo Nombre>* (Cambia el nombre de la financiera)
🔹 *.plantilla <Mensaje>* (Usa {nombre}, {financiera} y {monto})
🔹 *.setpago <Datos de cuentas>* (Cambia el texto de .pago)

*Operaciones:*
🔹 *.cobrar* (Lanza el envío automático en este momento)`;

      await sock.sendMessage(senderJid, { text: menu });
      return;
    }

    if (!esAdmin) return;

    // Cambiar nombre
    if (cmd.toLowerCase() === '.nombre') {
      if (!parametro) {
        await sock.sendMessage(senderJid, { text: '⚠️ Especifica el nuevo nombre. Ejemplo:\n.nombre FINANCIERA CREFICER' });
        return;
      }
      configActual.nombreFinanciera = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: `✅ Nombre actualizado a: *${parametro}*` });
      return;
    }

    // Cambiar plantilla
    if (cmd.toLowerCase() === '.plantilla') {
      if (!parametro) {
        await sock.sendMessage(senderJid, { text: '⚠️ Escribe la plantilla. Recuerda que puedes usar {nombre}, {monto} y {financiera}.' });
        return;
      }
      configActual.plantillaRecordatorio = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: '✅ Plantilla de recordatorio guardada con éxito.' });
      return;
    }

    // Cambiar datos de pago
    if (cmd.toLowerCase() === '.setpago') {
      if (!parametro) {
        await sock.sendMessage(senderJid, { text: '⚠️ Escribe los nuevos datos de pago.' });
        return;
      }
      configActual.infoPago = parametro;
      writeJson(CONFIG_FILE, configActual);
      await sock.sendMessage(senderJid, { text: '✅ Datos del comando *.pago* actualizados.' });
      return;
    }

    // Ver clientes
    if (cmd.toLowerCase() === '.clientes') {
      const clientes = readJson(CLIENTES_FILE, []);
      if (clientes.length === 0) {
        await sock.sendMessage(senderJid, { text: 'No tienes clientes registrados aún.' });
        return;
      }
      let lista = `👥 *CLIENTES REGISTRADOS (${clientes.length})*\n\n`;
      clientes.forEach((c, idx) => {
        lista += `${idx + 1}. *${c.nombre}*\n   Tel: ${c.telefono}\n   Monto: ${c.monto} | Tipo: ${c.frecuencia}${c.frecuencia === 'semanal' ? ' (Día ' + c.diaSemana + ')' : ''}\n\n`;
      });
      await sock.sendMessage(senderJid, { text: lista });
      return;
    }

    // Agregar cliente
    if (cmd.toLowerCase() === '.agregar') {
      const partes = parametro.split('|').map((p) => p.trim());
      if (partes.length < 4) {
        await sock.sendMessage(senderJid, { text: '⚠️ Formato incorrecto. Debe ser:\n.agregar Nombre | Teléfono | Monto | Frecuencia (diario/semanal) | [diaSemana opcional]' });
        return;
      }

      const [nombre, telefono, monto, frecuencia, dia] = partes;
      const clientes = readJson(CLIENTES_FILE, []);
      const limpioTel = telefono.replace(/[^0-9]/g, '');

      const nuevo = {
        nombre,
        telefono: limpioTel,
        monto,
        frecuencia: frecuencia.toLowerCase(),
        diaSemana: dia !== undefined ? parseInt(dia) : null,
        activo: true
      };

      clientes.push(nuevo);
      writeJson(CLIENTES_FILE, clientes);
      await sock.sendMessage(senderJid, { text: `✅ Cliente *${nombre}* registrado correctamente.` });
      return;
    }

    // Eliminar cliente
    if (cmd.toLowerCase() === '.eliminar') {
      const tel = parametro.replace(/[^0-9]/g, '');
      let clientes = readJson(CLIENTES_FILE, []);
      const totalAntes = clientes.length;
      clientes = clientes.filter((c) => c.telefono !== tel);

      if (clientes.length === totalAntes) {
        await sock.sendMessage(senderJid, { text: `⚠️ No se encontró ningún cliente con el número ${tel}.` });
      } else {
        writeJson(CLIENTES_FILE, clientes);
        await sock.sendMessage(senderJid, { text: `✅ Cliente con número ${tel} eliminado.` });
      }
      return;
    }

    // Disparo manual
    if (cmd.toLowerCase() === '.cobrar') {
      await sock.sendMessage(senderJid, { text: '🚀 Iniciando ciclo de cobranza inmediato...' });
      await procesarCobranza(sock);
      await sock.sendMessage(senderJid, { text: '🏁 Ciclo de cobranza terminado.' });
      return;
    }
  });
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
      let mensaje = config.plantillaRecordatorio
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
