const fs = require('fs');
const http = require('http');
const assert = require('assert');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ============================================================================
// PART 1: FRONTEND STATE & BUTTON DYNAMICS EMPIRICAL TEST
// ============================================================================
function runFrontendEmpiricalSuite() {
  console.log('\n========================================================');
  console.log('>>> SUITE 1: Frontend Dynamic Button & State Transitions');
  console.log('========================================================');

  const appCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

  function createEnv() {
    const elements = {};
    function getOrCreateEl(id) {
      if (!elements[id]) {
        elements[id] = {
          id,
          innerHTML: '',
          textContent: '',
          className: '',
          style: {},
          classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
          },
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

    const mockWindow = { alert: () => {}, confirm: () => true };
    const context = {
      window: mockWindow,
      document: mockDoc,
      navigator: {},
      localStorage: { getItem: () => null, setItem: () => {} },
      io: () => ({ on: () => {}, emit: () => {} }),
      alert: () => {},
      confirm: () => true,
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      formatCRC: (v) => 'CRC ' + v,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval
    };

    const fn = new Function(
      ...Object.keys(context),
      appCode + '; return { estado, actualizarBotonEnviarComanda, renderTicketItems, modificarCantidadTicket: window.modificarCantidadTicket, agregarAlTicketOneTap: window.agregarAlTicketOneTap, solicitarAnulacionItem: window.solicitarAnulacionItem };'
    );
    const runtime = fn(...Object.values(context));

    runtime.estado.productos = [
      { id: 1, nombre: 'Imperial Regular', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
      { id: 2, nombre: 'Pilsen', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
      { id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, destino: 'cocina', curso: 2, happyHour: 0 },
      { id: 9, nombre: 'Hamburguesa GastroBar', precio: 5200, destino: 'cocina', curso: 2, happyHour: 0 }
    ];

    return { runtime, elements };
  }

  const results = [];

  // Subtest 1.1: 100% bar items
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    runtime.agregarAlTicketOneTap(1); // Imperial (bar)
    runtime.agregarAlTicketOneTap(2); // Pilsen (bar)
    const btn = elements['btnEnviarComandaCocina'];
    const pass = btn.innerHTML === '💾 Guardar' && btn.className === 'btn-btn-cmd guardar';
    results.push({ name: '1.1: 100% bar items displays "💾 Guardar"', pass, actual: btn.innerHTML });
  }

  // Subtest 1.2: Mixed items (bar + food)
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    runtime.agregarAlTicketOneTap(1); // Imperial (bar)
    runtime.agregarAlTicketOneTap(8); // Chifrijo (cocina)
    const btn = elements['btnEnviarComandaCocina'];
    const pass = btn.innerHTML === '🔥 Enviar a Cocina' && btn.className === 'btn-btn-cmd cocina';
    results.push({ name: '1.2: Mixed items (bar + food) displays "🔥 Enviar a Cocina"', pass, actual: btn.innerHTML });
  }

  // Subtest 1.3: Food deleted leaving only bar items
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    runtime.agregarAlTicketOneTap(1); // Imperial (bar)
    runtime.agregarAlTicketOneTap(8); // Chifrijo (cocina)
    runtime.modificarCantidadTicket(1, -1); // Delete Chifrijo
    const btn = elements['btnEnviarComandaCocina'];
    const pass = btn.innerHTML === '💾 Guardar' && btn.className === 'btn-btn-cmd guardar';
    results.push({ name: '1.3: Food deleted leaving only bar items toggles to "💾 Guardar"', pass, actual: btn.innerHTML });
  }

  // Subtest 1.4: Food items deleted back to 0 items (empty order)
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    runtime.agregarAlTicketOneTap(8); // Chifrijo (cocina)
    const btn = elements['btnEnviarComandaCocina'];
    assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina', 'Setup: button should be cocina');
    // Waiter clicks '-' to delete the single food item back to 0 items
    runtime.modificarCantidadTicket(0, -1);
    const pass = btn.innerHTML === '💾 Guardar' && btn.className === 'btn-btn-cmd guardar';
    results.push({
      name: '1.4: Food items deleted back to 0 items toggles to "💾 Guardar"',
      pass,
      actual: btn.innerHTML,
      detail: pass ? 'Passed' : `CRITICAL BUG: Button remained "${btn.innerHTML}" (class: "${btn.className}") when ticket items reached 0!`
    });
  }

  // Subtest 1.5: Multiple food items, all deleted to 0
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    runtime.agregarAlTicketOneTap(8); // Chifrijo
    runtime.agregarAlTicketOneTap(9); // Burger
    const btn = elements['btnEnviarComandaCocina'];
    assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
    runtime.modificarCantidadTicket(1, -1); // Delete Burger -> Chifrijo remains
    const intermediatePass = btn.innerHTML === '🔥 Enviar a Cocina';
    runtime.modificarCantidadTicket(0, -1); // Delete Chifrijo -> 0 items remain
    const pass = intermediatePass && btn.innerHTML === '💾 Guardar';
    results.push({
      name: '1.5: Multiple food items deleted sequentially to 0 items',
      pass,
      actual: btn.innerHTML,
      detail: pass ? 'Passed' : `Button failed to switch to "💾 Guardar" upon reaching 0 items (remained "${btn.innerHTML}")`
    });
  }

  // Subtest 1.6: Rapid 50-cycle addition and deletion
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
    runtime.actualizarBotonEnviarComanda();
    const btn = elements['btnEnviarComandaCocina'];
    let failures = 0;
    for (let i = 0; i < 50; i++) {
      runtime.agregarAlTicketOneTap(1); // Bar item
      if (btn.innerHTML !== '💾 Guardar') failures++;
      runtime.agregarAlTicketOneTap(8); // Food item added -> mixed
      if (btn.innerHTML !== '🔥 Enviar a Cocina') failures++;
      runtime.modificarCantidadTicket(1, -1); // Remove food item -> bar remains
      if (btn.innerHTML !== '💾 Guardar') failures++;
      runtime.modificarCantidadTicket(0, -1); // Remove bar item -> 0 items
      if (btn.innerHTML !== '💾 Guardar') failures++;
    }
    results.push({
      name: '1.6: Rapid 50-cycle item addition/deletion stress test',
      pass: failures === 0,
      actual: failures === 0 ? '0 failures / 200 transitions' : `${failures} failures / 200 transitions`
    });
  }

  // Subtest 1.7: Adding food after table order already sent
  {
    const { runtime, elements } = createEnv();
    runtime.estado.mesaActiva = {
      id: 1,
      numero: '1',
      estado: 'esperando',
      items: [
        { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina', curso: 2, enviado: true }
      ]
    };
    runtime.actualizarBotonEnviarComanda();
    const btn = elements['btnEnviarComandaCocina'];
    const initialSentPass = btn.innerHTML === '💾 Guardar';
    runtime.agregarAlTicketOneTap(9); // Add new burger (unsent)
    const afterFoodPass = btn.innerHTML === '🔥 Enviar a Cocina';
    runtime.modificarCantidadTicket(1, -1); // Delete new burger
    const afterDeletePass = btn.innerHTML === '💾 Guardar';

    const pass = initialSentPass && afterFoodPass && afterDeletePass;
    results.push({
      name: '1.7: Adding and deleting new food on already sent order',
      pass,
      actual: btn.innerHTML
    });
  }

  return results;
}

