const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 30: Aislamiento Total entre GastroBar y Beta Tester Sandbox (Mesas, Plano y Menú)', () => {
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

  it('T30.1: Crear una nueva mesa en Beta Tester (ID: 2) se guarda con negocio_id: 2', async () => {
    const rCrear = await req('/api/mesas/crear', 'POST', {
      numero: 'Mesa Sandbox 99',
      capacidad: 6,
      forma: 'square',
      x: 120,
      y: 120,
      piso: 1
    }, { 'x-negocio-id': '2' });

    assert.strictEqual(rCrear.status, 200, 'Creación de mesa debe responder 200');
    assert.ok(rCrear.data.id, 'Debe devolver id de la mesa');
    assert.strictEqual(Number(rCrear.data.negocio_id), 2, 'negocio_id de la mesa creada debe ser 2');
    assert.strictEqual(rCrear.data.numero, 'Mesa Sandbox 99');
  });

  it('T30.2: La mesa creada en Beta Tester aparece en GET /api/mesas de Beta Tester (ID: 2)', async () => {
    const rBeta = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '2' });
    assert.strictEqual(rBeta.status, 200);
    const mesasBeta = rBeta.data.mesas || [];
    const mesaEncontrada = mesasBeta.find(m => m.numero === 'Mesa Sandbox 99');
    assert.ok(mesaEncontrada, 'La mesa creada debe aparecer en el salón de Beta Tester');
    assert.strictEqual(Number(mesaEncontrada.negocio_id), 2);
  });

  it('T30.3: La mesa creada en Beta Tester NO aparece en GastroBar (ID: 1)', async () => {
    const rGastro = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '1' });
    assert.strictEqual(rGastro.status, 200);
    const mesasGastro = rGastro.data.mesas || [];
    const mesaEncontrada = mesasGastro.find(m => m.numero === 'Mesa Sandbox 99');
    assert.strictEqual(mesaEncontrada, undefined, 'La mesa de Beta Tester NO debe figurar en GastroBar');
  });

  it('T30.4: Zonas de Beta Tester están completamente aisladas de las Zonas de GastroBar', async () => {
    const rBeta = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '2' });
    const rGastro = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '1' });
    
    const zonasBeta = rBeta.data.zonas || [];
    const zonasGastro = rGastro.data.zonas || [];

    zonasBeta.forEach(z => {
      if (z.negocio_id) assert.strictEqual(Number(z.negocio_id), 2);
    });

    const tieneZonasBetaEnGastro = zonasGastro.some(z => Number(z.id) >= 101 && Number(z.id) <= 105);
    assert.strictEqual(tieneZonasBetaEnGastro, false, 'GastroBar no debe incluir zonas de Beta Tester');
  });

  it('T30.5: Reorganizar plano y guardar posiciones en Beta Tester solo afecta mesas de Beta Tester', async () => {
    const rReorg = await req('/api/mesas/posiciones/reorganizar-cuadricula', 'POST', {}, { 'x-negocio-id': '2' });
    assert.strictEqual(rReorg.status, 200);
    assert.ok(rReorg.data.ok);

    const rGastro = await req('/api/mesas', 'GET', null, { 'x-negocio-id': '1' });
    const mesasGastro = rGastro.data.mesas || [];
    mesasGastro.forEach(m => {
      assert.strictEqual(Number(m.negocio_id || 1), 1, 'Todas las mesas de GastroBar deben tener negocio_id: 1');
    });
  });

  it('T30.6: Catálogo de Menú y Categorías aislado por negocio_id', async () => {
    const rMenuBeta = await req('/api/menu', 'GET', null, { 'x-negocio-id': '2' });
    const rMenuGastro = await req('/api/menu', 'GET', null, { 'x-negocio-id': '1' });

    assert.strictEqual(rMenuBeta.status, 200);
    assert.strictEqual(rMenuGastro.status, 200);

    const prodsBeta = rMenuBeta.data.productos || [];
    const prodsGastro = rMenuGastro.data.productos || [];

    prodsBeta.forEach(p => {
      assert.strictEqual(Number(p.negocio_id || 2), 2, 'Los productos del menú Beta deben pertenecer a negocio_id: 2');
    });

    prodsGastro.forEach(p => {
      assert.strictEqual(Number(p.negocio_id || 1), 1, 'Los productos del menú GastroBar deben pertenecer a negocio_id: 1');
    });
  });
});
