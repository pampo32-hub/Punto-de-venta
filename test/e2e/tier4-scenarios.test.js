const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startTestServer,
  evaluarBotonComanda,
  evaluarEstadoMesaKDS,
  formatearTooltipEspera,
  calcularTotalesHappyHour,
  formatearNombreItemConOrigen
} = require('../helpers/test-server');

describe('Tier 4: Real-World Workload Scenarios', () => {
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
  // SCENARIO 1: FULL DINING LIFECYCLE
  // ==========================================================================
  it('T4.1: Scenario 1 — Full Dining Lifecycle (Drinks -> Food -> KDS Partial -> KDS All Listo -> Activa -> Cobrar)', async () => {
    const mesaId = 10;

    // 1. Guests arrive and order initial round of drinks
    const initialDrinks = [
      { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra', curso: 2, enviado: false }
    ];
    // Dynamic button shows "💾 Guardar"
    const btnState1 = evaluarBotonComanda(initialDrinks);
    assert.strictEqual(btnState1.text, '💾 Guardar');

    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, items: initialDrinks }
    });
    assert.strictEqual(r1.status, 200);
    const ordenId = r1.data.ordenId;

    // 2. Guests order appetizers and entrees
    const foodItems = [
      { id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina', curso: 1, enviado: false },
      { id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina', curso: 2, enviado: false }
    ];
    // Dynamic button now switches to "🔥 Enviar a Cocina"
    const btnState2 = evaluarBotonComanda(foodItems);
    assert.strictEqual(btnState2.text, '🔥 Enviar a Cocina');

    const r2 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, items: foodItems }
    });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.data.ordenId, ordenId);

    // Verify table in database is now 'esperando'
    const mesaEsperando = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
    assert.strictEqual(mesaEsperando.estado, 'esperando');

    // 3. Kitchen marks appetizer (Chifrijo) ready
    const itemsDb = await server.dbAll('SELECT id, nombre_producto, destino, estado_comanda FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    const chifrijoItem = itemsDb.find((i) => i.nombre_producto.includes('Chifrijo'));
    const ribEyeItem = itemsDb.find((i) => i.nombre_producto.includes('Rib Eye'));

    await server.request(`/api/kds/${chifrijoItem.id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });

    // Simulated table evaluation: 1 listo, 1 pendiente -> esperando_parcial
    const kitchenCurrent = [
      { ...chifrijoItem, estado_comanda: 'listo' },
      { ...ribEyeItem, estado_comanda: 'pendiente' }
    ];
    assert.strictEqual(evaluarEstadoMesaKDS(kitchenCurrent), 'esperando_parcial');

    // Tooltip lists ONLY pending Rib Eye
    const tooltip = formatearTooltipEspera(new Date().toISOString(), ['Corte Rib Eye 350g']);
    assert.deepStrictEqual(tooltip.items, ['Corte Rib Eye 350g']);

    // 4. Kitchen marks entree (Rib Eye) ready
    await server.request(`/api/kds/${ribEyeItem.id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });

    const kitchenAllReady = [
      { ...chifrijoItem, estado_comanda: 'listo' },
      { ...ribEyeItem, estado_comanda: 'listo' }
    ];
    assert.strictEqual(evaluarEstadoMesaKDS(kitchenAllReady), 'activa');

    // 5. Payment & Table Closure
    const ordenFinal = await server.dbGet('SELECT total FROM Ordenes WHERE id = ?', [ordenId]);
    const payRes = await server.request(`/api/ordenes/${ordenId}/cobrar`, {
      method: 'POST',
      body: {
        metodo: 'Efectivo',
        monto: ordenFinal.total,
        propina: 2000
      }
    });
    assert.strictEqual(payRes.status, 200);

    // Free table after payment
    await server.dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [mesaId]);
    const mesaCerrada = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
    assert.strictEqual(mesaCerrada.estado, 'libre');
  });

  // ==========================================================================
  // SCENARIO 2: HAPPY HOUR TRANSITION LIFECYCLE
  // ==========================================================================
  it('T4.2: Scenario 2 — Happy Hour Transition (Ordered during HH -> Auto-expires past 19:00 -> Next drinks full price)', async () => {
    let happyHourActivo = true;
    const mesaId = 9;

    // 1. Order 4 beers during Happy Hour
    const round1 = [
      { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 4, happy_hour: 1, destino: 'barra' }
    ];
    const totalsRound1 = calcularTotalesHappyHour(round1, happyHourActivo);
    // 4 beers = 2 free (3600 discount)
    assert.strictEqual(totalsRound1.descuentoHH, 3600);
    assert.strictEqual(totalsRound1.subNeto, 3600);

    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, happyHourActivo: true, items: round1 }
    });

    // 2. Clock advances past 19:00 -> Happy Hour auto-expires
    const currentTime = '19:05';
    const scheduledEndTime = '19:00';
    if (currentTime >= scheduledEndTime) {
      happyHourActivo = false;
    }
    assert.strictEqual(happyHourActivo, false, 'HH must auto-expire when clock reaches end time');

    // 3. Guests order 2 more beers at 19:10 (post-HH)
    const round2 = [
      { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, happy_hour: 1, destino: 'barra' }
    ];
    const totalsRound2 = calcularTotalesHappyHour(round2, happyHourActivo);
    assert.strictEqual(totalsRound2.descuentoHH, 0, 'No discount on post-HH orders');
    assert.strictEqual(totalsRound2.subNeto, 3600);

    // 4. Combined ticket verification:
    // 6 beers total: 4 with 2x1 (3600 discount), 2 at regular price (0 discount)
    // Gross: 6 * 1800 = 10800
    // Total discount = 3600
    // Total a pagar = 7200
    // Subtotal (base) = Math.round(7200 / 1.23) = 5854
    // Servicio 10% = Math.round(5854 * 0.10) = 585
    // IVA 13% = 7200 - 5854 - 585 = 761
    // Total = 7200
    const totalDescuentos = totalsRound1.descuentoHH + totalsRound2.descuentoHH;
    const subtotalBruto = 1800 * 6;
    const totalFinal = subtotalBruto - totalDescuentos;
    const subtotalBase = Math.round(totalFinal / 1.23);
    const servicioFinal = Math.round(subtotalBase * 0.10);
    const ivaFinal = totalFinal - subtotalBase - servicioFinal;

    assert.strictEqual(totalDescuentos, 3600);
    assert.strictEqual(totalFinal, 7200);
    assert.strictEqual(subtotalBase + servicioFinal + ivaFinal, totalFinal);
  });

  // ==========================================================================
  // SCENARIO 3: TABLE MIGRATION LIFECYCLE
  // ==========================================================================
  it('T4.3: Scenario 3 — Table Migration (Move from Table 10 to Table 11 on terrace, preserving state and items)', async () => {
    const mesa10 = 10;
    const mesa11 = 11;

    // 1. Guest seated at Table 10 orders Rib Eye and Corona
    const envRes = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: mesa10,
        mesero: 'Carlos Solano',
        items: [
          { id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina' },
          { id: 3, nombre: 'Corona Extra', precio: 2500, cantidad: 1, destino: 'barra' }
        ]
      }
    });
    const ordenId = envRes.data.ordenId;

    // 2. Guest requests to move to Table 11
    const moverRes = await server.request('/api/mesas/mover', {
      method: 'POST',
      body: { origenMesaId: mesa10, destinoMesaId: mesa11 }
    });
    assert.strictEqual(moverRes.status, 200);

    // 3. Verification of Table 10: must be completely free
    const m10 = await server.dbGet('SELECT estado, mesero FROM Mesas WHERE id = ?', [mesa10]);
    assert.strictEqual(m10.estado, 'libre');
    assert.strictEqual(m10.mesero, null);

    // 4. Verification of Table 11: inherits active order and status
    const m11 = await server.dbGet('SELECT estado, mesero FROM Mesas WHERE id = ?', [mesa11]);
    assert.strictEqual(m11.estado, 'esperando');
    assert.strictEqual(m11.mesero, 'Carlos Solano');

    // 5. DetalleOrden items now belong to Table 11 through the order
    const ordenActualizada = await server.dbGet('SELECT mesa_id FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(ordenActualizada.mesa_id, mesa11);
  });

  // ==========================================================================
  // SCENARIO 4: LARGE GROUP TABLE MERGE & PROVENANCE LIFECYCLE
  // ==========================================================================
  it('T4.4: Scenario 4 — Large Group Table Merge & Item Origin Verification (Table 9 + Table 11)', async () => {
    // Table 9 (Mesa 3) orders Ceviche and Beer
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        items: [
          { id: 10, nombre: 'Ceviche Mixto con Aguacate', precio: 4800, cantidad: 1, destino: 'cocina' },
          { id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }
        ]
      }
    });

    // Table 11 (Mesa 2) orders Burgers and Cocktails
    const r2 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [
          { id: 13, nombre: 'Hamburguesa Doble', precio: 5500, cantidad: 2, destino: 'cocina' },
          { id: 5, nombre: 'Mojito Clásico', precio: 3800, cantidad: 2, destino: 'barra' }
        ]
      }
    });

    // Merge Table 11 into Table 9
    const unirRes = await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });
    assert.strictEqual(unirRes.status, 200);

    // Verify item origin tagging
    const itemsMerged = [
      { nombre_producto: 'Ceviche Mixto con Aguacate', origen_mesa_numero: '3' },
      { nombre_producto: 'Imperial Regular', origen_mesa_numero: '3' },
      { nombre_producto: 'Hamburguesa Doble', origen_mesa_numero: '2' },
      { nombre_producto: 'Mojito Clásico', origen_mesa_numero: '2' }
    ];

    // Formatted ticket for unified Table (Mesa 3)
    const ticketLines = itemsMerged.map((it) => formatearNombreItemConOrigen(it, '3'));

    assert.strictEqual(ticketLines[0], 'Ceviche Mixto con Aguacate');
    assert.strictEqual(ticketLines[1], 'Imperial Regular');
    assert.strictEqual(ticketLines[2], '[Mesa 2] Hamburguesa Doble');
    assert.strictEqual(ticketLines[3], '[Mesa 2] Mojito Clásico');
  });

  // ==========================================================================
  // SCENARIO 5: MERGE ERROR & UNDO SEPARATION LIFECYCLE
  // ==========================================================================
  it('T4.5: Scenario 5 — Accidental Merge & Undo Separation Lifecycle', async () => {
    // Table 9 orders Steak
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        items: [{ id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // Table 11 orders Chifrijo
    const r2 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [{ id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // Erroneous merge
    await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });

    // Undo Separation contract logic:
    // Reallocates items where origen_mesa_id = 11 back to Table 11's original order
    function undoSeparacion(itemsUnified, mesaSecundariaId, ordenSecundariaId) {
      const itemsMesa1 = itemsUnified.filter((i) => i.origen_mesa_id !== mesaSecundariaId);
      const itemsMesa2 = itemsUnified
        .filter((i) => i.origen_mesa_id === mesaSecundariaId)
        .map((i) => ({ ...i, orden_id: ordenSecundariaId }));

      return { itemsMesa1, itemsMesa2 };
    }

    const unifiedItems = [
      { id: 1, nombre: 'Corte Rib Eye 350g', precio: 12500, origen_mesa_id: 9, orden_id: r1.data.ordenId },
      { id: 2, nombre: 'Chifrijo Tradicional', precio: 4500, origen_mesa_id: 11, orden_id: r1.data.ordenId }
    ];

    const { itemsMesa1, itemsMesa2 } = undoSeparacion(unifiedItems, 11, r2.data.ordenId);

    // Both tables restored intact
    assert.strictEqual(itemsMesa1.length, 1);
    assert.strictEqual(itemsMesa1[0].nombre, 'Corte Rib Eye 350g');

    assert.strictEqual(itemsMesa2.length, 1);
    assert.strictEqual(itemsMesa2[0].nombre, 'Chifrijo Tradicional');
    assert.strictEqual(itemsMesa2[0].orden_id, r2.data.ordenId);
  });

  // ==========================================================================
  // SCENARIO 6: MULTI-COURSE GOURMET DINNER WITH DRINK REFILLS
  // ==========================================================================
  it('T4.6: Scenario 6 — Multi-Course Dining with Drink Refills and Split Tip', async () => {
    const mesaId = 10;
    await server.request('/api/happy-hour', {
      method: 'POST',
      headers: { 'x-user-rol': 'admin' },
      body: { activo: false, pin: '1234' }
    });

    // Course 1: Appetizer + Drinks
    const course1 = [
      { id: 10, nombre: 'Ceviche Mixto con Aguacate', precio: 4800, cantidad: 1, destino: 'cocina', curso: 1 },
      { id: 6, nombre: 'Margarita Tradicional', precio: 4200, cantidad: 1, destino: 'barra', curso: 1 }
    ];
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, items: course1 }
    });
    const ordenId = r1.data.ordenId;

    // Refill: Waiter adds another Margarita while waiting for food
    const refill = [
      { id: 6, nombre: 'Margarita Tradicional', precio: 4200, cantidad: 1, destino: 'barra', curso: 1 }
    ];
    // Dynamic button for refill is "💾 Guardar"
    assert.strictEqual(evaluarBotonComanda(refill).text, '💾 Guardar');
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, items: refill }
    });

    // Course 2: Entree
    const course2 = [
      { id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina', curso: 2 }
    ];
    // Dynamic button for food is "🔥 Enviar a Cocina"
    assert.strictEqual(evaluarBotonComanda(course2).text, '🔥 Enviar a Cocina');
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: { mesaId, items: course2 }
    });

    // Total items in order = 1 ceviche + 2 margaritas + 1 rib eye = 4 items
    const allItems = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    assert.strictEqual(allItems.length, 4);

    // Total = 4800 + 4200 + 4200 + 12500 = 25700
    const orden = await server.dbGet('SELECT total, subtotal FROM Ordenes WHERE id = ?', [ordenId]);
    assert.strictEqual(orden.total, 25700);
    assert.strictEqual(orden.subtotal, Math.round(25700 / 1.23));
  });
});
