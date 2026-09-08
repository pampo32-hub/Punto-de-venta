const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 25: Registro Completo de Formas de Pago Oficiales y Cierre de Caja', () => {
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

  it('T25.1: Registro de pago en Efectivo con cambio y propina', async () => {
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      mesero: 'carlos',
      metodo: 'Efectivo',
      monto: 3600,
      recibido: 5000,
      cambio: 1400,
      propina: 360,
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(rCobro.status, 200);
    assert.equal(rCobro.body.ok, true);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.status, 200);
    assert.equal(rHist.body.totalCuentas, 1);
    assert.equal(rHist.body.pagosPorMetodo.efectivo, 3600);
  });

  it('T25.2: Registro de pago con Tarjeta / Datáfono y referencia', async () => {
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 2,
      mesero: 'juan',
      metodo: 'Tarjeta',
      monto: 4500,
      referencia: 'Visa Credomatic #4829',
      propina: 450,
      items: [
        { id: 22, nombre: 'Casado con pollo', precio: 4500, cantidad: 1, destino: 'cocina' }
      ]
    });
    assert.equal(rCobro.status, 200);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.body.pagosPorMetodo.tarjeta, 4500);
  });

  it('T25.3: Registro de pago con SINPE Móvil y comprobante', async () => {
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 3,
      mesero: 'sofia',
      metodo: 'SINPE',
      monto: 6500,
      referencia: 'SINPE-99281204',
      items: [
        { id: 21, nombre: 'Arroz con camarones', precio: 6500, cantidad: 1, destino: 'cocina' }
      ]
    });
    assert.equal(rCobro.status, 200);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.body.pagosPorMetodo.sinpe, 6500);
  });

  it('T25.4: Registro de pago en Dólares ($ USD) con tipo de cambio', async () => {
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 4,
      mesero: 'carlos',
      metodo: 'Dólares',
      monto: 5200,
      monto_usd: 10,
      tipo_cambio: 520,
      recibido: 10400,
      cambio: 5200,
      items: [
        { id: 25, nombre: 'Arroz con pollo', precio: 5000, cantidad: 1, destino: 'cocina' }
      ]
    });
    assert.equal(rCobro.status, 200);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.body.pagosPorMetodo.dolares, 5200);
    assert.ok(rHist.body.pagosPorMetodo.efectivo >= 5200);
  });

  it('T25.5: Registro de Pago Mixto desglosado en múltiples métodos (Efectivo + Tarjeta + SINPE + Dólares)', async () => {
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 6,
      mesero: 'carlos',
      metodo: 'Mixto',
      monto: 15200,
      pagos: [
        { metodo: 'Efectivo', monto: 5000 },
        { metodo: 'Tarjeta', monto: 3000, referencia: 'Auth #1234' },
        { metodo: 'SINPE', monto: 2000, referencia: 'SINPE #8888-8888' },
        { metodo: 'Dólares', monto: 5200, monto_usd: 10, tipo_cambio: 520 }
      ],
      items: [
        { id: 25, nombre: 'Arroz con pollo', precio: 5000, cantidad: 2, destino: 'cocina' },
        { id: 4, nombre: 'Michelada', precio: 2600, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(rCobro.status, 200);

    const rHist = await req('/api/admin/ventas/historial-hoy');
    assert.equal(rHist.body.pagosPorMetodo.efectivo, 10200); // 5000 colones + 5200 dolares
    assert.equal(rHist.body.pagosPorMetodo.tarjeta, 3000);
    assert.equal(rHist.body.pagosPorMetodo.sinpe, 2000);
    assert.equal(rHist.body.pagosPorMetodo.dolares, 5200);
  });

  it('T25.6: Cierre Z y Corte X cuadran con todos los métodos de pago registrados', async () => {
    await req('/api/caja/abrir', 'POST', { cajero: 'Cajero Principal', monto_inicial: 50000 });

    await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      metodo: 'Mixto',
      monto: 10000,
      pagos: [
        { metodo: 'Efectivo', monto: 6000 },
        { metodo: 'Tarjeta', monto: 4000, referencia: 'Voucher 9901' }
      ],
      items: [
        { id: 25, nombre: 'Arroz con pollo', precio: 5000, cantidad: 2, destino: 'cocina' }
      ]
    });

    await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 2,
      metodo: 'SINPE',
      monto: 3600,
      referencia: 'SINPE 5555-5555',
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }
      ]
    });

    const rCorte = await req('/api/caja/corte-x');
    assert.equal(rCorte.status, 200);
    assert.equal(rCorte.body.fondo_inicial, 50000);
    assert.equal(rCorte.body.ventas.efectivo, 6000);
    assert.equal(rCorte.body.ventas.tarjeta, 4000);
    assert.equal(rCorte.body.ventas.sinpe, 3600);
    assert.equal(rCorte.body.ventas.total, 13600);
    assert.equal(rCorte.body.efectivo_esperado, 56000);

    const rCierre = await req('/api/caja/cierre-z', 'POST', {
      efectivo_real_contado: 56000,
      usuarioNombre: 'Cajero Principal'
    });
    assert.equal(rCierre.status, 200);
    assert.equal(rCierre.body.ok, true);
    assert.equal(rCierre.body.estado_cuadre, 'Cuadrada');
    assert.equal(rCierre.body.diferencia, 0);
  });
});
