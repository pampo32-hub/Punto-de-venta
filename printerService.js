require('dotenv').config();
const net = require('net');
const { sendRawToWindowsPrinter, getInstalledPrinters } = require('./windowsPrinter');

/**
 * SERVICIO DE IMPRESIÓN TÉRMICA ESC/POS & SIMULADOR DE PUERTO TCP 9100
 * Compatible con impresoras térmicas de 80mm (Epson, Bixolon, Star, Xprinter, etc.)
 * Compatible con impresoras térmicas de 80mm USB (Windows Spooler) y Red TCP (Epson, Bixolon, Star, Xprinter, POS-80, etc.)
 */

// Estado en memoria de configuración de impresoras
let printerConfig = {
  caja: {
    nombre: process.env.PRINTER_CAJA_NAME || 'Impresora Caja (80mm)',
    tipo: process.env.PRINTER_CAJA_TYPE || (process.env.PRINTER_CAJA_IP ? 'red' : 'red'),
    nombre: process.env.PRINTER_CAJA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_CAJA_TYPE || 'usb',
    ip: process.env.PRINTER_CAJA_IP || '192.168.1.30',
    puerto: Number(process.env.PRINTER_CAJA_PORT) || 9100,
    windowsPrinter: process.env.PRINTER_CAJA_WIN || 'POS-80-Series',
    activa: true
  },
  cocina: {
    nombre: process.env.PRINTER_COCINA_NAME || 'Impresora Cocina (80mm)',
    tipo: process.env.PRINTER_COCINA_TYPE || (process.env.PRINTER_COCINA_IP ? 'red' : 'red'),
    nombre: process.env.PRINTER_COCINA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_COCINA_TYPE || 'usb',
    ip: process.env.PRINTER_COCINA_IP || '192.168.1.30',
    puerto: Number(process.env.PRINTER_COCINA_PORT) || 9100,
    windowsPrinter: process.env.PRINTER_COCINA_WIN || 'POS-80-Series',
    activa: true
  },
  barra: {
    nombre: process.env.PRINTER_BARRA_NAME || 'Impresora Barra (80mm)',
    tipo: process.env.PRINTER_BARRA_TYPE || (process.env.PRINTER_BARRA_IP ? 'red' : 'red'),
    nombre: process.env.PRINTER_BARRA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_BARRA_TYPE || 'usb',
    ip: process.env.PRINTER_BARRA_IP || '192.168.1.30',
    puerto: Number(process.env.PRINTER_BARRA_PORT) || 9100,
    windowsPrinter: process.env.PRINTER_BARRA_WIN || 'POS-80-Series',
    activa: true
  },
};

// Historial de impresiones recientes (simulador y auditoría)
const historialImpresiones = [];
const MAX_HISTORIAL = 50;

// Constantes ESC/POS estándar
const ESC = '\x1B';
const GS = '\x1D';

const ESCPOS = {
  INIT: `${ESC}@`,
  ALIGN_LEFT: `${ESC}a\x00`,
  ALIGN_CENTER: `${ESC}a\x01`,
  ALIGN_RIGHT: `${ESC}a\x02`,
  BOLD_ON: `${ESC}E\x01`,
  BOLD_OFF: `${ESC}E\x00`,
  DOUBLE_HEIGHT: `${GS}!\x01`,
  DOUBLE_WIDTH: `${GS}!\x10`,
  DOUBLE_BOTH: `${GS}!\x11`,
  NORMAL: `${GS}!\x00`,
  UNDERLINE_ON: `${ESC}-\x01`,
  UNDERLINE_OFF: `${ESC}-\x00`,
  CUT_FULL: `${GS}V\x00`,
  CUT_PARTIAL: `${GS}V\x01`,
  FEED_LINES: (n = 3) => `${ESC}d${String.fromCharCode(n)}`,
  BEEP: `${ESC}B\x03\x02` // 3 beeps
};

/**
 * Formatea montos para impresora térmica en formato estándar de Colones (CRC 1,800 / CRC 10,086)
 * Evita caracteres Unicode no soportados (como NBSP \u00A0 o el símbolo ₡ que en ROM CP437 sale como í)
 */
