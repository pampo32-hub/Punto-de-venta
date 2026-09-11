const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const printerService = require('../../printerService');

describe('Tier 46: Impresion Directa Silenciosa a Impresora Termica (192.168.1.30:9100)', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const publicAppJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('T46.1: app.js y public/app.js implementan ejecutarImpresionDirectaTermica no bloqueante y con notificaciones toast', () => {
    [appJs, publicAppJs].forEach((code, idx) => {
      const target = idx === 0 ? 'app.js' : 'public/app.js';
      assert.ok(code.includes('window.ejecutarImpresionDirectaTermica = async function'), `${target} debe definir ejecutarImpresionDirectaTermica`);
      assert.ok(code.includes('/api/impresoras/imprimir-directo'), `${target} debe invocar /api/impresoras/imprimir-directo`);
      assert.ok(code.includes('despachado a impresora térmica'), `${target} debe notificar despacho a impresora térmica`);
      assert.ok(code.includes('La operación continuó con éxito'), `${target} debe garantizar resiliencia no bloqueante ante fallos de impresora`);
    });
  });

  it('T46.2: Pre-factura / Pre-cuenta muestra ticket en pantalla y despacha a impresion termica', () => {
    [appJs, publicAppJs].forEach((code, idx) => {
      const target = idx === 0 ? 'app.js' : 'public/app.js';
      const funcMatch = code.match(/window\.solicitarPreFacturaMesa\s*=\s*async\s*function[\s\S]*?catch\s*\(e\)/);
      assert.ok(funcMatch, `${target} debe contener window.solicitarPreFacturaMesa`);
      const body = funcMatch[0];
      assert.ok(body.includes('mostrarVisorTicketTermico(ticketGenerado, true)'), `${target} solicitarPreFacturaMesa debe abrir visor modal de ticket`);
    });
  });

  it('T46.3: Cobro y liquidacion final muestra factura en pantalla y despacha a termica', () => {
    [appJs, publicAppJs].forEach((code, idx) => {
      const target = idx === 0 ? 'app.js' : 'public/app.js';
      const funcMatch = code.match(/window\.ejecutarCobroFinal\s*=\s*async\s*function[\s\S]*?catch\s*\(e\)/);
      assert.ok(funcMatch, `${target} debe contener window.ejecutarCobroFinal`);
      const body = funcMatch[0];
      assert.ok(body.includes('mostrarVisorTicketTermico(tVisualFinal, true)'), `${target} ejecutarCobroFinal debe abrir visor modal de ticket`);
    });
  });

  it('T46.4: Cortes X y Cierre Z despachan directo a impresora termica', () => {
    [appJs, publicAppJs].forEach((code, idx) => {
      const target = idx === 0 ? 'app.js' : 'public/app.js';
      
      // Corte X estandar
      const corteXMatch = code.match(/window\.generarCorteX\s*=\s*async\s*function[\s\S]*?catch\s*\(e\)/);
      assert.ok(corteXMatch, `${target} debe contener window.generarCorteX`);
      assert.ok(corteXMatch[0].includes('window.ejecutarImpresionDirectaTermica(ticketData, false)'), `${target} generarCorteX debe llamar ejecutarImpresionDirectaTermica`);

      // Corte X ciego
      const ciegoMatch = code.match(/window\.procesarCorteXCiego\s*=\s*async\s*function[\s\S]*?catch\s*\(e\)/);
      assert.ok(ciegoMatch, `${target} debe contener window.procesarCorteXCiego`);
      assert.ok(ciegoMatch[0].includes('window.ejecutarImpresionDirectaTermica(data, false)'), `${target} procesarCorteXCiego debe llamar ejecutarImpresionDirectaTermica`);

      // Cierre Z
      const cierreZMatch = code.match(/window\.ejecutarCierreZ\s*=\s*async\s*function[\s\S]*?await\s*cargarCajaDesdeBackend/);
      assert.ok(cierreZMatch, `${target} debe contener window.ejecutarCierreZ`);
      assert.ok(cierreZMatch[0].includes('window.ejecutarImpresionDirectaTermica(ticketData, false)'), `${target} ejecutarCierreZ debe llamar ejecutarImpresionDirectaTermica`);
    });
  });

  it('T46.5: mostrarVisorTicketTermico despacha impresion termica en segundo plano y muestra modal en pantalla', () => {
    [appJs, publicAppJs].forEach((code, idx) => {
      const target = idx === 0 ? 'app.js' : 'public/app.js';
      const funcMatch = code.match(/window\.mostrarVisorTicketTermico\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)const modal/);
      assert.ok(funcMatch, `${target} debe contener window.mostrarVisorTicketTermico`);
      const body = funcMatch[2];
      assert.ok(body.includes('if (autoImprimir && typeof window.ejecutarImpresionDirectaTermica === \'function\')'), `${target} debe despachar autoImprimir a ejecutarImpresionDirectaTermica`);
      assert.ok(body.includes('ejecutarImpresionDirectaTermica(ticketData, false)'), `${target} debe despachar a ejecutarImpresionDirectaTermica`);
    });
  });

  it('T46.6: Backend server.js soporta conversion RAW ESC/POS para todos los tipos de ticket en /api/impresoras/imprimir-directo', () => {
    assert.ok(serverJs.includes("app.post('/api/impresoras/imprimir-directo'"), 'server.js debe tener endpoint POST /api/impresoras/imprimir-directo');
    assert.ok(serverJs.includes("ticketVisual.tipo === 'prefactura'"), 'server.js debe soportar tipo prefactura');
    assert.ok(serverJs.includes("ticketVisual.tipo === 'cierre_z'"), 'server.js debe soportar tipo cierre_z');
    assert.ok(serverJs.includes("ticketVisual.tipo === 'corte_x'"), 'server.js debe soportar tipo corte_x');
    assert.ok(serverJs.includes("ticketVisual.tipo === 'corte_x_ciego'"), 'server.js debe soportar tipo corte_x_ciego');
    assert.ok(serverJs.includes("ticketVisual.tipo === 'liquidacion'"), 'server.js debe soportar tipo liquidacion');
  });

  it('T46.7: printerService tiene timeout ampliado a 12000ms para compensar latencia de suspension WiFi en 192.168.1.30', () => {
    const printerServiceCode = fs.readFileSync(path.join(__dirname, '../../printerService.js'), 'utf8');
    assert.ok(printerServiceCode.includes('12000'), 'printerService debe usar timeout de 12000ms');
    assert.ok(printerServiceCode.includes('intento <= 2') || printerServiceCode.includes('retries'), 'printerService debe soportar reintento automatico');
    assert.ok(printerServiceCode.includes('1200'), 'printerService debe pausar 1.2s para cooldown del socket de la impresora');
  });
});
