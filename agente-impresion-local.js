/**
 * 🖨️ AGENTE DE IMPRESIÓN LOCAL PARA POS EN LA WEB / NUBE (CLOUD BRIDGE)
 * =========================================================================
 * Este script se ejecuta en segundo plano en la PC / Laptop del restaurante.
 * Se conecta por WebSocket en tiempo real al servidor web en la nube
 * (ej. https://tu-pos-web.com o tu URL de producción) y cuando un cliente,
 * mesero o cajero genera un ticket (pre-factura, factura, comanda, corte X/Z)
 * desde cualquier teléfono o navegador en internet, este agente lo recibe en
 * milisegundos y lo imprime automáticamente en la impresora física (192.168.1.30).
 */

require('dotenv').config();
const { io } = require('socket.io-client');
const net = require('net');
const http = require('http');

// Obtener URL remota desde argumentos CLI, variable de entorno o fallback
const urlServidorRemoto = process.argv[2] || process.env.POS_SERVER_URL || 'http://localhost:4000';
const IP_IMPRESORA_PRINCIPAL = process.env.PRINTER_IP || '192.168.1.30';
const PUERTO_IMPRESORA_PRINCIPAL = Number(process.env.PRINTER_PORT) || 9100;

const CONFIG = {
  servidorWebUrl: urlServidorRemoto,
  impresoras: {
    caja:   { ip: IP_IMPRESORA_PRINCIPAL, puerto: PUERTO_IMPRESORA_PRINCIPAL },
    cocina: { ip: IP_IMPRESORA_PRINCIPAL, puerto: PUERTO_IMPRESORA_PRINCIPAL },
    barra:  { ip: IP_IMPRESORA_PRINCIPAL, puerto: PUERTO_IMPRESORA_PRINCIPAL },
  }
};

console.log('================================================================');
console.log('🖨️  AGENTE DE IMPRESIÓN EN TIEMPO REAL (POS CLOUD BRIDGE)');
console.log('================================================================');
console.log(`🌐 Servidor Web en la Nube: ${CONFIG.servidorWebUrl}`);
console.log(`🖨️  Impresora Física Destino: ${IP_IMPRESORA_PRINCIPAL}:${PUERTO_IMPRESORA_PRINCIPAL}`);
console.log('================================================================\n');

const socket = io(CONFIG.servidorWebUrl, {
  reconnection: true,
  reconnectionDelay: 1500,
  reconnectionAttempts: Infinity,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log(`✅ [CONECTADO] Enlace en tiempo real activo con el servidor web.`);
  console.log('👂 Escuchando ventas, pre-facturas, comandas y cierres para impresión inmediata...\n');
});

socket.on('disconnect', (reason) => {
  console.warn(`⚠️ [DESCONECTADO] Se perdió enlace con el servidor (${reason}). Reconectando automáticamente...`);
});

socket.on('connect_error', (err) => {
  console.error(`❌ [ERROR CONEXION] No se pudo conectar a ${CONFIG.servidorWebUrl}: ${err.message}`);
});

// Escuchar tickets generados desde cualquier terminal, celular o cliente web
socket.on('ticket_impreso', async (reg) => {
  if (!reg || !reg.rawBase64) return;

  const destino = reg.destinoImpresora || 'caja';
  const cfgImp = CONFIG.impresoras[destino] || CONFIG.impresoras.caja;

  console.log(`📄 [TICKET EN TIEMPO REAL RECIBIDO DE LA WEB]`);
  console.log(`   • Título: ${reg.titulo || 'Ticket'} (${reg.tipoTicket || 'general'})`);
  console.log(`   • Destino: ${destino.toUpperCase()} -> ${cfgImp.ip}:${cfgImp.puerto}`);
  console.log(`   • Mesa / Referencia: ${reg.mesa || 'General'}`);
  console.log(`   • Hora: ${new Date().toLocaleTimeString()}`);

  const rawBuffer = Buffer.from(reg.rawBase64, 'base64');
  await despacharAImpresoraDualStack(cfgImp.ip, cfgImp.puerto, rawBuffer, reg.titulo || 'Ticket');
});

/**
 * Enviar buffer mediante Epson ePOS-Print (HTTP XML)
 */
function enviarAePOSPrint(ip, rawData, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const hex = (Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, 'latin1')).toString('hex');
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      <command>${hex}</command>
    </epos-print>
  </s:Body>
</s:Envelope>`;

      const req = http.request({
        hostname: ip,
        port: 80,
        path: '/cgi-bin/epos/service.cgi?devid=local_printer&timeout=' + timeoutMs,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': '""',
          'Content-Length': Buffer.byteLength(xml)
        },
        timeout: timeoutMs
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 && (respData.includes('success="true"') || respData.includes('response success="true"'))) {
            resolve({ ok: true, metodo: 'epos', mensaje: `Impreso físicamente con éxito vía ePOS-Print en ${ip}` });
          } else {
            resolve({ ok: false, error: `ePOS status ${res.statusCode}: ${respData.substring(0, 120)}` });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: `Timeout al conectar con ePOS-Print en ${ip}` });
      });

      req.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      req.write(xml);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

/**
 * Enviar buffer mediante RAW TCP Socket al puerto 9100
 */
function enviarAPuertoTCP(ip, puerto, rawData, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resuelto = false;

    const finalizar = (res) => {
      if (resuelto) return;
      resuelto = true;
      try { socket.destroy(); } catch (_) {}
      resolve(res);
    };

    socket.setTimeout(timeoutMs);
    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, 'latin1');

    socket.connect(puerto, ip, () => {
      socket.setTimeout(0); // Desactivar timer de inactividad de lectura
      socket.write(buf, () => {
        try { socket.end(); } catch (_) {}
        finalizar({ ok: true, mensaje: `Enviados ${buf.length} bytes a ${ip}:${puerto}` });
      });
    });

    socket.on('timeout', () => {
      finalizar({ ok: false, mensaje: `Timeout al conectar con ${ip}:${puerto}` });
    });

    socket.on('error', (err) => {
      finalizar({ ok: false, error: err.message, mensaje: `Error de conexión con ${ip}:${puerto}: ${err.message}` });
    });
  });
}

/**
 * Despachador dual-stack con respaldo automático
 */
async function despacharAImpresoraDualStack(ip, puerto, buffer, titulo) {
  const t0 = Date.now();
  // 1. Intentar RAW TCP 9100 primero (ultra rápido: 4 milisegundos en red local)
  const resTcp = await enviarAPuertoTCP(ip, puerto, buffer, 4000);
  if (resTcp.ok) {
    const elapsed = Date.now() - t0;
    console.log(`   ✅ [IMPRESIÓN INMEDIATA] ${titulo} impreso en ${elapsed}ms vía RAW TCP en ${ip}:${puerto}\n`);
    return;
  }

  // 2. Si no responde por TCP, intentar ePOS XML
  const resEpos = await enviarAePOSPrint(ip, buffer, 3000);
  if (resEpos.ok) {
    const elapsed = Date.now() - t0;
    console.log(`   ✅ [IMPRESIÓN INMEDIATA] ${titulo} impreso en ${elapsed}ms vía ePOS XML en ${ip}\n`);
  } else {
    console.error(`   ❌ [ERROR DE IMPRESIÓN] No se pudo imprimir en ${ip}:${puerto}: ${resTcp.mensaje || resTcp.error}\n`);
  }
}