function formatMontoTermica(monto) {
  const n = Math.round(Number(monto) || 0);
  const formatted = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `CRC ${formatted}`;
}

/**
 * Sanitiza textos para impresoras térmicas ESC/POS:
 * Remueve acentos problemáticos (é->e, á->a, etc.) y caracteres que corrompen la tabla de fuentes
 */
function limpiarTextoTermica(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n\r\t]/g, '');
}

/**
 * Formatea una línea con dos columnas alineadas a los extremos (80mm = 48 caracteres ancho)
 */
function formatearLinea2Col(col1, col2, anchoTotal = 48) {
  col1 = limpiarTextoTermica(String(col1 || ''));
  col2 = limpiarTextoTermica(String(col2 || ''));
  const espacio = Math.max(1, anchoTotal - col1.length - col2.length);
  return col1 + ' '.repeat(espacio) + col2;
}

/**
 * Formatea una línea con tres columnas (Cant, Descripción, Total)
 */
function formatearLinea3Col(cant, desc, total, anchoTotal = 48) {
  cant = limpiarTextoTermica(String(cant || '')).padEnd(4, ' ');
  total = limpiarTextoTermica(String(total || '')).padStart(12, ' ');
  const anchoDesc = anchoTotal - cant.length - total.length;
  let descCortada = limpiarTextoTermica(String(desc || ''));
  if (descCortada.length > anchoDesc) {
    descCortada = descCortada.substring(0, anchoDesc);
  } else {
    descCortada = descCortada.padEnd(anchoDesc, ' ');
  }
  return cant + descCortada + total;
}

/**
 * Generador de comandos ESC/POS y Formato Visual de Comanda para Cocina / Barra
 */
