const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Tier 22: Control de Estado Único y Exclusividad de Modales en POS', async (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  await t.test('T22.1: Modales administrativos tienen clase modal-backdrop y display:none por defecto', () => {
    assert.ok(html.includes('id="modalCambioPasswordObligatorio"'));
    assert.ok(html.includes('id="modalPinMesaSalonero"'));
    assert.ok(html.includes('id="modalCambiarPinAutoservicio"'));

    const passModalMatch = html.match(/<div[^>]*id="modalCambioPasswordObligatorio"[^>]*>/);
    const pinModalMatch = html.match(/<div[^>]*id="modalPinMesaSalonero"[^>]*>/);
    const autoPinModalMatch = html.match(/<div[^>]*id="modalCambiarPinAutoservicio"[^>]*>/);

    assert.ok(passModalMatch && passModalMatch[0].includes('modal-backdrop'));
    assert.ok(passModalMatch[0].includes('display:none') || passModalMatch[0].includes('display: none'));

    assert.ok(pinModalMatch && pinModalMatch[0].includes('modal-backdrop'));
    assert.ok(pinModalMatch[0].includes('display:none') || pinModalMatch[0].includes('display: none'));

    assert.ok(autoPinModalMatch && autoPinModalMatch[0].includes('modal-backdrop'));
    assert.ok(autoPinModalMatch[0].includes('display:none') || autoPinModalMatch[0].includes('display: none'));
  });

  await t.test('T22.2: CSS define display:none y position:fixed para .modal y .modal-backdrop', () => {
    assert.ok(css.includes('.modal,') && css.includes('.modal-backdrop'));
    assert.ok(css.includes('.modal.active,') && css.includes('.modal-backdrop.active'));
    assert.ok(css.includes('display: flex !important;'));
  });

  await t.test('T22.3: Modal Manager centralizado implementado en app.js', () => {
    assert.ok(appJs.includes('window.cerrarTodosLosModales = function'));
    assert.ok(appJs.includes('window.abrirModalExclusivo = function'));
    assert.ok(appJs.includes('window._modalActivoId'));
  });

  await t.test('T22.4: abrirModalSeleccionBaldeNacional invoca cerrarTodosLosModales', () => {
    const fnMatch = appJs.match(/window\.abrirModalSeleccionBaldeNacional\s*=\s*function[\s\S]*?\{([\s\S]*?)\n\};/);
    assert.ok(fnMatch, 'abrirModalSeleccionBaldeNacional debe estar definida');
    assert.ok(fnMatch[1].includes('cerrarTodosLosModales'), 'Debe cerrar otros modales antes de abrir balde');
    assert.ok(fnMatch[1].includes("window._modalActivoId = 'modalSeleccionBaldeNacional'"));
  });

  await t.test('T22.5: Modales de PIN y Password gestionan _modalActivoId y exclusividad', () => {
    assert.ok(appJs.includes("window.cerrarTodosLosModales('modalPinMesaSalonero')"));
    assert.ok(appJs.includes("window.cerrarTodosLosModales('modalCambiarPinAutoservicio')"));
    assert.ok(appJs.includes("window.cerrarTodosLosModales('modalCambioPasswordObligatorio')"));
  });
});
