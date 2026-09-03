const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('./helpers/test-server');

describe('Empirical Challenger M2: KDS States, Partial Deliveries & Wait Time Tooltips', () => {
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

  // ==========================================================================
  // SUITE 1: FULL-STACK DATABASE STATE TRANSITIONS ON KDS DISPATCH
  // ==========================================================================
  describe('Suite 1: KDS Readiness & Table State Machine (esperando -> esperando_parcial -> activa)', () => {
    it('S1.1: Multi-dish order transitions to esperando_parcial on first dish, and activa when all ready', async () => {
      // 1. Submit comanda with 2 kitchen items (Rib Eye + Chifrijo) to Mesa 1
      const sendRes = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          items: [
            { nombre: 'Corte Rib Eye 350g', precio: 14500, cantidad: 1, destino: 'cocina', curso: 2 },
            { nombre: 'Chifrijo Tradicional', precio: 5800, cantidad: 1, destino: 'cocina', curso: 1 }
          ]
        }
      });
      assert.strictEqual(sendRes.status, 200);

      // Verify table is 'esperando' in SQLite
      const mesaInit = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaInit.estado, 'esperando', 'Initial table state must be esperando');

      const ordenInit = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(ordenInit.estado, 'esperando', 'Initial order state must be esperando');

      // Check GET /api/mesas shows both dishes pending
      const mesasRes1 = await serverInstance.request('/api/mesas');
      const mesa1Data = mesasRes1.data.mesas.find(m => m.id === 1);
      assert.strictEqual(mesa1Data.estado, 'esperando');
      assert.strictEqual(mesa1Data.platos_pendientes.length, 2);
      assert.ok(mesa1Data.platos_pendientes.includes('Corte Rib Eye 350g'));
      assert.ok(mesa1Data.platos_pendientes.includes('Chifrijo Tradicional'));

      // 2. Fetch DetalleOrden items
      const items = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [sendRes.data.ordenId]);
      assert.strictEqual(items.length, 2);
      const [itemRibEye, itemChifrijo] = items;

      // 3. Mark Rib Eye as 'listo'
      const kdsRes1 = await serverInstance.request(`/api/kds/${itemRibEye.id}/estado`, {
        method: 'POST',
        body: { estado: 'listo' }
      });
      assert.strictEqual(kdsRes1.status, 200);

      // Verify table transitioned to 'esperando_parcial' in SQLite
      const mesaPartial = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaPartial.estado, 'esperando_parcial', 'Mesa must transition to esperando_parcial in DB');

      const ordenPartial = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(ordenPartial.estado, 'esperando_parcial', 'Orden must transition to esperando_parcial in DB');

      // Check GET /api/mesas now contains ONLY Chifrijo in platos_pendientes
      const mesasRes2 = await serverInstance.request('/api/mesas');
      const mesa1Partial = mesasRes2.data.mesas.find(m => m.id === 1);
      assert.strictEqual(mesa1Partial.estado, 'esperando_parcial');
      assert.strictEqual(mesa1Partial.platos_pendientes.length, 1);
      assert.strictEqual(mesa1Partial.platos_pendientes[0], 'Chifrijo Tradicional');

      // 4. Mark Chifrijo as 'listo'
      const kdsRes2 = await serverInstance.request(`/api/kds/${itemChifrijo.id}/estado`, {
        method: 'POST',
        body: { estado: 'listo' }
      });
      assert.strictEqual(kdsRes2.status, 200);

      // Verify table transitioned to 'activa' (Blue) in SQLite
      const mesaActiva = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaActiva.estado, 'activa', 'Mesa must transition to activa in DB when all ready');

      const ordenActiva = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(ordenActiva.estado, 'activa', 'Orden must transition to activa in DB when all ready');

      // Check GET /api/mesas shows activa and empty pending dishes
      const mesasRes3 = await serverInstance.request('/api/mesas');
      const mesa1Activa = mesasRes3.data.mesas.find(m => m.id === 1);
      assert.strictEqual(mesa1Activa.estado, 'activa');
      assert.strictEqual(mesa1Activa.platos_pendientes.length, 0);
      assert.ok(mesa1Activa.orden_activa_id > 0, 'orden_activa_id must NOT be null for activa tables');
    });

    it('S1.2: State Reversibility: un-marking a dish reverts table from activa back to esperando_parcial and esperando', async () => {
      // Create table with 2 dishes, mark both ready
      const sendRes = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 2,
          items: [
            { nombre: 'Hamburguesa GastroBar', precio: 7200, cantidad: 1, destino: 'cocina' },
            { nombre: 'Alitas BBQ Picantes', precio: 6500, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const items = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [sendRes.data.ordenId]);
      await serverInstance.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      await serverInstance.request(`/api/kds/${items[1].id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      const mesaReady = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 2');
      assert.strictEqual(mesaReady.estado, 'activa');

      // Revert 1 dish back to 'preparando'
      await serverInstance.request(`/api/kds/${items[1].id}/estado`, { method: 'POST', body: { estado: 'preparando' } });
      const mesaReverted1 = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 2');
      assert.strictEqual(mesaReverted1.estado, 'esperando_parcial', 'Reverting 1 dish must return table to esperando_parcial');

      // Revert 2nd dish back to 'pendiente'
      await serverInstance.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      const mesaReverted2 = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 2');
      assert.strictEqual(mesaReverted2.estado, 'esperando', 'Reverting all dishes must return table to esperando');
    });
  });

  // ==========================================================================
  // SUITE 2: CANCELLATIONS & AUDIT RECALCULATION
  // ==========================================================================
  describe('Suite 2: Comanda Item Cancellation (anular-item) Recalculates Table State', () => {
    it('S2.1: Cancelling the only pending dish when other is ready transitions table to activa', async () => {
      const sendRes = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 3,
          items: [
            { nombre: 'Corte Rib Eye 350g', precio: 14500, cantidad: 1, destino: 'cocina' },
            { nombre: 'Ceviche Mixto Peruano', precio: 6900, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const items = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [sendRes.data.ordenId]);
      
      // Mark Rib Eye as ready -> esperando_parcial
      await serverInstance.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      const mesaBefore = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 3');
      assert.strictEqual(mesaBefore.estado, 'esperando_parcial');

      // Cancel Ceviche via anular-item
      const anularRes = await serverInstance.request('/api/comandas/anular-item', {
        method: 'POST',
        body: {
          detalleId: items[1].id,
          motivo: 'Cliente cambió de opinión',
          supervisorPin: '1234',
          mesaNumero: 'Mesa 3'
        }
      });
      assert.strictEqual(anularRes.status, 200);

      // Now the only remaining item is Rib Eye, which is 'listo' -> mesa must be 'activa'
      const mesaAfter = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 3');
      assert.strictEqual(mesaAfter.estado, 'activa', 'Table must transition to activa after pending dish is cancelled');
    });
  });

  // ==========================================================================
  // SUITE 3: WAIT TIME & TOOLTIP ENDPOINTS
  // ==========================================================================
  describe('Suite 3: Wait Time & Tooltip Queries', () => {
    it('S3.1: GET /api/mesas/:id/espera returns calculated minutes and pending dishes', async () => {
      const sendRes = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 4,
          items: [
            { nombre: 'Chifrijo Tradicional', precio: 5800, cantidad: 1, destino: 'cocina' }
          ]
        }
      });

      const esperaRes = await serverInstance.request('/api/mesas/4/espera');
      assert.strictEqual(esperaRes.status, 200);
      assert.strictEqual(esperaRes.data.mesaId, 4);
      assert.strictEqual(esperaRes.data.estado, 'esperando');
      assert.strictEqual(esperaRes.data.minutos_espera, 0);
      assert.ok(esperaRes.data.primera_comanda_hora, 'primera_comanda_hora must be populated');
      assert.deepStrictEqual(esperaRes.data.platos_pendientes, ['Chifrijo Tradicional']);
      assert.strictEqual(esperaRes.data.tooltip.titulo, '⏱️ Esperando hace 0 min');
    });

    it('S3.2: GET /api/comandas/activas returns active kitchen items', async () => {
      await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 5,
          items: [
            { nombre: 'Corte Rib Eye 350g', precio: 14500, cantidad: 1, destino: 'cocina' }
          ]
        }
      });

      const activasRes = await serverInstance.request('/api/comandas/activas');
      assert.strictEqual(activasRes.status, 200);
      assert.ok(Array.isArray(activasRes.data));
      const found = activasRes.data.find(c => c.nombre_producto === 'Corte Rib Eye 350g');
      assert.ok(found, 'Active comanda must be present in /api/comandas/activas');
    });
  });

  // ==========================================================================
  // SUITE 4: FRONTEND CODE & CSS COMPLIANCE
  // ==========================================================================
  describe('Suite 4: UI, CSS & HTML Template Integrity', () => {
    it('S4.1: public/styles.css contains activa (#2563eb) and esperando_parcial (#f59e0b) definitions', () => {
      const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
      assert.ok(css.includes('.mesa-render-card.activa'), 'CSS must include .mesa-render-card.activa');
      assert.ok(css.includes('#2563eb'), 'activa must use blue #2563eb');
      assert.ok(css.includes('.mesa-render-card.esperando_parcial'), 'CSS must include .mesa-render-card.esperando_parcial');
      assert.ok(css.includes('#f59e0b'), 'esperando_parcial must use amber #f59e0b');
      assert.ok(css.includes('.m-wait-chip'), 'CSS must include .m-wait-chip');
      assert.ok(css.includes('.mesa-tooltip'), 'CSS must include .mesa-tooltip');
    });

    it('S4.2: public/index.html includes Esperando Parcial and Activa in legend', () => {
      const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
      assert.ok(html.includes('legend-badge esperando_parcial'), 'Legend must contain esperando_parcial badge');
      assert.ok(html.includes('legend-badge activa'), 'Legend must contain activa badge');
    });

    it('S4.3: public/app.js maps activa and esperando_parcial labels and exports helpers', () => {
      const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
      assert.ok(appJs.includes("activa: 'Activa'"), "app.js must map activa: 'Activa'");
      assert.ok(appJs.includes("esperando_parcial: 'Esperando Parcial'"), "app.js must map esperando_parcial: 'Esperando Parcial'");
      assert.ok(appJs.includes('m-wait-chip'), 'app.js must render m-wait-chip');
      assert.ok(appJs.includes('mesa-tooltip'), 'app.js must render mesa-tooltip');
    });
  });
});