function generarTicketComanda({ ordenId, comandaNumero, mesaNumero, mesero, items, destino = 'cocina', pagada = false, fechaHora = new Date().toISOString() }) {
  const fechaStr = new Date(fechaHora).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  let destinoTitulo = destino.toUpperCase() === 'BARRA' ? 'COMANDA BARRA' : 'COMANDA COCINA';
  if (pagada) {
    destinoTitulo += ' (PAGADA / DIRECTO)';
  }
  
  // 1. ESC/POS Buffer (para enviar al puerto 9100 / socket / USB)
  let raw = '';
  raw += ESCPOS.INIT;
  raw += ESCPOS.BEEP;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + `*** ${destinoTitulo} ***\n` + ESCPOS.NORMAL;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `MESA: ${limpiarTextoTermica(mesaNumero)}\n` + ESCPOS.NORMAL;
  if (pagada) {
    raw += ESCPOS.BOLD_ON + `[ ESTADO: COBRADA / DIRECTO ]\n` + ESCPOS.BOLD_OFF;
  }
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Orden: #${ordenId || 1} | Comanda: #${comandaNumero || 1}\n`;
  raw += `Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea3Col('CANT', 'PLATILLO / PRODUCTO', 'CURSO/DEST') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  items.forEach(it => {
    const cursoLabels = { 1: '[Entrada]', 2: '[Fuerte]', 3: '[Postre]' };
    const curLabel = cursoLabels[it.curso] || '';
    const prodNombre = limpiarTextoTermica(it.nombre_producto || it.nombre || 'Producto');
    raw += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_HEIGHT + `${it.cantidad}x ${prodNombre}\n` + ESCPOS.NORMAL;
    if (curLabel) {
      raw += `   ${curLabel}\n`;
    }
    if (it.notas) {
      raw += ESCPOS.BOLD_ON + `   >> NOTA: ${limpiarTextoTermica(it.notas)}\n` + ESCPOS.BOLD_OFF;
    }
    if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(mesaNumero)) {
      raw += `   (Orig: Mesa ${it.origen_mesa_numero})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.BOLD_ON + `TOTAL ITEMS: ${items.reduce((acc, i) => acc + (Number(i.cantidad) || 1), 0)}\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.FEED_LINES(3);
  raw += ESCPOS.CUT_FULL;

  // 2. Modelo estructurado para vista previa en HTML
  const ticketVisual = {
    tipo: 'comanda',
    destino,
    titulo: destinoTitulo,
    mesa: mesaNumero,
    ordenId,
    comandaNumero,
    mesero,
    pagada: Boolean(pagada),
    fechaHora: fechaStr,
    items: items.map(it => ({
      cantidad: it.cantidad,
      nombre: it.nombre_producto || it.nombre || 'Producto',
      notas: it.notas || '',
      curso: it.curso || 2,
      origenMesa: it.origen_mesa_numero || null
    })),
    totalItems: items.reduce((acc, i) => acc + (Number(i.cantidad) || 1), 0)
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Factura / Ticket de Liquidación Completa
 */
function generarTicketLiquidacion({ negocio, ordenId, numeroOrden, mesaNumero, mesero, cliente, metodoPago, subtotal, descuentoHH, servicio, iva, total, recibido, cambio, items, fechaHora = new Date().toISOString() }) {
  const fechaStr = new Date(fechaHora).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-0000 / 8888-9999');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');

  let raw = '';
  raw += ESCPOS.INIT;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  raw += `${negDir}\n`;
  raw += `Ced. Juridica: 3-101-789456\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `COMPROBANTE DE PAGO / FACTURA\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Factura / Orden: #${numeroOrden || ordenId || '001'}\n`;
  raw += `Mesa: ${limpiarTextoTermica(mesaNumero)} | Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Cliente: ${limpiarTextoTermica(cliente || 'Cliente General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea3Col('CANT', 'DESCRIPCION', 'PRECIO') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  items.forEach(it => {
    const totalLinea = (it.precio_unitario || it.precio || 0) * it.cantidad;
    const nombreProd = limpiarTextoTermica(it.nombre_producto || it.nombre);
    raw += formatearLinea3Col(`${it.cantidad}x`, nombreProd, formatMontoTermica(totalLinea)) + '\n';
    if (it.notas) {
      raw += `   (${limpiarTextoTermica(it.notas)})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_RIGHT;
  raw += formatearLinea2Col('Subtotal (Base Imponible):', formatMontoTermica(subtotal)) + '\n';
  if (descuentoHH > 0) {
    raw += ESCPOS.BOLD_ON + formatearLinea2Col('Descuento Happy Hour 2x1:', `-${formatMontoTermica(descuentoHH)}`) + '\n' + ESCPOS.BOLD_OFF;
  }
  raw += formatearLinea2Col('10% Servicio (Ley):', formatMontoTermica(servicio)) + '\n';
  raw += formatearLinea2Col('13% I.V.A.:', formatMontoTermica(iva)) + '\n';
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + formatearLinea2Col('TOTAL A PAGAR:', formatMontoTermica(total)) + '\n' + ESCPOS.NORMAL;
  raw += '='.repeat(48) + '\n';

  raw += ESCPOS.ALIGN_LEFT;
  raw += `Metodo de Pago: ${limpiarTextoTermica(metodoPago || 'Efectivo')}\n`;
  if (metodoPago === 'Efectivo' && recibido > 0) {
    raw += `Monto Recibido: ${formatMontoTermica(recibido)}\n`;
    raw += `Vuelto / Cambio: ${formatMontoTermica(cambio)}\n`;
  }

  raw += ESCPOS.ALIGN_CENTER;
  raw += '\n';
  raw += 'Muchas gracias por su preferencia!\n';
  raw += 'Esperamos servirle de nuevo muy pronto.\n';
  raw += 'Autorizado mediante resolucion DGT-R-033-2019\n';
  raw += ESCPOS.FEED_LINES(3);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'cuenta_total',
    titulo: 'COMPROBANTE DE PAGO',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir },
    ordenId,
    numeroOrden: numeroOrden || ordenId,
    mesa: mesaNumero,
    mesero,
    cliente: cliente || 'Cliente General',
    fechaHora: fechaStr,
    items: items.map(it => ({
      cantidad: it.cantidad,
      nombre: it.nombre_producto || it.nombre,
      precioUnitario: it.precio_unitario || it.precio,
      totalLinea: (it.precio_unitario || it.precio) * it.cantidad
    })),
    subtotal: Math.round(subtotal),
    descuentoHH: Math.round(descuentoHH || 0),
    servicio: Math.round(servicio),
    iva: Math.round(iva),
    total: Math.round(total),
    metodoPago: metodoPago || 'Efectivo',
    recibido: Math.round(recibido || total),
    cambio: Math.round(cambio || 0)
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Comprobante de Pago Parcial (Split Bill)
 */
