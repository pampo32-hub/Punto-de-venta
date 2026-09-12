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
    nombre: process.env.PRINTER_CAJA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_CAJA_TYPE || (process.platform === 'win32' ? 'usb' : 'red'),
    ip: process.env.PRINTER_CAJA_IP || '192.168.1.30',
    puerto: Number(process.env.PRINTER_CAJA_PORT) || 9100,
    windowsPrinter: process.env.PRINTER_CAJA_WIN || 'POS-80-Series',
    activa: true
  },
  cocina: {
    nombre: process.env.PRINTER_COCINA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_COCINA_TYPE || (process.platform === 'win32' ? 'usb' : 'red'),
    ip: process.env.PRINTER_COCINA_IP || '192.168.1.30',
    puerto: Number(process.env.PRINTER_COCINA_PORT) || 9100,
    windowsPrinter: process.env.PRINTER_COCINA_WIN || 'POS-80-Series',
    activa: true
  },
  barra: {
    nombre: process.env.PRINTER_BARRA_NAME || 'POS-80-Series',
    tipo: process.env.PRINTER_BARRA_TYPE || (process.platform === 'win32' ? 'usb' : 'red'),
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
  FONT_A: `${ESC}M\x00`,
  DOUBLE_STRIKE_ON: `${ESC}G\x01`,
  DOUBLE_STRIKE_OFF: `${ESC}G\x00`,
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
  FEED_LINES: (n = 4) => `${ESC}d${String.fromCharCode(n)}`,
  BEEP: `${ESC}B\x03\x02` // 3 beeps
};

