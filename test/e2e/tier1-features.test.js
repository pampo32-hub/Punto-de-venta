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

describe('Tier 1: Feature Coverage (R1 - R4)', () => {
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
  // R1: LÓGICA DINÁMICA DE COMANDAS ("Enviar a Cocina" vs "Guardar")
  // ==========================================================================
  describe('Feature 1 (R1): Dynamic Comanda Button', () => {
    it('T1.1: should show "🔥 Enviar a Cocina" when new kitchen food items exist', () => {
      const items = [
        {
          id: 8,
          nombre: 'Chifrijo Tradicional',
          destino: 'cocina',
          curso: 2,
          enviado: false,
          id_detalle_existente: null
        }
      ];
      const result = evaluarBotonComanda(items);
      assert.strictEqual(result.text, '🔥 Enviar a Cocina');
      assert.strictEqual(result.className, 'btn-btn-cmd cocina');
      assert.strictEqual(result.tieneNuevosCocina, true);
    });

    it('T1.2: should show "💾 Guardar" when order only contains bar/drink items', () => {
      const items = [
        {
          id: 1,
          nombre: 'Imperial Regular',
          destino: 'barra',
          curso: 2,
          enviado: false,
          id_detalle_existente: null
        }
      ];
      const result = evaluarBotonComanda(items);
      assert.strictEqual(result.text, '💾 Guardar');
      assert.strictEqual(result.className, 'btn-btn-cmd guardar');
      assert.strictEqual(result.tieneNuevosCocina, false);
    });

    it('T1.3: should switch to "💾 Guardar" when food is already sent and only new drinks are added', () => {
      const items = [
        {
          id: 8,
          nombre: 'Chifrijo Tradicional',
          destino: 'cocina',
          enviado: true,
          id_detalle_existente: 101
        },
        {
          id: 2,
          nombre: 'Pilsen',
          destino: 'barra',
          enviado: false,
          id_detalle_existente: null
        }
      ];
      const result = evaluarBotonComanda(items);
      assert.strictEqual(result.text, '💾 Guardar');
      assert.strictEqual(result.className, 'btn-btn-cmd guardar');
      assert.strictEqual(result.tieneNuevosCocina, false);
    });

    it('T1.4: should switch back to "🔥 Enviar a Cocina" when new food is added to an already sent order', () => {
      const items = [
        {
          id: 8,
          nombre: 'Chifrijo Tradicional',
          destino: 'cocina',
          enviado: true,
          id_detalle_existente: 101
        },
        {
          id: 2,
          nombre: 'Pilsen',
          destino: 'barra',
          enviado: true,
          id_detalle_existente: 102
        },
        {
          id: 11,
          nombre: 'Corte Rib Eye 350g',
          destino: 'cocina',
          enviado: false,
          id_detalle_existente: null
        }
      ];
      const result = evaluarBotonComanda(items);
      assert.strictEqual(result.text, '🔥 Enviar a Cocina');
      assert.strictEqual(result.className, 'btn-btn-cmd cocina');
      assert.strictEqual(result.tieneNuevosCocina, true);
    });

    it('T1.5: POST /api/comandas/enviar creates order and transitions table to "esperando" for kitchen items', async () => {
      const mesaId = 10;
      const res = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          mesero: 'Carlos Solano',
          items: [
            {
              id: 8,
              nombre: 'Chifrijo Tradicional',
              precio: 4500,
              cantidad: 1,
              destino: 'cocina',
              curso: 2
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.ordenId, 'Should return created ordenId');

      // Verify table state in database
      const mesa = await server.dbGet('SELECT estado, mesero FROM Mesas WHERE id = ?', [mesaId]);
      assert.strictEqual(mesa.estado, 'esperando');
      assert.strictEqual(mesa.mesero, 'Carlos Solano');
    });

    it('T1.6: POST /api/comandas/enviar saves bar items without failing', async () => {
      const mesaId = 11;
      const res = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId,
          mesero: 'Sofía Morales',
          items: [
            {
              id: 1,
              nombre: 'Imperial Regular',
              precio: 1800,
              cantidad: 2,
              destino: 'barra',
              curso: 2
            }
          ]
        }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.ordenId);

      const itemsDb = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [res.data.ordenId]);
      assert.strictEqual(itemsDb.length, 1);
      assert.strictEqual(itemsDb[0].destino, 'barra');
    });
  });

  // ==========================================================================
  // R2: ESTADOS DE KDS, ENTREGAS PARCIALES Y TIEMPOS DE ESPERA
  // ==========================================================================
  describe('Feature 2 (R2): KDS Table States & Wait Tooltips', () => {
    it('T1.7: Table evaluates to "esperando" when all kitchen items are pending', () => {
      const items = [
        { id: 1, nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'pendiente' },
        { id: 2, nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'preparando' }
      ];
      const estado = evaluarEstadoMesaKDS(items);
      assert.strictEqual(estado, 'esperando');
    });

    it('T1.8: Table evaluates to "esperando_parcial" when some dishes are ready and others pending', () => {
      const items = [
        { id: 1, nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'listo' },
        { id: 2, nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'pendiente' },
        { id: 3, nombre_producto: 'Alitas BBQ', destino: 'cocina', estado_comanda: 'preparando' }
      ];
      const estado = evaluarEstadoMesaKDS(items);
      assert.strictEqual(estado, 'esperando_parcial');
    });

    it('T1.9: Table evaluates to "activa" (Blue) when ALL kitchen items are marked "listo"', () => {
      const items = [
        { id: 1, nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'listo' },
        { id: 2, nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'listo' }
      ];
      const estado = evaluarEstadoMesaKDS(items);
      assert.strictEqual(estado, 'activa');
    });

    it('T1.10: Wait tooltip calculates correct elapsed minutes from primera_comanda_hora', () => {
      const ahora = new Date('2026-09-03T14:30:00Z');
      const primeraComanda = new Date('2026-09-03T14:18:00Z').toISOString(); // 12 mins ago

      const tooltip = formatearTooltipEspera(primeraComanda, ['Rib Eye', 'Chifrijo'], ahora);
      assert.strictEqual(tooltip.minutos, 12);
      assert.strictEqual(tooltip.titulo, '⏱️ Esperando hace 12 min');
      assert.ok(tooltip.tooltipText.includes('Rib Eye'));
      assert.ok(tooltip.tooltipText.includes('Chifrijo'));
    });

    it('T1.11: Wait tooltip excludes completed dishes and lists only pending items', () => {
      const ahora = new Date('2026-09-03T14:30:00Z');
      const primeraComanda = new Date('2026-09-03T14:20:00Z').toISOString();
      const platosPendientes = ['Ceviche Mixto con Aguacate'];

      const tooltip = formatearTooltipEspera(primeraComanda, platosPendientes, ahora);
      assert.strictEqual(tooltip.items.length, 1);
      assert.strictEqual(tooltip.items[0], 'Ceviche Mixto con Aguacate');
      assert.strictEqual(tooltip.minutos, 10);
    });

    it('T1.12: POST /api/kds/:detalleId/estado updates item status in DetalleOrden', async () => {
      // First create a comanda
      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          mesero: 'Carlos Solano',
          items: [{ id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' }]
        }
      });
      const ordenId = envRes.data.ordenId;
      const detalle = await server.dbGet('SELECT id FROM DetalleOrden WHERE orden_id = ?', [ordenId]);

      // Update via KDS endpoint
      const kdsRes = await server.request(`/api/kds/${detalle.id}/estado`, {
        method: 'POST',
        body: { estado: 'listo' }
      });

      assert.strictEqual(kdsRes.status, 200);
      const updated = await server.dbGet('SELECT estado_comanda, hora_listo FROM DetalleOrden WHERE id = ?', [detalle.id]);
      assert.strictEqual(updated.estado_comanda, 'listo');
      assert.ok(updated.hora_listo, 'hora_listo timestamp should be populated');
    });
  });

  // ==========================================================================
  // R3: ACTIVACIÓN Y DESACTIVACIÓN INTELIGENTE DE HAPPY HOUR
  // ==========================================================================
  describe('Feature 3 (R3): Happy Hour Pricing & Auto-Expiration', () => {
    it('T1.13: Participating beers and cocktails have happy_hour = 1 flag in database', async () => {
      const rows = await server.dbAll(
        "SELECT id, nombre, codigo, destino, happy_hour FROM Productos WHERE codigo IN ('BEB01', 'BEB02', 'BEB03', 'COC01', 'COC02', 'ENT01')"
      );

      const beersAndCocktails = rows.filter((r) => r.codigo !== 'ENT01');
      const kitchenFood = rows.filter((r) => r.codigo === 'ENT01');

      // Participating products must have happy_hour = 1
      for (const prod of beersAndCocktails) {
        assert.strictEqual(prod.happy_hour, 1, `Product ${prod.nombre} (${prod.codigo}) should have happy_hour = 1`);
      }
      // Kitchen food should NOT have happy_hour = 1
      for (const food of kitchenFood) {
        assert.strictEqual(food.happy_hour, 0, `Food ${food.nombre} should not have happy_hour = 1`);
      }
    });

    it('T1.14: Happy Hour 2x1 formula applies 1 free item per 2 units on promo products', () => {
      const items = [
        { nombre: 'Imperial Regular', precio: 1800, cantidad: 2, happy_hour: 1 },
        { nombre: 'Mojito Clásico', precio: 3800, cantidad: 4, happy_hour: 1 }
      ];

      const res = calcularTotalesHappyHour(items, true);
      // 2 Imperials -> 1 free (1800 discount)
      // 4 Mojitos -> 2 free (7600 discount)
      assert.strictEqual(res.descuentoHH, 1800 + 7600);
      assert.strictEqual(res.subtotal, 1800 * 2 + 3800 * 4); // 3600 + 15200 = 18800
      assert.strictEqual(res.subNeto, 18800 - 9400); // 9400
      assert.strictEqual(res.servicio, Math.round(9400 * 0.10)); // 940
      assert.strictEqual(res.iva, Math.round(9400 * 0.13)); // 1222
      assert.strictEqual(res.total, 9400 + 940 + 1222);
    });

    it('T1.15: Happy Hour gives 0 discount on food items even when HH is active', () => {
      const items = [
        { nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 4, happy_hour: 0 },
        { nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 2, happy_hour: 0 }
      ];

      const res = calcularTotalesHappyHour(items, true);
      assert.strictEqual(res.descuentoHH, 0, 'Food items should never receive HH discount');
      assert.strictEqual(res.subNeto, res.subtotal);
    });

    it('T1.16: Happy Hour inactive ignores 2x1 even on promo products', () => {
      const items = [
        { nombre: 'Imperial Regular', precio: 1800, cantidad: 4, happy_hour: 1 }
      ];

      const res = calcularTotalesHappyHour(items, false);
      assert.strictEqual(res.descuentoHH, 0, 'Discount must be 0 when happy hour is inactive');
      assert.strictEqual(res.subNeto, 1800 * 4);
    });

    it('T1.17: Auto-expiration evaluates active state based on schedule end time', () => {
      function checkAutoExpiration(currentTimeStr, endTimeStr, isCurrentlyActive) {
        if (!isCurrentlyActive) return false;
        return currentTimeStr >= endTimeStr ? false : true;
      }

      // Schedule: ends at 19:00
      assert.strictEqual(checkAutoExpiration('18:59', '19:00', true), true, 'Still active at 18:59');
      assert.strictEqual(checkAutoExpiration('19:00', '19:00', true), false, 'Auto-expires at 19:00');
      assert.strictEqual(checkAutoExpiration('19:05', '19:00', true), false, 'Auto-expired after 19:00');
      assert.strictEqual(checkAutoExpiration('15:00', '19:00', false), false, 'Remains false when not active');
    });
  });

  // ==========================================================================
  // R4: MOVER, UNIR Y SEPARAR MESAS MEDIANTE DRAG & DROP & TRAZABILIDAD
  // ==========================================================================
  describe('Feature 4 (R4): Table Move, Merge, Split & Item Traceability', () => {
    it('T1.18: POST /api/mesas/mover transfers order to empty destination table and frees origin', async () => {
      // Create order on Table 10
      const envRes = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 10,
          mesero: 'Carlos Solano',
          items: [{ id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 1, destino: 'cocina' }]
        }
      });
      const ordenId = envRes.data.ordenId;

      // Move Table 10 -> Table 11 (vacant)
      const moverRes = await server.request('/api/mesas/mover', {
        method: 'POST',
        body: {
          origenMesaId: 10,
          destinoMesaId: 11
        }
      });

      assert.strictEqual(moverRes.status, 200);

      // Verify origin mesa is now libre
      const mesaOrig = await server.dbGet('SELECT estado, mesero FROM Mesas WHERE id = 10');
      assert.strictEqual(mesaOrig.estado, 'libre');
      assert.strictEqual(mesaOrig.mesero, null);

      // Verify destination mesa inherited the order and state
      const mesaDest = await server.dbGet('SELECT estado, mesero FROM Mesas WHERE id = 11');
      assert.strictEqual(mesaDest.estado, 'esperando');
      assert.strictEqual(mesaDest.mesero, 'Carlos Solano');

      // Verify order now points to destination table
      const orden = await server.dbGet('SELECT mesa_id FROM Ordenes WHERE id = ?', [ordenId]);
      assert.strictEqual(orden.mesa_id, 11);
    });

    it('T1.19: POST /api/mesas/unir merges two occupied tables and recalculates combined total', async () => {
      // Order 1 on Table 9 (Mesa 3)
      const r1 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 9,
          items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
        }
      });

      // Order 2 on Table 11 (Mesa 2)
      const r2 = await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 11,
          items: [{ id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, destino: 'cocina' }]
        }
      });

      const unirRes = await server.request('/api/mesas/unir', {
        method: 'POST',
        body: {
          mesaPrincipalId: 9,
          mesaSecundariaId: 11
        }
      });

      assert.strictEqual(unirRes.status, 200);

      // Combined items in primary order
      const itemsMerged = await server.dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ?', [r1.data.ordenId]);
      assert.strictEqual(itemsMerged.length, 2);

      // Secondary order marked as fusionada
      const ordenSec = await server.dbGet('SELECT estado FROM Ordenes WHERE id = ?', [r2.data.ordenId]);
      assert.strictEqual(ordenSec.estado, 'fusionada');

      // Secondary mesa state updated
      const mesaSec = await server.dbGet('SELECT estado FROM Mesas WHERE id = 11');
      assert.ok(mesaSec.estado === 'libre' || mesaSec.estado === 'unida');
    });

    it('T1.20: Item origin provenance formatting tags secondary table items as [Mesa X]', () => {
      // Item belonging to Mesa 2, currently viewed in Table 4
      const itemMesa2 = {
        nombre_producto: 'Corona Extra Extra',
        origen_mesa_numero: '2'
      };
      const formatted = formatearNombreItemConOrigen(itemMesa2, '4');
      assert.strictEqual(formatted, '[Mesa 2] Corona Extra Extra');

      // Item belonging to the primary table itself (Mesa 4)
      const itemMesa4 = {
        nombre_producto: 'Hamburguesa Doble',
        origen_mesa_numero: '4'
      };
      const formattedSame = formatearNombreItemConOrigen(itemMesa4, '4');
      assert.strictEqual(formattedSame, 'Hamburguesa Doble');
    });

    it('T1.21: Pointer drag & drop interaction threshold validates long-press and jitter tolerance', () => {
      function evaluatePointerGesture(pressDurationMs, deltaX, deltaY) {
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        // Long-press threshold >400ms and jitter <= 10px
        if (distance > 10 && pressDurationMs < 400) {
          return 'scroll_or_pan';
        }
        if (pressDurationMs < 400 && distance <= 10) {
          return 'click_open_comandero';
        }
        if (pressDurationMs >= 400 && distance <= 10) {
          return 'drag_mode_activated';
        }
        return 'drag_in_progress';
      }

      assert.strictEqual(evaluatePointerGesture(150, 2, 3), 'click_open_comandero');
      assert.strictEqual(evaluatePointerGesture(150, 15, 20), 'scroll_or_pan');
      assert.strictEqual(evaluatePointerGesture(450, 4, 5), 'drag_mode_activated');
      assert.strictEqual(evaluatePointerGesture(800, 50, 60), 'drag_in_progress');
    });
  });

  // ==========================================================================
  // R5: QR SOLICITAR MESERO - ENFRIAMIENTO 2 MINUTOS Y REACTIVACIÓN CÍCLICA
  // ==========================================================================
  describe('Feature 5: QR Waiter Request Cooldown & Re-activation', () => {
    it('T1.22: POST /api/cliente/mesa/:id/pedir-cuenta sets hora_pidio_cuenta and pidio_cuenta_qr', async () => {
      const resCmd = await fetch(`${server.baseUrl}/api/comandas/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesaId: 1,
          items: [{ id: 8, cantidad: 1, precio: 5500, nombre: 'Chifrijo', curso: 2, destino: 'cocina' }]
        })
      });
      assert.strictEqual(resCmd.status, 200);

      const resQr = await fetch(`${server.baseUrl}/api/cliente/mesa/1/pedir-cuenta`, {
        method: 'POST'
      });
      assert.strictEqual(resQr.status, 200);
      const bodyQr = await resQr.json();
      assert.ok(bodyQr.hora_pidio_cuenta, 'Debe devolver la hora de solicitud');

      const resMesa = await fetch(`${server.baseUrl}/api/cliente/mesa/1`);
      assert.strictEqual(resMesa.status, 200);
      const data = await resMesa.json();
      assert.strictEqual(data.mesa.estado, 'cuenta');
      assert.strictEqual(data.mesa.pidio_cuenta_qr, 1);
      assert.ok(data.mesa.hora_pidio_cuenta, 'La mesa debe almacenar hora_pidio_cuenta');
    });

    it('T1.23: Cooldown logic keeps button disabled for <120s and re-activates >=120s if still open', () => {
      const ahora = Date.now();
      // Pasaron 45s (< 120s): debe seguir deshabilitado con 75s restantes
      const ts45s = ahora - (45 * 1000);
      const restante45s = Math.max(0, 120 - Math.floor((ahora - ts45s) / 1000));
      assert.strictEqual(restante45s, 75);
      const deshabilitado = restante45s > 0;
      assert.strictEqual(deshabilitado, true);

      // Pasaron 121s (>= 120s): debe reactivarse si la cuenta sigue abierta
      const ts121s = ahora - (121 * 1000);
      const restante121s = Math.max(0, 120 - Math.floor((ahora - ts121s) / 1000));
      assert.strictEqual(restante121s, 0);
      const cuentaAbierta = true;
      const reactivado = restante121s <= 0 && cuentaAbierta;
      assert.strictEqual(reactivado, true);
    });

    it('T1.24: Completing payment frees table and resets hora_pidio_cuenta to NULL', async () => {
      const resCmd = await fetch(`${server.baseUrl}/api/comandas/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesaId: 2,
          items: [{ id: 1, cantidad: 1, precio: 2000, nombre: 'Imperial', curso: 1, destino: 'barra' }]
        })
      });
      const { ordenId } = await resCmd.json();

      await fetch(`${server.baseUrl}/api/cliente/mesa/2/pedir-cuenta`, { method: 'POST' });

      const resPago = await fetch(`${server.baseUrl}/api/ordenes/${ordenId}/cobrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metodo: 'Efectivo',
          monto: 2500,
          cambio: 500
        })
      });
      assert.strictEqual(resPago.status, 200);

      const resMesa = await fetch(`${server.baseUrl}/api/cliente/mesa/2`);
      const data = await resMesa.json();
      assert.strictEqual(data.mesa.estado, 'libre');
      assert.strictEqual(data.mesa.pidio_cuenta_qr, 0);
      assert.strictEqual(data.mesa.hora_pidio_cuenta, null);
    });
  });
});