function generarTicketPagoParcial({ negocio, ordenId, mesaNumero, personaNombre, mesero, metodoPago, montoCobrado, subtotal, impuestos, itemsPagados, saldoRestanteMesa, fechaHora = new Date().toISOString() }) {
  const fechaStr = new Date(fechaHora).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');

  let raw = '';
  raw += ESCPOS.INIT;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL;
  raw += ESCPOS.BOLD_ON + `*** COMPROBANTE DE PAGO PARCIAL ***\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.DOUBLE_HEIGHT + `MESA: ${limpiarTextoTermica(mesaNumero)} - ${limpiarTextoTermica(personaNombre).toUpperCase()}\n` + ESCPOS.NORMAL;
  raw += `Orden: #${ordenId} | Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_LEFT;
  raw += ESCPOS.BOLD_ON + formatearLinea3Col('CANT', 'CONSUMO INDIVIDUAL', 'TOTAL') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  itemsPagados.forEach(it => {
    const unitP = it.precio_unitario || it.precio || 0;
    const totalL = unitP * it.cantidad;
    const nomProd = limpiarTextoTermica(it.nombre_producto || it.nombre || 'Consumo');
    raw += formatearLinea3Col(`${it.cantidad}x`, nomProd, formatMontoTermica(totalL)) + '\n';
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_RIGHT;
  raw += formatearLinea2Col('Subtotal Consumo:', formatMontoTermica(subtotal)) + '\n';
  raw += formatearLinea2Col('10% Serv + 13% IVA:', formatMontoTermica(impuestos)) + '\n';
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + formatearLinea2Col('PAGADO:', formatMontoTermica(montoCobrado)) + '\n' + ESCPOS.NORMAL;
  raw += '='.repeat(48) + '\n';

  raw += ESCPOS.ALIGN_LEFT;
  raw += `Metodo: ${limpiarTextoTermica(metodoPago || 'Efectivo')}\n`;
  raw += ESCPOS.BOLD_ON + `Saldo Pendiente en Mesa: ${formatMontoTermica(saldoRestanteMesa)}\n` + ESCPOS.BOLD_OFF;
  raw += `Estado: Mesa permanece ABIERTA con consumos pendientes.\n`;
  raw += ESCPOS.FEED_LINES(3);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'pago_parcial',
    titulo: 'PAGO PARCIAL INDIVIDUAL',
    negocio: { nombre: negNombre },
    ordenId,
    mesa: mesaNumero,
    personaNombre,
    mesero,
    fechaHora: fechaStr,
    items: itemsPagados.map(it => ({
      cantidad: it.cantidad,
      nombre: it.nombre_producto || it.nombre || 'Consumo',
      precioUnitario: it.precio_unitario || it.precio || 0,
      totalLinea: (it.precio_unitario || it.precio || 0) * it.cantidad
    })),
    subtotal: Math.round(subtotal),
    impuestos: Math.round(impuestos),
    total: Math.round(montoCobrado),
    metodoPago: metodoPago || 'Efectivo',
    saldoRestanteMesa: Math.round(saldoRestanteMesa)
  };

  return { raw, ticketVisual };
}

/**
 * Enviar buffer RAW a puerto TCP (impresora física o simulador local en red)
 */
function enviarAPuertoTCP(ip, puerto, rawData) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);

    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, 'latin1');

    socket.connect(puerto, ip, () => {
      socket.write(buf, () => {
        setTimeout(() => {
          socket.end(() => {
            resolve({ ok: true, mensaje: `Enviados ${buf.length} bytes a ${ip}:${puerto}` });
          });
        }, 150);
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, simulado: true, mensaje: `Timeout al conectar con ${ip}:${puerto} (Modo Simulación Activo)` });
    });

    socket.on('error', (err) => {
      socket.destroy();
      // Si no hay impresora física respondiendo en esa IP/puerto, no rompemos el sistema: lo registramos como simulación
      resolve({ ok: false, simulado: true, error: err.message, mensaje: `Simulación completada en buffer (Impresora física no detectada en ${ip}:${puerto})` });
    });
  });
}

