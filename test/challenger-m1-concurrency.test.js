const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startTestServer, getFreePort } = require('./helpers/test-server');

describe('Empirical Challenger 2: Concurrency & Server Stability Stress Suite', () => {
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
  // SUITE 1: HIGH CONCURRENCY ON SINGLE TABLE (RACE CONDITION RESILIENCE)
  // ==========================================================================
  describe('Suite 1: High Concurrency on Single Table', () => {
    it('C1.1: 25 simultaneous requests to an active table all succeed with 200 and preserve "esperando" state', async () => {
      const mesaId = 1;
      const numRequests = 25;

      // First open table with initial order
      await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          mesero: 'Mesero Inicial',
          items: [{ producto_id: 8, nombre: 'Plato Inicial', precio: 5500, cantidad: 1, destino: 'cocina', curso: 2 }]
        }
      });

      // Half drinks, half food sent simultaneously to the open table
      const promises = Array.from({ length: numRequests }, (_, i) => {
        const isFood = i % 2 === 0;
        return serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            mesero: `Mesero ${i}`,
            items: [
              {
                producto_id: isFood ? 8 : 1, // 8 = Chifrijo (cocina, 5500), 1 = Imperial (barra, 1800)
                nombre: isFood ? `Plato ${i}` : `Bebida ${i}`,
                precio: isFood ? 5500 : 1800,
                cantidad: 1,
                destino: isFood ? 'cocina' : 'barra',
                curso: 2,
                enviado: false
              }
            ]
          }
        });
      });

      const responses = await Promise.all(promises);

      // 1. All must return 200 OK
      const non200 = responses.filter(r => r.status !== 200);
      assert.strictEqual(non200.length, 0, `All ${numRequests} concurrent requests must return 200 OK. Failures: ${JSON.stringify(non200)}`);

      // 2. Table state must remain esperando because food items were included and table had pending food
      const mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando', 'Mesa must remain in esperando state');

      // 3. Exactly numRequests + 1 items must be recorded in DetalleOrden
      const totalDetalles = await serverInstance.dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE mesa_id = ?)",
        [mesaId]
      );
      assert.strictEqual(totalDetalles.length, numRequests + 1, `DetalleOrden must contain exactly ${numRequests + 1} items`);
    });

    it('C1.2: 20 simultaneous drink-only requests to empty table transition table to "abierta" with zero kitchen leaks', async () => {
      const mesaId = 2;
      const numRequests = 20;

      const promises = Array.from({ length: numRequests }, (_, i) => {
        return serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            mesero: `Barman ${i}`,
            items: [
              {
                producto_id: 1,
                nombre: `Imperial ${i}`,
                precio: 1800,
                cantidad: 1,
                destino: 'barra',
                curso: 2,
                enviado: false
              }
            ]
          }
        });
      });

      const responses = await Promise.all(promises);
      const all200 = responses.every(r => r.status === 200);
      assert.ok(all200, 'All 20 drink requests must return 200 OK');

      const allNoKitchen = responses.every(r => r.data.tieneCocina === false);
      assert.ok(allNoKitchen, 'All responses must confirm tieneCocina: false');

      const mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'abierta', 'Table with only drinks must remain/transition to abierta');

      const kitchenItems = await serverInstance.dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE mesa_id = ?) AND destino = 'cocina'",
        [mesaId]
      );
      assert.strictEqual(kitchenItems.length, 0, 'No kitchen items should exist');
    });
  });

  // ==========================================================================
  // SUITE 2: MULTI-TABLE BURST THROUGHPUT & CROSS-TABLE ISOLATION
  // ==========================================================================
  describe('Suite 2: Multi-Table Burst Throughput & Cross-Table Isolation', () => {
    it('C2.1: 50 concurrent requests across 10 tables achieve 100% success without data cross-talk', async () => {
      const totalRequests = 50;
      const tables = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const promises = Array.from({ length: totalRequests }, (_, i) => {
        const mesaId = tables[i % tables.length];
        const isFood = (i % 3 === 0);
        return serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            mesero: `Mesero T${mesaId}`,
            cliente: `Cliente ${mesaId}-${i}`,
            items: [
              {
                producto_id: isFood ? 8 : 2,
                nombre: isFood ? `Chifrijo T${mesaId}` : `Pilsen T${mesaId}`,
                precio: isFood ? 5500 : 1800,
                cantidad: 1,
                destino: isFood ? 'cocina' : 'barra',
                curso: 2,
                enviado: false
              }
            ]
          }
        });
      });

      const responses = await Promise.all(promises);
      const failed = responses.filter(r => r.status !== 200);
      assert.strictEqual(failed.length, 0, `Expected 0 failed requests, but got ${failed.length}`);

      // Verify each table has exactly 5 items
      for (const mesaId of tables) {
        const detalles = await serverInstance.dbAll(
          `SELECT d.* FROM DetalleOrden d
           JOIN Ordenes o ON d.orden_id = o.id
           WHERE o.mesa_id = ?`,
          [mesaId]
        );
        assert.strictEqual(detalles.length, 5, `Table ${mesaId} must have exactly 5 items`);
        // Verify no items from other tables leaked in
        const wrongItems = detalles.filter(d => !d.nombre_producto.includes(`T${mesaId}`));
        assert.strictEqual(wrongItems.length, 0, `Table ${mesaId} should not have foreign items`);
      }
    });
  });

  // ==========================================================================
  // SUITE 3: RAPID ALTERNATING BURSTS & KITCHEN STATE PRESERVATION
  // ==========================================================================
  describe('Suite 3: Rapid Alternating Bursts & Kitchen State Preservation', () => {
    it('C3.1: Sequential rapid bursts of food then drinks keep mesa in "esperando" state', async () => {
      const mesaId = 3;

      // Burst 1: 5 food items
      const burst1 = await Promise.all(Array.from({ length: 5 }, (_, i) => 
        serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            items: [{ producto_id: 8, nombre: `Comida ${i}`, precio: 5000, cantidad: 1, destino: 'cocina', curso: 2 }]
          }
        })
      ));
      assert.ok(burst1.every(r => r.status === 200));

      let mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando');

      // Burst 2: 10 drinks added to active order with food
      const burst2 = await Promise.all(Array.from({ length: 10 }, (_, i) => 
        serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId,
            items: [{ producto_id: 1, nombre: `Trago ${i}`, precio: 2000, cantidad: 1, destino: 'barra', curso: 2 }]
          }
        })
      ));
      assert.ok(burst2.every(r => r.status === 200));

      // Mesa must still be esperando because food items are not dispatched
      mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando', 'Mesa MUST retain esperando state after drink refills');

      // Total items must be 15
      const totalItems = await serverInstance.dbAll(
        'SELECT * FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE mesa_id = ?)',
        [mesaId]
      );
      assert.strictEqual(totalItems.length, 15);
    });
  });

  // ==========================================================================
  // SUITE 4: SOCKET.IO EMISSIONS INTEGRITY UNDER LOAD
  // ==========================================================================
  describe('Suite 4: Socket.IO Event Emissions Integrity Under Concurrent Load', () => {
    it('C4.1: Socket.IO filters nueva_comanda strictly to kitchen items during concurrent traffic', async () => {
      const { server, io } = require('../server');
      const ephemeralPort = await getFreePort();

      await new Promise((resolve) => server.listen(ephemeralPort, '127.0.0.1', resolve));

      const emitted = [];
      const origEmit = io.emit;
      io.emit = function (event, ...args) {
        emitted.push({ event, args, timestamp: Date.now() });
        return origEmit.apply(this, [event, ...args]);
      };

      try {
        // Send 10 concurrent requests: 6 drinks, 4 food
        const requests = Array.from({ length: 10 }, (_, i) => {
          const isFood = i < 4;
          return fetch(`http://127.0.0.1:${ephemeralPort}/api/comandas/enviar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mesaId: 5,
              mesero: 'Socket Tester',
              items: [
                {
                  producto_id: isFood ? 8 : 1,
                  nombre: isFood ? `Hamburguesa ${i}` : `Cerveza ${i}`,
                  precio: 2000,
                  cantidad: 1,
                  destino: isFood ? 'cocina' : 'barra',
                  curso: 2,
                  enviado: false
                }
              ]
            })
          });
        });

        const responses = await Promise.all(requests);
        assert.ok(responses.every(r => r.status === 200), 'All requests must return 200 OK');

        // Check emitted events
        const nuevaComandaEvents = emitted.filter(e => e.event === 'nueva_comanda');
        assert.strictEqual(nuevaComandaEvents.length, 4, 'Exactly 4 nueva_comanda events must be emitted for 4 food items');

        for (const ev of nuevaComandaEvents) {
          const comandas = ev.args[0]?.comandas || [];
          assert.ok(comandas.length > 0, 'Comanda array must not be empty');
          assert.ok(comandas.every(c => c.destino === 'cocina'), 'All items in nueva_comanda must have destino=cocina');
        }

        const mesaActualizadaEvents = emitted.filter(e => e.event === 'mesa_actualizada');
        assert.strictEqual(mesaActualizadaEvents.length, 10, 'Exactly 10 mesa_actualizada events must be emitted');
      } finally {
        io.emit = origEmit;
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  // ==========================================================================
  // SUITE 5: FRONTEND STATE MACHINE COMBINATORIAL & FUZZ STRESS TEST
  // ==========================================================================
  describe('Suite 5: Frontend State Machine Combinatorial & Fuzz Stress Test', () => {
    it('C5.1: 500 randomized ticket operations strictly maintain button and badge contract', () => {
      const appCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

      const elements = {};
      function getOrCreateEl(id) {
        if (!elements[id]) {
          elements[id] = {
            id,
            innerHTML: '',
            textContent: '',
            className: '',
            style: {},
            classList: { add: () => {}, remove: () => {}, contains: () => false },
            addEventListener: () => {}
          };
        }
        return elements[id];
      }

      const mockDoc = {
        getElementById: (id) => getOrCreateEl(id),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
      };

      const context = {
        window: { alert: () => {}, confirm: () => true },
        document: mockDoc,
        navigator: {},
        localStorage: { getItem: () => null, setItem: () => {} },
        io: () => ({ on: () => {}, emit: () => {} }),
        alert: () => {},
        confirm: () => true,
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        formatCRC: (v) => 'CRC ' + v,
        solicitarAnulacionItem: () => {},
        setTimeout, clearTimeout, setInterval, clearInterval
      };

      const fn = new Function(
        ...Object.keys(context),
        appCode + '; return { estado, actualizarBotonEnviarComanda, renderTicketItems, agregarAlTicketOneTap: window.agregarAlTicketOneTap, modificarCantidadTicket: window.modificarCantidadTicket };'
      );
      const runtime = fn(...Object.values(context));

      runtime.estado.productos = [
        { id: 1, nombre: 'Imperial Regular', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
        { id: 2, nombre: 'Pilsen', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
        { id: 3, nombre: 'Michelada', precio: 2200, destino: 'barra', curso: 2, happyHour: 0 },
        { id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, destino: 'cocina', curso: 2, happyHour: 0 },
        { id: 9, nombre: 'Hamburguesa GastroBar', precio: 5200, destino: 'cocina', curso: 2, happyHour: 0 },
        { id: 10, nombre: 'Papas Supremas', precio: 3800, destino: 'cocina', curso: 1, happyHour: 0 }
      ];

      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      const btn = elements['btnEnviarComandaCocina'];
      const mobCount = elements['mobTicketCount'];

      let invariantFailures = 0;

      for (let step = 0; step < 500; step++) {
        const action = Math.floor(Math.random() * 6);
        const prodId = [1, 2, 3, 8, 9, 10][Math.floor(Math.random() * 6)];

        switch (action) {
          case 0: // Add item one-tap
          case 1:
            runtime.agregarAlTicketOneTap(prodId);
            break;
          case 2: // Increment quantity
            if (runtime.estado.mesaActiva.items.length > 0) {
              const idx = Math.floor(Math.random() * runtime.estado.mesaActiva.items.length);
              runtime.modificarCantidadTicket(idx, 1);
            }
            break;
          case 3: // Decrement quantity (can trigger deletion)
            if (runtime.estado.mesaActiva.items.length > 0) {
              const idx = Math.floor(Math.random() * runtime.estado.mesaActiva.items.length);
              runtime.modificarCantidadTicket(idx, -1);
            }
            break;
          case 4: // Mark sent (simulate send)
            runtime.estado.mesaActiva.items.forEach(it => it.enviado = true);
            runtime.actualizarBotonEnviarComanda();
            break;
          case 5: // Clear all items
            runtime.estado.mesaActiva.items = [];
            runtime.renderTicketItems();
            break;
        }

        // Verify invariant:
        const items = runtime.estado.mesaActiva.items || [];
        const hasUnsentKitchen = items.some(it => 
          !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
        );

        const expectedText = hasUnsentKitchen ? '🔥 Enviar a Cocina' : '💾 Guardar';
        const expectedClass = hasUnsentKitchen ? 'btn-btn-cmd cocina' : 'btn-btn-cmd guardar';

        if (btn.innerHTML !== expectedText || btn.className !== expectedClass) {
          invariantFailures++;
        }

        if (items.length === 0) {
          if (mobCount && mobCount.textContent !== 0 && mobCount.textContent !== '0') {
            invariantFailures++;
          }
        }
      }

      assert.strictEqual(invariantFailures, 0, `Zero invariant violations across 500 random operations`);
    });
  });
});
