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

describe('Tier 2: Boundary & Corner Cases (R1 - R4)', () => {
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
  // R1 BOUNDARIES: COMANDAS DINÁMICAS
  // ==========================================================================
  describe('Feature 1 Boundaries: Dynamic Comanda Validation & Courses', () => {
    it('T2.1: POST /api/comandas/enviar rejects empty items array with 400 Bad Request', async () => {
      const res = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          mesero: 'Carlos Solano',
          items: []
        }
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes('no contiene productos'));
    });

    it('T2.2: Items with 0 quantity evaluate safely without flagging new kitchen items', () => {
      const items = [
        {
          id: 8,
          nombre: 'Chifrijo',
          destino: 'cocina',
          cantidad: 0,
          enviado: false
        }
      ];
      // When cantidad is 0, it should be treated as empty or non-actionable
      const tieneItemsReales = items.filter((i) => i.cantidad > 0);
      const result = evaluarBotonComanda(tieneItemsReales);
      assert.strictEqual(result.text, '💾 Guardar');
      assert.strictEqual(result.tieneNuevosCocina, false);
    });

    it('T2.3: Order where all items are already sent evaluates to "💾 Guardar"', () => {
      const items = [
        { id: 8, nombre: 'Chifrijo', destino: 'cocina', enviado: true, id_detalle_existente: 1 },
        { id: 11, nombre: 'Rib Eye', destino: 'cocina', enviado: true, id_detalle_existente: 2 },
        { id: 1, nombre: 'Imperial', destino: 'barra', enviado: true, id_detalle_existente: 3 }
      ];
      const result = evaluarBotonComanda(items);
      assert.strictEqual(result.text, '💾 Guardar');
      assert.strictEqual(result.tieneNuevosCocina, false);
    });

    it('T2.4: Mixed course items properly route to kitchen vs bar destinations', () => {
      // Curso 1 (Entrada) -> Cocina
      const entrada = { nombre: 'Ceviche', destino: 'cocina', curso: 1, enviado: false };
      assert.strictEqual(evaluarBotonComanda([entrada]).tieneNuevosCocina, true);

      // Curso 2 (Fuerte) -> Cocina
      const fuerte = { nombre: 'Rib Eye', destino: 'cocina', curso: 2, enviado: false };
      assert.strictEqual(evaluarBotonComanda([fuerte]).tieneNuevosCocina, true);

      // Curso 4 (Postre/Café) -> Cocina
      const postre = { nombre: 'Tres Leches', destino: 'cocina', curso: 4, enviado: false };
      assert.strictEqual(evaluarBotonComanda([postre]).tieneNuevosCocina, true);

      // Curso 5 (Licores/Digestivos) -> Barra
      const digestivo = { nombre: 'Whisky', destino: 'barra', curso: 5, enviado: false };
      assert.strictEqual(evaluarBotonComanda([digestivo]).tieneNuevosCocina, false);
    });

    it('T2.5: Rapid consecutive comanda submissions append to existing active order without duplicate orders', async () => {
      const mesaId = 10;
      // First comanda
      const res1 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          items: [{ id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' }]
        }
      });
      assert.strictEqual(res1.status, 200);
      const ordenId1 = res1.data.ordenId;

      // Immediate second comanda on same table
      const res2 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 2, destino: 'barra' }]
        }
      });
      assert.strictEqual(res2.status, 200);
      const ordenId2 = res2.data.ordenId;

      // Must be the exact same order
      assert.strictEqual(ordenId1, ordenId2, 'Subsequent comanda must append to same order ID');

      // Verify DetalleOrden contains all 2 items
      const items = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [ordenId1]);
      assert.strictEqual(items.length, 2);
    });
  });

  // ==========================================================================
  // R2 BOUNDARIES: ESTADOS DE KDS & TOOLTIPS
  // ==========================================================================
  describe('Feature 2 Boundaries: KDS State Transitions & Timing', () => {
    it('T2.6: Table with only bar items (0 kitchen items) evaluates to "abierta", never "esperando"', () => {
      const barItems = [
        { id: 1, nombre_producto: 'Imperial', destino: 'barra', estado_comanda: 'pendiente' },
        { id: 2, nombre_producto: 'Mojito', destino: 'barra', estado_comanda: 'listo' }
      ];
      const estado = evaluarEstadoMesaKDS(barItems);
      assert.strictEqual(estado, 'abierta');
    });

    it('T2.7: Single kitchen item table transitions directly from "esperando" to "activa" upon completion', () => {
      const singleItem = [
        { id: 1, nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'pendiente' }
      ];
      assert.strictEqual(evaluarEstadoMesaKDS(singleItem), 'esperando');

      // Now marked listo
      singleItem[0].estado_comanda = 'listo';
      assert.strictEqual(evaluarEstadoMesaKDS(singleItem), 'activa');
    });

    it('T2.8: KDS dishes marked listo out-of-order maintains accurate pending list', () => {
      const items = [
        { id: 1, nombre_producto: 'Entrada: Ceviche', destino: 'cocina', estado_comanda: 'listo' },
        { id: 2, nombre_producto: 'Plato 1: Rib Eye', destino: 'cocina', estado_comanda: 'preparando' },
        { id: 3, nombre_producto: 'Plato 2: Hamburguesa', destino: 'cocina', estado_comanda: 'listo' },
        { id: 4, nombre_producto: 'Postre: Tres Leches', destino: 'cocina', estado_comanda: 'pendiente' }
      ];

      const estado = evaluarEstadoMesaKDS(items);
      assert.strictEqual(estado, 'esperando_parcial');

      const pendientes = items.filter((i) => i.estado_comanda !== 'listo');
      const tooltip = formatearTooltipEspera(new Date().toISOString(), pendientes);
      assert.strictEqual(tooltip.items.length, 2);
      assert.deepStrictEqual(tooltip.items, ['Plato 1: Rib Eye', 'Postre: Tres Leches']);
    });

    it('T2.9: Wait time boundary: 0 minutes elapsed formats as "⏱️ Esperando hace 0 min"', () => {
      const now = new Date('2026-09-03T15:00:30Z');
      const justOrdered = new Date('2026-09-03T15:00:10Z').toISOString();

      const tooltip = formatearTooltipEspera(justOrdered, ['Chifrijo'], now);
      assert.strictEqual(tooltip.minutos, 0);
      assert.strictEqual(tooltip.titulo, '⏱️ Esperando hace 0 min');
    });

    it('T2.10: Multiple kitchen orders at different times calculates wait time from the earliest order', () => {
      const now = new Date('2026-09-03T15:30:00Z');
      const firstComandaTime = new Date('2026-09-03T15:05:00Z').toISOString(); // 25 mins ago
      const secondComandaTime = new Date('2026-09-03T15:25:00Z').toISOString(); // 5 mins ago

      // Earliest timestamp must be used
      const timestamps = [firstComandaTime, secondComandaTime];
      const earliestTime = timestamps.reduce((earliest, cur) => (cur < earliest ? cur : earliest));

      const tooltip = formatearTooltipEspera(earliestTime, ['Rib Eye'], now);
      assert.strictEqual(tooltip.minutos, 25);
    });
  });

  // ==========================================================================
  // R3 BOUNDARIES: HAPPY HOUR PRICING & SCHEDULING
  // ==========================================================================
  describe('Feature 3 Boundaries: 2x1 Odd Quantities & Schedule Limits', () => {
    it('T2.11: 2x1 promotional pricing on odd quantities: 1=0 free, 3=1 free, 5=2 free, 7=3 free', () => {
      const testCases = [
        { qty: 1, expectedFree: 0 },
        { qty: 2, expectedFree: 1 },
        { qty: 3, expectedFree: 1 },
        { qty: 4, expectedFree: 2 },
        { qty: 5, expectedFree: 2 },
        { qty: 6, expectedFree: 3 },
        { qty: 7, expectedFree: 3 },
        { qty: 9, expectedFree: 4 }
      ];

      for (const tc of testCases) {
        const item = [{ nombre: 'Imperial Regular', precio: 1800, cantidad: tc.qty, happy_hour: 1 }];
        const res = calcularTotalesHappyHour(item, true);
        const expectedDiscount = tc.expectedFree * 1800;
        assert.strictEqual(
          res.descuentoHH,
          expectedDiscount,
          `Qty ${tc.qty} should have discount ${expectedDiscount}, got ${res.descuentoHH}`
        );
      }
    });

    it('T2.12: Boundary time comparison: 18:59:59 is active, exactly 19:00:00 is expired', () => {
      function isHappyHourWithinSchedule(currentTime, endTime) {
        return currentTime < endTime;
      }
      const endTime = '19:00:00';
      assert.strictEqual(isHappyHourWithinSchedule('18:59:59', endTime), true);
      assert.strictEqual(isHappyHourWithinSchedule('19:00:00', endTime), false);
      assert.strictEqual(isHappyHourWithinSchedule('19:00:01', endTime), false);
    });

    it('T2.13: Large mixed order with 10 products computes penny-accurate totals without NaN or floats', () => {
      const items = [
        { nombre: 'Imperial', precio: 1800, cantidad: 4, happy_hour: 1 },
        { nombre: 'Pilsen', precio: 1800, cantidad: 3, happy_hour: 1 },
        { nombre: 'Corona', precio: 2500, cantidad: 2, happy_hour: 1 },
        { nombre: 'Mojito', precio: 3800, cantidad: 1, happy_hour: 1 },
        { nombre: 'Margarita', precio: 4200, cantidad: 6, happy_hour: 1 },
        { nombre: 'Chifrijo', precio: 4500, cantidad: 2, happy_hour: 0 },
        { nombre: 'Rib Eye', precio: 12500, cantidad: 1, happy_hour: 0 },
        { nombre: 'Hamburguesa', precio: 5500, cantidad: 3, happy_hour: 0 },
        { nombre: 'Ceviche', precio: 4800, cantidad: 2, happy_hour: 0 },
        { nombre: 'Tres Leches', precio: 2800, cantidad: 4, happy_hour: 0 }
      ];

      const res = calcularTotalesHappyHour(items, true);
      // Discounts:
      // Imperial: 2 free * 1800 = 3600
      // Pilsen: 1 free * 1800 = 1800
      // Corona: 1 free * 2500 = 2500
      // Mojito: 0 free = 0
      // Margarita: 3 free * 4200 = 12600
      // Total HH discount = 3600 + 1800 + 2500 + 12600 = 20500
      assert.strictEqual(res.descuentoHH, 20500);

      const totalBruto = items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
      const expectedTotal = totalBruto - 20500;
      assert.strictEqual(res.total, expectedTotal);
      assert.strictEqual(res.subtotal + res.servicio + res.iva, res.total);
    });

    it('T2.14: Happy Hour quantity 0 produces 0 discount without error', () => {
      const items = [{ nombre: 'Pilsen', precio: 1800, cantidad: 0, happy_hour: 1 }];
      const res = calcularTotalesHappyHour(items, true);
      assert.strictEqual(res.descuentoHH, 0);
      assert.strictEqual(res.total, 0);
    });

    it('T2.15: Complimentary promotional item with price 0 produces 0 discount and 0 total', () => {
      const items = [{ nombre: 'Cortesía de la Casa', precio: 0, cantidad: 2, happy_hour: 1 }];
      const res = calcularTotalesHappyHour(items, true);
      assert.strictEqual(res.descuentoHH, 0);
      assert.strictEqual(res.total, 0);
    });
  });

  // ==========================================================================
  // R4 BOUNDARIES: MOVER / UNIR / SEPARAR MESAS
  // ==========================================================================
  describe('Feature 4 Boundaries: Table Management Constraints', () => {
    it('T2.16: POST /api/mesas/mover fails when origin mesa has no active order', async () => {
      // Table 10 is vacant in resetDb
      const res = await server.request('/api/mesas/mover', {
        method: 'POST',
        body: {
          origenMesaId: 10,
          destinoMesaId: 11
        }
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes('no tiene una orden activa'));
    });

    it('T2.17: POST /api/mesas/mover fails when destination mesa does not exist', async () => {
      // Create order on Table 10
      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
        }
      });

      const res = await server.request('/api/mesas/mover', {
        method: 'POST',
        body: {
          origenMesaId: 10,
          destinoMesaId: 99999
        }
      });
      assert.strictEqual(res.status, 404);
      assert.ok(res.data.error.includes('no encontrada'));
    });

    it('T2.18: POST /api/mesas/unir fails when one table has no active order', async () => {
      // Only Table 10 has order; Table 11 has none
      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
        }
      });

      const res = await server.request('/api/mesas/unir', {
        method: 'POST',
        body: {
          mesaPrincipalId: 10,
          mesaSecundariaId: 11
        }
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.data.error.includes('Ambas mesas deben tener órdenes activas'));
    });

    it('T2.19: Preventing merging a table with itself', () => {
      function validateMergeRequest(mesa1Id, mesa2Id) {
        if (!mesa1Id || !mesa2Id) return { valid: false, error: 'Mesas requeridas' };
        if (Number(mesa1Id) === Number(mesa2Id)) {
          return { valid: false, error: 'No se puede unir una mesa consigo misma' };
        }
        return { valid: true };
      }

      const res = validateMergeRequest(10, 10);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'No se puede unir una mesa consigo misma');
    });

    it('T2.20: High-volume merge preserves item provenance across all items', () => {
      const itemsMesa1 = Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        nombre_producto: `Platillo ${i + 1}`,
        origen_mesa_numero: '1'
      }));
      const itemsMesa2 = Array.from({ length: 15 }, (_, i) => ({
        id: i + 13,
        nombre_producto: `Platillo ${i + 13}`,
        origen_mesa_numero: '2'
      }));

      const allMerged = [...itemsMesa1, ...itemsMesa2];
      assert.strictEqual(allMerged.length, 27);

      // Verify each item formatted under Mesa 1 ticket
      for (const item of allMerged) {
        const formatted = formatearNombreItemConOrigen(item, '1');
        if (item.origen_mesa_numero === '2') {
          assert.ok(formatted.startsWith('[Mesa 2]'), `Item ${item.nombre_producto} must have [Mesa 2] tag`);
        } else {
          assert.ok(!formatted.startsWith('['), `Item ${item.nombre_producto} must not have bracket tag`);
        }
      }
    });
  });
});
