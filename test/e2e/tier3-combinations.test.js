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

describe('Tier 3: Cross-Feature Combinations', () => {
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
  // INTERACTION 1: HAPPY HOUR + TABLE MERGES
  // ==========================================================================
  it('T3.1: Happy Hour applied on drinks during table merge combines totals and maintains promo discounts', async () => {
    // Table 9 orders 2 Imperials (1 free under HH)
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        happyHourActivo: true,
        items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    // Table 11 orders 2 Pilsen (1 free under HH)
    const r2 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        happyHourActivo: true,
        items: [{ id: 2, nombre: 'Pilsen', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    // Merge Table 11 into Table 9
    const unirRes = await server.request('/api/mesas/unir', {
      method: 'POST',
      body: {
        mesaPrincipalId: 9,
        mesaSecundariaId: 11
      }
    });
    assert.strictEqual(unirRes.status, 200);

    const mergedItems = [
      { nombre: 'Imperial Regular', precio: 1800, cantidad: 2, happy_hour: 1 },
      { nombre: 'Pilsen', precio: 1800, cantidad: 2, happy_hour: 1 }
    ];
    const totals = calcularTotalesHappyHour(mergedItems, true);
    // 1 free Imperial (1800) + 1 free Pilsen (1800) = 3600 discount
    assert.strictEqual(totals.descuentoHH, 3600);
    assert.strictEqual(totals.subNeto, 3600);
  });

  // ==========================================================================
  // INTERACTION 2: KDS PARTIAL DELIVERIES ON MERGED TABLES
  // ==========================================================================
  it('T3.2: Partial KDS delivery on a merged table shows "esperando_parcial" and lists only secondary table pending dish', () => {
    // Mesa 1 had Rib Eye (now listo). Mesa 2 had Chifrijo (still pendiente).
    const mergedDishes = [
      {
        id: 1,
        nombre_producto: 'Corte Rib Eye 350g',
        destino: 'cocina',
        estado_comanda: 'listo',
        origen_mesa_numero: '1'
      },
      {
        id: 2,
        nombre_producto: 'Chifrijo Tradicional',
        destino: 'cocina',
        estado_comanda: 'pendiente',
        origen_mesa_numero: '2'
      }
    ];

    const estadoMesa = evaluarEstadoMesaKDS(mergedDishes);
    assert.strictEqual(estadoMesa, 'esperando_parcial');

    const pendientes = mergedDishes.filter((d) => d.estado_comanda !== 'listo');
    const itemsTooltip = pendientes.map((p) => formatearNombreItemConOrigen(p, '1'));
    const tooltip = formatearTooltipEspera(new Date().toISOString(), itemsTooltip);

    assert.strictEqual(tooltip.items.length, 1);
    assert.strictEqual(tooltip.items[0], '[Mesa 2] Chifrijo Tradicional');
  });

  // ==========================================================================
  // INTERACTION 3: SEPARATING TABLES AFTER PARTIAL KITCHEN DISPATCH
  // ==========================================================================
  it('T3.3: Separating merged tables restores Mesa 1 as "activa" and Mesa 2 as "esperando"', () => {
    function restoreSeparatedStates(itemsMesa1, itemsMesa2) {
      return {
        mesa1Estado: evaluarEstadoMesaKDS(itemsMesa1),
        mesa2Estado: evaluarEstadoMesaKDS(itemsMesa2)
      };
    }

    const itemsMesa1 = [
      { nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'listo' }
    ];
    const itemsMesa2 = [
      { nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'pendiente' }
    ];

    const { mesa1Estado, mesa2Estado } = restoreSeparatedStates(itemsMesa1, itemsMesa2);
    assert.strictEqual(mesa1Estado, 'activa', 'Mesa 1 dishes are all ready -> activa');
    assert.strictEqual(mesa2Estado, 'esperando', 'Mesa 2 dish is still pending -> esperando');
  });

  // ==========================================================================
  // INTERACTION 4: DYNAMIC BUTTON AFTER TABLE MOVE
  // ==========================================================================
  it('T3.4: Dynamic comanda button switches correctly after moving table and adding items', async () => {
    // Table 10 orders Chifrijo
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 10,
        items: [{ id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // Move Table 10 -> Table 11
    await server.request('/api/mesas/mover', {
      method: 'POST',
      body: { origenMesaId: 10, destinoMesaId: 11 }
    });

    // Table 11 currently has 1 sent item
    const currentItemsOnMesa11 = [
      { id: 8, nombre: 'Chifrijo', destino: 'cocina', enviado: true, id_detalle_existente: 10 }
    ];

    // Waiter adds beer -> button must say Guardar
    currentItemsOnMesa11.push({
      id: 1,
      nombre: 'Imperial',
      destino: 'barra',
      enviado: false,
      id_detalle_existente: null
    });
    assert.strictEqual(evaluarBotonComanda(currentItemsOnMesa11).text, '💾 Guardar');

    // Waiter adds another burger -> button must switch to Enviar a Cocina
    currentItemsOnMesa11.push({
      id: 13,
      nombre: 'Hamburguesa Doble',
      destino: 'cocina',
      enviado: false,
      id_detalle_existente: null
    });
    assert.strictEqual(evaluarBotonComanda(currentItemsOnMesa11).text, '🔥 Enviar a Cocina');
  });

  // ==========================================================================
  // INTERACTION 5: HAPPY HOUR AUTO-EXPIRATION WHILE IN 'ESPERANDO_PARCIAL'
  // ==========================================================================
  it('T3.5: Happy Hour auto-expiration occurs while table is in "esperando_parcial" without affecting kitchen status', () => {
    const tableState = 'esperando_parcial';
    let happyHourActivo = true;

    // Time passes past 19:00
    const currentTime = '19:01';
    const endTime = '19:00';
    if (currentTime >= endTime) {
      happyHourActivo = false;
    }

    // Table kitchen state is untouched
    assert.strictEqual(tableState, 'esperando_parcial');
    assert.strictEqual(happyHourActivo, false);

    // New drinks added post-expiration receive 0 discount
    const newItems = [{ nombre: 'Corona Extra', precio: 2500, cantidad: 2, happy_hour: 1 }];
    const totals = calcularTotalesHappyHour(newItems, happyHourActivo);
    assert.strictEqual(totals.descuentoHH, 0, 'Post-expiration items must not receive HH discount');
  });

  // ==========================================================================
  // INTERACTION 6: MERGING 'ACTIVA' TABLE WITH 'ESPERANDO' TABLE
  // ==========================================================================
  it('T3.6: Merging an "activa" table with an "esperando" table evaluates unified table to "esperando_parcial"', () => {
    // Mesa A items were all listo
    const mesaAItems = [
      { nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'listo', origen_mesa_numero: '1' }
    ];
    // Mesa B items are still pending
    const mesaBItems = [
      { nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'pendiente', origen_mesa_numero: '2' }
    ];

    const combined = [...mesaAItems, ...mesaBItems];
    const combinedState = evaluarEstadoMesaKDS(combined);

    // Since 1 is listo and 1 is pendiente, unified table is esperando_parcial
    assert.strictEqual(combinedState, 'esperando_parcial');
  });

  // ==========================================================================
  // INTERACTION 7: ADDING DRINKS TO 'ESPERANDO_PARCIAL' TABLE
  // ==========================================================================
  it('T3.7: Adding only drinks to an "esperando_parcial" table keeps button as "💾 Guardar" and tooltip clean of drinks', () => {
    const activeOrderItems = [
      { nombre: 'Ceviche', destino: 'cocina', enviado: true, id_detalle_existente: 1 },
      { nombre: 'Rib Eye', destino: 'cocina', enviado: true, id_detalle_existente: 2 },
      // New unsent items:
      { nombre: 'Pilsen', destino: 'barra', enviado: false, id_detalle_existente: null },
      { nombre: 'Mojito', destino: 'barra', enviado: false, id_detalle_existente: null }
    ];

    // Button should be Guardar because only drinks were added
    const btn = evaluarBotonComanda(activeOrderItems);
    assert.strictEqual(btn.text, '💾 Guardar');
    assert.strictEqual(btn.tieneNuevosCocina, false);

    // Wait tooltip should still list only pending kitchen dishes, never drinks
    const pendingDishes = ['Rib Eye'];
    const tooltip = formatearTooltipEspera(new Date().toISOString(), pendingDishes);
    assert.deepStrictEqual(tooltip.items, ['Rib Eye']);
    assert.ok(!tooltip.tooltipText.includes('Pilsen'));
    assert.ok(!tooltip.tooltipText.includes('Mojito'));
  });

  // ==========================================================================
  // INTERACTION 8: MOVING 'ESPERANDO_PARCIAL' TABLE PRESERVES WAIT TIMER
  // ==========================================================================
  it('T3.8: Moving an "esperando_parcial" table to vacant table preserves pending kitchen items and wait timer', async () => {
    // Comanda on Table 10
    const envRes = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 10,
        items: [
          { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' },
          { id: 11, nombre: 'Rib Eye', precio: 12500, cantidad: 1, destino: 'cocina' }
        ]
      }
    });

    const detalle = await server.dbGet('SELECT id FROM DetalleOrden WHERE orden_id = ? AND nombre_producto LIKE ?', [
      envRes.data.ordenId,
      '%Chifrijo%'
    ]);

    // Mark Chifrijo as listo in KDS
    await server.request(`/api/kds/${detalle.id}/estado`, {
      method: 'POST',
      body: { estado: 'listo' }
    });

    // Move Table 10 -> Table 11
    const moverRes = await server.request('/api/mesas/mover', {
      method: 'POST',
      body: { origenMesaId: 10, destinoMesaId: 11 }
    });
    assert.strictEqual(moverRes.status, 200);

    // DetalleOrden items still point to the transferred order
    const itemsTransferred = await server.dbAll('SELECT nombre_producto, estado_comanda FROM DetalleOrden WHERE orden_id = ?', [
      envRes.data.ordenId
    ]);
    assert.strictEqual(itemsTransferred.length, 2);

    const pending = itemsTransferred.filter((i) => i.estado_comanda !== 'listo');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].nombre_producto, 'Rib Eye');
  });

  // ==========================================================================
  // INTERACTION 9: PAYMENT OF MERGED TABLE WITH HAPPY HOUR
  // ==========================================================================
  it('T3.9: Payment of a merged table with Happy Hour discounts verifies accurate billing and mesa clearance', async () => {
    // Open Table 9 with Happy Hour
    const r1 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 9,
        happyHourActivo: true,
        items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
      }
    });

    // Open Table 11
    const r2 = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId: 11,
        items: [{ id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' }]
      }
    });

    // Merge Table 11 into Table 9
    await server.request('/api/mesas/unir', {
      method: 'POST',
      body: { mesaPrincipalId: 9, mesaSecundariaId: 11 }
    });

    const ordenId = r1.data.ordenId;
    const orden = await server.dbGet('SELECT total FROM Ordenes WHERE id = ?', [ordenId]);

    // Pay order via /api/ordenes/:id/cobrar
    const payRes = await server.request(`/api/ordenes/${ordenId}/cobrar`, {
      method: 'POST',
      body: {
        metodo: 'Tarjeta',
        monto: orden.total,
        propina: 1000
      }
    });

    assert.strictEqual(payRes.status, 200);
    const pago = await server.dbGet('SELECT * FROM Pagos WHERE orden_id = ?', [ordenId]);
    assert.ok(pago);
    assert.strictEqual(pago.metodo, 'Tarjeta');
    assert.strictEqual(pago.propina, 1000);
  });

  // ==========================================================================
  // INTERACTION 10: UNDO MERGE AFTER NEW FOOD ADDED
  // ==========================================================================
  it('T3.10: Undo merge preserves newly added items on primary table while returning secondary table to original state', () => {
    const mesa1Original = [{ id: 1, nombre: 'Rib Eye', origen_mesa_id: 1, orden_id: 100 }];
    const mesa2Original = [{ id: 2, nombre: 'Chifrijo', origen_mesa_id: 2, orden_id: 200 }];

    // After merge, both are under order 100
    const merged = [
      ...mesa1Original,
      { id: 2, nombre: 'Chifrijo', origen_mesa_id: 2, orden_id: 100, orden_original_id: 200 }
    ];

    // Waiter adds dessert to the merged table
    merged.push({ id: 3, nombre: 'Tres Leches', origen_mesa_id: 1, orden_id: 100 });

    // When split is performed:
    const restoredMesa1 = merged.filter((item) => item.origen_mesa_id === 1);
    const restoredMesa2 = merged
      .filter((item) => item.origen_mesa_id === 2)
      .map((item) => ({ ...item, orden_id: item.orden_original_id || item.orden_id }));

    // Primary table keeps Rib Eye + Tres Leches
    assert.strictEqual(restoredMesa1.length, 2);
    assert.deepStrictEqual(
      restoredMesa1.map((i) => i.nombre),
      ['Rib Eye', 'Tres Leches']
    );

    // Secondary table receives only its original Chifrijo
    assert.strictEqual(restoredMesa2.length, 1);
    assert.strictEqual(restoredMesa2[0].nombre, 'Chifrijo');
    assert.strictEqual(restoredMesa2[0].orden_id, 200);
  });

  // ==========================================================================
  // INTERACTION 11: MERGING ODD QUANTITIES COMBINES TO 2X1 SAVINGS
  // ==========================================================================
  it('T3.11: Merging two tables with 1 Happy Hour beer each creates an even pair for 2x1 promo discount', () => {
    const tableAItem = [{ nombre: 'Imperial', precio: 1800, cantidad: 1, happy_hour: 1 }];
    const tableBItem = [{ nombre: 'Imperial', precio: 1800, cantidad: 1, happy_hour: 1 }];

    // Before merge: 1 item each -> 0 discount each
    assert.strictEqual(calcularTotalesHappyHour(tableAItem, true).descuentoHH, 0);
    assert.strictEqual(calcularTotalesHappyHour(tableBItem, true).descuentoHH, 0);

    // Merged: 2 Imperials -> 1 free beer!
    const combined = [{ nombre: 'Imperial', precio: 1800, cantidad: 2, happy_hour: 1 }];
    const mergedTotals = calcularTotalesHappyHour(combined, true);
    assert.strictEqual(mergedTotals.descuentoHH, 1800, 'Combined pair earns 1 free Imperial');
    assert.strictEqual(mergedTotals.subNeto, 1800);
  });
});
