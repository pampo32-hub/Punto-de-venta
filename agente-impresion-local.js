/**
 * 🖨️ AGENTE DE IMPRESIÓN LOCAL PARA POS EN LA WEB / NUBE (CLOUD BRIDGE)
 * =========================================================================
 * Este script se ejecuta en segundo plano en la PC de caja del restaurante.
 * Se conecta por WebSocket al servidor web en la nube (ej. https://mi-pos.com)
 * y cuando un salonero envía una orden desde su celular/tablet o la web,
 * este agente recibe el ticket y lo imprime automáticamente en la impresora
 * física (USB o Red Ethernet/Wi-Fi).
 */

const { io } = require('socket.io-client');
const net = require('net');

// Configuración de la URL de tu servidor en la nube y tus impresoras locales
const CONFIG = {
  // Pon aquí la URL pública de tu servidor (ej: 'https://mi-pos-restaurante.com')
  servidorWebUrl: process.env.POS_SERVER_URL || 'http://localhost:4000',

  // Configuración de tus impresoras físicas en el restaurante
  impresoras: {
    caja:   { ip: '127.0.0.1', puerto: 9100 },
    cocina: { ip: '127.0.0.1', puerto: 9101 },
    barra:  { ip: '127.0.0.1', puerto: 9102 },
  }
};

console.log('========================================================');
console.log('🖨️ AGENTE DE IMPRESIÓN LOCAL (POS CLOUD BRIDGE)');
console.log(`🌐 Servidor Web Remoto: ${CONFIG.servidorWebUrl}`);
console.log('========================================================');

const socket = io(CONFIG.servidorWebUrl, {
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: Infinity
});

socket.on('connect', () => {
  console.log(`✅ [CONECTADO] Enlace activo con el servidor web en la nube.`);
  console.log('👂 Esperando comandas y cobros para imprimir automáticamente...');
});

socket.on('disconnect', (reason) => {
  console.warn(`⚠️ [DESCONECTADO] Se perdió conexión con el servidor web: ${reason}. Reconectando...`);
});

socket.on('connect_error', (err) => {
  console.error(`❌ [ERROR] No se pudo conectar al servidor: ${err.message}`);
});

// Escuchar tickets generados desde cualquier terminal o tablet web
socket.on('ticket_impreso', (reg) => {
  if (!reg || !reg.rawBase64) return;

  const destino = reg.destinoImpresora || 'caja';
  const cfgImp = CONFIG.impresoras[destino] || CONFIG.impresoras.caja;

  console.log(`\n📄 [TICKET RECIBIDO DE LA WEB]`);
  console.log(`   • Tipo: ${reg.titulo} (${reg.tipoTicket})`);
  console.log(`   • Destino: ${destino.toUpperCase()} -> ${cfgImp.ip}:${cfgImp.puerto}`);
  console.log(`   • Mesa: ${reg.mesa || 'General'}`);

  const rawBuffer = Buffer.from(reg.rawBase64, 'base64');
  enviarAImpresoraFisica(cfgImp.ip, cfgImp.puerto, rawBuffer, reg.titulo);
});

function enviarAImpresoraFisica(ip, puerto, buffer, titulo) {
  const client = new net.Socket();
  client.setTimeout(3000);

  client.connect(puerto, ip, () => {
    client.write(buffer, () => {
      client.end();
      console.log(`   ✅ [IMPRESO] ${titulo} despachado exitosamente en ${ip}:${puerto}`);
    });
  });

  client.on('timeout', () => {
    client.destroy();
    console.warn(`   ⚠️ [TIMEOUT] Impresora ${ip}:${puerto} no respondió.`);
  });

  client.on('error', (err) => {
    client.destroy();
    console.error(`   ❌ [ERROR IMPRESORA] Fallo al enviar a ${ip}:${puerto}: ${err.message}`);
  });
}
