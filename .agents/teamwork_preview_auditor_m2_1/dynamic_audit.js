const assert = require('assert');
const { startTestServer } = require('../../test/helpers/test-server');
const fs = require('fs');
const path = require('path');

async function runAudit() {
  console.log('--- STARTING DYNAMIC FORENSIC AUDIT (MILESTONE 2) ---');
  const server = await startTestServer();
  try {
    await server.resetDb();

    // 1. Send order with 3 distinct kitchen items and 1 bar item
    const sendRes = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 6,
        mesero: 'Auditor Test',
        items: [
          { nombre: 'Corte Rib Eye 350g', precio: 14500, cantidad: 1, destino: 'cocina', curso: 2 },
          { nombre: 'Chifrijo Tradicional', precio: 5800, cantidad: 1, destino: 'cocina', curso: 1 },
          { nombre: 'Alitas BBQ Picantes', precio: 6500, cantidad: 1, destino: 'cocina', curso: 2 },
          { nombre: 'Cerveza Imperial', precio: 1800, cantidad: 2, destino: 'barra', curso: 1 }
        ]
      }
    });
    assert.strictEqual(sendRes.status, 200);
    const ordenId = sendRes.data.ordenId;

    // Verify initial table state: esperando
    let mesa = await server.dbGet('SELECT * FROM Mesas WHERE id = 6');
    assert.strictEqual(mesa.estado, 'esperando', 'Mesa must be esperando initially');

    let orden = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(orden.estado, 'esperando', 'Orden must be esperando initially');

    // Verify GET /api/mesas tooltips
    let mesasRes = await server.request('/api/mesas');
    let m6 = mesasRes.data.mesas.find(m => m.id === 6);
    assert.strictEqual(m6.estado, 'esperando');
    assert.strictEqual(m6.platos_pendientes.length, 3, 'Must list only 3 kitchen dishes (excludes bar cerveza)');
    assert.ok(!m6.platos_pendientes.includes('Cerveza Imperial'), 'Must NEVER include bar items in pending kitchen dishes');
    console.log('✓ Check 1: Initial state esperando with 3 pending kitchen dishes verified');

    // 2. Fetch line items
    const items = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? AND destino = "cocina" ORDER BY id ASC', [ordenId]);
    assert.strictEqual(items.length, 3);

    // 3. Mark first dish as 'listo'
    let kds1 = await server.request(`/api/kds/${items[0].id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });
    assert.strictEqual(kds1.status, 200);

    mesa = await server.dbGet('SELECT * FROM Mesas WHERE id = 6');
    assert.strictEqual(mesa.estado, 'esperando_parcial', 'Mesa must be esperando_parcial after 1st dish ready');
    orden = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(orden.estado, 'esperando_parcial', 'Orden must be esperando_parcial after 1st dish ready');

    mesasRes = await server.request('/api/mesas');
    m6 = mesasRes.data.mesas.find(m => m.id === 6);
    assert.strictEqual(m6.estado, 'esperando_parcial');
    assert.strictEqual(m6.platos_pendientes.length, 2, 'Must list remaining 2 pending dishes');
    assert.ok(!m6.platos_pendientes.includes(items[0].nombre_producto), 'Completed dish must be excluded');
    console.log('✓ Check 2: Transition to esperando_parcial and tooltip exclusion verified');

    // 4. Mark second dish as 'listo'
    let kds2 = await server.request(`/api/kds/${items[1].id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });
    assert.strictEqual(kds2.status, 200);

    mesa = await server.dbGet('SELECT * FROM Mesas WHERE id = 6');
    assert.strictEqual(mesa.estado, 'esperando_parcial');
    mesasRes = await server.request('/api/mesas');
    m6 = mesasRes.data.mesas.find(m => m.id === 6);
    assert.strictEqual(m6.platos_pendientes.length, 1);
    assert.strictEqual(m6.platos_pendientes[0], items[2].nombre_producto);
    console.log('✓ Check 3: Subsequent partial delivery retains esperando_parcial and updates list');

    // 5. Mark third (and final) dish as 'listo'
    let kds3 = await server.request(`/api/kds/${items[2].id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });
    assert.strictEqual(kds3.status, 200);

    mesa = await server.dbGet('SELECT * FROM Mesas WHERE id = 6');
    assert.strictEqual(mesa.estado, 'activa', 'Mesa must transition to activa when ALL kitchen items ready');
    orden = await server.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(orden.estado, 'activa', 'Orden must transition to activa when ALL kitchen items ready');

    mesasRes = await server.request('/api/mesas');
    m6 = mesasRes.data.mesas.find(m => m.id === 6);
    assert.strictEqual(m6.estado, 'activa');
    assert.strictEqual(m6.platos_pendientes.length, 0, 'No pending dishes when activa');
    assert.ok(m6.orden_activa_id > 0, 'orden_activa_id must be populated');
    console.log('✓ Check 4: Transition to activa with 0 pending dishes and active order id verified');

    // 6. Test reversibility: mark 1 dish back to preparando
    let kdsRevert = await server.request(`/api/kds/${items[2].id}/estado`, {
      method: 'POST',
      body: { estado: 'preparando' }
    });
    assert.strictEqual(kdsRevert.status, 200);

    mesa = await server.dbGet('SELECT * FROM Mesas WHERE id = 6');
    assert.strictEqual(mesa.estado, 'esperando_parcial', 'Reverting dish must revert table to esperando_parcial');
    console.log('✓ Check 5: State reversibility from activa to esperando_parcial verified');

    console.log('--- ALL DYNAMIC AUDIT CHECKS PASSED EMPIRICALLY ---');
  } finally {
    await server.stop();
  }
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
