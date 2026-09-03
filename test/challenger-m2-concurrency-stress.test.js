const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const {
  startTestServer,
  evaluarEstadoMesaKDS
} = require('./helpers/test-server');

describe('Empirical Challenger M2: Concurrency, Deadlock & Stress Testing', () => {
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
  // SUITE 1: Multi-Table Concurrent KDS Dispatches (No SQLITE_BUSY / Deadlocks)
  // ==========================================================================
  describe('Suite 1: Multi-Table Concurrent KDS Dispatches', () => {
    it('C1.1: 6 tables with 3 dishes each (18 concurrent requests) dispatch without error or deadlocks', async () => {
      const tableIds = [1, 6, 7, 8, 9, 10]; // Mesas validas
      const createdDetalles = [];

      // Setup 6 tables with 3 dishes each
      for (const mesaId of tableIds) {
        const envRes = await server.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            mesero: 'Mesero Concurrente',
            items: [
              { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' },
              { id: 9, nombre: 'Alitas BBQ', precio: 5200, cantidad: 1, destino: 'cocina' },
              { id: 14, nombre: 'Hamburguesa', precio: 5800, cantidad: 1, destino: 'cocina' }
            ]
          }
        });
        assert.strictEqual(envRes.status, 200, `Failed to create order on mesa ${mesaId}`);
        const ordenId = envRes.data.ordenId;
        const items = await server.dbAll('SELECT id, orden_id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
        assert.strictEqual(items.length, 3);
        createdDetalles.push(...items.map((it, idx) => ({ ...it, mesaId, index: idx })));
      }

      assert.strictEqual(createdDetalles.length, 18);

      // Now dispatch all 18 dishes concurrently:
      const dispatchPromises = createdDetalles.map((d) =>
        server.request(`/api/kds/${d.id}/estado`, {
          method: 'POST',
          body: { estado: 'listo' }
        })
      );

      const results = await Promise.all(dispatchPromises);

      // Verify EVERY dispatch succeeded with 200 (no SQLITE_BUSY, no 500)
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        assert.strictEqual(res.status, 200, `Dispatch ${i} for detalle ${createdDetalles[i].id} failed with status ${res.status}`);
      }

      // Verify every table transitioned to 'activa'
      for (const mesaId of tableIds) {
        const mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
        assert.strictEqual(mesa.estado, 'activa', `Mesa ${mesaId} should be 'activa' after all dishes listo`);

        const orden = await server.dbGet("SELECT estado FROM Ordenes WHERE mesa_id = ? AND estado = 'activa'", [mesaId]);
        assert.ok(orden, `Mesa ${mesaId} should have an 'activa' order in SQLite`);

        // Tooltip wait stats check
        const esperaRes = await server.request(`/api/mesas/${mesaId}/espera`);
        assert.strictEqual(esperaRes.status, 200);
        assert.strictEqual(esperaRes.data.platos_pendientes.length, 0, `Mesa ${mesaId} should have 0 pending dishes`);
      }
    });
  });

  // ==========================================================================
  // SUITE 2: Same-Table Stampede (Massive Concurrent Updates to Single Table)
  // ==========================================================================
  describe('Suite 2: Same-Table High-Frequency Stampede', () => {
    it('C2.1: 10 concurrent dispatches on the same table converge deterministically to "activa"', async () => {
      const mesaId = 10;
      const itemsPayload = Array.from({ length: 10 }, (_, i) => ({
        id: 8,
        nombre: `Platillo Chef #${i + 1}`,
        precio: 3000,
        cantidad: 1,
        destino: 'cocina'
      }));

      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          mesero: 'Carlos Solano',
          items: itemsPayload
        }
      });
      assert.strictEqual(envRes.status, 200);
      const ordenId = envRes.data.ordenId;

      const detalles = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
      assert.strictEqual(detalles.length, 10);

      // Verify initial state is esperando
      const mesaInit = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesaInit.estado, 'esperando');

      // Fire 10 simultaneous dispatches to mark all 10 listo
      const stampede = detalles.map((d) =>
        server.request(`/api/kds/${d.id}/estado`, {
          method: 'POST',
          body: { estado: 'listo' }
        })
      );

      const stampedeResults = await Promise.all(stampede);
      for (const r of stampedeResults) {
        assert.strictEqual(r.status, 200, `Stampede update failed with status ${r.status}`);
      }

      // Verify all items are marked listo
      const finalDetalles = await server.dbAll('SELECT estado_comanda FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
      assert.ok(finalDetalles.every((d) => d.estado_comanda === 'listo'));

      // Verify table and order final state is 'activa'
      const mesaFinal = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesaFinal.estado, 'activa');

      const ordenFinal = await server.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [ordenId]);
      assert.strictEqual(ordenFinal.estado, 'activa');
    });

    it('C2.2: Partial concurrent dispatches leave table in "esperando_parcial" with exact pending count', async () => {
      const mesaId = 9;
      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          items: [
            { id: 8, nombre: 'Chifrijo 1', precio: 4500, cantidad: 1, destino: 'cocina' },
            { id: 9, nombre: 'Alitas 2', precio: 5200, cantidad: 1, destino: 'cocina' },
            { id: 11, nombre: 'Ceviche 3', precio: 6000, cantidad: 1, destino: 'cocina' },
            { id: 14, nombre: 'Hamburguesa 4', precio: 5500, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const ordenId = envRes.data.ordenId;
      const detalles = await server.dbAll('SELECT id, nombre_producto FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenId]);

      // Concurrently mark only the first 2 dishes as listo
      const [d1, d2] = [detalles[0], detalles[1]];
      const resPartial = await Promise.all([
        server.request(`/api/kds/${d1.id}/estado`, { method: 'POST', body: { estado: 'listo' } }),
        server.request(`/api/kds/${d2.id}/estado`, { method: 'POST', body: { estado: 'listo' } })
      ]);

      assert.strictEqual(resPartial[0].status, 200);
      assert.strictEqual(resPartial[1].status, 200);

      // Verify table is 'esperando_parcial'
      const mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando_parcial');

      // Verify tooltip returns exactly the 2 remaining dishes
      const espera = await server.request(`/api/mesas/${mesaId}/espera`);
      assert.strictEqual(espera.status, 200);
      assert.strictEqual(espera.data.estado, 'esperando_parcial');
      assert.strictEqual(espera.data.platos_pendientes.length, 2);
      assert.ok(espera.data.platos_pendientes.includes('Ceviche 3'));
      assert.ok(espera.data.platos_pendientes.includes('Hamburguesa 4'));
    });
  });

  // ==========================================================================
  // SUITE 3: Rapid State Reversals & Inverted Ordering
  // ==========================================================================
  describe('Suite 3: Rapid State Flip-Flops & Reversals', () => {
    it('C3.1: Sequential and concurrent un-marking correctly resets table from "activa" back to "esperando_parcial" and "esperando"', async () => {
      const mesaId = 11;
      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          items: [
            { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' },
            { id: 14, nombre: 'Hamburguesa', precio: 5500, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const ordenId = envRes.data.ordenId;
      const [it1, it2] = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenId]);

      // 1. Mark both listo -> table is activa
      await server.request(`/api/kds/${it1.id}/estado`, { method: 'POST', body: { estado: 'listo' } });
      await server.request(`/api/kds/${it2.id}/estado`, { method: 'POST', body: { estado: 'listo' } });

      let mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'activa');

      // 2. Revert dish 2 back to preparando -> table should revert to esperando_parcial
      const revRes = await server.request(`/api/kds/${it2.id}/estado`, { method: 'POST', body: { estado: 'preparando' } });
      assert.strictEqual(revRes.status, 200);
      assert.strictEqual(revRes.data.nuevoEstadoMesa, 'esperando_parcial');

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando_parcial');

      // 3. Revert dish 1 back to pendiente -> both are pending/preparando -> table reverts to esperando
      const revRes2 = await server.request(`/api/kds/${it1.id}/estado`, { method: 'POST', body: { estado: 'pendiente' } });
      assert.strictEqual(revRes2.status, 200);
      assert.strictEqual(revRes2.data.nuevoEstadoMesa, 'esperando');

      mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando');
    });
  });

  // ==========================================================================
  // SUITE 4: Concurrent KDS Dispatches vs Item Cancellation
  // ==========================================================================
  describe('Suite 4: Concurrent KDS Updates vs Item Cancellation', () => {
    it('C4.1: Concurrently marking a dish listo while cancelling remaining pending dishes evaluates to "activa"', async () => {
      const mesaId = 8; // Mesa VIP
      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          items: [
            { id: 8, nombre: 'Plato A Listo', precio: 4500, cantidad: 1, destino: 'cocina' },
            { id: 9, nombre: 'Plato B Anular', precio: 5000, cantidad: 1, destino: 'cocina' }
          ]
        }
      });
      const ordenId = envRes.data.ordenId;
      const [itA, itB] = await server.dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenId]);

      // Fire concurrent requests:
      // 1. Mark Plato A as listo
      // 2. Anulate Plato B with supervisor pin
      const [rListo, rAnular] = await Promise.all([
        server.request(`/api/kds/${itA.id}/estado`, {
          method: 'POST',
          body: { estado: 'listo' }
        }),
        server.request('/api/comandas/anular-item', {
          method: 'POST',
          body: {
            detalleId: itB.id,
            motivo: 'Cliente canceló el platillo',
            supervisorPin: '1234',
            mesaNumero: 'Mesa VIP'
          }
        })
      ]);

      assert.strictEqual(rListo.status, 200);
      assert.strictEqual(rAnular.status, 200);

      // The surviving active kitchen item is Plato A ('listo').
      // Therefore, the table MUST be 'activa'.
      const mesa = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'activa');

      const orden = await server.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [ordenId]);
      assert.strictEqual(orden.estado, 'activa');

      // Check tooltip: 0 pending dishes
      const espera = await server.request(`/api/mesas/${mesaId}/espera`);
      assert.strictEqual(espera.status, 200);
      assert.strictEqual(espera.data.platos_pendientes.length, 0);
    });
  });

  // ==========================================================================
  // SUITE 5: Real-Time Socket.IO Event Integrity Under Concurrency
  // ==========================================================================
  describe('Suite 5: Real-Time Socket.IO Event Integrity', () => {
    it('C5.1: Emits accurate comanda_estado_cambiado and mesa_actualizada events for all concurrent updates', async () => {
      const { server: appServer, io } = require('../server');
      const testPort = 55124;

      await new Promise((resolve, reject) => {
        appServer.listen(testPort, '127.0.0.1', () => resolve());
        appServer.on('error', reject);
      });

      const emittedEvents = [];
      const origEmit = io.emit;
      io.emit = function (event, ...args) {
        emittedEvents.push({ event, payload: args[0] });
        return origEmit.apply(this, [event, ...args]);
      };

      try {
        // Create an order via this running server
        const envRes = await fetch(`http://127.0.0.1:${testPort}/api/comandas/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mesaId: 7,
            mesero: 'Salonero Socket',
            items: [
              { id: 8, nombre: 'Platillo 1 Eventos', precio: 4500, cantidad: 1, destino: 'cocina' },
              { id: 9, nombre: 'Platillo 2 Eventos', precio: 5000, cantidad: 1, destino: 'cocina' }
            ]
          })
        });
        const envData = await envRes.json();
        const ordenId = envData.ordenId;

        const db = require('../database');
        const dbAll = (sql, p) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
        const items = await dbAll('SELECT id FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenId]);

        emittedEvents.length = 0; // reset for KDS updates

        // Dispatch both dishes concurrently
        const [d1Res, d2Res] = await Promise.all([
          fetch(`http://127.0.0.1:${testPort}/api/kds/${items[0].id}/estado`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'listo' })
          }),
          fetch(`http://127.0.0.1:${testPort}/api/kds/${items[1].id}/estado`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'listo' })
          })
        ]);

        assert.strictEqual(d1Res.status, 200);
        assert.strictEqual(d2Res.status, 200);

        // Verify emitted events
        const comandaEvents = emittedEvents.filter((e) => e.event === 'comanda_estado_cambiado');
        const mesaEvents = emittedEvents.filter((e) => e.event === 'mesa_actualizada');

        assert.strictEqual(comandaEvents.length, 2, 'Must emit exactly 2 comanda_estado_cambiado events');
        assert.ok(comandaEvents.some((e) => e.payload.detalleId === items[0].id && e.payload.estado === 'listo'));
        assert.ok(comandaEvents.some((e) => e.payload.detalleId === items[1].id && e.payload.estado === 'listo'));

        assert.ok(mesaEvents.length >= 2, 'Must emit at least 2 mesa_actualizada events');
        const lastMesaEv = mesaEvents[mesaEvents.length - 1];
        assert.strictEqual(lastMesaEv.payload.mesaId, 7);
        assert.strictEqual(lastMesaEv.payload.estado, 'activa');
      } finally {
        io.emit = origEmit;
        await new Promise((resolve) => appServer.close(resolve));
      }
    });
  });
});
