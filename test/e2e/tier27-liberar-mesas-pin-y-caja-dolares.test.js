const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 27: Liberación Condicional de Mesas con PIN y Desglose de Caja en Colones y Dólares', () => {
  let serverInstance;
  let baseUrl;

  const req = (endpoint, method = 'GET', body = null, headers = {}) => {
    return new Promise((resolve, reject) => {
      const u = new URL(endpoint, baseUrl);
      const opt = {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-negocio-id': '1',
          ...headers
        }
      };
      const r = http.request(opt, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, data, headers: res.headers, raw });
          } catch (e) {
            resolve({ status: res.statusCode, data: raw, headers: res.headers, raw });
          }
        });
      });
      r.on('error', reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  };

  before(async () => {
    delete require.cache[require.resolve('../../server.js')];
    delete require.cache[require.resolve('../../database.js')];
    const { server } = require('../../server.js');
    serverInstance = server;
    await new Promise((resolve) => {
      if (serverInstance.listening) {
        const addr = serverInstance.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        serverInstance.listen(0, '127.0.0.1', () => {
          const addr = serverInstance.address();
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }
    });
  });

  after(async () => {
    if (serverInstance && serverInstance.close) {
      await new Promise(r => serverInstance.close(r));
    }
  });

  it('T27.1: Mesero/Cajero puede liberar mesa con saldo ₡0 directamente sin PIN', async () => {
    // 1. Cobrar por completo una mesa con saldo 0
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      items: [{ id: 1, nombre: 'Bebida Test', precio: 2000, cantidad: 1, destino: 'barra' }],
      metodo: 'Efectivo',
      monto: 2000,
      liquidar_total: true,
      enviarCocina: false
    });
    assert.strictEqual(rCobro.status, 200);

    // 2. Liberar mesa con rol mesero y sin PIN
    const rLiberar = await req('/api/mesas/1/liberar', 'POST', { usuarioNombre: 'Salonero' }, { 'x-user-rol': 'mesero' });
    assert.strictEqual(rLiberar.status, 200, 'Debe permitir liberar mesa con saldo 0 sin requerir PIN');
    assert.ok(rLiberar.data.ok, 'Debe retornar ok: true');

    // 3. Verificar que la mesa 1 esté libre
    const rMesas = await req('/api/mesas');
    const mesa1 = rMesas.data.mesas.find(m => Number(m.id) === 1);
    assert.strictEqual(mesa1.estado, 'libre', 'La mesa 1 debe figurar en estado libre');
    assert.strictEqual(Number(mesa1.orden_total || 0), 0, 'El total de la mesa 1 debe ser 0');
  });

  it('T27.2: Liberar mesa con saldo pendiente rechaza sin PIN de Admin (403)', async () => {
    // 1. Abrir comanda en mesa 2 con consumo pendiente
    const rComanda = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      cliente: 'Cliente Mesa 2',
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
    });
    assert.strictEqual(rComanda.status, 200);

    // 2. Intentar liberar mesa como mesero sin PIN
    const rLiberarSinPin = await req('/api/mesas/2/liberar', 'POST', { usuarioNombre: 'Salonero' }, { 'x-user-rol': 'mesero' });
    assert.strictEqual(rLiberarSinPin.status, 403, 'Debe retornar 403 Forbidden cuando hay saldo pendiente y no hay PIN');
    assert.strictEqual(rLiberarSinPin.data.requierePin, true, 'Debe indicar requierePin: true');
    assert.ok(rLiberarSinPin.data.saldoPendiente > 0, 'Debe indicar el saldo pendiente');

    // 3. Verificar que la mesa 2 siga ocupada
    const rMesas = await req('/api/mesas');
    const mesa2 = rMesas.data.mesas.find(m => Number(m.id) === 2);
    assert.notStrictEqual(mesa2.estado, 'libre', 'La mesa 2 no debe haber sido liberada');
  });

  it('T27.3: Liberar mesa con saldo pendiente autorizada con PIN de Admin anula la orden y libera la mesa', async () => {
    // 1. Liberar mesa 2 enviando PIN de Admin
    const rLiberarConPin = await req('/api/mesas/2/liberar', 'POST', {
      pinAutorizado: '1234',
      usuarioNombre: 'Supervisor Admin'
    }, {
      'x-user-rol': 'mesero',
      'x-supervisor-pin': '1234'
    });
    assert.strictEqual(rLiberarConPin.status, 200, 'Debe retornar 200 OK con PIN válido');
    assert.ok(rLiberarConPin.data.ok, 'Debe retornar ok: true');
    assert.ok(rLiberarConPin.data.saldoAnulado > 0, 'Debe confirmar el saldo anulado');

    // 2. Verificar que la mesa 2 quedó libre
    const rMesas = await req('/api/mesas');
    const mesa2 = rMesas.data.mesas.find(m => Number(m.id) === 2);
    assert.strictEqual(mesa2.estado, 'libre', 'La mesa 2 debe haber quedado libre');
    assert.strictEqual(Number(mesa2.orden_total || 0), 0, 'El saldo de la mesa 2 debe ser 0');
  });

  it('T27.4: Caja calcula y desglosa Total Esperado en Colones, en Dólares y Total Gaveta', async () => {
    // 1. Abrir caja si no estuviese abierta
    await req('/api/caja/abrir', 'POST', { monto_inicial: 50000, cajero: 'Cajero Admin' });

    // 2. Cobro en dólares
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 3,
      items: [{ id: 1, nombre: 'Trago Especial', precio: 5200, cantidad: 1, destino: 'barra' }],
      metodo: 'Dólares',
      monto: 5200,
      monto_usd: 10,
      tipo_cambio: 520,
      liquidar_total: true,
      cajero: 'Cajero Admin'
    });
    assert.strictEqual(rCobro.status, 200);

    // 3. Consultar Corte X
    const rCorteX = await req('/api/caja/corte-x', 'GET', null, { 'x-supervisor-pin': '1234' });
    assert.strictEqual(rCorteX.status, 200);
    const cx = rCorteX.data;

    assert.ok(cx.esperado_efectivo_crc !== undefined, 'Debe incluir esperado_efectivo_crc');
    assert.ok(cx.esperado_dolares_usd !== undefined, 'Debe incluir esperado_dolares_usd');
    assert.ok(cx.esperado_dolares_crc !== undefined, 'Debe incluir esperado_dolares_crc');
    assert.ok(cx.total_general_esperado_gaveta_crc !== undefined, 'Debe incluir total_general_esperado_gaveta_crc');
    assert.strictEqual(
      cx.total_general_esperado_gaveta_crc,
      Math.round(cx.esperado_efectivo_crc + cx.esperado_dolares_crc),
      'El total general esperado debe ser la suma exacta de efectivo en colones más dólares convertidos'
    );
  });

  it('T27.5: Cierre Z con arqueo dual (Colones y Dólares) calcula cuadres y diferencias por moneda', async () => {
    const rCorteX = await req('/api/caja/corte-x', 'GET', null, { 'x-supervisor-pin': '1234' });
    const cx = rCorteX.data;

    const rCierreZ = await req('/api/caja/cierre-z', 'POST', {
      efectivo_real_contado_crc: cx.esperado_efectivo_crc,
      dolares_real_contado_usd: cx.esperado_dolares_usd,
      tipo_cambio: 520,
      adminPin: '1234',
      usuarioNombre: 'Cajero Cierre'
    });

    assert.strictEqual(rCierreZ.status, 200);
    const cz = rCierreZ.data;
    assert.strictEqual(cz.ok, true);
    assert.strictEqual(cz.diferencia_crc, 0, 'Diferencia en colones debe ser 0 al ingresar monto exacto');
    assert.strictEqual(cz.diferencia_usd, 0, 'Diferencia en dólares debe ser 0 al ingresar monto exacto');
    assert.strictEqual(cz.diferencia_total, 0, 'Diferencia total en gaveta debe ser 0');
    assert.strictEqual(cz.estado_cuadre, 'Cuadrada', 'El estado de cuadre debe ser Cuadrada');
  });
});
