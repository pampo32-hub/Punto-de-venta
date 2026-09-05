const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 10: Mesa Emergency Reset & Force Delete Protection', () => {
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

  it('T10.1: POST /api/mesas/:id/reset requires admin or developer role', async () => {
    const resMesa = await req('/api/mesas');
    assert.equal(resMesa.status, 200);
    const mesas = resMesa.body.mesas || resMesa.body;
    const mesa = mesas[0];
    assert.ok(mesa, 'Debe existir al menos una mesa');

    // Salonero no debe tener permiso (403)
    const resSalonero = await req(`/api/mesas/${mesa.id}/reset`, 'POST', {}, { 'x-user-rol': 'salonero' });
    assert.equal(resSalonero.status, 403);
    assert.match(resSalonero.body.error, /Requiere permisos de Administrador/);

    // Admin sí tiene permiso
    const resAdmin = await req(`/api/mesas/${mesa.id}/reset`, 'POST', {}, { 'x-user-rol': 'admin' });
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.body.success, true);
  });

  it('T10.2: Resetting a stuck table cancels active orders, annuls items, and frees the table', async () => {
    // 1. Crear una orden activa en mesa 1
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [
        { id: 1, cantidad: 2, precio: 2000, nombre: 'Imperial Regular', curso: 1, destino: 'barra' }
      ]
    });
    assert.equal(resCmd.status, 200);
    const ordenId = resCmd.body.ordenId;
    assert.ok(ordenId);

    // Verificar que mesa 1 está ocupada/esperando
    const resMesaAntes = await req('/api/cliente/mesa/1');
    assert.notEqual(resMesaAntes.body.mesa.estado, 'libre');

    // 2. Ejecutar reset de emergencia
    const resReset = await req('/api/mesas/1/reset', 'POST', {}, { 'x-user-rol': 'admin' });
    assert.equal(resReset.status, 200);
    assert.equal(resReset.body.success, true);
    assert.ok(resReset.body.ordenesCanceladas >= 1);

    // 3. Verificar estado de la mesa restaurada a 'libre'
    const resMesaDespues = await req('/api/cliente/mesa/1');
    assert.equal(resMesaDespues.body.mesa.estado, 'libre');
    assert.equal(resMesaDespues.body.orden, null);

    // 4. Verificar orden cancelada en base de datos
    const ordenDb = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenDb.estado, 'cancelada');
    assert.ok(ordenDb.notas && ordenDb.notas.includes('[Reset forzado por Admin/Dev]'));

    // 5. Verificar items anulados
    const itemsDb = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    for (const itm of itemsDb) {
      assert.equal(itm.estado_comanda, 'anulado');
    }
  });

  it('T10.3: DELETE /api/mesas/:id blocks deletion if open account exists and returns tiene_cuenta: true', async () => {
    // Crear comanda en mesa 2
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      items: [
        { id: 8, cantidad: 1, precio: 5500, nombre: 'Chifrijo', curso: 2, destino: 'cocina' }
      ]
    });

    // Intentar borrar sin forzar
    const resDel = await req('/api/mesas/2', 'DELETE', null, { 'x-user-rol': 'admin' });
    assert.equal(resDel.status, 400);
    assert.equal(resDel.body.tiene_cuenta, true);
    assert.match(resDel.body.error, /cuenta activa/);

    // La mesa sigue existiendo
    const mesaCheck = await server.dbGet('SELECT * FROM Mesas WHERE id = 2');
    assert.ok(mesaCheck, 'La mesa no debe haber sido eliminada');
  });

  it('T10.4: DELETE /api/mesas/:id?forzar=true allows admin to force-delete table and cancels pending order', async () => {
    // Crear comanda en mesa 3
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      items: [
        { id: 1, cantidad: 1, precio: 2000, nombre: 'Imperial', curso: 1, destino: 'barra' }
      ]
    });
    const ordenId = resCmd.body.ordenId;

    // Intentar forzar eliminación siendo salonero (no debe permitir cancelación forzada)
    const resDelSal = await req('/api/mesas/3?forzar=true', 'DELETE', null, { 'x-user-rol': 'salonero' });
    assert.equal(resDelSal.status, 400);

    // Forzar eliminación como admin
    const resDelAdmin = await req('/api/mesas/3?forzar=true', 'DELETE', null, { 'x-user-rol': 'admin' });
    assert.equal(resDelAdmin.status, 200);

    // Mesa eliminada
    const mesaCheck = await server.dbGet('SELECT * FROM Mesas WHERE id = 3');
    assert.equal(mesaCheck, undefined);

    // Orden fue cancelada con auditoría
    const ordenDb = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenDb.estado, 'cancelada');
    assert.ok(ordenDb.notas && ordenDb.notas.includes('[Cancelada por eliminación forzada de mesa]'));
  });
});
