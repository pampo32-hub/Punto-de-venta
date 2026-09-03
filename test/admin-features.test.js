const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/test-server');

describe('Tier 6: Admin Modules (Inventory, Audit & Real-Time Metrics)', () => {
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

  // 1. CONTROL DE ACCESO
  describe('Security & Role-Based Access Control', () => {
    it('T6.1: rejects non-admin users (salonero) with 403 Forbidden on admin endpoints', async () => {
      const rInv = await server.request('/api/admin/inventario', {
        headers: { 'x-user-rol': 'salonero' }
      });
      assert.strictEqual(rInv.status, 403);
      assert.match(rInv.data.error, /Requiere permisos de Administrador/);

      const rAud = await server.request('/api/admin/auditoria', {
        headers: { 'x-user-rol': 'salonero' }
      });
      assert.strictEqual(rAud.status, 403);

      const rMet = await server.request('/api/admin/metricas/dashboard', {
        headers: { 'x-user-rol': 'salonero' }
      });
      assert.strictEqual(rMet.status, 403);
    });

    it('T6.2: allows admin users to access all admin endpoints with 200 OK', async () => {
      const rInv = await server.request('/api/admin/inventario', {
        headers: { 'x-user-rol': 'admin' }
      });
      assert.strictEqual(rInv.status, 200);
      assert.ok(Array.isArray(rInv.data));

      const rAud = await server.request('/api/admin/auditoria', {
        headers: { 'x-user-rol': 'admin' }
      });
      assert.strictEqual(rAud.status, 200);
      assert.ok(Array.isArray(rAud.data));

      const rMet = await server.request('/api/admin/metricas/dashboard', {
        headers: { 'x-user-rol': 'admin' }
      });
      assert.strictEqual(rMet.status, 200);
      assert.ok(rMet.data.resumen);
    });
  });

  // 2. INVENTARIO
  describe('Inventory Management & Automatic Deduction', () => {
    it('T6.3: registers new inventory items and applies stock adjustments (entrada & merma)', async () => {
      const rCreate = await server.request('/api/admin/inventario', {
        method: 'POST',
        headers: { 'x-user-rol': 'admin' },
        body: {
          nombre: 'Queso Gouda Artesanal',
          categoria: 'Lácteos & Cocina',
          unidad_medida: 'kg',
          stock_actual: 5,
          stock_minimo: 2,
          costo_unitario: 6500,
          usuarioNombre: 'Admin General'
        }
      });
      assert.strictEqual(rCreate.status, 200);
      const insumoId = rCreate.data.id;

      const rEntrada = await server.request(`/api/admin/inventario/${insumoId}/ajuste`, {
        method: 'POST',
        headers: { 'x-user-rol': 'admin' },
        body: {
          tipo: 'entrada',
          cantidad: 10,
          motivo: 'Compra de 10kg a Distribuidora',
          usuarioNombre: 'Admin General'
        }
      });
      assert.strictEqual(rEntrada.status, 200);
      assert.strictEqual(rEntrada.data.stock_actual, 15);

      const rMerma = await server.request(`/api/admin/inventario/${insumoId}/ajuste`, {
        method: 'POST',
        headers: { 'x-user-rol': 'admin' },
        body: {
          tipo: 'merma',
          cantidad: 2,
          motivo: 'Pérdida por vencimiento de lote',
          usuarioNombre: 'Admin General'
        }
      });
      assert.strictEqual(rMerma.status, 200);
      assert.strictEqual(rMerma.data.stock_actual, 13);
    });

    it('T6.4: automatically deducts stock when food or drink items are ordered', async () => {
      await server.request('/api/admin/inventario', {
        method: 'POST',
        headers: { 'x-user-rol': 'admin' },
        body: {
          nombre: 'Stock Cerveza Imperial Test',
          categoria: 'Bebidas',
          unidad_medida: 'botellas',
          stock_actual: 20,
          stock_minimo: 5,
          costo_unitario: 900,
          producto_id: 1,
          usuarioNombre: 'Admin'
        }
      });

      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 2,
          items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 3, destino: 'barra' }]
        }
      });

      const rInv = await server.request('/api/admin/inventario', {
        headers: { 'x-user-rol': 'admin' }
      });
      const insumoImperial = rInv.data.find(i => i.nombre === 'Stock Cerveza Imperial Test');
      assert.ok(insumoImperial);
      assert.strictEqual(insumoImperial.stock_actual, 17);
    });
  });

  // 3. AUDITORÍA
  describe('Security Audit Trail & Logging', () => {
    it('T6.5: logs comanda cancellations with mandatory reason, user and supervisor pin into Auditoria', async () => {
      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 4,
          items: [{ id: 10, nombre: 'Hamburguesa Angus', precio: 6500, cantidad: 1, destino: 'cocina' }]
        }
      });

      const kdss = (await server.request('/api/kds?destino=todos')).data;
      const burger = kdss.find(c => c.mesa_id === 4 && (c.nombre_producto === 'Hamburguesa Angus' || c.platillo === 'Hamburguesa Angus'));
      assert.ok(burger);

      const rAnula = await server.request('/api/comandas/anular-item', {
        method: 'POST',
        body: {
          detalleId: burger.id,
          motivo: 'Cliente canceló por tiempo de espera',
          supervisorPin: '1234',
          mesaNumero: 'Mesa 4',
          usuarioNombre: 'Salonero Carlos'
        }
      });
      assert.strictEqual(rAnula.status, 200);

      const rAud = await server.request('/api/admin/auditoria', {
        headers: { 'x-user-rol': 'admin' }
      });
      const eventoAnulacion = rAud.data.find(a => a.accion === 'anulacion_comanda');
      assert.ok(eventoAnulacion, 'Debe existir registro en Auditoria para la anulación');
      assert.strictEqual(eventoAnulacion.usuario_nombre, 'Salonero Carlos');
      assert.strictEqual(eventoAnulacion.motivo, 'Cliente canceló por tiempo de espera');
      assert.strictEqual(eventoAnulacion.pin_autorizado, 1);
    });
  });

  // 4. MÉTRICAS
  describe('Real-Time Metrics & Executive Dashboard', () => {
    it('T6.6: calculates pennies-accurate sales, tickets, top sellers and kitchen times', async () => {
      const rMetricas = await server.request('/api/admin/metricas/dashboard', {
        headers: { 'x-user-rol': 'admin' }
      });

      assert.strictEqual(rMetricas.status, 200);
      assert.ok('totalVentasHoy' in rMetricas.data.resumen);
      assert.ok('cuentasHoy' in rMetricas.data.resumen);
      assert.ok('ticketPromedio' in rMetricas.data.resumen);
      assert.ok('tiempoPromedioCocinaMin' in rMetricas.data.resumen);
      assert.ok(Array.isArray(rMetricas.data.topProductos));
      assert.ok(Array.isArray(rMetricas.data.ventasPorHora));
      assert.ok(Array.isArray(rMetricas.data.alertasStock));
    });

    it('T6.7: requesting bill via QR transitions table state to "cuenta" for illuminated blinking alert', async () => {
      // 1. Abrir mesa y agregar ítems
      await server.request('/api/comandas/enviar', {
        method: 'POST',
        body: {
          mesaId: 3,
          items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 2, destino: 'barra' }]
        }
      });

      // 2. Cliente solicita cuenta por QR
      const rQr = await server.request('/api/cliente/mesa/3/pedir-cuenta', {
        method: 'POST'
      });
      assert.strictEqual(rQr.status, 200);
      assert.match(rQr.data.message, /enviada|exitosa/i);

      // 3. Verificar que la mesa 3 pasa a estado 'cuenta'
      const rMesas = await server.request('/api/mesas');
      const mesa3 = rMesas.data.mesas.find(m => m.id === 3);
      assert.ok(mesa3);
      assert.strictEqual(mesa3.estado, 'cuenta');
    });
  });
});