// Cola de impresión secuencial (FIFO) para evitar colisiones cuando se envían múltiples tickets a la misma IP
const colasImpresion = new Map();

function encolarEnvioTCP(ip, puerto, rawData) {
  const clave = `${ip}:${puerto}`;
  const colaActual = colasImpresion.get(clave) || Promise.resolve();

  const siguiente = colaActual
    .catch(() => {})
    .then(async () => {
      const res = await enviarAPuertoTCP(ip, puerto, rawData);
      // Breve pausa entre tickets para permitir el corte de papel y vaciado del buffer de la impresora
      await new Promise(resolve => setTimeout(resolve, 300));
      return res;
    });

  colasImpresion.set(clave, siguiente);
  return siguiente;
}

/**
 * Función principal para despachar impresión a la impresora configurada
 */
async function procesarImpresion({ destinoImpresora = 'caja', ticketInfo, io = null }) {
  const cfg = printerConfig[destinoImpresora] || printerConfig.caja;
  const ahora = new Date().toISOString();

  const registro = {
    id: Date.now() + '-' + Math.floor(Math.random() * 1000),
    timestamp: ahora,
    destinoImpresora,
    impresoraNombre: cfg.nombre,
    tipoTicket: ticketInfo.ticketVisual.tipo,
    titulo: ticketInfo.ticketVisual.titulo,
    mesa: ticketInfo.ticketVisual.mesa,
    bytes: Buffer.byteLength(ticketInfo.raw),
    estado: 'enviando',
    detalleConexion: `Despachando a ${cfg.ip || 'simulador'}...`,
    ticketVisual: ticketInfo.ticketVisual,
    rawBase64: Buffer.from(ticketInfo.raw, 'binary').toString('base64'),
    rawText: ticketInfo.raw,
    rawHexPreview: Buffer.from(ticketInfo.raw).toString('hex').substring(0, 64) + '...'
  };

  historialImpresiones.unshift(registro);
  if (historialImpresiones.length > MAX_HISTORIAL) historialImpresiones.pop();

  // Despacho directo: USB / Windows Spooler o TCP Red
  if (cfg.tipo === 'usb' || (!cfg.ip && process.platform === 'win32')) {
    const winPrinterName = cfg.windowsPrinter || cfg.nombre || 'POS-80-Series';
    sendRawToWindowsPrinter(winPrinterName, ticketInfo.raw).then((resWin) => {
      registro.estado = resWin.ok ? 'impreso' : 'simulado';
      registro.detalleConexion = resWin.mensaje || resWin.error || 'Enviado a Windows Spooler';
      if (io) io.emit('ticket_impreso', registro);
    }).catch((err) => {
      registro.estado = 'simulado';
      registro.detalleConexion = 'Error USB: ' + err.message;
      if (io) io.emit('ticket_impreso', registro);
    });
  } else if (cfg.tipo === 'red' && cfg.ip && cfg.puerto) {
    encolarEnvioTCP(cfg.ip, cfg.puerto, ticketInfo.raw).then((resTCP) => {
      registro.estado = resTCP.ok ? 'impreso' : 'simulado';
      registro.detalleConexion = resTCP.mensaje || 'Enviado correctamente por Red TCP';
      if (io) io.emit('ticket_impreso', registro);
    }).catch((err) => {
      registro.estado = 'simulado';
      registro.detalleConexion = 'Error TCP: ' + err.message;
      if (io) io.emit('ticket_impreso', registro);
    });
  } else {
    registro.estado = 'simulado';
    registro.detalleConexion = 'Simulacion virtual';
  }

  // Emitir evento por Socket.IO en tiempo real a las terminales para feedback instantáneo
  if (io) {
    io.emit('ticket_impreso', registro);
  }

  return registro;
}

module.exports = {
  printerConfig,
  historialImpresiones,
  ESCPOS,
  generarTicketComanda,
  generarTicketLiquidacion,
  generarTicketPagoParcial,
  enviarAPuertoTCP,
  sendRawToWindowsPrinter,
  getInstalledPrinters,
  procesarImpresion
};

