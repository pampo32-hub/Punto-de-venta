const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 47: Toggle Característica Unión de Mesas (Activar / Desactivar)', () => {
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

  it('T47.1: Cuando union_mesas está ACTIVA (o all), POST /api/mesas/unir permite unir mesas ocupadas', async () => {
    // 1. Activar todas las características para negocio 1
    await server.request('/api/dev/negocios/1/caracteristicas', {
      method: 'PUT',
      body: { caracteristicas_activas: 'all' }
    });

    // 2. Crear órdenes activas en mesa 9 y 11
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [{ id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // 3. Unir mesas
    const unirRes = await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });

    assert.strictEqual(unirRes.status, 200);
    assert.ok(unirRes.data.message.includes('unidas') || unirRes.data.message.includes('Unidas') || unirRes.data.message.includes('éxito'));
  });

  it('T47.2: Cuando union_mesas está DESACTIVADA, POST /api/mesas/unir retorna 403 Forbidden', async () => {
    // 1. Desactivar union_mesas para negocio 1
    await server.request('/api/dev/negocios/1/caracteristicas', {
      method: 'PUT',
      body: {
        caracteristicas_activas: ['descuentos_cortesias', 'division_cuentas', 'servicio_10']
      }
    });

    // 2. Crear órdenes activas en mesa 9 y 11
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [{ id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // 3. Intentar unir mesas
    const unirRes = await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });

    assert.strictEqual(unirRes.status, 403);
    assert.ok(unirRes.data.error.includes('Unión de Mesas') && unirRes.data.error.includes('desactivada'));
  });

  it('T47.3: Reactivar union_mesas vuelve a permitir la unión inmediatamente', async () => {
    // 1. Reactivar union_mesas
    await server.request('/api/dev/negocios/1/caracteristicas', {
      method: 'PUT',
      body: {
        caracteristicas_activas: ['union_mesas', 'descuentos_cortesias', 'division_cuentas']
      }
    });

    // 2. Crear órdenes activas en mesa 9 y 11
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [{ id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // 3. Unir mesas exitosamente
    const unirRes = await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });

    assert.strictEqual(unirRes.status, 200);
    assert.ok(unirRes.data.message.includes('unidas') || unirRes.data.message.includes('Unidas') || unirRes.data.message.includes('éxito'));
  });
});
