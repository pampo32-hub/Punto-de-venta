const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 11: Happy Hour Permanence & Strict vs Flexible Mode 2026', () => {
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

  it('T11.1: Happy Hour discount remains permanently applied on open orders even after HH ends', async () => {
    // 1. Activar Happy Hour en el servidor
    const resHHActivar = await req('/api/happy-hour', 'POST', { activo: true, horaInicio: '00:00', horaFin: '23:59' });
    assert.equal(resHHActivar.status, 200);
    assert.equal(resHHActivar.body.activo, true);

    // 2. Enviar comanda con 2 cervezas Imperial (precio 2000 c/u) a Mesa 1
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(resCmd.status, 200);
    const ordenId = resCmd.body.ordenId;
    assert.ok(ordenId);

    // Verificar que en DetalleOrden se guardó con en_happy_hour = 1
    const itemsDb = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    assert.equal(itemsDb.length, 1);
    assert.equal(itemsDb[0].en_happy_hour, 1);

    // Verificar descuento en BD
    const ordenAntes = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenAntes.descuento_happy_hour, 2000);
    const totalConHH = ordenAntes.total;

    // 3. Apagar Happy Hour (simulando fin de horario)
    const resHHDesactivar = await req('/api/happy-hour', 'POST', { activo: false });
    assert.equal(resHHDesactivar.status, 200);
    assert.equal(resHHDesactivar.body.activo, false);

    // 4. Consultar la orden abierta con HH apagado: el descuento NO debe perderse
    const resMesa = await req('/api/cliente/mesa/1');
    assert.equal(resMesa.status, 200);
    assert.ok(resMesa.body.orden);
    assert.equal(resMesa.body.orden.descuento_happy_hour, 2000);
    assert.equal(resMesa.body.orden.total, totalConHH);
  });

  it('T11.2: Drinks ordered after Happy Hour ends are billed at regular price without affecting existing HH discount', async () => {
    // 1. Activar HH y pedir 2 cervezas Imperial en Mesa 1
    await req('/api/happy-hour', 'POST', { activo: true });
    const resCmd1 = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra' }
      ]
    });
    const ordenId = resCmd1.body.ordenId;

    // 2. Apagar Happy Hour
    await req('/api/happy-hour', 'POST', { activo: false });

    // 3. Agregar 2 cervezas Imperial adicionales post-HH a la misma mesa
    const resCmd2 = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra', en_happy_hour: 0 }
      ]
    });
    assert.equal(resCmd2.status, 200);

    // 4. Verificar que existen 2 registros en DetalleOrden: uno con en_happy_hour=1 y otro con en_happy_hour=0
    const itemsDb = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenId]);
    assert.equal(itemsDb.length, 2);
    assert.equal(itemsDb[0].en_happy_hour, 1);
    assert.equal(itemsDb[1].en_happy_hour, 0);

    // 5. El descuento Happy Hour debe seguir siendo exactamente 2000 (1 cerveza gratis de las 2 de HH, las 2 nuevas a precio normal)
    const ordenDb = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenDb.total, 6000); // 4 cervezas a 2000 menos 2000 de HH = 6000 final
    assert.equal(ordenDb.subtotal, Math.round(6000 / 1.23));
    assert.equal(ordenDb.descuento_happy_hour, 2000);
  });

  it('T11.3: Odd quantity pairing: Strict mode (default) vs Flexible mode with role security', async () => {
    // 1. Pedir 1 cerveza durante HH
    await req('/api/happy-hour', 'POST', { activo: true });
    const resCmd1 = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 1, destino: 'barra' }]
    });
    const ordenId = resCmd1.body.ordenId;

    // 2. Apagar HH y pedir 1 cerveza post-HH
    await req('/api/happy-hour', 'POST', { activo: false });
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 1, destino: 'barra', en_happy_hour: 0 }]
    });

    // En Modo Estricto (por defecto): Descuento es 0 porque solo hay 1 cerveza en HH
    const ordenEstricta = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenEstricta.modo_happy_hour, 'estricto');
    assert.equal(ordenEstricta.descuento_happy_hour, 0);

    // 3. Seguridad de roles: Salonero no puede cambiar a Flexible (403)
    const resSal = await req(`/api/ordenes/${ordenId}/modo-happy-hour`, 'PUT', { modo: 'flexible' }, { 'x-user-rol': 'salonero' });
    assert.equal(resSal.status, 403);
    assert.match(resSal.body.error, /Requiere permisos de Administrador o Cajero/);

    // 4. Cajero o Admin sí pueden cambiar a Flexible (200)
    const resCaj = await req(`/api/ordenes/${ordenId}/modo-happy-hour`, 'PUT', { modo: 'flexible' }, { 'x-user-rol': 'cajero' });
    assert.equal(resCaj.status, 200);
    assert.equal(resCaj.body.modo, 'flexible');
    // En modo flexible, la cerveza post-HH completa el par impar de HH -> descuento 2000
    assert.equal(resCaj.body.descuentoHH, 2000);

    const ordenFlexible = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenFlexible.modo_happy_hour, 'flexible');
    assert.equal(ordenFlexible.descuento_happy_hour, 2000);
  });

  it('T11.4: Payment finalization preserves Happy Hour discount in billing and receipts when HH is inactive', async () => {
    // 1. Activar HH, ordenar 2 cervezas y apagar HH
    await req('/api/happy-hour', 'POST', { activo: true });
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra' }]
    });
    const ordenId = resCmd.body.ordenId;
    await req('/api/happy-hour', 'POST', { activo: false });

    // 2. Cobrar la orden con Happy Hour apagado
    const ordenDb = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    const resPago = await req(`/api/ordenes/${ordenId}/cobrar`, 'POST', {
      metodo: 'Efectivo',
      monto: ordenDb.total,
      cambio: 0
    });

    assert.equal(resPago.status, 200);
    assert.equal(resPago.body.descuentoHH, 2000);

    // 3. Verificar estado pagada y descuento preservado en BD
    const ordenPagada = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.equal(ordenPagada.estado, 'pagada');
    assert.equal(ordenPagada.descuento_happy_hour, 2000);
  });
});

