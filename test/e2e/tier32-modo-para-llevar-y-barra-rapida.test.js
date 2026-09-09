const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 32: Modo Para Llevar / Barra Rápida (Exención 10% Servicio, KDS y Cobro sin Mesa)', () => {
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
            resolve({ status: res.statusCode, body: data, headers: res.headers, raw });
          } catch (e) {
            resolve({ status: res.statusCode, body: raw, headers: res.headers, raw });
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
        baseUrl = 'http://127.0.0.1:' + addr.port;
        resolve();
      } else {
        serverInstance.listen(0, '127.0.0.1', () => {
          const addr = serverInstance.address();
          baseUrl = 'http://127.0.0.1:' + addr.port;
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

  it('T32.1: Enviar comanda Para Llevar crea orden con 0% servicio y 13% IVA sin requerir mesa física', async () => {
    const itemCocina = { id: 8, nombre: 'Chifrijo Tradicional', precio: 5000, cantidad: 2, destino: 'cocina', curso: 3 };
    const resComanda = await req('/api/comandas/enviar', 'POST', {
      mesaId: 'para_llevar',
      mesero: 'Roberto Cajero',
      cliente: 'Carlos Express',
      tipo_orden: 'para_llevar',
      es_para_llevar: true,
      items: [itemCocina]
    });

    assert.strictEqual(resComanda.status, 200, 'Comanda Para Llevar debe responder 200 OK');
    assert.ok(resComanda.body.ordenId, 'Debe devolver un ordenId válido');
    assert.strictEqual(resComanda.body.es_para_llevar, true, 'Debe marcarse como es_para_llevar');
    assert.strictEqual(resComanda.body.total, 10000, 'Total debe ser 10,000');

    const resOrden = await req('/api/ordenes/' + resComanda.body.ordenId);
    assert.strictEqual(resOrden.status, 200);
    const ord = resOrden.body.orden;
    assert.strictEqual(ord.total, 10000);
    assert.strictEqual(ord.servicio_10, 0, 'Servicio del 10% debe ser 0 en órdenes para llevar');
    assert.strictEqual(ord.subtotal, 8850, 'Subtotal debe calcularse con base 1.13');
    assert.strictEqual(ord.iva_13, 1150, 'IVA debe ser el restante al subtotal');
  });

  it('T32.2: KDS muestra distintivo 🛍️ Para Llevar en comandas para llevar', async () => {
    const rKds = await req('/api/kds?destino=cocina');
    assert.strictEqual(rKds.status, 200);
    const items = Array.isArray(rKds.body) ? rKds.body : [];
    const itemParaLlevar = items.find(it => it.nombre_producto === 'Chifrijo Tradicional' && (it.tipo_orden === 'para_llevar' || it.es_para_llevar));
    assert.ok(itemParaLlevar, 'El item debe existir en la lista de KDS');
    assert.ok(itemParaLlevar.mesa_numero.includes('Para Llevar'), 'mesa_numero debe indicar Para Llevar, recibido: ' + itemParaLlevar.mesa_numero);
  });

  it('T32.3: Cobro directo Para Llevar aplica exención del 10% y emite liquidación sin afectar salón', async () => {
    const itemBarra = { id: 7, nombre: 'Gin Tonic Flor de Caña', precio: 3500, cantidad: 2, destino: 'barra', curso: 1 };
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 'para_llevar',
      cliente: 'Ana Takeout',
      metodo: 'Tarjeta',
      monto: 7000,
      liquidar_total: true,
      tipo_orden: 'para_llevar',
      es_para_llevar: true,
      items: [itemBarra]
    });

    assert.strictEqual(rCobro.status, 200, 'Cobro directo para llevar debe ser exitoso');
    assert.strictEqual(rCobro.body.ok, true);
    assert.ok(rCobro.body.ordenId, 'Debe devolver ID de orden');

    const resOrden = await req('/api/ordenes/' + rCobro.body.ordenId);
    assert.strictEqual(resOrden.status, 200);
    const ord = resOrden.body.orden;
    assert.strictEqual(ord.estado, 'pagada');
    assert.strictEqual(ord.total, 7000);
    assert.strictEqual(ord.servicio_10, 0, 'Servicio del 10% debe ser exactamente 0');
    assert.strictEqual(ord.subtotal, Math.round(7000 / 1.13));
    assert.strictEqual(ord.iva_13, 7000 - Math.round(7000 / 1.13));
  });

  it('T32.4: Las órdenes de salón normales siguen cobrando el 10% de servicio correctamente', async () => {
    await req('/api/mesas/3/liberar', 'POST', { pinAutorizado: '1234' }, { 'x-user-rol': 'admin', 'x-supervisor-pin': '1234' });
    const itemSalon = { id: 8, nombre: 'Chifrijo Tradicional', precio: 10000, cantidad: 1, destino: 'cocina', curso: 3 };
    const resComanda = await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      mesero: 'Carlos Salonero',
      cliente: 'Familia Perez',
      tipo_orden: 'mesa',
      items: [itemSalon]
    });

    assert.strictEqual(resComanda.status, 200);
    const resOrden = await req('/api/ordenes/' + resComanda.body.ordenId);
    const ord = resOrden.body.orden;
    assert.strictEqual(ord.total, 10000);
    assert.strictEqual(ord.subtotal, 8130);
    assert.strictEqual(ord.servicio_10, 813, 'En salón sí debe aplicar el 10% de servicio');
    assert.strictEqual(ord.iva_13, 1057);
  });
});