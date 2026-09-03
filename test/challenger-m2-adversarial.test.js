const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('./helpers/test-server');

describe('Empirical Challenger Adversarial M2: KDS States, Partials & Tooltips Deep Stress', { concurrency: 1 }, () => {
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

  // ==========================================================================
  // SUITE 1: SINGLE-DISH FAST TRANSITIONS & BOUNDARY STATES
  // ==========================================================================
  describe('Suite 1: Single-Dish Boundary Transitions', () => {
    it('ADV1.1: Single kitchen dish transitions directly esperando -> activa without ever entering esperando_parcial', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          items: [{ nombre: 'Chifrijo Tradicional', precio: 5800, cantidad: 1, destino: 'cocina' }]
        }
      });
      assert.strictEqual(sendRes.status, 200);

      // Verify table is esperando
      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 1');
      assert.strictEqual(mesa.estado, 'esperando');

      const items = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(items.length, 1);

      // Mark the only item listo
      const kdsRes = await server.request(`/api/kds/${items[0].id}/estado`, {
        method: 'POST',
        body: { estado: 'listo' }
      });
      assert.strictEqual(kdsRes.status, 200);
      assert.strictEqual(kdsRes.data.nuevoEstadoMesa, 'activa', 'Single item completed must skip esperando_parcial and go straight to activa');

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 1');
      assert.strictEqual(mesa.estado, 'activa');

      const orden = await server.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(orden.estado, 'activa');
    });

    it('ADV1.2: Single kitchen dish reversibility: listo -> preparando reverts table directly activa -> esperando', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 2,
          items: [{ nombre: 'Corte Rib Eye 350g', precio: 14500, cantidad: 1, destino: 'cocina' }]
        }
      });
      const items = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [sendRes.data.ordenId]);
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 2');
      assert.strictEqual(mesa.estado, 'activa');

      // Revert to preparando
      const revRes = await server.request(`/api/kds/${items[0].id}/estado`, {
        method: 'POST',
        body: { estado: 'preparando' }
      });
      assert.strictEqual(revRes.status, 200);
      assert.strictEqual(revRes.data.nuevoEstadoMesa, 'esperando');

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 2');
      assert.strictEqual(mesa.estado, 'esperando');
    });
  });

  // ==========================================================================
  // SUITE 2: MIXED DESTINATION (COCINA VS BARRA) ISOLATION
  // ==========================================================================
  describe('Suite 2: Cocina vs Barra Isolation & Immune State Mechanics', () => {
    it('ADV2.1: Drinks only in an order never cause esperando, esperando_parcial, or activa', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 3,
          items: [
            { nombre: 'Cerveza Imperial', precio: 1800, cantidad: 2, destino: 'barra' },
            { nombre: 'Mojito Cubano', precio: 3500, cantidad: 1, destino: 'barra' }
          ]
        }
      });
      assert.strictEqual(sendRes.status, 200);
      assert.strictEqual(sendRes.data.tieneCocina, false);
      assert.strictEqual(sendRes.data.estado, 'abierta');

      const mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 3');
      assert.strictEqual(mesa.estado, 'abierta');

      const esperaRes = await server.request('/api/mesas/3/espera');
      assert.strictEqual(esperaRes.data.platos_pendientes.length, 0, 'Drinks must not appear as platos pendientes');
      assert.strictEqual(esperaRes.data.minutos_espera, 0);
    });

    it('ADV2.2: Mixed order: Bar items do not count towards kitchen completion or tooltip pending count', async () => {
      // 1 kitchen dish + 2 bar drinks
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 4,
          items: [
            { nombre: 'Hamburguesa Clásica', precio: 6500, cantidad: 1, destino: 'cocina' },
            { nombre: 'Cerveza Pilsen', precio: 1800, cantidad: 1, destino: 'barra' },
            { nombre: 'Gin Tonic', precio: 4000, cantidad: 1, destino: 'barra' }
          ]
        }
      });
      assert.strictEqual(sendRes.status, 200);

      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 4');
      assert.strictEqual(mesa.estado, 'esperando');

      // Check tooltip contains ONLY Hamburguesa Clásica
      let mesasRes = await server.request('/api/mesas');
      let m4 = mesasRes.data.mesas.find(m => m.id === 4);
      assert.strictEqual(m4.platos_pendientes.length, 1);
      assert.strictEqual(m4.platos_pendientes[0], 'Hamburguesa Clásica');

      // Mark the kitchen dish listo
      const items = await server.dbAll('SELECT id, destino FROM DetalleOrden WHERE orden_id = ?', [sendRes.data.ordenId]);
      const kitchenItem = items.find(i => i.destino === 'cocina');
      await server.request(`/api/kds/${kitchenItem.id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      // Table must transition to activa even though bar items have no KDS status
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 4');
      assert.strictEqual(mesa.estado, 'activa');

      // Platos pendientes must be empty
      mesasRes = await server.request('/api/mesas');
      m4 = mesasRes.data.mesas.find(m => m.id === 4);
      assert.strictEqual(m4.platos_pendientes.length, 0);
    });

    it('ADV2.3: Adding drinks to an activa table preserves activa state; adding food reverts to esperando', async () => {
      // Create and complete 1 kitchen dish
      const res1 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 5,
          items: [{ nombre: 'Ceviche Mixto', precio: 6900, cantidad: 1, destino: 'cocina' }]
        }
      });
      const items = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [res1.data.ordenId]);
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 5');
      assert.strictEqual(mesa.estado, 'activa');

      // Add a drink
      const res2 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 5,
          items: [{ nombre: 'Vino Tinto Copa', precio: 3800, cantidad: 1, destino: 'barra' }]
        }
      });
      assert.strictEqual(res2.data.estado, 'activa', 'Adding drinks to an activa table must keep it activa');
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 5');
      assert.strictEqual(mesa.estado, 'activa');

      // Now add a new kitchen dish (Postre)
      const res3 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 5,
          items: [{ nombre: 'Tres Leches', precio: 3200, cantidad: 1, destino: 'cocina' }]
        }
      });
      assert.strictEqual(res3.data.estado, 'esperando', 'Adding new kitchen food must transition table back to esperando');
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 5');
      assert.strictEqual(mesa.estado, 'esperando');

      // Mark the dessert listo -> returns to activa
      const newItems = await server.dbAll("SELECT id FROM DetalleOrden WHERE orden_id = ? AND nombre_producto = 'Tres Leches'", [res1.data.ordenId]);
      await server.request(`/api/kds/${newItems[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 5');
      assert.strictEqual(mesa.estado, 'activa');
    });
  });

  // ==========================================================================
  // SUITE 3: MULTI-COURSE PROGRESSIVE PARTIAL DELIVERY & REVERSIBILITY
  // ==========================================================================
  describe('Suite 3: 4-Course Progressive Dispatch & Double Reversibility', () => {
    it('ADV3.1: 4 dishes (Entrada, Fuerte 1, Fuerte 2, Postre) correctly traverse esperando -> esperando_parcial (3 steps) -> activa', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 6,
          items: [
            { nombre: 'Ceviche Mixto', precio: 6900, cantidad: 1, destino: 'cocina', curso: 1 },
            { nombre: 'Rib Eye Steak', precio: 14500, cantidad: 1, destino: 'cocina', curso: 2 },
            { nombre: 'Salmón a la Plancha', precio: 12500, cantidad: 1, destino: 'cocina', curso: 2 },
            { nombre: 'Cheesecake', precio: 3500, cantidad: 1, destino: 'cocina', curso: 3 }
          ]
        }
      });
      const items = await server.dbAll('SELECT id, nombre_producto FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [sendRes.data.ordenId]);
      assert.strictEqual(items.length, 4);

      // Initial state: esperando, 4 pending
      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando');

      let mesasRes = await server.request('/api/mesas');
      let m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 4);

      // 1. Mark Ceviche listo -> esperando_parcial (3 pending)
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando_parcial');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 3);
      assert.ok(!m6.platos_pendientes.includes('Ceviche Mixto'));

      // 2. Mark Rib Eye listo -> still esperando_parcial (2 pending)
      await server.request(`/api/kds/${items[1].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando_parcial');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 2);
      assert.deepStrictEqual(m6.platos_pendientes, ['Salmón a la Plancha', 'Cheesecake']);

      // 3. Mark Salmón listo -> still esperando_parcial (1 pending)
      await server.request(`/api/kds/${items[2].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando_parcial');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 1);
      assert.deepStrictEqual(m6.platos_pendientes, ['Cheesecake']);

      // 4. Mark Cheesecake listo -> activa (0 pending)
      await server.request(`/api/kds/${items[3].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'activa');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 0);

      // Reversibility: un-mark Cheesecake to pendiente -> returns to esperando_parcial with Cheesecake
      await server.request(`/api/kds/${items[3].id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando_parcial');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.deepStrictEqual(m6.platos_pendientes, ['Cheesecake']);

      // Reversibility: un-mark all remaining 3 dishes to pendiente -> returns to esperando with all 4
      await server.request(`/api/kds/${items[2].id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      await server.request(`/api/kds/${items[1].id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 6');
      assert.strictEqual(mesa.estado, 'esperando');
      mesasRes = await server.request('/api/mesas');
      m6 = mesasRes.data.mesas.find(m => m.id === 6);
      assert.strictEqual(m6.platos_pendientes.length, 4);
    });
  });

  // ==========================================================================
  // SUITE 4: CANCELLATION (ANULACIÓN) MATRIX & TOTAL RECALCULATION
  // ==========================================================================
  describe('Suite 4: Item Cancellation Edge Cases & State Pruning', () => {
    it('ADV4.1: Cancelling all pending dishes leaves only ready dishes -> transitions table to activa', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 7,
          items: [
            { nombre: 'Plato Listo', precio: 5000, cantidad: 1, destino: 'cocina' },
            { nombre: 'Plato Pendiente 1', precio: 4000, cantidad: 1, destino: 'cocina' },
            { nombre: 'Plato Pendiente 2', precio: 3000, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const items = await server.dbAll('SELECT id, nombre_producto FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [sendRes.data.ordenId]);
      
      // Mark first dish listo -> esperando_parcial
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 7');
      assert.strictEqual(mesa.estado, 'esperando_parcial');

      // Cancel second dish (Pendiente 1) -> still esperando_parcial because Pendiente 2 remains
      await server.request('/api/comandas/anular-item', {
        method: 'POST',
        body: { detalleId: items[1].id, motivo: 'Cancelado por demora', supervisorPin: '1234', mesaNumero: 'Mesa 7' }
      });
      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 7');
      assert.strictEqual(mesa.estado, 'esperando_parcial');

      // Cancel third dish (Pendiente 2) -> now only Plato Listo remains non-anulado -> table transitions to activa!
      const anularRes2 = await server.request('/api/comandas/anular-item', {
        method: 'POST',
        body: { detalleId: items[2].id, motivo: 'Cancelado por cliente', supervisorPin: '1234', mesaNumero: 'Mesa 7' }
      });
      assert.strictEqual(anularRes2.status, 200);
      assert.strictEqual(anularRes2.data.nuevoEstado, 'activa');

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 7');
      assert.strictEqual(mesa.estado, 'activa');

      const orden = await server.dbGet('SELECT estado, subtotal FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(orden.estado, 'activa');
      assert.strictEqual(orden.subtotal, 5000);
    });

    it('ADV4.2: Cancelling the only kitchen item in an order transitions table to abierta', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 8,
          items: [{ nombre: 'Corte Especial', precio: 15000, cantidad: 1, destino: 'cocina' }]
        }
      });
      const items = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [sendRes.data.ordenId]);

      // Cancel it
      const anularRes = await server.request('/api/comandas/anular-item', {
        method: 'POST',
        body: { detalleId: items[0].id, motivo: 'Error de digitación', supervisorPin: '1234', mesaNumero: 'Mesa 8' }
      });
      assert.strictEqual(anularRes.status, 200);
      assert.strictEqual(anularRes.data.nuevoEstado, 'abierta', 'Table with zero active kitchen items must become abierta');

      const mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = 8');
      assert.strictEqual(mesa.estado, 'abierta');

      const orden = await server.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [sendRes.data.ordenId]);
      assert.strictEqual(orden.estado, 'abierta');
    });
  });

  // ==========================================================================
  // SUITE 5: WAIT TIME PRECISION & MULTI-ORDER ANCHORING
  // ==========================================================================
  describe('Suite 5: Elapsed Wait Time & Anchor Invariance', () => {
    it('ADV5.1: Wait time calculates from the earliest comanda timestamp, not subsequent additions', async () => {
      // Create comanda with timestamp 20 minutes in the past
      const sendRes1 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 9,
          items: [{ nombre: 'Plato Primer Envío', precio: 6000, cantidad: 1, destino: 'cocina' }]
        }
      });
      const ordenId = sendRes1.data.ordenId;
      const items1 = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);

      // Manually backdate the first item's hora_pedido and creado_en by 20 minutes (1200000 ms)
      const pastDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      await server.dbRun('UPDATE DetalleOrden SET hora_pedido = ?, creado_en = ? WHERE id = ?', [pastDate, pastDate, items1[0].id]);

      // Verify wait time is 20 minutes
      let espera = await server.request('/api/mesas/9/espera');
      assert.strictEqual(espera.data.minutos_espera, 20);
      assert.strictEqual(espera.data.tooltip.titulo, '⏱️ Esperando hace 20 min');

      // Now send a SECOND kitchen dish at current time
      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 9,
          items: [{ nombre: 'Plato Segundo Envío', precio: 7000, cantidad: 1, destino: 'cocina' }]
        }
      });

      // Verify wait time is STILL calculated from the first comanda (~20 minutes), NOT reset to 0
      espera = await server.request('/api/mesas/9/espera');
      assert.strictEqual(espera.data.minutos_espera, 20, 'Wait time anchor must remain the earliest comanda');
      assert.strictEqual(espera.data.platos_pendientes.length, 2);
      assert.ok(espera.data.platos_pendientes.includes('Plato Primer Envío'));
      assert.ok(espera.data.platos_pendientes.includes('Plato Segundo Envío'));

      // Check GET /api/mesas also reflects 20 minutes
      const mesasRes = await server.request('/api/mesas');
      const m9 = mesasRes.data.mesas.find(m => m.id === 9);
      assert.strictEqual(m9.minutos_espera, 20);
      assert.strictEqual(m9.platos_pendientes.length, 2);
    });

    it('ADV5.2: Tooltip renders cleanly when table is in esperando_parcial with only remaining dishes', async () => {
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          items: [
            { nombre: 'Entrada Lista', precio: 4000, cantidad: 1, destino: 'cocina' },
            { nombre: 'Plato Principal Pendiente', precio: 9000, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const items = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [sendRes.data.ordenId]);
      await server.request(`/api/kds/${items[0].id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      const espera = await server.request('/api/mesas/10/espera');
      assert.strictEqual(espera.data.estado, 'esperando_parcial');
      assert.strictEqual(espera.data.platos_pendientes.length, 1);
      assert.strictEqual(espera.data.platos_pendientes[0], 'Plato Principal Pendiente');
      assert.strictEqual(espera.data.tooltip.items.length, 1);
      assert.strictEqual(espera.data.tooltip.items[0], 'Plato Principal Pendiente');
      assert.ok(espera.data.tooltip.tooltipText.includes('• Plato Principal Pendiente'));
      assert.ok(!espera.data.tooltip.tooltipText.includes('Entrada Lista'));
    });
  });

  // ==========================================================================
  // SUITE 6: PURE DOMAIN ORACLE & SANITIZATION STRESS
  // ==========================================================================
  describe('Suite 6: Domain Oracle & XSS / Character Resilience', () => {
    it('ADV6.1: Product names with HTML special characters (<, >, &, \") are safely stored and returned without crashing', async () => {
      const rawName = 'Tacos <Especial> & "Picantes"';
      const sendRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 11,
          items: [{ nombre: rawName, precio: 5000, cantidad: 1, destino: 'cocina' }]
        }
      });
      assert.strictEqual(sendRes.status, 200);

      const espera = await server.request('/api/mesas/11/espera');
      assert.strictEqual(espera.status, 200);
      assert.strictEqual(espera.data.platos_pendientes[0], rawName);

      const mesasRes = await server.request('/api/mesas');
      const m11 = mesasRes.data.mesas.find(m => m.id === 11);
      assert.strictEqual(m11.platos_pendientes[0], rawName);
    });

    it('ADV6.2: Combinatorial Fuzz on 100 randomized dish status states against app.js implementation', () => {
      // Extract function directly from public/app.js
      const appJsCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
      const match = appJsCode.match(/function evaluarEstadoMesaKDS\(detalles = \[\]\) \{[\s\S]*?\n\}/);
      assert.ok(match, 'evaluarEstadoMesaKDS must exist in app.js');
      const evalFn = new Function('detalles', `${match[0]}; return evaluarEstadoMesaKDS(detalles);`);

      const possibleStates = ['pendiente', 'preparando', 'listo', 'anulado'];
      
      for (let trial = 0; trial < 100; trial++) {
        const count = Math.floor(Math.random() * 8) + 1; // 1 to 8 items
        const items = [];
        for (let i = 0; i < count; i++) {
          const st = possibleStates[Math.floor(Math.random() * possibleStates.length)];
          const dest = Math.random() > 0.3 ? 'cocina' : 'barra';
          items.push({ estado_comanda: st, destino: dest, curso: 2, nombre_producto: `Item ${i}` });
        }

        // Compute expected state manually
        const activeKitchen = items.filter(it => it.destino === 'cocina' && it.estado_comanda !== 'anulado');
        let expected;
        if (!activeKitchen.length) {
          expected = 'abierta';
        } else {
          const listos = activeKitchen.filter(it => it.estado_comanda === 'listo');
          const pendientes = activeKitchen.filter(it => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando');
          if (pendientes.length === 0 && listos.length > 0) expected = 'activa';
          else if (listos.length > 0 && pendientes.length > 0) expected = 'esperando_parcial';
          else expected = 'esperando';
        }

        const computed = evalFn(items);
        assert.strictEqual(computed, expected, `Trial ${trial} failed: computed ${computed} vs expected ${expected}`);
      }
    });
  });
});
