const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Tier 41: Atajos de Teclado Rápidos (Hotkeys) POS', async (t) => {
  const rootDir = path.resolve(__dirname, '../..');
  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
  const publicAppJs = fs.readFileSync(path.join(rootDir, 'public/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const publicIndexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');

  await t.test('1. Frontend JS: Mapeo de atajos de función F8, F9, F10 y combinaciones', () => {
    [appJs, publicAppJs].forEach(js => {
      // F8: Enviar comanda
      assert.ok(js.includes("e.key === 'F8'"), 'Debe capturar tecla F8 para enviar comanda');
      assert.ok(js.includes('btnEnviarComandaCocina'), 'F8 debe accionar btnEnviarComandaCocina');

      // F9: Pre-factura
      assert.ok(js.includes("e.key === 'F9'"), 'Debe capturar tecla F9 para pre-factura');
      assert.ok(js.includes('solicitarPreFacturaMesa'), 'F9 debe invocar solicitarPreFacturaMesa');

      // F10: Cobrar cuenta
      assert.ok(js.includes("e.key === 'F10'"), 'Debe capturar tecla F10 para cobrar cuenta');
      assert.ok(js.includes('btnAbrirCobroModal'), 'F10 debe abrir modal de cobro');

      // Ctrl + D: Descuento / Cortesía con PIN
      assert.ok(js.includes("key === 'd' || e.key === 'D'"), 'Debe capturar Ctrl+D para abrir descuento');
      assert.ok(js.includes('abrirModalAplicarDescuento'), 'Ctrl+D debe abrir modal de descuento');

      // Ctrl + X: Corte X
      assert.ok(js.includes("key === 'x' || e.key === 'X'"), 'Debe capturar Ctrl+X para Corte X');
      assert.ok(js.includes('generarCorteX'), 'Ctrl+X debe invocar generarCorteX');

      // Ctrl + Z: Cierre Z
      assert.ok(js.includes("key === 'z' || e.key === 'Z'"), 'Debe capturar Ctrl+Z para Cierre Z');
      assert.ok(js.includes('abrirModalCierreZ'), 'Ctrl+Z debe invocar abrirModalCierreZ');

      // Escape: Cierre de modales y regreso al Salón
      assert.ok(js.includes("e.key === 'Escape'"), 'Debe manejar tecla Escape');
      assert.ok(js.includes('cerrarComandero'), 'Escape debe permitir cerrar comandero y regresar al salón');

      // Buscador rápido
      assert.ok(js.includes("e.key === '/'"), 'Debe permitir "/" para enfocar buscador rápido');
      assert.ok(js.includes("key === 'k' || e.key === 'K'"), 'Debe permitir Ctrl+K para enfocar buscador');
    });
  });

  await t.test('2. Frontend JS: Métodos de pago y liquidación en Modal de Cobro', () => {
    [appJs, publicAppJs].forEach(js => {
      assert.ok(js.includes('seleccionarMetodoCobro'), 'Debe existir función seleccionarMetodoCobro');
      assert.ok(js.includes("'Efectivo'"), 'Debe mapear tecla a Efectivo');
      assert.ok(js.includes("'Tarjeta'"), 'Debe mapear tecla a Tarjeta');
      assert.ok(js.includes("'SINPE'"), 'Debe mapear tecla a SINPE');
      assert.ok(js.includes('btnFinalizarCobro'), 'Enter en modal cobro debe accionar btnFinalizarCobro');
    });
  });

  await t.test('3. HTML: Badges visuales <kbd> en Comandero, Modal de Cobro y Caja', () => {
    [indexHtml, publicIndexHtml].forEach(html => {
      // Badges en comandero
      assert.ok(html.includes('>F8</kbd>'), 'Debe incluir badge visual F8 en Enviar Comanda');
      assert.ok(html.includes('>F9</kbd>'), 'Debe incluir badge visual F9 en Pre-Factura');
      assert.ok(html.includes('>F10</kbd>'), 'Debe incluir badge visual F10 en Cobrar');
      assert.ok(html.includes('>Ctrl+D</kbd>'), 'Debe incluir badge visual Ctrl+D en Descuento');

      // Badges en Modal Cobro
      assert.ok(html.includes('1 / E</kbd>'), 'Debe incluir badge 1/E en Efectivo');
      assert.ok(html.includes('2 / T</kbd>'), 'Debe incluir badge 2/T en Tarjeta');
      assert.ok(html.includes('3 / S</kbd>'), 'Debe incluir badge 3/S en SINPE');
      assert.ok(html.includes('>Enter</kbd>'), 'Debe incluir badge Enter en Liquidar');

      // Badges en Caja
      assert.ok(html.includes('>Ctrl+X</kbd>'), 'Debe incluir badge Ctrl+X en Corte X');
      assert.ok(html.includes('>Ctrl+Z</kbd>'), 'Debe incluir badge Ctrl+Z en Cierre Z');

      // Estilos CSS de kbd
      assert.ok(html.includes('.kbd-shortcut'), 'Debe incluir clase CSS .kbd-shortcut');
      assert.ok(html.includes('.kbd-sub-shortcut'), 'Debe incluir clase CSS .kbd-sub-shortcut');
    });
  });
});
