const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 29: Descuentos/Cortesías con PIN y Semáforo de Tiempos en Salón', () => {
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
          'x-negocio-id': '2',
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

    // Asegurar que Beta Tester (Sandbox ID: 2) tenga 'all' módulos activos
    await req('/api/dev/negocios/2/modulos', 'PUT', { modulos_activos: 'all' });
    // Limpiar mesas de prueba
    await req('/api/mesas/51/reset', 'POST', null, { 'x-user-rol': 'admin' });
    await req('/api/mesas/52/reset', 'POST', null, { 'x-user-rol': 'admin' });
    await req('/api/mesas/1/reset', 'POST', null, { 'x-user-rol': 'admin' });
  });

  after(async () => {
    if (serverInstance && serverInstance.close) {
      await new Promise(r => serverInstance.close(r));
    }
  });

  it('T29.1: Catálogo de módulos incluye los flags descuentos_cortesias_pin y semaforo_tiempos_salon', async () => {
    const res = await req('/api/dev/modulos/catalogo');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));

    const modulosIds = res.data.map(m => m.id);
    assert.ok(modulosIds.includes('descuentos_cortesias_pin'), 'Debe incluir flag descuentos_cortesias_pin');
    assert.ok(modulosIds.includes('semaforo_tiempos_salon'), 'Debe incluir flag semaforo_tiempos_salon');
  });

  it('T29.2: Descuentos protegidos con PIN funcionan en Beta Tester (Sandbox ID: 2)', async () => {
    // 1. Crear comanda en mesa 51 de Beta Tester
    const resCom = await req('/api/comandas/enviar', 'POST', {
      mesaId: 51,
      negocio_id: 2,
      mesero: 'Tester Sandbox',
      items: [
        { id: 1, nombre: 'Corte Rib Eye Angus', precio: 10000, cantidad: 1, destino: 'cocina', curso: 3 }
      ]
    }, { 'x-negocio-id': '2' });

    assert.strictEqual(resCom.status, 200);
    const ordenId = resCom.data.orden_id || resCom.data.ordenId;
    assert.ok(ordenId, 'Debe retornar el ID de la orden creada');

    // 2. Intentar aplicar descuento sin PIN como mesero -> debe fallar 403
    const resSinPin = await req(`/api/ordenes/${ordenId}/descuento`, 'POST', {
      tipo: 'porcentaje',
      valor: 20,
      motivo: 'Cliente VIP'
    }, { 'x-negocio-id': '2', 'x-user-rol': 'mesero' });

    assert.strictEqual(resSinPin.status, 403);
    assert.ok(resSinPin.data.requierePin);

    // 3. Aplicar descuento con PIN correcto de Admin (9999 o 1234) o rol admin
    const resConPin = await req(`/api/ordenes/${ordenId}/descuento`, 'POST', {
      tipo: 'porcentaje',
      valor: 20,
      motivo: 'Cliente Frecuente VIP',
      pin: '9999'
    }, { 'x-negocio-id': '2', 'x-user-rol': 'admin' });

    assert.strictEqual(resConPin.status, 200);
    assert.ok(resConPin.data.ok);
    assert.ok(resConPin.data.orden);
    assert.strictEqual(Number(resConPin.data.orden.descuento_porcentaje), 20);
    assert.strictEqual(Number(resConPin.data.orden.descuento_monto), 2000);
    // Subtotal bruto: 10000, Descuento: 2000 => Subtotal neto: 8000
    // Servicio 10%: 800, IVA 13%: 1040 => Total: 9840
    assert.strictEqual(Number(resConPin.data.orden.servicio_10), 800);
    assert.strictEqual(Number(resConPin.data.orden.iva_13), 1040);
    assert.strictEqual(Number(resConPin.data.orden.total), 9840);
  });

  it('T29.3: Cortesía 100% deja el total en ₡0 y recalcula impuestos', async () => {
    const resCom = await req('/api/comandas/enviar', 'POST', {
      mesaId: 52,
      negocio_id: 2,
      mesero: 'Tester Sandbox',
      items: [
        { id: 2, nombre: 'Hamburguesa Especial', precio: 5000, cantidad: 2, destino: 'cocina', curso: 3 }
      ]
    }, { 'x-negocio-id': '2' });

    assert.strictEqual(resCom.status, 200);
    const ordenId = resCom.data.orden_id || resCom.data.ordenId;

    const resCortesia = await req(`/api/ordenes/${ordenId}/descuento`, 'POST', {
      tipo: 'cortesia',
      valor: 100,
      motivo: 'Cortesía de la Casa Gerencia'
    }, { 'x-negocio-id': '2', 'x-user-rol': 'admin' });

    assert.strictEqual(resCortesia.status, 200);
    assert.strictEqual(Number(resCortesia.data.orden.descuento_porcentaje), 100);
    assert.strictEqual(Number(resCortesia.data.orden.descuento_monto), 10000);
    assert.strictEqual(Number(resCortesia.data.orden.total), 0);
  });

  it('T29.4: GastroBar (ID: 1) rechaza descuentos porque el módulo está desactivado por defecto', async () => {
    const resCom = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      negocio_id: 1,
      mesero: 'Mesero GastroBar',
      items: [
        { id: 1, nombre: 'Platillo Gastro', precio: 6000, cantidad: 1, destino: 'cocina', curso: 2 }
      ]
    }, { 'x-negocio-id': '1' });

    assert.strictEqual(resCom.status, 200);
    const ordenId = resCom.data.orden_id || resCom.data.ordenId;

    const resDesc = await req(`/api/ordenes/${ordenId}/descuento`, 'POST', {
      tipo: 'porcentaje',
      valor: 10,
      motivo: 'Descuento no habilitado'
    }, { 'x-negocio-id': '1', 'x-user-rol': 'admin' });

    assert.strictEqual(resDesc.status, 403);
    assert.ok(resDesc.data.error.includes('no está habilitado'));
  });

  it('T29.5: Semáforo de Salón calcula semaforo_alerta y semaforo_activo en Beta Tester (ID: 2)', async () => {
    const res = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '2' });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.mesas));
    assert.ok(res.data.mesas.length > 0);

    const mesaBeta = res.data.mesas[0];
    assert.strictEqual(mesaBeta.semaforo_activo, true, 'semaforo_activo debe ser true en Beta Tester');
    assert.ok(mesaBeta.semaforo_alerta !== undefined, 'Debe incluir campo semaforo_alerta');
    assert.ok(typeof mesaBeta.minutos_inactiva === 'number', 'minutos_inactiva debe ser un número');
  });

  it('T29.6: Semáforo de Salón permanece inactivo en GastroBar (ID: 1)', async () => {
    const res = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '1' });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.mesas));

    const mesaGastro = res.data.mesas[0];
    assert.strictEqual(mesaGastro.semaforo_activo, false, 'semaforo_activo debe ser false en GastroBar');
    assert.strictEqual(mesaGastro.semaforo_alerta, 'normal', 'semaforo_alerta debe ser normal cuando está desactivado');
  });
});
