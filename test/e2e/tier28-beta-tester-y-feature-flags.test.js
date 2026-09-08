const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 28: Restaurante Beta Tester y Sistema de Feature Flags por Restaurante', () => {
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

  it('T28.1: Existen al menos 2 comercios registrados (GastroBar y Beta Tester Sandbox)', async () => {
    const res = await req('/api/dev/negocios');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data), 'Debe retornar un arreglo de negocios');
    assert.ok(res.data.length >= 2, 'Debe haber al menos 2 negocios');

    const neg1 = res.data.find(n => Number(n.id) === 1);
    const neg2 = res.data.find(n => Number(n.id) === 2);

    assert.ok(neg1, 'Negocio 1 debe existir');
    assert.ok(neg2, 'Negocio 2 (Beta Tester) debe existir');
    assert.ok(neg2.nombre.includes('Beta Tester'), 'Negocio 2 debe llamarse Beta Tester');
  });

  it('T28.2: Catálogo de módulos incluye los nuevos interruptores de funcionalidad (Feature Flags)', async () => {
    const res = await req('/api/dev/modulos/catalogo');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data));

    const modulosIds = res.data.map(m => m.id);
    assert.ok(modulosIds.includes('pedir_pin_liberar_con_saldo'), 'Debe incluir flag pedir_pin_liberar_con_saldo');
    assert.ok(modulosIds.includes('caja_arqueo_dual_dolares'), 'Debe incluir flag caja_arqueo_dual_dolares');
    assert.ok(modulosIds.includes('comanda_express_cobro_anticipado'), 'Debe incluir flag comanda_express_cobro_anticipado');
  });

  it('T28.3: Clonar restaurante mediante POST /api/dev/negocios/:id/duplicar crea copia aislada', async () => {
    const res = await req('/api/dev/negocios/1/duplicar', 'POST', {
      nombreNuevo: 'Restaurante Clon Test Tier28',
      sloganNuevo: 'Sucursal de Pruebas Automatizadas'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.ok);
    assert.ok(res.data.negocio && res.data.negocio.id > 2);
    assert.strictEqual(res.data.negocio.nombre, 'Restaurante Clon Test Tier28');
  });

  it('T28.4: Feature Flag "pedir_pin_liberar_con_saldo" aplica solo al negocio configurado', async () => {
    // 1. Configurar Negocio 1 con 'pedir_pin_liberar_con_saldo' ACTIVO (all)
    await req('/api/dev/negocios/1/modulos', 'PUT', {
      modulos_activos: 'all',
      plan_nombre: 'Plan Full Tech 2026'
    });

    // 2. Configurar Negocio 2 SIN 'pedir_pin_liberar_con_saldo' (array que no lo incluye)
    await req('/api/dev/negocios/2/modulos', 'PUT', {
      modulos_activos: ['pos_core', 'kds_cocina', 'caja_arqueo_dual_dolares'],
      plan_nombre: 'Plan Custom Sandbox'
    });

    // 3. Crear orden pendiente en Negocio 1 Mesa 3
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      cliente: 'Cliente Negocio 1',
      items: [{ id: 1, nombre: 'Platillo 1', precio: 3000, cantidad: 1, destino: 'cocina' }]
    }, { 'x-negocio-id': '1' });

    // 4. Intentar liberar mesa 3 en Negocio 1 sin PIN -> DEBE RECHAZAR CON 403
    const rLiberarNeg1 = await req('/api/mesas/3/liberar', 'POST', { usuarioNombre: 'Salonero' }, {
      'x-negocio-id': '1',
      'x-user-rol': 'mesero'
    });
    assert.strictEqual(rLiberarNeg1.status, 403, 'En Negocio 1 debe exigir PIN porque la feature está activa');
    assert.strictEqual(rLiberarNeg1.data.requierePin, true);

    // 5. Crear orden pendiente en Negocio 2 (Beta Tester) Mesa 1
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      cliente: 'Cliente Negocio 2',
      items: [{ id: 1, nombre: 'Platillo Beta', precio: 3000, cantidad: 1, destino: 'cocina' }]
    }, { 'x-negocio-id': '2' });

    // 6. Intentar liberar mesa en Negocio 2 sin PIN -> DEBE PERMITIRLO porque la feature NO está activa en Negocio 2
    const rLiberarNeg2 = await req('/api/mesas/1/liberar', 'POST', { usuarioNombre: 'Salonero' }, {
      'x-negocio-id': '2',
      'x-user-rol': 'mesero'
    });
    assert.strictEqual(rLiberarNeg2.status, 200, 'En Negocio 2 debe permitir liberar sin PIN porque la regla estricta está apagada');
    assert.ok(rLiberarNeg2.data.ok);
  });
});
