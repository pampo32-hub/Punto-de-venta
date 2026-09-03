const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const cp = require('child_process');
const {
  startTestServer,
  evaluarBotonComanda,
  getFreePort
} = require('./helpers/test-server');

describe('Empirical Challenger 2: Milestone 1 Stress Harness', () => {
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
  // SUITE 1: SERVER EXPORT & EPHEMERAL PORT LIFECYCLE
  // ==========================================================================
  describe('Suite 1: Server Export & Multiple Require Resilience', () => {
    it('S1.1: Direct require of server.js exports { app, server, io } and does not auto-listen', () => {
      const exported = require('../server');
      assert.ok(exported.app, 'app must be exported');
      assert.ok(exported.server, 'server must be exported');
      assert.ok(exported.io, 'io must be exported');
      assert.strictEqual(typeof exported.app.use, 'function', 'app must be an Express app');
      assert.strictEqual(typeof exported.server.listen, 'function', 'server must be an http.Server');
      assert.strictEqual(typeof exported.io.emit, 'function', 'io must be a Socket.IO Server');
      assert.strictEqual(exported.server.listening, false, 'Server should NOT listen on require()');
    });

    it('S1.2: Multiple require calls return consistent module instance without re-executing server.listen', () => {
      const mod1 = require('../server');
      const mod2 = require('../server');
      assert.strictEqual(mod1, mod2, 'Repeated require() should return cached module instance');
      assert.strictEqual(mod1.server.listening, false, 'server should still not be listening');
    });

    it('S1.3: Ephemeral port binding on exported server listens, serves requests, and closes cleanly', async () => {
      const { server, app } = require('../server');
      const ephemeralPort = await getFreePort();

      try {
        await new Promise((resolve, reject) => {
          server.listen(ephemeralPort, '127.0.0.1', () => resolve());
          server.on('error', reject);
        });

        assert.strictEqual(server.listening, true, 'Server should be listening after server.listen()');

        // Make a request to ephemeral port
        const res = await fetch(`http://127.0.0.1:${ephemeralPort}/api/mesas`);
        assert.strictEqual(res.status, 200, 'HTTP GET /api/mesas should return 200 OK');
        const data = await res.json();
        assert.ok(data && Array.isArray(data.mesas), 'Response should contain an array of mesas');
      } finally {
        await new Promise((resolve) => server.close(resolve));
        assert.strictEqual(server.listening, false, 'Server should close cleanly');
      }
    });

    it('S1.4: Concurrent standalone server child processes spawn on distinct ports without collision', async () => {
      const port1 = await getFreePort();
      let port2 = await getFreePort();
      while (port2 === port1) {
        port2 = await getFreePort();
      }

      const spawnProc = (port) => {
        return new Promise((resolve, reject) => {
          const p = cp.spawn(process.execPath, [path.join(__dirname, '../server.js')], {
            env: { ...process.env, PORT: String(port) },
            stdio: ['pipe', 'pipe', 'pipe']
          });
          const timer = setTimeout(() => {
            p.kill('SIGKILL');
            reject(new Error(`Spawn timed out on port ${port}`));
          }, 5000);

          p.stdout.on('data', (d) => {
            if (d.toString().includes(`Puerto: ${port}`)) {
              clearTimeout(timer);
              resolve(p);
            }
          });
          p.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      };

      const [p1, p2] = await Promise.all([spawnProc(port1), spawnProc(port2)]);

      try {
        const res1 = await fetch(`http://127.0.0.1:${port1}/api/mesas`);
        const res2 = await fetch(`http://127.0.0.1:${port2}/api/mesas`);
        assert.strictEqual(res1.status, 200, `Server 1 on ${port1} should respond 200`);
        assert.strictEqual(res2.status, 200, `Server 2 on ${port2} should respond 200`);
      } finally {
        p1.kill('SIGTERM');
        p2.kill('SIGTERM');
      }
    });
  });

  // ==========================================================================
  // SUITE 2: SEQUENTIAL ORDER LIFECYCLES & TABLE STATE TRANSITIONS
  // ==========================================================================
  describe('Suite 2: Sequential Order Lifecycles & Table State Transitions', () => {
    it('S2.1: Full sequential lifecycle (libre -> drinks [abierta] -> food [esperando] -> drinks refill [esperando])', async () => {
      // Step 0: Ensure table 1 is libre
      const mesaInicial = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaInicial.estado, 'libre', 'Table 1 must initially be libre');

      // STEP A: Waiter adds drinks first (Imperial Regular, BEB01, id: 1)
      const drinkItems = [
        {
          producto_id: 1,
          nombre: 'Imperial Regular',
          precio: 1800,
          cantidad: 2,
          destino: 'barra',
          curso: 2,
          enviado: false
        }
      ];

      // A1: Client-side button logic evaluation
      const btnStateA = evaluarBotonComanda(drinkItems);
      assert.strictEqual(btnStateA.tieneNuevosCocina, false, 'Drinks only must NOT flag new kitchen items');
      assert.strictEqual(btnStateA.text, '💾 Guardar', 'Button must display 💾 Guardar');
      assert.strictEqual(btnStateA.className, 'btn-btn-cmd guardar', 'Button class must be guardar');

      // A2: Server dispatch
      const resA = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          mesero: 'Carlos Solano',
          items: drinkItems
        }
      });

      assert.strictEqual(resA.status, 200, 'Dispatch A should succeed with 200');
      assert.strictEqual(resA.data.tieneCocina, false, 'Response must confirm tieneCocina: false');
      assert.strictEqual(resA.data.estado, 'abierta', 'Response must return table state abierta');
      assert.strictEqual(resA.data.message, 'Comanda guardada con éxito');

      // A3: Verify DB states after Step A
      const mesaA = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaA.estado, 'abierta', 'DB Mesas.estado must transition from libre to abierta');

      const ordenA = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE mesa_id = 1 AND id = ?', [resA.data.ordenId]);
      assert.ok(ordenA, 'Order record must exist');
      assert.strictEqual(ordenA.estado, 'abierta', 'DB Ordenes.estado must be abierta for drinks');

      const detallesA = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [resA.data.ordenId]);
      assert.strictEqual(detallesA.length, 1, 'Exactly 1 item must exist in DetalleOrden');
      assert.strictEqual(detallesA[0].destino, 'barra', 'Detalle item destino must be barra');

      // STEP B: Waiter adds food next (Chifrijo Tradicional, ENT01, id: 8)
      // Existing drink is now marked enviado: true
      const existingDrinkA = { ...drinkItems[0], enviado: true, id_detalle_existente: detallesA[0].id };
      const newFoodItem = {
        producto_id: 8,
        nombre: 'Chifrijo Tradicional',
        precio: 5500,
        cantidad: 1,
        destino: 'cocina',
        curso: 2,
        enviado: false
      };
      const itemsB = [existingDrinkA, newFoodItem];

      // B1: Client-side button logic evaluation
      const btnStateB = evaluarBotonComanda(itemsB);
      assert.strictEqual(btnStateB.tieneNuevosCocina, true, 'New food item must flag tieneNuevosCocina: true');
      assert.strictEqual(btnStateB.text, '🔥 Enviar a Cocina', 'Button must switch to 🔥 Enviar a Cocina');
      assert.strictEqual(btnStateB.className, 'btn-btn-cmd cocina', 'Button class must be cocina');

      // B2: Server dispatch
      const resB = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          mesero: 'Carlos Solano',
          items: itemsB
        }
      });

      assert.strictEqual(resB.status, 200, 'Dispatch B should succeed with 200');
      assert.strictEqual(resB.data.tieneCocina, true, 'Response must confirm tieneCocina: true');
      assert.strictEqual(resB.data.estado, 'esperando', 'Response must return table state esperando');
      assert.strictEqual(resB.data.message, 'Comanda enviada a cocina');
      assert.strictEqual(resB.data.ordenId, ordenA.id, 'Must append to existing order ID');

      // B3: Verify DB states after Step B
      const mesaB = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaB.estado, 'esperando', 'DB Mesas.estado must transition from abierta to esperando');

      const ordenB = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenA.id]);
      assert.strictEqual(ordenB.estado, 'esperando', 'DB Ordenes.estado must transition to esperando');

      const detallesB = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenA.id]);
      assert.strictEqual(detallesB.length, 2, 'DetalleOrden must contain exactly 2 items');
      assert.strictEqual(detallesB[1].nombre_producto, 'Chifrijo Tradicional');
      assert.strictEqual(detallesB[1].destino, 'cocina');

      // STEP C: Waiter adds drinks next while food is in kitchen (Pilsen, BEB02, id: 2)
      // All prior items are marked enviado: true
      const existingFoodB = { ...newFoodItem, enviado: true, id_detalle_existente: detallesB[1].id };
      const newDrinkC = {
        producto_id: 2,
        nombre: 'Pilsen',
        precio: 1800,
        cantidad: 1,
        destino: 'barra',
        curso: 2,
        enviado: false
      };
      const itemsC = [existingDrinkA, existingFoodB, newDrinkC];

      // C1: Client-side button logic evaluation
      const btnStateC = evaluarBotonComanda(itemsC);
      assert.strictEqual(btnStateC.tieneNuevosCocina, false, 'Drink refill must NOT flag kitchen');
      assert.strictEqual(btnStateC.text, '💾 Guardar', 'Button must switch back to 💾 Guardar');
      assert.strictEqual(btnStateC.className, 'btn-btn-cmd guardar', 'Button class must be guardar');

      // C2: Server dispatch
      const resC = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          mesero: 'Carlos Solano',
          items: itemsC
        }
      });

      assert.strictEqual(resC.status, 200, 'Dispatch C should succeed with 200');
      assert.strictEqual(resC.data.tieneCocina, false, 'Response must confirm tieneCocina: false');
      assert.strictEqual(resC.data.estado, 'esperando', 'Table state MUST REMAIN esperando while food is pending');
      assert.strictEqual(resC.data.message, 'Comanda guardada con éxito');

      // C3: Verify DB states after Step C
      const mesaC = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 1');
      assert.strictEqual(mesaC.estado, 'esperando', 'DB Mesas.estado MUST NOT regress to abierta');

      const ordenC = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenA.id]);
      assert.strictEqual(ordenC.estado, 'esperando', 'DB Ordenes.estado must remain esperando');

      const detallesC = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [ordenA.id]);
      assert.strictEqual(detallesC.length, 3, 'DetalleOrden must now contain exactly 3 items');
      assert.strictEqual(detallesC[2].nombre_producto, 'Pilsen');
      assert.strictEqual(detallesC[2].destino, 'barra');

      // STEP D: Double-click or accidental re-save with NO new items
      const itemsD = itemsC.map(it => ({ ...it, enviado: true, id_detalle_existente: 999 }));
      const btnStateD = evaluarBotonComanda(itemsD);
      assert.strictEqual(btnStateD.tieneNuevosCocina, false);
      assert.strictEqual(btnStateD.text, '💾 Guardar');

      const resD = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 1,
          mesero: 'Carlos Solano',
          items: itemsD
        }
      });

      assert.strictEqual(resD.status, 200, 'Re-save with no new items must return 200');
      assert.strictEqual(resD.data.tieneCocina, false);
      assert.strictEqual(resD.data.message, 'Comanda guardada con éxito');

      // Verify no phantom items added to DetalleOrden
      const detallesD = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenA.id]);
      assert.strictEqual(detallesD.length, 3, 'DetalleOrden count must remain exactly 3');
    });

    it('S2.2: Mixed items (drinks + food together) on empty table transitions directly to esperando', async () => {
      const items = [
        {
          producto_id: 1,
          nombre: 'Imperial Regular',
          precio: 1800,
          cantidad: 2,
          destino: 'barra',
          curso: 2,
          enviado: false
        },
        {
          producto_id: 14,
          nombre: 'Hamburguesa Gastro',
          precio: 6500,
          cantidad: 1,
          destino: 'cocina',
          curso: 2,
          enviado: false
        }
      ];

      const btnState = evaluarBotonComanda(items);
      assert.strictEqual(btnState.tieneNuevosCocina, true);
      assert.strictEqual(btnState.text, '🔥 Enviar a Cocina');

      const res = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 2,
          mesero: 'Don Alberto',
          items
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, true);
      assert.strictEqual(res.data.estado, 'esperando');

      const mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 2');
      assert.strictEqual(mesa.estado, 'esperando');

      const orden = await serverInstance.dbGet('SELECT * FROM Ordenes WHERE id = ?', [res.data.ordenId]);
      assert.strictEqual(orden.estado, 'esperando');
    });

    it('S2.3: Socket.IO event spy validates real-time event filtering across lifecycles', async () => {
      const { server, io } = require('../server');
      const ephemeralPort = await getFreePort();

      try {
        await new Promise((resolve, reject) => {
          server.listen(ephemeralPort, '127.0.0.1', () => resolve());
          server.on('error', reject);
        });

        const emitted = [];
        const origEmit = io.emit;
        io.emit = function (event, ...args) {
          emitted.push({ event, args });
          return origEmit.apply(this, [event, ...args]);
        };

        try {
          // 1. Drinks dispatch on mesa 6
          emitted.length = 0;
          const res1 = await fetch(`http://127.0.0.1:${ephemeralPort}/api/comandas/enviar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mesaId: 6,
              mesero: 'Carlos Solano',
              items: [{ producto_id: 1, cantidad: 2, destino: 'barra', enviado: false }]
            })
          });
          assert.strictEqual(res1.status, 200);
          const ev1Names = emitted.map((e) => e.event);
          assert.ok(!ev1Names.includes('nueva_comanda'), 'nueva_comanda must NOT be emitted for drinks');
          assert.ok(ev1Names.includes('mesa_actualizada'), 'mesa_actualizada MUST be emitted');
          const mesaEv1 = emitted.find((e) => e.event === 'mesa_actualizada');
          assert.strictEqual(mesaEv1.args[0].estado, 'abierta', 'mesa_actualizada state must be abierta');

          // 2. Food dispatch on mesa 6
          emitted.length = 0;
          const res2 = await fetch(`http://127.0.0.1:${ephemeralPort}/api/comandas/enviar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mesaId: 6,
              mesero: 'Carlos Solano',
              items: [{ producto_id: 8, cantidad: 1, destino: 'cocina', enviado: false }]
            })
          });
          assert.strictEqual(res2.status, 200);
          const ev2Names = emitted.map((e) => e.event);
          assert.ok(ev2Names.includes('nueva_comanda'), 'nueva_comanda MUST be emitted for food');
          assert.ok(ev2Names.includes('mesa_actualizada'), 'mesa_actualizada MUST be emitted for food');
          const kdsEv = emitted.find((e) => e.event === 'nueva_comanda');
          assert.strictEqual(kdsEv.args[0].comandas.length, 1, 'KDS comanda must contain 1 item');
          assert.strictEqual(kdsEv.args[0].comandas[0].destino, 'cocina');
          const mesaEv2 = emitted.find((e) => e.event === 'mesa_actualizada');
          assert.strictEqual(mesaEv2.args[0].estado, 'esperando', 'mesa_actualizada state must be esperando');

          // 3. Drinks refill on mesa 6
          emitted.length = 0;
          const res3 = await fetch(`http://127.0.0.1:${ephemeralPort}/api/comandas/enviar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mesaId: 6,
              mesero: 'Carlos Solano',
              items: [{ producto_id: 2, cantidad: 1, destino: 'barra', enviado: false }]
            })
          });
          assert.strictEqual(res3.status, 200);
          const ev3Names = emitted.map((e) => e.event);
          assert.ok(!ev3Names.includes('nueva_comanda'), 'nueva_comanda must NOT be emitted for drink refill');
          assert.ok(ev3Names.includes('mesa_actualizada'), 'mesa_actualizada MUST be emitted');
          const mesaEv3 = emitted.find((e) => e.event === 'mesa_actualizada');
          assert.strictEqual(mesaEv3.args[0].estado, 'esperando', 'mesa_actualizada state must remain esperando');
        } finally {
          io.emit = origEmit;
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  // ==========================================================================
  // SUITE 3: EDGE CASES, PRODUCT FALLBACKS & RESILIENCE
  // ==========================================================================
  describe('Suite 3: Edge Cases, Inferred Destinations & Input Validation', () => {
    it('S3.1: Automatically resolves missing destino and precio from database catalog', async () => {
      // Send item without destino, precio, or nombre - server must look up in Productos table
      const items = [
        {
          producto_id: 1, // Imperial -> barra
          cantidad: 1,
          enviado: false
        }
      ];

      const res = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 3,
          mesero: 'Carlos Solano',
          items
        }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, false, 'Server should infer destino=barra from database');
      assert.strictEqual(res.data.estado, 'abierta', 'Table should be abierta');

      const detalle = await serverInstance.dbGet('SELECT * FROM DetalleOrden WHERE orden_id = ?', [res.data.ordenId]);
      assert.strictEqual(detalle.destino, 'barra');
      assert.strictEqual(detalle.nombre_producto, 'Imperial Regular');
      assert.strictEqual(detalle.precio_unitario, 1800);
    });

    it('S3.2: Rejects invalid payloads with appropriate HTTP status codes', async () => {
      // Missing items
      const resEmpty = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: { mesaId: 1, items: [] }
      });
      assert.strictEqual(resEmpty.status, 400);

      // Non-array items
      const resInvalid = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: { mesaId: 1, items: 'not-an-array' }
      });
      assert.strictEqual(resInvalid.status, 400);

      // Non-existent table
      const resNotFound = await serverInstance.request('/api/comandas/enviar', {
        method: 'POST',
        body: { mesaId: 99999, items: [{ producto_id: 1, cantidad: 1 }] }
      });
      assert.strictEqual(resNotFound.status, 404);
    });

    it('S3.3: Stress: 10 rapid sequential orders on same table append deterministically', async () => {
      for (let i = 1; i <= 10; i++) {
        const isFood = i % 2 === 0;
        const res = await serverInstance.request('/api/comandas/enviar', {
          method: 'POST',
          body: {
            mesaId: 4,
            mesero: 'Carlos Solano',
            items: [
              {
                producto_id: isFood ? 8 : 1,
                nombre: isFood ? `Plato ${i}` : `Bebida ${i}`,
                precio: 1000,
                cantidad: 1,
                destino: isFood ? 'cocina' : 'barra',
                curso: 2,
                enviado: false
              }
            ]
          }
        });
        assert.strictEqual(res.status, 200);
      }

      // Check that exactly ONE active order exists for Mesa 4
      const ordenes = await serverInstance.dbAll(
        "SELECT * FROM Ordenes WHERE mesa_id = 4 AND estado IN ('abierta', 'esperando', 'activa')",
        []
      );
      assert.strictEqual(ordenes.length, 1, 'Only one active order must exist for Mesa 4');

      // Check all 10 items recorded
      const detalles = await serverInstance.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenes[0].id]);
      assert.strictEqual(detalles.length, 10, 'All 10 items must be recorded in DetalleOrden');

      // Mesa state must be esperando since food was included
      const mesa = await serverInstance.dbGet('SELECT * FROM Mesas WHERE id = 4');
      assert.strictEqual(mesa.estado, 'esperando');
    });
  });
});
