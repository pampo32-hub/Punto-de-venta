const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 50: Comanda Pagada Permanece en Cocina / KDS y Mesa Ocupada Saldo Cero', () => {
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
          'x-user-rol': 'admin',
          ...headers
        }
      };
      const r = http.request(opt, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, data, body: data, headers: res.headers, raw });
          } catch (e) {
            resolve({ status: res.statusCode, data: raw, body: raw, headers: res.headers, raw });
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

    // Asegurar que Mesa 3 esté libre al iniciar
    await req('/api/mesas/3/liberar', 'POST', { pin: '1234' });
  });

  after(async () => {
    if (serverInstance && serverInstance.close) {
      await new Promise(r => serverInstance.close(r));
    }
  });

  it('T50.1: Guardar comanda con comida y bebida -> Cobrar cuenta -> La comida permanece en KDS y mesa queda esperando con saldo ₡0', async () => {
    try {
    // 1. Enviar comanda con comida de cocina y bebida de barra
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      mesero: 'Mesero Test',
      cliente: 'Familia Perez',
      items: [
        { id: 40, nombre: 'Hamburguesa Especial', precio: 4500, cantidad: 1, destino: 'cocina', curso: 3 },
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 1, destino: 'barra', curso: 1 }
      ]
    });
    assert.strictEqual(resCmd.status, 200, 'Comanda debe enviarse con éxito');
    const ordenId = resCmd.body.ordenId;
    assert.ok(ordenId, 'Debe crearse ordenId');

    // 2. Cobrar la cuenta por completo en caja
    const resCobro = await req(`/api/ordenes/${ordenId}/cobrar`, 'POST', {
      metodo: 'Tarjeta',
      monto: 6500,
      liquidar_total: true,
      mesero: 'Cajero Test'
    });
    assert.strictEqual(resCobro.status, 200, 'Cobro debe procesarse exitosamente');

    // 3. Verificar que la comida SIGUE en el KDS con su estado pendiente y marcada como pagada
    const resKds = await req('/api/kds?destino=cocina');
    assert.strictEqual(resKds.status, 200);
    const itemsCocinaKds = (resKds.body || []).filter(it => it.orden_id === ordenId);
    assert.strictEqual(itemsCocinaKds.length, 1, 'La hamburguesa debe seguir en KDS de cocina');
    assert.strictEqual(itemsCocinaKds[0].nombre_producto, 'Hamburguesa Especial');
    assert.strictEqual(itemsCocinaKds[0].estado_comanda, 'pendiente');
    assert.strictEqual(Number(itemsCocinaKds[0].pagado), 1, 'El ítem en KDS debe estar marcado como pagado = 1');
    assert.strictEqual(itemsCocinaKds[0].orden_estado, 'pagada', 'El estado de la orden en KDS debe ser pagada');

    // 4. Verificar que en el Salón, Mesa 3 sigue OCUPADA en estado "esperando" (naranja) y saldo en ₡0
    const resMesas = await req('/api/mesas');
    const listaMesas = resMesas.body.mesas || resMesas.body;
    const mesa3 = listaMesas.find(m => Number(m.id) === 3);
    assert.ok(mesa3, 'Mesa 3 debe existir');
    assert.strictEqual(mesa3.estado, 'esperando', 'Mesa 3 debe estar en estado esperando');
    assert.strictEqual(Number(mesa3.orden_total), 0, 'El saldo pendiente de Mesa 3 debe ser 0');
    assert.ok(mesa3.platos_pendientes.length > 0, 'Debe listar los platillos pendientes en cocina');

    // 5. En KDS, cocina marca la hamburguesa como 'listo'
    const detalleId = itemsCocinaKds[0].id;
    const resListo = await req(`/api/kds/${detalleId}/estado`, 'POST', {
      estado: 'listo'
    });
    assert.strictEqual(resListo.status, 200, 'KDS debe actualizar estado a listo');

    // 6. Verificar que Mesa 3 pasó automáticamente a 'ocupada' (azul, comiendo) con saldo ₡0
    const resMesasListo = await req('/api/mesas');
    const listaMesasListo = resMesasListo.body.mesas || resMesasListo.body;
    const mesa3Listo = listaMesasListo.find(m => Number(m.id) === 3);
    assert.strictEqual(mesa3Listo.estado, 'ocupada', 'Mesa 3 debe pasar a ocupada cuando la comida sale de cocina');
    assert.strictEqual(Number(mesa3Listo.orden_total), 0, 'El saldo de Mesa 3 debe seguir en 0');
    } catch (err) {
      console.error('ERROR EN T50.1:', err);
      throw err;
    }
  });

  it('T50.2: Cobro Directo sin guardar comanda previa -> La comida llega a cocina y mesa queda esperando con saldo ₡0', async () => {
    // Liberar mesa 3 para el siguiente test
    await req('/api/mesas/3/liberar', 'POST', { pin: '1234' });

    // Cliente pide platillo y paga de una vez ("Cobro Directo" sin guardar comanda previa)
    const resDirecto = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 3,
      items: [
        { id: 40, nombre: 'Pizza Artesanal Margarita', precio: 6800, cantidad: 1, destino: 'cocina', curso: 3 }
      ],
      metodo: 'Sinpe Móvil',
      monto: 6800,
      liquidar_total: true
    });
    assert.strictEqual(resDirecto.status, 200, 'Cobro directo debe ser exitoso');
    const ordenId = resDirecto.body.ordenId;
    assert.ok(ordenId, 'Debe crearse ordenId');

    // La pizza DEBE llegar a la cocina sí o sí
    const resKds = await req('/api/kds?destino=cocina');
    const itemsCocinaKds = (resKds.body || []).filter(it => it.orden_id === ordenId);
    assert.strictEqual(itemsCocinaKds.length, 1, 'La pizza debe llegar al KDS de cocina en cobro directo');
    assert.strictEqual(itemsCocinaKds[0].estado_comanda, 'pendiente', 'Debe estar en estado pendiente');
    assert.strictEqual(Number(itemsCocinaKds[0].pagado), 1, 'Debe estar pagado = 1');

    // La mesa debe quedar en esperando con saldo en 0
    const resMesas = await req('/api/mesas');
    const listaMesas = resMesas.body.mesas || resMesas.body;
    const mesa3 = listaMesas.find(m => Number(m.id) === 3);
    assert.strictEqual(mesa3.estado, 'esperando', 'Mesa debe quedar en esperando');
    assert.strictEqual(Number(mesa3.orden_total), 0, 'Saldo debe ser 0');
  });

  it('T50.3: Liberar Mesa con saldo ₡0 es permitido sin exigir PIN', async () => {
    const resLiberar = await req('/api/mesas/3/liberar', 'POST', {});
    assert.strictEqual(resLiberar.status, 200, 'Debe permitir liberar mesa con saldo ₡0');

    const resMesas = await req('/api/mesas');
    const listaMesas = resMesas.body.mesas || resMesas.body;
    const mesa3 = listaMesas.find(m => Number(m.id) === 3);
    assert.strictEqual(mesa3.estado, 'libre', 'Mesa 3 debe quedar completamente libre');
  });

  it('T50.4: Cobro de cuenta regular sin comida pendiente en cocina -> La mesa se libera automáticamente a "libre"', async () => {
    // 1. Pedir solo bebidas o platillos sin destino de cocina
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      mesero: 'Mesero Test',
      cliente: 'Cliente Bebidas',
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra', curso: 1 }
      ]
    });
    assert.strictEqual(resCmd.status, 200);
    const ordenId = resCmd.body.ordenId;

    // 2. Cobrar la orden por completo
    const resCobro = await req(`/api/ordenes/${ordenId}/cobrar`, 'POST', {
      metodo: 'Efectivo',
      monto: 4000,
      liquidar_total: true,
      mesero: 'Cajero Test'
    });
    assert.strictEqual(resCobro.status, 200);

    // 3. Como no hay comida pendiente en cocina, la mesa debe liberarse automáticamente
    const resMesas = await req('/api/mesas');
    const listaMesas = resMesas.body.mesas || resMesas.body;
    const mesa3 = listaMesas.find(m => Number(m.id) === 3);
    assert.strictEqual(mesa3.estado, 'libre', 'Mesa 3 debe liberarse automáticamente al pagar si no hay comida pendiente en cocina');
  });
});
