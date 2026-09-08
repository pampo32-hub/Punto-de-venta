const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');

describe('Tier 26: Cobro Anticipado con KDS, Protección Doble Cobro y Rótulos de Caja', () => {
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

  it('T26.1: Cobro anticipado con envío a cocina mantiene la mesa ocupada/esperando con saldo en 0', async () => {
    try {
      const itemCocina = { id: 7, nombre: 'Corte Rib Eye Prime 350g', precio: 5200, cantidad: 1, destino: 'cocina', curso: 3 };
      
      const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
        mesaId: 2,
        items: [itemCocina],
        metodo: 'Efectivo',
        monto: 5200,
        liquidar_total: true,
        enviarCocina: true,
        enviar_cocina: true
      });

      assert.strictEqual(rCobro.status, 200, 'Cobro directo debe ser exitoso');
      assert.ok(rCobro.body.ordenId, 'Debe devolver ID de orden');
      const ordenId = rCobro.body.ordenId;

      const rMesas = await req('/api/mesas');
      const listaMesas = rMesas.body.mesas || rMesas.body;
      const mesa2 = listaMesas.find(m => Number(m.id) === 2);
      assert.ok(mesa2, 'Mesa 2 debe existir');
      console.log('DEBUG Mesa 2 tras cobro:', { estado: mesa2.estado, orden_total: mesa2.orden_total });
      
      assert.ok(mesa2.estado === 'esperando' || mesa2.estado === 'ocupada', `Estado de mesa debe ser esperando u ocupada, recibido: ${mesa2.estado}`);
      assert.strictEqual(Number(mesa2.orden_total || 0), 0, 'El saldo pendiente de la mesa debe ser 0');

      const rKds = await req('/api/kds?destino=cocina');
      const itemsKds = Array.isArray(rKds.body) ? rKds.body.filter(it => it.orden_id === ordenId) : [];
      console.log('DEBUG items KDS:', itemsKds.length);
      assert.ok(itemsKds.length > 0, 'Debe haber ítems en KDS para esta orden');

      const detalleId = itemsKds[0].id;
      const rDespacho = await req('/api/kds/despachar-lote', 'POST', {
        itemIds: [detalleId],
        estado: 'listo'
      });
      assert.strictEqual(rDespacho.status, 200);

      const rMesasPost = await req('/api/mesas');
      const listaMesasPost = rMesasPost.body.mesas || rMesasPost.body;
      const mesa2Post = listaMesasPost.find(m => Number(m.id) === 2);
      console.log('DEBUG Mesa 2 post despacho:', { estado: mesa2Post.estado, orden_total: mesa2Post.orden_total });
      assert.strictEqual(mesa2Post.estado, 'ocupada', 'Mesa debe quedar en estado ocupada');
      assert.strictEqual(Number(mesa2Post.orden_total || 0), 0, 'Saldo activo de la mesa debe ser 0');

      const rOrdMesa = await req('/api/ordenes/mesa/2');
      assert.strictEqual(rOrdMesa.body.orden, null, 'No debe haber orden activa no pagada');
    } catch (e) {
      console.error('ERROR T26.1:', e);
      throw e;
    }
  });

  it('T26.2: Agregar un nuevo consumo a la mesa ocupada con saldo 0 solo cobra el nuevo consumo', async () => {
    try {
      const nuevaBebida = { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 1, destino: 'barra', curso: 1 };
      const rNuevaComanda = await req('/api/comandas/enviar', 'POST', {
        mesaId: 2,
        cliente: 'Cliente Mesa 2',
        items: [nuevaBebida]
      });
      assert.strictEqual(rNuevaComanda.status, 200);

      const rOrdMesa = await req('/api/ordenes/mesa/2');
      assert.ok(rOrdMesa.body.orden, 'Debe haber una nueva orden activa');
      assert.strictEqual(Number(rOrdMesa.body.orden.total), 1800, 'El total debe ser solo el valor del nuevo consumo');
    } catch (e) {
      console.error('ERROR T26.2:', e);
      throw e;
    }
  });

  it('T26.3: Liberación explícita de mesa mediante endpoint POST /api/mesas/:id/liberar', async () => {
    try {
      const rLiberar = await req('/api/mesas/2/liberar', 'POST');
      console.log('DEBUG rLiberar:', rLiberar.status, rLiberar.body);
      assert.strictEqual(rLiberar.status, 200);

      const rMesas = await req('/api/mesas');
      const listaMesas = rMesas.body.mesas || rMesas.body;
      const mesa2 = listaMesas.find(m => Number(m.id) === 2);
      console.log('DEBUG Mesa 2 post liberar:', { estado: mesa2.estado, orden_total: mesa2.orden_total });
      assert.strictEqual(mesa2.estado, 'libre', 'Mesa 2 debe quedar en estado libre');
      assert.strictEqual(Number(mesa2.orden_total || 0), 0, 'Mesa 2 debe tener saldo 0');
    } catch (e) {
      console.error('ERROR T26.3:', e);
      throw e;
    }
  });

  it('T26.4: Saneamiento de selectores de métricas de caja en ConfigNegocio y labels en DOM', async () => {
    const rCaja = await req('/api/caja/actual');
    assert.strictEqual(rCaja.status, 200);
    assert.ok(rCaja.body.ventas !== undefined, 'Debe retornar ventas');

    const indexHtml = fs.readFileSync('public/index.html', 'utf8');
    assert.ok(indexHtml.includes('id="lblCajaVentasDolares"'), 'HTML debe contener id lblCajaVentasDolares');
    assert.ok(indexHtml.includes('id="lblCajaTotalEfectivo"'), 'HTML debe contener id lblCajaTotalEfectivo');
    assert.ok(indexHtml.includes('Total Esperado en Gaveta (₡):'), 'HTML debe contener Total Esperado en Gaveta (₡)');
  });
});
