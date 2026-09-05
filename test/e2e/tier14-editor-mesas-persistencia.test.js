const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 14: Editor de Plano (Mesas) y Persistencia de Navegación tras F5 (2026)', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.stop();
  });

  beforeEach(async () => {
    await server.resetDb();
  });

  function req(endpoint, method = 'GET', body = null, headers = { 'x-user-rol': 'admin' }) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T14.1: CSS contiene z-index: 100000 para .modal-backdrop y estilos dedicados para #modalCapacidadMesa', () => {
    const cssContent = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

    assert.match(cssContent, /\.modal-backdrop\s*\{[^}]*z-index:\s*100000;/s, 'modal-backdrop debe tener z-index: 100000');
    assert.ok(cssContent.includes('#modalCapacidadMesa'), 'Debe incluir estilos para #modalCapacidadMesa');
    assert.ok(cssContent.includes('.btn-cap-step'), 'Debe estilizar botones del stepper');
    assert.ok(cssContent.includes('.input-cap-display'), 'Debe estilizar display numérico de capacidad');
  });

  it('T14.2: index.html incluye los modales estilizados para renombrar y cambiar capacidad', () => {
    const htmlContent = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');

    assert.ok(htmlContent.includes('id="modalRenombrarMesa"'), 'Debe existir #modalRenombrarMesa');
    assert.ok(htmlContent.includes('id="modalCapacidadMesa"'), 'Debe existir #modalCapacidadMesa');
    assert.ok(htmlContent.includes('guardarNuevoNombreMesa()'), 'Debe invocar guardarNuevoNombreMesa()');
    assert.ok(htmlContent.includes('guardarCapacidadMesa()'), 'Debe invocar guardarCapacidadMesa()');
  });

  it('T14.3: app.js almacena y restaura pos_active_view y pos_active_zone en sessionStorage', () => {
    const appJsContent = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

    assert.ok(appJsContent.includes("sessionStorage.setItem('pos_active_view'"), 'Debe persistir pos_active_view');
    assert.ok(appJsContent.includes("sessionStorage.setItem('pos_active_zone'"), 'Debe persistir pos_active_zone');
    assert.ok(appJsContent.includes("sessionStorage.getItem('pos_active_view')"), 'Debe restaurar pos_active_view');
    assert.ok(appJsContent.includes("sessionStorage.getItem('pos_active_zone')"), 'Debe restaurar pos_active_zone');
    assert.ok(appJsContent.includes('.mesa-nombre-label'), 'Debe ignorar click en etiqueta de nombre para evitar drag');
    assert.ok(appJsContent.includes('.mesa-cap-label'), 'Debe ignorar click en etiqueta de capacidad para evitar drag');
  });

  it('T14.4: Renombrar mesa mediante PUT /api/mesas/:id actualiza el número/nombre en la BD', async () => {
    const resMesas = await req('/api/mesas');
    const mesa1 = resMesas.body.mesas.find(m => m.id === 1);
    assert.ok(mesa1, 'Mesa 1 debe existir');

    const nuevoNombre = 'Terraza VIP 01';
    const resRename = await req(`/api/mesas/${mesa1.id}`, 'PUT', {
      nombre: nuevoNombre,
      zona: mesa1.zona
    }, { 'x-user-rol': 'admin' });
    assert.equal(resRename.status, 200);

    const resVerif = await req('/api/mesas');
    const mesaActualizada = resVerif.body.mesas.find(m => m.id === 1);
    assert.equal(mesaActualizada.numero, nuevoNombre);
  });

  it('T14.5: Actualizar capacidad de mesa mediante PUT /api/mesas/:id/capacidad persiste el nuevo valor', async () => {
    const nuevaCapacidad = 8;
    const resCap = await req('/api/mesas/1/capacidad', 'PUT', {
      capacidad: nuevaCapacidad
    }, { 'x-user-rol': 'admin' });
    assert.equal(resCap.status, 200);

    const resVerif = await req('/api/mesas');
    const mesa1 = resVerif.body.mesas.find(m => m.id === 1);
    assert.equal(mesa1.capacidad, nuevaCapacidad);
  });

  it('T14.6: Eliminar mesa libre funciona, pero mesa con comanda activa se protege', async () => {
    const resCreate = await req('/api/mesas/crear', 'POST', {
      numero: 'Mesa Temporal Test',
      zona_id: 1,
      forma: 'cuadrada',
      capacidad: 4
    }, { 'x-user-rol': 'admin' });
    assert.equal(resCreate.status, 200);
    const mesaCreada = resCreate.body.mesa || resCreate.body;
    const mesaId = mesaCreada.id;
    assert.ok(mesaId, 'Mesa debe tener ID generado');

    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: mesaId,
      mesero: 'Carlos',
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 1, destino: 'barra' }]
    });
    assert.equal(resCmd.status, 200);

    const resDeleteFail = await req(`/api/mesas/${mesaId}`, 'DELETE', null, { 'x-user-rol': 'admin' });
    assert.equal(resDeleteFail.status, 400);
    assert.match(resDeleteFail.body.error, /cuenta activa|no se puede eliminar/i);

    const resReset = await req(`/api/mesas/${mesaId}/reset`, 'POST', {}, { 'x-user-rol': 'admin' });
    assert.equal(resReset.status, 200);

    const resDeleteOk = await req(`/api/mesas/${mesaId}`, 'DELETE', null, { 'x-user-rol': 'admin' });
    assert.equal(resDeleteOk.status, 200);

    const resFinal = await req('/api/mesas');
    const existe = resFinal.body.mesas.some(m => m.id === mesaId);
    assert.equal(existe, false, 'La mesa eliminada ya no debe existir en /api/mesas');
  });
});
