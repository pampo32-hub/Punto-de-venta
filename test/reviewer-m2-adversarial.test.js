const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('./helpers/test-server');

describe('Adversarial Stress & Edge Case Suite: Milestone 2 KDS & Tooltips', () => {
  let serverInstance;

  before(async () => {
    serverInstance = await startTestServer();
  });

  after(async () => {
    if (serverInstance) await serverInstance.stop();
  });

  beforeEach(async () => {
    await serverInstance.resetDb();
  });

  it('ADV-1: Concurrent rapid KDS dispatches on 5 items of same table converge to "activa"', async () => {
    const items = [
      { nombre: 'Item 1', precio: 1000, cantidad: 1, destino: 'cocina' },
      { nombre: 'Item 2', precio: 1000, cantidad: 1, destino: 'cocina' },
      { nombre: 'Item 3', precio: 1000, cantidad: 1, destino: 'cocina' },
      { nombre: 'Item 4', precio: 1000, cantidad: 1, destino: 'cocina' },
      { nombre: 'Item 5', precio: 1000, cantidad: 1, destino: 'cocina' }
    ];

    const r1 = await serverInstance.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId: 1, items }
    });
    assert.strictEqual(r1.status, 200);

    const dbItems = await serverInstance.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [r1.data.ordenId]);
    assert.strictEqual(dbItems.length, 5);

    // Concurrently mark all 5 items as listo
    const promises = dbItems.map(it => 
      serverInstance.request(`/api/kds/${it.id}/estado`, {
        method: 'POST',
        body: { estado: 'listo' }
      })
    );
    const responses = await Promise.all(promises);
    responses.forEach(res => assert.strictEqual(res.status, 200));

    // Database must have converged to 'activa'
    const mesa = await serverInstance.dbGet('SELECT estado FROM Mesas WHERE id = 1');
    assert.strictEqual(mesa.estado, 'activa', 'Table must be activa after all items ready');

    const orden = await serverInstance.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [r1.data.ordenId]);
    assert.strictEqual(orden.estado, 'activa', 'Order must be activa after all items ready');

    // Tooltip data must show 0 pending items
    const espera = await serverInstance.request('/api/mesas/1/espera');
    assert.strictEqual(espera.data.platos_pendientes.length, 0);
  });

  it('ADV-2: Malformed or missing payload in /api/kds/:detalleId/estado handled cleanly', async () => {
    // Missing body or empty estado
    const rEmpty = await serverInstance.request('/api/kds/9999/estado', {
      method: 'POST',
      body: {}
    });
    assert.strictEqual(rEmpty.status, 400);

    // Non-existent item
    const r404 = await serverInstance.request('/api/kds/99999/estado', {
      method: 'POST',
      body: { estado: 'listo' }
    });
    assert.strictEqual(r404.status, 404);
  });

  it('ADV-3: Future timestamps in primera_comanda_hora clamped safely to 0 minutes', async () => {
    const { formatearTooltipEspera } = require('../server');
    const futureDate = new Date(Date.now() + 600000).toISOString(); // 10 minutes in future
    const tooltip = formatearTooltipEspera(futureDate, ['Test Dish'], new Date());
    assert.strictEqual(tooltip.minutos, 0, 'Future timestamp must not produce negative minutes');
    assert.strictEqual(tooltip.titulo, '⏱️ Esperando hace 0 min');
  });

  it('ADV-4: XSS safety: html tags in product name properly escaped in app.js template', async () => {
    const { formatearTooltipEspera } = require('../server');
    const dirtyName = '<script>alert("XSS")</script> Ceviche';
    const tooltip = formatearTooltipEspera(new Date().toISOString(), [dirtyName]);
    assert.ok(tooltip.items.includes(dirtyName));
    
    // Test app.js template escaping
    const appJsContent = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    assert.ok(appJsContent.includes('escapeHtml(typeof p === \'string\' ? p : p.nombre_producto)'), 'Must call escapeHtml on dish items');
  });

  it('ADV-5: Table in "activa" state maintains order integrity for bill settlement', async () => {
    // 1. Create table with food
    const r1 = await serverInstance.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 2,
        items: [{ nombre: 'Pizza Margherita', precio: 8000, cantidad: 1, destino: 'cocina' }]
      }
    });
    const ordenId = r1.data.ordenId;

    // 2. Mark listo -> table transitions to 'activa'
    const items = await serverInstance.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    await serverInstance.request(`/api/kds/${items[0].id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });

    const mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 2');
    assert.strictEqual(mesa.estado, 'activa');

    // 3. Client requests bill from "activa" table
    const rPedir = await serverInstance.request('/api/cliente/mesa/2/pedir-cuenta', {
      method: 'POST'
    });
    assert.strictEqual(rPedir.status, 200);

    const ordenPedida = await serverInstance.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(ordenPedida.estado, 'cuenta_pedida', 'Order should transition to cuenta_pedida from activa');

    // 4. Pay order and close table
    const rCobrar = await serverInstance.request(`/api/ordenes/${ordenId}/cobrar`, {
      method: 'POST',
      body: {
        metodo: 'Efectivo',
        monto: 9840,
        propina: 0,
        cambio: 0,
        mesero: 'Juan Jival'
      }
    });
    assert.strictEqual(rCobrar.status, 200);

    // Table must be libre
    const mesaFinal = await serverInstance.dbGet('SELECT estado FROM Mesas WHERE id = 2');
    assert.strictEqual(mesaFinal.estado, 'libre');
  });

  it('ADV-6: Adding new food item to "activa" table transitions it back to "esperando"', async () => {
    // 1. Create table with food and mark ready
    const r1 = await serverInstance.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 3,
        items: [{ nombre: 'Sopa Azteca', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });
    const ordenId = r1.data.ordenId;
    const items = await serverInstance.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    await serverInstance.request(`/api/kds/${items[0].id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });

    let mesa = await serverInstance.dbGet('SELECT estado FROM Mesas WHERE id = 3');
    assert.strictEqual(mesa.estado, 'activa');

    // 2. Add second course of food
    const r2 = await serverInstance.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 3,
        items: [{ nombre: 'Churrasco 400g', precio: 15000, cantidad: 1, destino: 'cocina' }]
      }
    });
    assert.strictEqual(r2.status, 200);

    // Table must revert to 'esperando'
    mesa = await serverInstance.dbGet('SELECT estado FROM Mesas WHERE id = 3');
    assert.ok(mesa.estado === 'esperando' || mesa.estado === 'esperando_parcial');

    // GET /api/mesas must list Churrasco 400g as pending
    const mesasRes = await serverInstance.request('/api/mesas');
    const mesaData = mesasRes.data.mesas.find(m => m.id === 3);
    assert.ok(mesaData.platos_pendientes.includes('Churrasco 400g'));
    assert.ok(!mesaData.platos_pendientes.includes('Sopa Azteca'), 'Completed Sopa Azteca must not be in pending dishes');
  });
});