function negocioTieneCaracteristica(negocio, flagId) {
  if (!negocio) return true;
  const flags = negocio.caracteristicas_activas;
  if (!flags || flags === 'all') return true;
  if (Array.isArray(flags)) return flags.includes(flagId);
  if (typeof flags === 'string') {
    try {
      const arr = JSON.parse(flags);
      if (Array.isArray(arr)) return arr.includes(flagId);
    } catch (_) {}
    const splitArr = flags.split(',').map(s => s.trim().toLowerCase());
    return splitArr.includes(String(flagId).toLowerCase());
  }
  return true;
}

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
function generarTicketComanda({ negocio, ordenId, comandaNumero, mesaNumero, mesero, items, destino = 'cocina', pagada = false, fechaHora = new Date().toISOString() }) {
  let fechaStr = fechaHora;
  if (fechaHora) {
    const d = new Date(fechaHora);
    if (!isNaN(d.getTime())) {
      fechaStr = d.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
    }
  }
  if (!fechaStr || fechaStr === 'Invalid Date') {
    fechaStr = new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  }

  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');

  let destinoTitulo = destino.toUpperCase() === 'BARRA' ? 'COMANDA BARRA' : 'COMANDA COCINA';
  if (pagada) {
    destinoTitulo += ' (PAGADA / DIRECTO)';
  }
  
  const listaItems = Array.isArray(items) ? items : [];
  const totalItems = listaItems.reduce((acc, i) => acc + (Number(i.cantidad) || 1), 0);

  // 1. ESC/POS Buffer (para enviar al puerto 9100 / socket / USB)
  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.BEEP;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + `*** ${destinoTitulo} ***\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `MESA: ${limpiarTextoTermica(mesaNumero)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  if (pagada) {
    raw += ESCPOS.BOLD_ON + `[ ESTADO: COBRADA / DIRECTO ]\n` + ESCPOS.BOLD_OFF;
  }
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Orden: #${ordenId || 1} | Comanda: #${comandaNumero || 1}\n`;
  raw += `Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea3Col('CANT', 'PLATILLO / PRODUCTO', 'TIEMPO') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  listaItems.forEach(it => {
    const cursoLabels = { 1: '[Entrada]', 2: '[Fuerte]', 3: '[Postre]' };
    const curLabel = cursoLabels[it.curso] || '[Fuerte]';
    const cant = Number(it.cantidad) || 1;
    const prodNombre = limpiarTextoTermica(it.nombre_producto || it.nombre || 'Producto');
    raw += ESCPOS.BOLD_ON + ESCPOS.DOUBLE_HEIGHT + `${cant}x  ${prodNombre}\n` + ESCPOS.NORMAL;
    raw += `   ${curLabel}\n`;
    if (it.comensal && it.comensal !== 'General') {
      raw += ESCPOS.BOLD_ON + `   [👤 Comensal: ${limpiarTextoTermica(it.comensal)}]\n` + ESCPOS.BOLD_OFF;
    }
    if (it.notas) {
      raw += ESCPOS.BOLD_ON + `   >> NOTA: ${limpiarTextoTermica(it.notas)}\n` + ESCPOS.BOLD_OFF;
    }
    if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(mesaNumero)) {
      raw += `   (Orig: Mesa ${it.origen_mesa_numero})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'TOTAL ITEMS:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${totalItems}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_LEFT;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_CENTER;
  raw += `• NOTIFICACION DE ${destino.toUpperCase()} •\n`;
  raw += `Corte automatico ejecutado en puerto ESC/POS\n`;
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  // 2. Modelo estructurado para vista previa en HTML
  const ticketVisual = {
    tipo: 'comanda',
    destino,
    titulo: destinoTitulo,
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir },
    mesa: mesaNumero,
    ordenId,
    comandaNumero,
    mesero,
    pagada: Boolean(pagada),
    fechaHora: fechaStr,
    items: listaItems.map(it => ({
      cantidad: Number(it.cantidad) || 1,
      nombre: it.nombre_producto || it.nombre || 'Producto',
      notas: it.notas || '',
      curso: it.curso || 2,
      comensal: it.comensal || 'General',
      origenMesa: it.origen_mesa_numero || null
    })),
    totalItems: totalItems
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Factura / Ticket de Liquidación Completa
 */
function generarTicketLiquidacion(datos = {}, negocioOverride = null) {
  const {
    negocio = negocioOverride,
    ordenId,
    numeroOrden,
    mesaNumero = (datos.mesaNumero || datos.mesa),
    mesero,
    cliente,
    metodoPago,
    subtotal,
    descuentoHH,
    servicio,
    iva,
    total,
    recibido,
    cambio,
    items,
    pagos = [],
    fechaHora = new Date().toISOString(),
    es_para_llevar,
    tipo_orden
  } = datos;
  let fechaStr = fechaHora;
  if (fechaHora) {
    const d = new Date(fechaHora);
    if (!isNaN(d.getTime())) {
      fechaStr = d.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
    }
  }
  if (!fechaStr || fechaStr === 'Invalid Date') {
    fechaStr = new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  }
  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  const listaItems = Array.isArray(items) ? items : [];

  let subCalculado = 0;
  const itemsNormalizados = listaItems.map(it => {
    const cant = Number(it.cantidad) || 1;
    const unitPrice = Number(it.precio_unitario ?? it.precio ?? it.precioUnitario ?? (it.subtotal && cant ? it.subtotal / cant : (it.totalLinea && cant ? it.totalLinea / cant : 0))) || 0;
    const totalLinea = (it.totalLinea !== undefined && it.totalLinea !== null && Number(it.totalLinea) > 0)
      ? Number(it.totalLinea)
      : (it.subtotal !== undefined && it.subtotal !== null && Number(it.subtotal) > 0)
        ? Number(it.subtotal)
        : (unitPrice * cant);
    subCalculado += totalLinea;
    return {
      cantidad: cant,
      nombre: it.nombre_producto || it.nombre || it.descripcion || 'Producto',
      precioUnitario: unitPrice,
      totalLinea: totalLinea,
      notas: it.notas || ''
    };
  });

  const subNum = Math.round(Number(subtotal) || subCalculado || 0);
  const descHHNum = Math.round(Number(descuentoHH) || 0);
  const baseImponible = Math.max(0, subNum - descHHNum);
  const esParaLlevarTicket = Boolean(
    datos?.es_para_llevar ||
    datos?.tipo_orden === 'para_llevar' ||
    (typeof mesaNumero === 'string' && (mesaNumero.toLowerCase().includes('para llevar') || mesaNumero.toLowerCase().includes('llevar'))) ||
    (servicio !== undefined && servicio !== null && Number(servicio) === 0)
  );

  const tieneServicio10 = negocio ? negocioTieneCaracteristica(negocio, 'servicio_10') : true;
  const tieneIVA13 = negocio ? negocioTieneCaracteristica(negocio, 'desglose_iva_13') : true;

  let servNum = 0;
  if (tieneServicio10 && !esParaLlevarTicket) {
    if (servicio !== undefined && servicio !== null && !isNaN(Number(servicio))) {
      servNum = Math.max(0, Math.round(Number(servicio)));
    } else {
      servNum = Math.round(baseImponible * 0.10);
    }
  }

  let ivaNum = 0;
  if (tieneIVA13) {
    if (iva !== undefined && iva !== null && !isNaN(Number(iva))) {
      ivaNum = Math.max(0, Math.round(Number(iva)));
    } else {
      ivaNum = Math.round(baseImponible * 0.13);
    }
  }

  const totNum = (total !== undefined && total !== null && Number(total) > 0 && (!tieneServicio10 || servNum > 0) && (!tieneIVA13 || ivaNum > 0))
    ? Math.round(Number(total))
    : (baseImponible + servNum + ivaNum);
  const montoRecibido = Number(recibido) > 0 ? Math.round(Number(recibido)) : totNum;
  const vuelto = Number(cambio) >= 0 ? Math.round(Number(cambio)) : Math.max(0, montoRecibido - totNum);

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `COMPROBANTE DE PAGO / FACTURA\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Factura / Orden: #${numeroOrden || ordenId || '001'}\n`;
  raw += `Mesa: ${limpiarTextoTermica(mesaNumero)} | Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Cliente: ${limpiarTextoTermica(cliente || 'Cliente General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('CANT  DESCRIPCION', 'PRECIO') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  itemsNormalizados.forEach(it => {
    const cantDesc = `${it.cantidad}x  ${limpiarTextoTermica(it.nombre)}`;
    raw += formatearLinea2Col(cantDesc, formatMontoTermica(it.totalLinea)) + '\n';
    if (it.notas) {
      raw += `   (${limpiarTextoTermica(it.notas)})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_RIGHT;
  raw += formatearLinea2Col('Subtotal (Base Imponible):', formatMontoTermica(subNum)) + '\n';
  if (descHHNum > 0) {
    raw += ESCPOS.BOLD_ON + formatearLinea2Col('Descuento Happy Hour 2x1:', `-${formatMontoTermica(descHHNum)}`) + '\n' + ESCPOS.BOLD_OFF;
  }
  if (servNum > 0 && tieneServicio10) {
    raw += formatearLinea2Col('10% Servicio (Ley):', formatMontoTermica(servNum)) + '\n';
  } else if (esParaLlevarTicket && tieneServicio10) {
    raw += formatearLinea2Col('Servicio (0% Para Llevar):', 'EXENTO') + '\n';
  }
  if (ivaNum > 0 && tieneIVA13) {
    raw += formatearLinea2Col('13% I.V.A.:', formatMontoTermica(ivaNum)) + '\n';
  }
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'TOTAL A PAGAR:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(totNum)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_LEFT;
  raw += '='.repeat(48) + '\n';

  const esDolaresPago = Boolean(
    metodoPago === 'Dolares' ||
    metodoPago === 'Dólares' ||
    Number(datos?.monto_usd) > 0 ||
    (Array.isArray(pagos) && pagos.some(p => (p.metodo === 'Dolares' || p.metodo === 'Dólares' || Number(p.monto_usd) > 0)))
  );
  const montoUSDTotal = Number(datos?.monto_usd) || (Array.isArray(pagos) ? pagos.reduce((a, p) => a + (Number(p.monto_usd) || 0), 0) : 0);
  const tcUsado = Number(datos?.tipo_cambio) || (Array.isArray(pagos) && pagos[0]?.tipo_cambio ? Number(pagos[0].tipo_cambio) : 520);

  if (Array.isArray(pagos) && pagos.length > 1) {
    raw += `Metodo de Pago: PAGO MIXTO / COMBINADO\n`;
    pagos.forEach(p => {
      const nomP = limpiarTextoTermica(p.metodo || 'Pago');
      const mtoP = formatMontoTermica(p.monto);
      const usdDetalle = (p.metodo === 'Dolares' || p.metodo === 'Dólares' || Number(p.monto_usd) > 0)
        ? ` ($ ${(Number(p.monto_usd) || (Number(p.monto) / (Number(p.tipo_cambio) || 520))).toFixed(2)} USD)`
        : '';
      raw += `  * ${nomP}: ${mtoP}${usdDetalle}${p.referencia ? ` (Ref: ${limpiarTextoTermica(p.referencia)})` : ''}\n`;
    });
    if (vuelto > 0) {
      raw += `  * Vuelto / Cambio: ${formatMontoTermica(vuelto)}\n`;
    }
  } else if (esDolaresPago) {
    const finalUSD = montoUSDTotal > 0 ? montoUSDTotal : (montoRecibido > 0 && tcUsado > 0 ? Number((montoRecibido / tcUsado).toFixed(2)) : 0);
    raw += `Metodo de Pago: DOLARES ($ USD)\n`;
    raw += `Dolares Recibidos: $ ${finalUSD.toFixed(2)} (T.C: ${formatMontoTermica(tcUsado)})\n`;
    raw += `Equivalente en Colones: ${formatMontoTermica(montoRecibido)}\n`;
    if (vuelto > 0) {
      raw += `Vuelto / Cambio en Colones: ${formatMontoTermica(vuelto)}\n`;
    }
  } else {
    raw += `Metodo de Pago: ${limpiarTextoTermica(metodoPago || 'Efectivo')}\n`;
    if ((metodoPago === 'Efectivo' || !metodoPago) && montoRecibido > 0) {
      raw += `Monto Recibido: ${formatMontoTermica(montoRecibido)}\n`;
      raw += `Vuelto / Cambio: ${formatMontoTermica(vuelto)}\n`;
    }
  }

  raw += ESCPOS.ALIGN_CENTER;
  raw += '\n';
  raw += 'Muchas gracias por su preferencia!\n';
  raw += 'Esperamos servirle de nuevo muy pronto.\n';
  raw += 'Autorizado mediante resolucion DGT-R-033-2019\n';
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'cuenta_total',
    titulo: 'COMPROBANTE DE PAGO / FACTURA',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    ordenId,
    numeroOrden: numeroOrden || ordenId,
    mesa: mesaNumero,
    mesero,
    cliente: cliente || 'Cliente General',
    fechaHora: fechaStr,
    items: itemsNormalizados,
    subtotal: subNum,
    descuentoHH: descHHNum,
    servicio: servNum,
    iva: ivaNum,
    total: totNum,
    metodoPago: esDolaresPago ? 'Dólares' : (metodoPago || 'Efectivo'),
    recibido: montoRecibido,
    cambio: vuelto,
    monto_usd: montoUSDTotal > 0 ? montoUSDTotal : (esDolaresPago && tcUsado > 0 ? Number((montoRecibido / tcUsado).toFixed(2)) : 0),
    tipo_cambio: tcUsado,
    esDolares: esDolaresPago,
    pagos: Array.isArray(pagos) ? pagos : []
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Pre-Factura / Pre-Cuenta (Revisión de Consumos en Mesa)
 */
function generarTicketPreFactura(datos = {}, negocioOverride = null) {
  const {
    negocio = negocioOverride,
    ordenId,
    numeroOrden,
    mesaNumero = (datos.mesaNumero || datos.mesa),
    mesero,
    cliente,
    subtotal,
    descuentoHH,
    servicio,
    iva,
    total,
    items,
    fechaHora = new Date().toISOString(),
    es_para_llevar,
    tipo_orden
  } = datos;
  let fechaStr = fechaHora;
  if (fechaHora) {
    const d = new Date(fechaHora);
    if (!isNaN(d.getTime())) {
      fechaStr = d.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
    }
  }
  if (!fechaStr || fechaStr === 'Invalid Date') {
    fechaStr = new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  }
  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  const listaItems = Array.isArray(items) ? items : [];

  let subCalculado = 0;
  const itemsNormalizados = listaItems.map(it => {
    const cant = Number(it.cantidad) || 1;
    const unitPrice = Number(it.precio_unitario ?? it.precio ?? it.precioUnitario ?? (it.subtotal && cant ? it.subtotal / cant : (it.totalLinea && cant ? it.totalLinea / cant : 0))) || 0;
    const totalLinea = (it.totalLinea !== undefined && it.totalLinea !== null && Number(it.totalLinea) > 0)
      ? Number(it.totalLinea)
      : (it.subtotal !== undefined && it.subtotal !== null && Number(it.subtotal) > 0)
        ? Number(it.subtotal)
        : (unitPrice * cant);
    subCalculado += totalLinea;
    return {
      cantidad: cant,
      nombre: it.nombre_producto || it.nombre || it.descripcion || 'Producto',
      precioUnitario: unitPrice,
      totalLinea: totalLinea,
      notas: it.notas || ''
    };
  });

  const subNum = Math.round(Number(subtotal) || subCalculado || 0);
  const descHHNum = Math.round(Number(descuentoHH) || 0);
  const baseImponible = Math.max(0, subNum - descHHNum);
  const esParaLlevarTicket = Boolean(
    datos?.es_para_llevar ||
    datos?.tipo_orden === 'para_llevar' ||
    (typeof mesaNumero === 'string' && (mesaNumero.toLowerCase().includes('para llevar') || mesaNumero.toLowerCase().includes('llevar'))) ||
    (servicio !== undefined && servicio !== null && Number(servicio) === 0)
  );

  const tieneServicio10 = negocio ? negocioTieneCaracteristica(negocio, 'servicio_10') : true;
  const tieneIVA13 = negocio ? negocioTieneCaracteristica(negocio, 'desglose_iva_13') : true;

  let servNum = 0;
  if (tieneServicio10 && !esParaLlevarTicket) {
    if (servicio !== undefined && servicio !== null && !isNaN(Number(servicio))) {
      servNum = Math.max(0, Math.round(Number(servicio)));
    } else {
      servNum = Math.round(baseImponible * 0.10);
    }
  }

  let ivaNum = 0;
  if (tieneIVA13) {
    if (iva !== undefined && iva !== null && !isNaN(Number(iva))) {
      ivaNum = Math.max(0, Math.round(Number(iva)));
    } else {
      ivaNum = Math.round(baseImponible * 0.13);
    }
  }

  const totNum = (total !== undefined && total !== null && Number(total) > 0 && (!tieneServicio10 || servNum > 0) && (!tieneIVA13 || ivaNum > 0))
    ? Math.round(Number(total))
    : (baseImponible + servNum + ivaNum);
  const prop10 = Math.round(subNum * 0.10);
  const prop15 = Math.round(subNum * 0.15);

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `*** PRE-CUENTA / PRE-FACTURA ***\n`;
  raw += `[ REVISION DE CONSUMOS EN MESA ]\n` + ESCPOS.BOLD_OFF;
  raw += `* NO VALIDO COMO FACTURA FISCAL *\n`;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Pre-Factura / Orden: #${numeroOrden || ordenId || '001'}\n`;
  raw += `Mesa: ${limpiarTextoTermica(mesaNumero)} | Salonero: ${limpiarTextoTermica(mesero || 'Don Alberto')}\n`;
  raw += `Cliente: ${limpiarTextoTermica(cliente || 'Cliente General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('CANT  DESCRIPCION', 'PRECIO') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  itemsNormalizados.forEach(it => {
    const cantDesc = `${it.cantidad}x  ${limpiarTextoTermica(it.nombre)}`;
    raw += formatearLinea2Col(cantDesc, formatMontoTermica(it.totalLinea)) + '\n';
    if (it.notas) {
      raw += `   (${limpiarTextoTermica(it.notas)})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_RIGHT;
  raw += formatearLinea2Col('Subtotal (Base Imponible):', formatMontoTermica(subNum)) + '\n';
  if (descHHNum > 0) {
    raw += ESCPOS.BOLD_ON + formatearLinea2Col('Descuento Happy Hour 2x1:', `-${formatMontoTermica(descHHNum)}`) + '\n' + ESCPOS.BOLD_OFF;
  }
  if (servNum > 0 && tieneServicio10) {
    raw += formatearLinea2Col('10% Servicio (Ley):', formatMontoTermica(servNum)) + '\n';
  } else if (esParaLlevarTicket && tieneServicio10) {
    raw += formatearLinea2Col('Servicio (0% Para Llevar):', 'EXENTO') + '\n';
  }
  if (ivaNum > 0 && tieneIVA13) {
    raw += formatearLinea2Col('13% I.V.A.:', formatMontoTermica(ivaNum)) + '\n';
  }
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'TOTAL ESTIMADO:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(totNum)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_LEFT;
  raw += '='.repeat(48) + '\n';

  raw += ESCPOS.ALIGN_CENTER;
  raw += 'Firma / Aprobacion de Cuenta\n';
  raw += '-'.repeat(48) + '\n';
  raw += 'Comprobante preliminar para revision del cliente.\n';
  raw += ESCPOS.BOLD_ON + 'Muchas gracias por su preferencia!\n' + ESCPOS.BOLD_OFF;
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'prefactura',
    titulo: 'PRE-CUENTA / PRE-FACTURA',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    ordenId,
    numeroOrden: numeroOrden || ordenId,
    mesa: mesaNumero,
    mesero,
    cliente: cliente || 'Cliente General',
    fechaHora: fechaStr,
    items: itemsNormalizados,
    subtotal: subNum,
    descuentoHH: descHHNum,
    servicio: servNum,
    iva: ivaNum,
    total: totNum
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Comprobante de Pago Parcial (Split Bill)
 */
function generarTicketPagoParcial({ negocio, ordenId, mesaNumero, personaNombre, mesero, metodoPago, montoCobrado, subtotal, impuestos, itemsPagados, saldoRestanteMesa, fechaHora = new Date().toISOString() }) {
  let fechaStr = fechaHora;
  if (fechaHora) {
    const d = new Date(fechaHora);
    if (!isNaN(d.getTime())) {
      fechaStr = d.toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
    }
  }
  if (!fechaStr || fechaStr === 'Invalid Date') {
    fechaStr = new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  }
  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  const listaItems = Array.isArray(itemsPagados) ? itemsPagados : [];
  const itemsNormalizados = listaItems.map(it => {
    const cant = Number(it.cantidad) || 1;
    const unitP = Number(it.precio_unitario ?? it.precio ?? 0);
    const totL = (it.totalLinea !== undefined && it.totalLinea !== null && Number(it.totalLinea) > 0)
      ? Number(it.totalLinea)
      : (unitP * cant);
    return {
      cantidad: cant,
      nombre: it.nombre_producto || it.nombre || 'Consumo',
      precioUnitario: unitP,
      totalLinea: totL,
      notas: it.notas || ''
    };
  });

  const subNum = Math.round(Number(subtotal) || 0);
  const impNum = Math.round(Number(impuestos) || 0);
  const totNum = Math.round(Number(montoCobrado) || (subNum + impNum));
  const saldoRest = Math.round(Number(saldoRestanteMesa) || 0);

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `*** COMPROBANTE DE PAGO PARCIAL ***\n`;
  raw += `[ SPLIT BILL / CUENTA DIVIDIDA ]\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Factura / Orden: #${ordenId || '001'}\n`;
  raw += `Mesa: ${limpiarTextoTermica(mesaNumero)} - ${limpiarTextoTermica(personaNombre || 'CLIENTE').toUpperCase()}\n`;
  raw += `Salonero: ${limpiarTextoTermica(mesero || 'General')}\n`;
  raw += `Fecha/Hora: ${limpiarTextoTermica(fechaStr)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('CANT  DESCRIPCION', 'PRECIO') + '\n' + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';

  itemsNormalizados.forEach(it => {
    const cantDesc = `${it.cantidad}x  ${limpiarTextoTermica(it.nombre)}`;
    raw += formatearLinea2Col(cantDesc, formatMontoTermica(it.totalLinea)) + '\n';
    if (it.notas) {
      raw += `   (${limpiarTextoTermica(it.notas)})\n`;
    }
  });

  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_RIGHT;
  raw += formatearLinea2Col('Subtotal Consumo:', formatMontoTermica(subNum)) + '\n';
  raw += formatearLinea2Col('10% Serv + 13% IVA:', formatMontoTermica(impNum)) + '\n';
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'TOTAL PAGADO:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(totNum)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_LEFT;
  raw += '='.repeat(48) + '\n';

  raw += `Metodo de Pago: ${limpiarTextoTermica(metodoPago || 'Efectivo')}\n`;
  raw += `Saldo Pendiente en Mesa: ${formatMontoTermica(saldoRest)}\n`;
  raw += `Estado: Mesa permanece ABIERTA con consumos pendientes.\n`;
  raw += ESCPOS.ALIGN_CENTER;
  raw += '\n';
  raw += 'Muchas gracias por su preferencia!\n';
  raw += 'Autorizado mediante resolucion DGT-R-033-2019\n';
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'pago_parcial',
    titulo: 'PAGO PARCIAL INDIVIDUAL',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    ordenId,
    mesa: mesaNumero,
    personaNombre,
    mesero,
    fechaHora: fechaStr,
    items: itemsNormalizados,
    subtotal: subNum,
    impuestos: impNum,
    total: totNum,
    metodoPago: metodoPago || 'Efectivo',
    saldoRestanteMesa: saldoRest
  };

  return { raw, ticketVisual };
}
function generarTicketCorteX({ negocio, caja_id, cajero, fecha_apertura, fecha_corte, fondo_inicial, fondo_inicial_usd = 0, ventas = {}, total_entradas = 0, total_salidas = 0, efectivo_esperado, esperado_efectivo_crc, esperado_dolares_usd, esperado_dolares_crc, total_general_esperado_gaveta_crc, movimientos_detalle = [], tip_pool = [], total_propinas = 0 }) {
  const fApertura = fecha_apertura ? new Date(fecha_apertura).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : '-';
  const fCorte = fecha_corte ? new Date(fecha_corte).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });

  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `*** CORTE X (PARCIAL) ***\n`;
  raw += `[ AUDITORIA INFORMATIVA DE TURNO ]\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Turno / Caja: #${caja_id || 1} | Cajero: ${limpiarTextoTermica(cajero || 'Cajero')}\n`;
  raw += `Apertura: ${limpiarTextoTermica(fApertura)}\n`;
  raw += `Corte: ${limpiarTextoTermica(fCorte)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `DESGLOSE DE VENTAS\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('Ventas Efectivo:', formatMontoTermica(ventas.efectivo || 0)) + '\n';
  raw += formatearLinea2Col('Ventas Tarjeta:', formatMontoTermica(ventas.tarjeta || 0)) + '\n';
  raw += formatearLinea2Col('Ventas SINPE Movil:', formatMontoTermica(ventas.sinpe || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('Ventas Dolares ($ USD):', usdTxt) + '\n';
  }
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('TOTAL VENTAS:', formatMontoTermica(ventas.total || 0)) + '\n' + ESCPOS.BOLD_OFF;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `ARQUEO DE EFECTIVO EN GAVETA\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('(+) Fondo Inicial:', formatMontoTermica(fondo_inicial || 0)) + '\n';
  raw += formatearLinea2Col('(+) Ventas Efectivo:', formatMontoTermica(ventas.efectivo || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('(+) Ventas Dolares:', usdTxt) + '\n';
  }
  raw += formatearLinea2Col('(+) Entradas Efectivo:', `+${formatMontoTermica(total_entradas || 0)}`) + '\n';
  raw += formatearLinea2Col('(-) Salidas Menores:', `-${formatMontoTermica(total_salidas || 0)}`) + '\n';

  const espCRC = esperado_efectivo_crc !== undefined ? esperado_efectivo_crc : (efectivo_esperado || 0);
  const espUSD = esperado_dolares_usd !== undefined ? esperado_dolares_usd : (ventas.dolares_usd || 0);
  const espUSD_CRC = esperado_dolares_crc !== undefined ? esperado_dolares_crc : (ventas.dolares || 0);
  const totalGaveta = total_general_esperado_gaveta_crc !== undefined ? total_general_esperado_gaveta_crc : (espCRC + espUSD_CRC);

  if (espUSD > 0 || espUSD_CRC > 0) {
    raw += '='.repeat(48) + '\n';
    raw += formatearLinea2Col('Esperado en Colones:', formatMontoTermica(espCRC)) + '\n';
    raw += formatearLinea2Col('Esperado en Dolares:', `$${Number(espUSD).toFixed(2)} (${formatMontoTermica(espUSD_CRC)})`) + '\n';
    raw += '='.repeat(48) + '\n';
    raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'ESPERADO TOTAL GAVETA:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(totalGaveta)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.ALIGN_LEFT;
  } else {
    raw += '='.repeat(48) + '\n';
    raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'EFECTIVO ESPERADO:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(espCRC)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.ALIGN_LEFT;
  }

  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_CENTER;
  raw += `*** ESTADO: TURNO PERMANECE ABIERTO ***\n`;
  raw += `Corte informativo sin impacto en cierre contable\n`;
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'corte_x',
    titulo: 'CORTE X (PARCIAL)',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    caja_id,
    cajero,
    fecha_apertura,
    fecha_corte,
    fondo_inicial,
    fondo_inicial_usd: fondo_inicial_usd || 0,
    ventas,
    total_entradas,
    total_salidas,
    efectivo_esperado: espCRC,
    esperado_efectivo_crc: espCRC,
    esperado_dolares_usd: espUSD,
    esperado_dolares_crc: espUSD_CRC,
    total_general_esperado_gaveta_crc: totalGaveta,
    movimientos_detalle,
    tip_pool,
    total_propinas
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Comprobante Corte X a Ciegas (Arqueo Parcial con Conteo Ciego)
 */
function generarTicketCorteXCiego({
  negocio,
  caja_id,
  cajero,
  fecha_apertura,
  fecha_corte,
  fondo_inicial,
  fondo_inicial_usd = 0,
  ventas = {},
  total_entradas = 0,
  total_salidas = 0,
  efectivo_esperado = 0,
  esperado_efectivo_crc,
  esperado_dolares_usd,
  esperado_dolares_crc,
  total_general_esperado_gaveta_crc,
  efectivo_declarado = 0,
  diferencia_efectivo = 0,
  dolares_esperado_usd = 0,
  dolares_declarado_usd = 0,
  diferencia_dolares_usd = 0,
  tarjeta_declarada = 0,
  sinpe_declarado = 0,
  estado_cuadre = 'Cuadrado',
  notas = '',
  tip_pool = [],
  total_propinas = 0
}) {
  const fApertura = fecha_apertura ? new Date(fecha_apertura).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : '-';
  const fCorte = fecha_corte ? new Date(fecha_corte).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });

  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  const espCRC = esperado_efectivo_crc !== undefined ? esperado_efectivo_crc : (efectivo_esperado || 0);
  const espUSD = esperado_dolares_usd !== undefined ? esperado_dolares_usd : (dolares_esperado_usd || ventas.dolares_usd || 0);
  const espUSD_CRC = esperado_dolares_crc !== undefined ? esperado_dolares_crc : (ventas.dolares || 0);
  const totalGaveta = total_general_esperado_gaveta_crc !== undefined ? total_general_esperado_gaveta_crc : (espCRC + espUSD_CRC);

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `*** CORTE X A CIEGAS ***\n`;
  raw += `[ ARQUEO FISICO PARCIAL DE TURNO ]\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Turno / Caja: #${caja_id || 1} | Cajero: ${limpiarTextoTermica(cajero || 'Cajero')}\n`;
  raw += `Apertura: ${limpiarTextoTermica(fApertura)}\n`;
  raw += `Corte Ciego: ${limpiarTextoTermica(fCorte)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `RESULTADO DE ARQUEO A CIEGAS\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('Efectivo Declarado (Fisico):', formatMontoTermica(efectivo_declarado || 0)) + '\n';
  raw += formatearLinea2Col('Efectivo Esperado (Sistema):', formatMontoTermica(espCRC)) + '\n';
  const diffVal = Number(diferencia_efectivo) || 0;
  const diffTxt = diffVal === 0 ? '0 (CUADRADO)' : (diffVal > 0 ? `+${formatMontoTermica(diffVal)} (SOBRANTE)` : `-${formatMontoTermica(Math.abs(diffVal))} (FALTANTE)`);
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('DIFERENCIA EFECTIVO:', diffTxt) + '\n' + ESCPOS.BOLD_OFF;

  if (dolares_declarado_usd !== undefined && dolares_declarado_usd !== null && (Number(dolares_declarado_usd) > 0 || Number(espUSD) > 0)) {
    raw += '-'.repeat(48) + '\n';
    raw += formatearLinea2Col('Dolares Declarados ($):', `$${Number(dolares_declarado_usd).toFixed(2)}`) + '\n';
    raw += formatearLinea2Col('Dolares Esperados ($):', `$${Number(espUSD).toFixed(2)}`) + '\n';
    const diffDol = (Number(dolares_declarado_usd) || 0) - Number(espUSD);
    raw += formatearLinea2Col('Diferencia USD ($):', diffDol >= 0 ? `+$${diffDol.toFixed(2)}` : `-$${Math.abs(diffDol).toFixed(2)}`) + '\n';
  }

  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `DESGLOSE DE VENTAS EN SISTEMA\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('Ventas Efectivo:', formatMontoTermica(ventas.efectivo || 0)) + '\n';
  raw += formatearLinea2Col('Ventas Tarjeta:', formatMontoTermica(ventas.tarjeta || 0)) + '\n';
  raw += formatearLinea2Col('Ventas SINPE Movil:', formatMontoTermica(ventas.sinpe || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('Ventas Dolares ($ USD):', usdTxt) + '\n';
  }
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('TOTAL VENTAS:', formatMontoTermica(ventas.total || 0)) + '\n' + ESCPOS.BOLD_OFF;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `MOVIMIENTOS DE GAVETA\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('(+) Fondo Inicial:', formatMontoTermica(fondo_inicial || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('(+) Ventas Dolares:', usdTxt) + '\n';
  }
  raw += formatearLinea2Col('(+) Entradas Efectivo:', `+${formatMontoTermica(total_entradas || 0)}`) + '\n';
  raw += formatearLinea2Col('(-) Salidas Menores:', `-${formatMontoTermica(total_salidas || 0)}`) + '\n';

  if (espUSD > 0 || espUSD_CRC > 0) {
    raw += '='.repeat(48) + '\n';
    raw += formatearLinea2Col('Esperado en Colones:', formatMontoTermica(espCRC)) + '\n';
    raw += formatearLinea2Col('Esperado en Dolares:', `$${Number(espUSD).toFixed(2)} (${formatMontoTermica(espUSD_CRC)})`) + '\n';
    raw += '='.repeat(48) + '\n';
    raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'ESPERADO TOTAL GAVETA:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(totalGaveta)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
    raw += ESCPOS.ALIGN_LEFT;
  }

  if (notas) {
    raw += '-'.repeat(48) + '\n';
    raw += `Notas: ${limpiarTextoTermica(notas)}\n`;
  }
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_CENTER;
  raw += `*** ESTADO: TURNO PERMANECE ABIERTO ***\n`;
  raw += `Arqueo ciego registrado en bitacora de auditoria\n`;
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'corte_x_ciego',
    titulo: 'CORTE X A CIEGAS (ARQUEO PARCIAL)',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    caja_id,
    cajero,
    fecha_apertura,
    fecha_corte,
    fondo_inicial,
    fondo_inicial_usd: fondo_inicial_usd || 0,
    ventas,
    total_entradas,
    total_salidas,
    efectivo_esperado: espCRC,
    esperado_efectivo_crc: espCRC,
    esperado_dolares_usd: espUSD,
    esperado_dolares_crc: espUSD_CRC,
    total_general_esperado_gaveta_crc: totalGaveta,
    efectivo_declarado,
    diferencia_efectivo,
    dolares_esperado_usd: espUSD,
    dolares_declarado_usd,
    diferencia_dolares_usd,
    tarjeta_declarada,
    sinpe_declarado,
    estado_cuadre,
    notas,
    tip_pool,
    total_propinas
  };

  return { raw, ticketVisual };
}

/**
 * Generador de Comprobante Cierre Z (Liquidación Definitiva de Turno)
 */
function generarTicketCierreZ({
  negocio,
  caja_id,
  cajero,
  fecha_apertura,
  fecha_cierre,
  fondo_inicial,
  fondo_inicial_usd = 0,
  ventas = {},
  total_entradas = 0,
  total_salidas = 0,
  efectivo_esperado,
  esperado_efectivo_crc,
  esperado_dolares_usd,
  esperado_dolares_crc,
  total_general_esperado_gaveta_crc,
  efectivo_real_contado = 0,
  dolares_real_contado_usd = 0,
  diferencia = 0,
  estado_cuadre,
  notas,
  tip_pool = [],
  total_propinas = 0
}) {
  const fApertura = fecha_apertura ? new Date(fecha_apertura).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : '-';
  const fCierre = fecha_cierre ? new Date(fecha_cierre).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }) : new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });

  const negNombre = limpiarTextoTermica((negocio && negocio.nombre) || 'GastroBar Fuego & Brasas');
  const negSlogan = limpiarTextoTermica((negocio && negocio.slogan) || 'Restaurante, Bar & Lounge');
  const negTel = limpiarTextoTermica((negocio && negocio.telefono) || '2222-3344');
  const negDir = limpiarTextoTermica((negocio && negocio.direccion) || 'San Jose, Costa Rica');
  const negCed = limpiarTextoTermica((negocio && (negocio.cedula_juridica || negocio.cedula)) || '3-101-789458');

  const espCRC = esperado_efectivo_crc !== undefined ? esperado_efectivo_crc : (efectivo_esperado || 0);
  const espUSD = esperado_dolares_usd !== undefined ? esperado_dolares_usd : (ventas.dolares_usd || 0);
  const espUSD_CRC = esperado_dolares_crc !== undefined ? esperado_dolares_crc : (ventas.dolares || 0);
  const totalGaveta = total_general_esperado_gaveta_crc !== undefined ? total_general_esperado_gaveta_crc : (espCRC + espUSD_CRC);

  let raw = '';
  raw += ESCPOS.INIT + ESCPOS.FONT_A + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + `${negNombre}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += `${negSlogan}\n`;
  raw += `Tel: ${negTel}\n`;
  if (negDir) raw += `${negDir}\n`;
  if (negCed) raw += `Ced. Juridica: ${negCed}\n`;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `*** CIERRE Z (FINAL) ***\n`;
  raw += `[ LIQUIDACION OFICIAL DE TURNO ]\n` + ESCPOS.BOLD_OFF;
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Turno / Caja: #${caja_id || 1} | Cajero: ${limpiarTextoTermica(cajero || 'Cajero')}\n`;
  raw += `Apertura: ${limpiarTextoTermica(fApertura)}\n`;
  raw += `Cierre: ${limpiarTextoTermica(fCierre)}\n`;
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `VENTAS TOTALES DEL TURNO\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('Ventas Efectivo:', formatMontoTermica(ventas.efectivo || 0)) + '\n';
  raw += formatearLinea2Col('Ventas Tarjeta:', formatMontoTermica(ventas.tarjeta || 0)) + '\n';
  raw += formatearLinea2Col('Ventas SINPE Movil:', formatMontoTermica(ventas.sinpe || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('Ventas Dolares ($ USD):', usdTxt) + '\n';
  }
  raw += '-'.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + formatearLinea2Col('TOTAL FACTURADO:', formatMontoTermica(ventas.total || 0)) + '\n' + ESCPOS.BOLD_OFF;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.BOLD_ON + `ARQUEO FISICO Y CUADRE DE CAJA\n` + ESCPOS.BOLD_OFF;
  raw += '-'.repeat(48) + '\n';
  raw += formatearLinea2Col('(+) Fondo Inicial:', formatMontoTermica(fondo_inicial || 0)) + '\n';
  raw += formatearLinea2Col('(+) Ventas Efectivo:', formatMontoTermica(ventas.efectivo || 0)) + '\n';
  if ((ventas.dolares && ventas.dolares > 0) || (ventas.dolares_usd && ventas.dolares_usd > 0)) {
    const usdTxt = ventas.dolares_usd ? `$${ventas.dolares_usd.toFixed(2)} (${formatMontoTermica(ventas.dolares || 0)})` : formatMontoTermica(ventas.dolares || 0);
    raw += formatearLinea2Col('(+) Ventas Dolares:', usdTxt) + '\n';
  }
  raw += formatearLinea2Col('(+) Entradas Menores:', `+${formatMontoTermica(total_entradas || 0)}`) + '\n';
  raw += formatearLinea2Col('(-) Salidas Menores:', `-${formatMontoTermica(total_salidas || 0)}`) + '\n';

  if (espUSD > 0 || espUSD_CRC > 0) {
    raw += '='.repeat(48) + '\n';
    raw += formatearLinea2Col('Esperado en Colones:', formatMontoTermica(espCRC)) + '\n';
    raw += formatearLinea2Col('Esperado en Dolares:', `$${Number(espUSD).toFixed(2)} (${formatMontoTermica(espUSD_CRC)})`) + '\n';
    raw += formatearLinea2Col('ESPERADO TOTAL GAVETA:', formatMontoTermica(totalGaveta)) + '\n';
  } else {
    raw += formatearLinea2Col('EFECTIVO ESPERADO:', formatMontoTermica(espCRC)) + '\n';
  }

  raw += formatearLinea2Col('EFECTIVO CONTADO:', formatMontoTermica(efectivo_real_contado || 0)) + '\n';
  if (dolares_real_contado_usd > 0) {
    raw += formatearLinea2Col('DOLARES CONTADOS ($):', `$${Number(dolares_real_contado_usd).toFixed(2)}`) + '\n';
  }
  raw += formatearLinea2Col(`DIFERENCIA (${estado_cuadre || 'Cuadre'}):`, `${Number(diferencia) >= 0 ? '+' : ''}${formatMontoTermica(diferencia || 0)}`) + '\n';
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.DOUBLE_HEIGHT + ESCPOS.BOLD_ON + ESCPOS.ALIGN_LEFT + 'TOTAL LIQUIDADO:\n' + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.DOUBLE_BOTH + ESCPOS.BOLD_ON + ESCPOS.ALIGN_RIGHT + `${formatMontoTermica(efectivo_real_contado || 0)}\n` + ESCPOS.NORMAL + ESCPOS.DOUBLE_STRIKE_ON;
  raw += ESCPOS.ALIGN_LEFT;
  raw += '='.repeat(48) + '\n';
  raw += ESCPOS.ALIGN_CENTER;
  raw += '-'.repeat(48) + '\n';
  raw += 'Firma Cajero            Firma Administrador\n';
  raw += '-'.repeat(48) + '\n';
  raw += `*** TURNO OFICIALMENTE CERRADO ***\n`;
  raw += `Registro contable y fiscal guardado\n`;
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_FULL;

  const ticketVisual = {
    tipo: 'cierre_z',
    titulo: 'CIERRE Z (FINAL)',
    negocio: { nombre: negNombre, slogan: negSlogan, tel: negTel, dir: negDir, cedula: negCed },
    caja_id,
    cajero,
    fecha_apertura,
    fecha_cierre,
    fondo_inicial,
    fondo_inicial_usd: fondo_inicial_usd || 0,
    ventas,
    total_entradas,
    total_salidas,
    efectivo_esperado: espCRC,
    esperado_efectivo_crc: espCRC,
    esperado_dolares_usd: espUSD,
    esperado_dolares_crc: espUSD_CRC,
    total_general_esperado_gaveta_crc: totalGaveta,
    efectivo_real_contado,
    dolares_real_contado_usd,
    diferencia,
    estado_cuadre,
    total_propinas
  };

  return { raw, ticketVisual };
}

/**
 * Enviar buffer RAW a puerto TCP (impresora física o simulador local en red)
 */
function enviarAPuertoTCP(ip, puerto, rawData) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resuelto = false;

    const finalizar = (res) => {
      if (resuelto) return;
      resuelto = true;
      try { socket.destroy(); } catch (_) {}
      resolve(res);
    };

    socket.setTimeout(12000); // 12s para permitir despertar de reposo Wi-Fi/cable

    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, 'latin1');

    socket.connect(puerto, ip, () => {
      socket.setTimeout(0);
      socket.write(buf, () => {
        try { socket.end(); } catch (_) {}
        finalizar({ ok: true, mensaje: `Enviados ${buf.length} bytes a ${ip}:${puerto}` });
      });
    });

    socket.on('timeout', () => {
      finalizar({ ok: false, simulado: true, mensaje: `Timeout al conectar con ${ip}:${puerto} (Modo Simulación Activo)` });
    });

    socket.on('error', (err) => {
      finalizar({ ok: false, simulado: true, error: err.message, mensaje: `Error de conexión con ${ip}:${puerto}: ${err.message}` });
    });
  });
}

/**
 * Enviar buffer mediante Epson ePOS-Print (HTTP XML / SOAP)
 * Compatible con impresoras inteligentes Epson TM-T88VI, TM-T88VI-i, TM-m30, TM-T70II-i, etc.
 */
function enviarAePOSPrint(ip, rawData, timeoutMs = 7000) {
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
 * Despachador universal de red:
 * 1. Utiliza socket TCP directo al puerto 9100 estándar ESC/POS (ultrarrápido, ~4ms)
 * 2. Si la impresora requiere ePOS XML, utiliza fallback a ePOS-Print
 */
async function enviarAImpresoraRed(ip, puerto, rawData) {
  // 1. Intentar TCP 9100 primero (tiempo de respuesta inmediato < 10ms)
  const resTCP = await enviarAPuertoTCP(ip, puerto, rawData, 3500);
  if (resTCP.ok) {
    return resTCP;
  }

  // 2. Si no responde por TCP estándar, intentar Epson ePOS-Print
  const resEPOS = await enviarAePOSPrint(ip, rawData, 3000);
  if (resEPOS.ok) {
    return resEPOS;
  }

  return resTCP;
}

// Cola de impresión secuencial (FIFO) para evitar colisiones cuando se envían múltiples tickets a la misma IP
const colasImpresion = new Map();

function encolarEnvioTCP(ip, puerto, rawData) {
  const clave = `${ip}:${puerto}`;
  const colaActual = colasImpresion.get(clave) || Promise.resolve();

  const siguiente = colaActual
    .catch(() => {})
    .then(async () => {
      const res = await enviarAImpresoraRed(ip, puerto, rawData);
      // Breve pausa entre tickets para permitir el corte de papel y vaciado del buffer de la impresora
      await new Promise(resolve => setTimeout(resolve, 150));
      return res;
    });

  colasImpresion.set(clave, siguiente);
  return siguiente;
}

/**
 * Función principal para despachar impresión a la impresora configurada
 */
async function procesarImpresion({ destinoImpresora = 'caja', ticketInfo, io = null }) {
  if (!ticketInfo || !ticketInfo.ticketVisual || !ticketInfo.raw) {
    return { ok: false, error: 'Información de ticket no válida' };
  }

  // Si es comanda, verificar que contenga al menos 1 producto para este destino
  if (ticketInfo.ticketVisual.tipo === 'comanda') {
    const itemsComanda = ticketInfo.ticketVisual.items;
    if (!Array.isArray(itemsComanda) || itemsComanda.length === 0) {
      return { ok: false, error: `Comanda para ${destinoImpresora} no tiene productos, emisión omitida.` };
    }
  }

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

  // ⚡ EMITIR POR SOCKET.IO INMEDIATAMENTE (0ms delay)
  // Permite que el agente de impresión en tu laptop reciba y corte el ticket en < 10ms
  if (io) {
    io.emit('ticket_impreso', registro);
  }

  // Despacho directo: USB / Windows Spooler o TCP Red
  if (cfg.tipo === 'usb' || (!cfg.ip && process.platform === 'win32')) {
    const winPrinterName = cfg.windowsPrinter || cfg.nombre || 'POS-80-Series';
    try {
      const resWin = await sendRawToWindowsPrinter(winPrinterName, ticketInfo.raw);
      registro.estado = resWin.ok ? 'impreso' : 'simulado';
      registro.detalleConexion = resWin.mensaje || resWin.error || 'Enviado a Windows Spooler';
    } catch (err) {
      registro.estado = 'simulado';
      registro.detalleConexion = 'Error USB: ' + (err.message || err);
    }
  } else if (cfg.tipo === 'red' && cfg.ip && cfg.puerto) {
    try {
      const resTCP = await encolarEnvioTCP(cfg.ip, cfg.puerto, ticketInfo.raw);
      registro.estado = resTCP.ok ? 'impreso' : 'simulado';
      registro.detalleConexion = resTCP.mensaje || 'Enviado correctamente por Red TCP';
    } catch (err) {
      registro.estado = 'simulado';
      registro.detalleConexion = 'Error TCP: ' + (err.message || err);
    }
  } else {
    registro.estado = 'simulado';
    registro.detalleConexion = 'Simulacion virtual';
  }

  return registro;
}

/**
 * Auto-configuración Plug & Play de impresora térmica IP (Red TCP ESC/POS)
 * Prueba la conexión, envía ticket de bienvenida y guarda en memoria/perfil
 */
async function autoConfigurarImpresora({ ip, puerto = 9100, destino = 'caja', nombre = null, io = null }) {
  if (!ip || typeof ip !== 'string' || !ip.trim()) {
    throw new Error('Debes ingresar una dirección IP válida (ej: 192.168.1.30)');
  }
  let ipLimpia = ip.trim().replace(/^https?:\/\//i, '');
  let portNum = Number(puerto) || 9100;
  if (ipLimpia.includes(':')) {
    const partes = ipLimpia.split(':');
    ipLimpia = partes[0].trim();
    portNum = Number(partes[1]) || portNum;
  }
  const destinoLimpio = (destino || 'caja').toLowerCase();

  const regexIp = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!regexIp.test(ipLimpia) && ipLimpia !== 'localhost') {
    throw new Error('El formato de la dirección IP no es válido. Debe ser como: 192.168.1.30');
  }

  // 1. Construir ticket de bienvenida corto y calibración
  const areaNombres = {
    caja: 'CAJA (Cuentas y Facturas)',
    cocina: 'COCINA (Comandas de Alimentos)',
    barra: 'BARRA (Bebidas y Cocteles)'
  };
  const areaLabel = areaNombres[destinoLimpio] || `ÁREA ${destinoLimpio.toUpperCase()}`;
  const now = new Date();
  const fechaStr = now.toLocaleDateString('es-CR') + ' ' + now.toLocaleTimeString('es-CR');

  let raw = '';
  raw += ESCPOS.INIT;
  raw += ESCPOS.ALIGN_CENTER;
  raw += ESCPOS.DOUBLE_BOTH;
  raw += 'GAMMA POS\n';
  raw += ESCPOS.NORMAL;
  raw += ESCPOS.BOLD_ON;
  raw += 'VINCULACION EXITOSA (PLUG & PLAY)\n';
  raw += ESCPOS.BOLD_OFF;
  raw += '================================\n';
  raw += ESCPOS.ALIGN_LEFT;
  raw += `Destino : ${areaLabel}\n`;
  raw += `IP Red  : ${ipLimpia}:${portNum}\n`;
  raw += `Fecha   : ${fechaStr}\n`;
  raw += `Estado  : CONECTADA Y OPERATIVA\n`;
  raw += ESCPOS.ALIGN_CENTER;
  raw += '================================\n';
  raw += 'Impresora configurada con exito\npara despacho automatico.\n';
  raw += '================================\n';
  raw += ESCPOS.FEED_LINES(4);
  raw += ESCPOS.CUT_PARTIAL;

  // 2. Conectar y despachar el ticket en red (ePOS-Print o TCP 9100) con reintento automático
  let conexionOk = false;
  let ultimoError = '';

  for (let intento = 1; intento <= 2; intento++) {
    const intentoRes = await enviarAImpresoraRed(ipLimpia, portNum, raw);
    if (intentoRes.ok) {
      conexionOk = true;
      break;
    }

    ultimoError = intentoRes.error || intentoRes.mensaje || 'Error de conexión';
    if (intento < 2) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  if (!conexionOk) {
    throw new Error(`No se pudo conectar con la impresora en ${ipLimpia}:${portNum} (${ultimoError}). Verifica que la impresora esté encendida, con papel y conectada a la misma red Wi-Fi o cable.`);
  }

  // 4. Actualizar configuración en memoria
  const nombreFinal = nombre || `Impresora ${destinoLimpio.charAt(0).toUpperCase() + destinoLimpio.slice(1)}`;
  printerConfig[destinoLimpio] = {
    nombre: nombreFinal,
    tipo: 'red',
    ip: ipLimpia,
    puerto: portNum,
    windowsPrinter: printerConfig[destinoLimpio]?.windowsPrinter || 'POS-80-Series',
    activa: true
  };

  // 5. Registrar en bitácora
  const registro = {
    id: Date.now() + '-' + Math.floor(Math.random() * 1000),
    timestamp: now.toISOString(),
    destinoImpresora: destinoLimpio,
    impresoraNombre: nombreFinal,
    tipoTicket: 'Auto-Configuración',
    titulo: 'Vinculación Automática IP',
    mesa: areaLabel,
    bytes: Buffer.byteLength(raw),
    estado: 'impreso',
    detalleConexion: `Auto-configurada en ${ipLimpia}:${portNum}`,
    ticketVisual: {
      tipo: 'Auto-Configuración',
      titulo: 'Vinculación Automática IP',
      mesa: areaLabel,
      fechaHora: fechaStr,
      cliente: 'Administrador POS',
      items: [
        { nombre: `Área asignada: ${destinoLimpio.toUpperCase()}`, cantidad: 1, subtotal: 0 },
        { nombre: `Dirección IP: ${ipLimpia}:${portNum}`, cantidad: 1, subtotal: 0 },
        { nombre: 'Modo: Red TCP ESC/POS', cantidad: 1, subtotal: 0 }
      ],
      total: 0
    },
    rawBase64: Buffer.from(raw, 'binary').toString('base64'),
    rawText: raw,
    rawHexPreview: Buffer.from(raw).toString('hex').substring(0, 64) + '...'
  };

  historialImpresiones.unshift(registro);
  if (historialImpresiones.length > 50) historialImpresiones.pop();

  if (io) {
    io.emit('impresoras_config_actualizada', printerConfig);
    io.emit('ticket_impreso', registro);
  }

  return {
    ok: true,
    mensaje: `¡Impresora de ${destinoLimpio.toUpperCase()} auto-configurada con éxito en ${ipLimpia}:${portNum}!`,
    config: printerConfig[destinoLimpio],
    registro
  };
}

module.exports = {
  printerConfig,
  historialImpresiones,
  ESCPOS,
  generarTicketComanda,
  generarTicketLiquidacion,
  generarTicketPreFactura,
  generarTicketPagoParcial,
  generarTicketCorteX,
  generarTicketCorteXCiego,
  generarTicketCierreZ,
  enviarAPuertoTCP,
  sendRawToWindowsPrinter,
  getInstalledPrinters,
  procesarImpresion,
  autoConfigurarImpresora
};