// ============================================================================
// PART 2: BACKEND REST & SOCKET.IO EVENT EMISSIONS EMPIRICAL TEST
// ============================================================================
async function runBackendEmpiricalSuite() {
  console.log('\n========================================================');
  console.log('>>> SUITE 2: Backend REST & Socket.IO Emissions');
  console.log('========================================================');

  const { app, server, io } = require('../server');

  // Verify server export: server must not be listening
  assert.strictEqual(server.listening, false, 'Server should not auto-listen on require()');

  // Spy on io.emit
  const emittedEvents = [];
  const originalEmit = io.emit.bind(io);
  io.emit = function(event, ...args) {
    emittedEvents.push({ event, args, timestamp: Date.now() });
    return originalEmit(event, ...args);
  };

  // Start ephemeral server
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`Ephemeral server listening on port: ${port}`);

  function makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {}
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(data) });
            } catch (_) {
              resolve({ status: res.statusCode, data });
            }
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Helper: query sqlite db directly
  const dbPath = path.join(__dirname, '../pos.db');
  const db = new sqlite3.Database(dbPath);
  const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
  const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this); }));

  const results = [];

  try {
    // Reset test tables 20 and 21 for deterministic tests
    await dbRun("DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE mesa_id IN (20, 21))");
    await dbRun("DELETE FROM Ordenes WHERE mesa_id IN (20, 21)");
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id IN (20, 21)");

    // Ensure mesa 20 exists
    let m20 = await dbGet("SELECT * FROM Mesas WHERE id = 20");
    if (!m20) {
      await dbRun("INSERT INTO Mesas (id, numero, zona_id, estado) VALUES (20, 'Mesa Test 20', 1, 'libre')");
    }
    let m21 = await dbGet("SELECT * FROM Mesas WHERE id = 21");
    if (!m21) {
      await dbRun("INSERT INTO Mesas (id, numero, zona_id, estado) VALUES (21, 'Mesa Test 21', 1, 'libre')");
    }

    // Subtest 2.1: 100% bar items dispatched
    {
      emittedEvents.length = 0; // clear event log
      const res = await makeRequest('/api/comandas/enviar', 'POST', {
        mesaId: 20,
        mesero: 'Challenger Test',
        items: [
          { producto_id: 1, nombre: 'Imperial Regular', precio: 1500, cantidad: 2, destino: 'barra', curso: 2 }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, false);
      assert.strictEqual(res.data.estado, 'abierta');

      const nuevaComandaEvents = emittedEvents.filter(e => e.event === 'nueva_comanda');
      const mesaActualizadaEvents = emittedEvents.filter(e => e.event === 'mesa_actualizada');

      const pass = nuevaComandaEvents.length === 0 && mesaActualizadaEvents.length > 0;
      results.push({
        name: '2.1: 100% bar items: nueva_comanda NOT emitted, mesa_actualizada emitted',
        pass,
        actual: `nueva_comanda count: ${nuevaComandaEvents.length}, mesa_actualizada count: ${mesaActualizadaEvents.length}`
      });
    }

    // Subtest 2.2: Food item dispatched on clean table
    {
      emittedEvents.length = 0;
      const res = await makeRequest('/api/comandas/enviar', 'POST', {
        mesaId: 21,
        mesero: 'Challenger Test',
        items: [
          { producto_id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina', curso: 2 }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, true);
      assert.strictEqual(res.data.estado, 'esperando');

      const nuevaComandaEvents = emittedEvents.filter(e => e.event === 'nueva_comanda');
      const mesaActualizadaEvents = emittedEvents.filter(e => e.event === 'mesa_actualizada');

      const pass = nuevaComandaEvents.length === 1 && mesaActualizadaEvents.length > 0;
      results.push({
        name: '2.2: Kitchen item: nueva_comanda emitted with table set to "esperando"',
        pass,
        actual: `nueva_comanda count: ${nuevaComandaEvents.length}, payload comandas: ${nuevaComandaEvents[0]?.args[0]?.comandas?.length}`
      });
    }

    // Subtest 2.3: Mixed items dispatched (food + bar)
    {
      // Reset mesa 20
      await dbRun("DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE mesa_id = 20)");
      await dbRun("DELETE FROM Ordenes WHERE mesa_id = 20");
      await dbRun("UPDATE Mesas SET estado = 'libre' WHERE id = 20");

      emittedEvents.length = 0;
      const res = await makeRequest('/api/comandas/enviar', 'POST', {
        mesaId: 20,
        mesero: 'Challenger Test',
        items: [
          { producto_id: 1, nombre: 'Imperial Regular', precio: 1500, cantidad: 2, destino: 'barra', curso: 2 },
          { producto_id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina', curso: 2 }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, true);
      assert.strictEqual(res.data.estado, 'esperando');

      const nuevaComandaEvents = emittedEvents.filter(e => e.event === 'nueva_comanda');
      const emittedComandas = nuevaComandaEvents[0]?.args[0]?.comandas || [];
      const onlyKitchenInPayload = emittedComandas.every(c => c.destino === 'cocina') && emittedComandas.length === 1;

      const pass = nuevaComandaEvents.length === 1 && onlyKitchenInPayload;
      results.push({
        name: '2.3: Mixed dispatch: nueva_comanda payload contains ONLY kitchen items',
        pass,
        actual: `comandas in payload: ${emittedComandas.length} (destinos: ${emittedComandas.map(c => c.destino).join(', ')})`
      });
    }

    // Subtest 2.4: Subsequent drink dispatch on existing active order
    {
      emittedEvents.length = 0;
      // Mesa 20 now has order with chifrijo and imperial.
      // Waiter adds a Pilsen (bar item)
      const res = await makeRequest('/api/comandas/enviar', 'POST', {
        mesaId: 20,
        mesero: 'Challenger Test',
        items: [
          // Already sent items marked enviado: true
          { id_detalle_existente: 999, producto_id: 1, nombre: 'Imperial Regular', precio: 1500, cantidad: 2, destino: 'barra', enviado: true },
          { id_detalle_existente: 998, producto_id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina', enviado: true },
          // New unsent item
          { producto_id: 2, nombre: 'Pilsen', precio: 1500, cantidad: 1, destino: 'barra', curso: 2, enviado: false }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, false);

      const nuevaComandaEvents = emittedEvents.filter(e => e.event === 'nueva_comanda');
      const pass = nuevaComandaEvents.length === 0;
      results.push({
        name: '2.4: Subsequent drink on active order does NOT emit nueva_comanda',
        pass,
        actual: `nueva_comanda count: ${nuevaComandaEvents.length}`
      });
    }

    // Subtest 2.5: Subsequent food dispatch on active order
    {
      emittedEvents.length = 0;
      const res = await makeRequest('/api/comandas/enviar', 'POST', {
        mesaId: 20,
        mesero: 'Challenger Test',
        items: [
          { id_detalle_existente: 999, producto_id: 1, nombre: 'Imperial Regular', precio: 1500, cantidad: 2, destino: 'barra', enviado: true },
          { producto_id: 9, nombre: 'Hamburguesa GastroBar', precio: 5200, cantidad: 1, destino: 'cocina', curso: 2, enviado: false }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.tieneCocina, true);

      const nuevaComandaEvents = emittedEvents.filter(e => e.event === 'nueva_comanda');
      const emittedComandas = nuevaComandaEvents[0]?.args[0]?.comandas || [];
      const pass = nuevaComandaEvents.length === 1 && emittedComandas.length === 1 && emittedComandas[0].nombre_producto === 'Hamburguesa GastroBar';
      results.push({
        name: '2.5: Subsequent food on active order emits nueva_comanda with only new dish',
        pass,
        actual: `nueva_comanda count: ${nuevaComandaEvents.length}, dish: ${emittedComandas[0]?.nombre_producto}`
      });
    }

    // Subtest 2.6: High concurrency / rapid requests
    {
      emittedEvents.length = 0;
      const concurrentReqs = [];
      for (let i = 0; i < 10; i++) {
        concurrentReqs.push(
          makeRequest('/api/comandas/enviar', 'POST', {
            mesaId: 21,
            mesero: 'Concurrent Tester',
            items: [
              { producto_id: 1, nombre: 'Imperial Regular', precio: 1500, cantidad: 1, destino: 'barra', curso: 2 }
            ]
          })
        );
      }
      const responses = await Promise.all(concurrentReqs);
      const all200 = responses.every(r => r.status === 200);
      const noKitchenEvents = emittedEvents.filter(e => e.event === 'nueva_comanda').length === 0;
      const pass = all200 && noKitchenEvents;
      results.push({
        name: '2.6: Concurrency: 10 simultaneous drink dispatches succeed without kitchen leaks',
        pass,
        actual: `All 200: ${all200}, nueva_comanda count: ${emittedEvents.filter(e => e.event === 'nueva_comanda').length}`
      });
    }

  } finally {
    // Cleanup server and db connection
    db.close();
    await new Promise((resolve) => server.close(resolve));
    console.log('Ephemeral test server closed cleanly.');
  }

  return results;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  console.log('########################################################');
  console.log('# CHALLENGER 1: EMPIRICAL STRESS TEST SUITE (M1)       #');
  console.log('########################################################');

  const frontendResults = runFrontendEmpiricalSuite();
  frontendResults.forEach(r => {
    const tag = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${tag}: ${r.name}`);
    console.log(`   Result: ${r.actual}`);
    if (r.detail) console.log(`   Note: ${r.detail}`);
  });

  const backendResults = await runBackendEmpiricalSuite();
  backendResults.forEach(r => {
    const tag = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`${tag}: ${r.name}`);
    console.log(`   Result: ${r.actual}`);
  });

  const allResults = [...frontendResults, ...backendResults];
  const passed = allResults.filter(r => r.pass).length;
  const failed = allResults.filter(r => !r.pass).length;

  console.log('\n========================================================');
  console.log(`TOTAL TESTS: ${allResults.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================\n');

  if (failed > 0) {
    console.error(`VERDICT: REJECT (${failed} empirical failures found)`);
    process.exit(1);
  } else {
    console.log('VERDICT: APPROVE (all empirical assertions passed)');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(2);
});
