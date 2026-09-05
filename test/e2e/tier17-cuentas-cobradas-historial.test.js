const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 17: Historial de Cuentas Cobradas Hoy y Alertas de Stock Crítico', () => {
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

  it('T17.1: Seguridad: Rechaza acceso a saloneros (403) y permite a admin y dev', async () => {
    const rDenied = await req('/api/admin/ventas/historial-hoy', 'GET', null, { 'x-user-rol': 'salonero' });
    assert.equal(rDenied.status, 403);

    const rOk = await req('/api/admin/ventas/historial-hoy', 'GET', null, { 'x-user-rol': 'admin' });
    assert.equal(rOk.status, 200);
    assert.equal(rOk.body.ok, true);
    assert.ok(Array.isArray(rOk.body.ordenes));
  });

  it('T17.2: Desglose completo de órdenes cobradas hoy con métodos, totales y platillos', async () => {
    const rCobro1 = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      mesero: 'carlos',
      metodo: 'Efectivo',
      metodoPago: 'Efectivo',
      propina: 500,
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(rCobro1.status, 200);

    const rCobro2 = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 2,
      mesero: 'cajero',
      metodo: 'Tarjeta',
      metodoPago: 'Tarjeta',
      propina: 1000,
      items: [
        { id: 2, nombre: 'Pilsen Regular', precio: 1800, cantidad: 1, destino: 'barra' },
        { id: 5, nombre: 'Casado con Carne', precio: 4500, cantidad: 1, destino: 'cocina' }
      ]
    });
    assert.equal(rCobro2.status, 200);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.status, 200);
    assert.equal(rHist.body.ok, true);
    assert.equal(rHist.body.totalCuentas, 2);
    assert.ok(rHist.body.totalVentas > 0);
    assert.equal(rHist.body.totalPropinas, 1500);
    assert.ok(rHist.body.pagosPorMetodo.efectivo > 0);
    assert.ok(rHist.body.pagosPorMetodo.tarjeta > 0);

    const ordCasado = rHist.body.ordenes.find(o => Number(o.mesa_id) === 2);
    assert.ok(ordCasado, 'Debe existir la orden de mesa 2');
    assert.equal(ordCasado.items.length, 2);
    assert.ok(ordCasado.items.some(it => it.nombre_producto === 'Casado con Carne'));
  });
});
