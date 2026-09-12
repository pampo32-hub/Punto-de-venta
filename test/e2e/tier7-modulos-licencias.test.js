const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 7: Modular SaaS Architecture & Licensing Hub', () => {
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

  function req(endpoint, method = 'GET', body = null) {
    return server.request(endpoint, { method, body }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T7.1: GET /api/dev/modulos/catalogo returns all 11 SaaS modules', async () => {
    const res = await req('/api/dev/modulos/catalogo');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 11);
    assert.ok(res.body.length >= 11);

    const ids = res.body.map(m => m.id);
    assert.ok(ids.includes('pos_core'));
    assert.ok(ids.includes('kds_cocina'));
    assert.ok(ids.includes('offline_first'));
    assert.ok(ids.includes('auto_pago_qr'));
    assert.ok(ids.includes('inventario_recetas'));
    assert.ok(ids.includes('inteligencia_artificial'));
    assert.ok(ids.includes('facturacion_electronica'));

    const core = res.body.find(m => m.id === 'pos_core');
    assert.equal(core.esBase, true);
  });

  it('T7.2: GET /api/dev/negocios/:id/modulos returns default active modules for business', async () => {
    const res = await req('/api/dev/negocios/1/modulos');
    assert.equal(res.status, 200);
    assert.equal(res.body.negocioId, 1);
    assert.ok(res.body.nombre);
    assert.ok(res.body.modulosActivos === 'all' || Array.isArray(res.body.modulosActivos));
    assert.ok(Array.isArray(res.body.catalogo));
  });

  it('T7.3: PUT /api/dev/negocios/:id/modulos updates assigned modules and plan preset', async () => {
    const modulosSeleccionados = ['pos_core', 'kds_cocina', 'offline_first'];
    const putRes = await req('/api/dev/negocios/1/modulos', 'PUT', {
      modulos_activos: modulosSeleccionados,
      plan_nombre: 'Plan Básico (Start)'
    });

    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.ok, true);

    // Verify through GET endpoint
    const getRes = await req('/api/dev/negocios/1/modulos');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.planNombre, 'Plan Básico (Start)');
    assert.deepEqual(getRes.body.modulosActivos, modulosSeleccionados);
  });

  it('T7.4: GET /api/negocio/actual/modulos provides current active modules for POS client', async () => {
    const customModulos = ['pos_core', 'mesas_promos', 'split_bill', 'menu_qr'];
    await req('/api/dev/negocios/1/modulos', 'PUT', {
      modulos_activos: customModulos,
      plan_nombre: 'Plan Smart Gastro'
    });

    const res = await req('/api/negocio/actual/modulos?negocioId=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.planNombre, 'Plan Smart Gastro');
    assert.deepEqual(res.body.modulosActivos, customModulos);
  });

  it('T7.5: Disabling split_bill restricts module access and excludes it from active list', async () => {
    // 1. Set modules without split_bill
    const sinSplit = ['pos_core', 'kds_cocina', 'offline_first'];
    const putRes = await req('/api/dev/negocios/1/modulos', 'PUT', {
      modulos_activos: sinSplit,
      plan_nombre: 'Plan Básico Sin Split'
    });
    assert.equal(putRes.status, 200);

    // 2. Query active modules
    const res = await req('/api/negocio/actual/modulos?negocioId=1');
    assert.equal(res.status, 200);
    assert.ok(!res.body.modulosActivos.includes('split_bill'), 'split_bill must not be in active modules');
    assert.ok(res.body.modulosActivos.includes('pos_core'));
  });

  it('T7.6: DELETE /api/dev/negocios/:id rejects non-developer roles with 403 Forbidden', async () => {
    // Attempt with admin role
    const resAdmin = await server.request('/api/dev/negocios/2', {
      method: 'DELETE',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(resAdmin.status, 403);
    assert.ok(resAdmin.data.error.includes('Developer'));

    // Attempt with salonero role
    const resMesero = await server.request('/api/dev/negocios/2', {
      method: 'DELETE',
      headers: { 'x-user-rol': 'salonero' }
    });
    assert.equal(resMesero.status, 403);

    // Attempt without rol header
    const resAnon = await server.request('/api/dev/negocios/2', {
      method: 'DELETE'
    });
    assert.equal(resAnon.status, 403);
  });

  it('T7.7: DELETE /api/dev/negocios/1 rejects deletion of primary business (ID 1) with 400', async () => {
    const res = await server.request('/api/dev/negocios/1', {
      method: 'DELETE',
      headers: { 'x-user-rol': 'developer' }
    });
    assert.equal(res.status, 400);
    assert.ok(res.data.error.includes('principal por defecto'));
  });

  it('T7.8: DELETE /api/dev/negocios/:id allows Developer to delete secondary business', async () => {
    // 1. Create a test business
    const createRes = await server.request('/api/dev/negocios', {
      method: 'POST',
      headers: { 'x-user-rol': 'developer' },
      body: {
        nombre: 'Sucursal Test Eliminar',
        slogan: 'Para borrado seguro',
        moneda: 'CRC'
      }
    });
    assert.equal(createRes.status, 200);
    const newId = createRes.data.id;
    assert.ok(newId > 1);

    // 2. Delete business as Developer
    const delRes = await server.request(`/api/dev/negocios/${newId}`, {
      method: 'DELETE',
      headers: { 'x-user-rol': 'developer' }
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.ok, true);
    assert.ok(delRes.data.message.includes('eliminado exitosamente'));

    // 3. Trying to delete again returns 404
    const repeatRes = await server.request(`/api/dev/negocios/${newId}`, {
      method: 'DELETE',
      headers: { 'x-user-rol': 'developer' }
    });
    assert.equal(repeatRes.status, 404);
  });
});

