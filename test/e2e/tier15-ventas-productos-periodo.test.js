const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 15: Reporte de Ventas por Producto, Período y Consumo en Kárdex 2026', () => {
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

  function req(endpoint, method = 'GET', body = null, headers = { 'x-user-rol': 'admin' }) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T15.1: Seguridad: Rechaza acceso a saloneros (403) y permite a admin', async () => {
    const rDenied = await req('/api/admin/reportes/ventas-productos', 'GET', null, { 'x-user-rol': 'salonero' });
    assert.equal(rDenied.status, 403);

    const rOk = await req('/api/admin/reportes/ventas-productos', 'GET', null, { 'x-user-rol': 'admin' });
    assert.equal(rOk.status, 200);
    assert.ok(rOk.body.resumen);
    assert.ok(Array.isArray(rOk.body.productos));
    assert.ok(Array.isArray(rOk.body.insumos_consumidos));
  });

  it('T15.2: Solo contabiliza órdenes pagadas, ignorando órdenes abiertas o canceladas', async () => {
    // 1. Crear orden abierta (no pagada) en Mesa 1
    const rOrdenAbierta = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 3, destino: 'barra' }],
      mesero: 'carlos'
    });
    assert.equal(rOrdenAbierta.status, 200);

    // 2. Cobrar una orden directa de 2 unidades en Mesa 2
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 2,
      mesero: 'cajero',
      metodo: 'Efectivo',
      metodoPago: 'Efectivo',
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
    });
    assert.equal(rCobro.status, 200);

    // 3. Consultar reporte de ventas
    const hoy = new Date().toISOString().substring(0, 10);
    const rRep = await req(`/api/admin/reportes/ventas-productos?desde=${hoy}&hasta=${hoy}`);
    assert.equal(rRep.status, 200);

    const prodImperial = rRep.body.productos.find(p => p.producto_id === 1);
    assert.ok(prodImperial, 'Debe aparecer el producto cobrado');
    // Solo deben figurar las 2 unidades de la orden pagada, no las 3 de la abierta
    assert.equal(prodImperial.cantidad_vendida, 2);
    assert.equal(prodImperial.total_ingresos, 3600);
  });

  it('T15.3: Filtra con precisión por rango de fechas (desde / hasta)', async () => {
    // Cobrar orden hoy
    await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      mesero: 'cajero',
      metodo: 'Efectivo',
      metodoPago: 'Efectivo',
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, destino: 'barra' }]
    });

    // Consultar con fecha de ayer: no debe tener ventas de hoy
    const ayer = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    const rAyer = await req(`/api/admin/reportes/ventas-productos?desde=${ayer}&hasta=${ayer}`);
    assert.equal(rAyer.status, 200);
    const prodsAyer = rAyer.body.productos.filter(p => p.producto_id === 1);
    assert.equal(prodsAyer.length, 0, 'No debe registrar ventas en fecha pasada');

    // Consultar hoy
    const hoy = new Date().toISOString().substring(0, 10);
    const rHoy = await req(`/api/admin/reportes/ventas-productos?desde=${hoy}&hasta=${hoy}`);
    assert.equal(rHoy.status, 200);
    const prodHoy = rHoy.body.productos.find(p => p.producto_id === 1);
    assert.ok(prodHoy);
    assert.equal(prodHoy.cantidad_vendida, 2);
  });

  it('T15.4: Desglose de insumos consumidos en Kárdex y cálculo de margen de ganancia', async () => {
    // Crear insumo carne
    const rInsumo = await req('/api/admin/inventario', 'POST', {
      nombre: 'Carne Angus 250g Test',
      categoria: 'Carnes',
      unidad_medida: 'cortes',
      stock_actual: 20,
      stock_minimo: 5,
      costo_unitario: 3000,
      es_licor: 0
    });
    assert.equal(rInsumo.status, 201);
    const insumoId = rInsumo.body.id;

    // Crear producto Hamburguesa Angus
    const rProd = await req('/api/productos', 'POST', {
      nombre: 'Hamburguesa Angus Especial Test',
      precio: 8000,
      categoria_id: 1,
      descripcion: 'Hamburguesa angus'
    });
    assert.equal(rProd.status, 201);
    const prodId = rProd.body.producto ? rProd.body.producto.id : rProd.body.id;

    // Asociar insumo mediante receta
    const rRec = await req(`/api/admin/recetas/${prodId}/ingredientes`, 'POST', {
      insumo_id: insumoId,
      cantidad: 1,
      merma_porcentaje: 0
    });
    assert.equal(rRec.status, 200);

    // Cobrar 3 hamburguesas
    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 3,
      mesero: 'cajero',
      metodo: 'Tarjeta',
      metodoPago: 'Tarjeta',
      items: [{ id: prodId, nombre: 'Hamburguesa Angus Especial Test', precio: 8000, cantidad: 3, destino: 'cocina' }]
    });
    assert.equal(rCobro.status, 200);

    // Consultar reporte para ese producto
    const hoy = new Date().toISOString().substring(0, 10);
    const rRep = await req(`/api/admin/reportes/ventas-productos?producto_id=${prodId}&desde=${hoy}&hasta=${hoy}`);
    assert.equal(rRep.status, 200);
    assert.equal(rRep.body.productos.length, 1);

    const burger = rRep.body.productos[0];
    assert.equal(burger.cantidad_vendida, 3);
    assert.equal(burger.total_ingresos, 24000);
    // Costo insumo: 3 unidades * 3000 = 9000
    assert.equal(burger.costo_insumos_total, 9000);
    assert.equal(burger.ganancia_bruta, 15000);
    // Margen %: (15000 / 24000) * 100 = 62.5%
    assert.equal(burger.margen_bruto_pct, 62.5);

    // Verificar desglose de insumos en el producto
    assert.ok(burger.insumos_requeridos.length > 0);
    const insReq = burger.insumos_requeridos[0];
    assert.equal(insReq.insumo_id, insumoId);
    assert.equal(insReq.cantidad_total_consumida, 3);
    assert.equal(insReq.costo_total, 9000);

    // Verificar historial de transacciones
    assert.ok(burger.historial_ventas.length > 0);
    assert.equal(burger.historial_ventas[0].cantidad, 3);
  });

  it('T15.5: Filtro por categoría agrupa y restringe los productos retornados', async () => {
    const hoy = new Date().toISOString().substring(0, 10);
    // Categoría 4 = Cervezas
    const rCat = await req(`/api/admin/reportes/ventas-productos?categoria_id=4&desde=${hoy}&hasta=${hoy}`);
    assert.equal(rCat.status, 200);
    rCat.body.productos.forEach(p => {
      assert.equal(p.categoria_id, 4);
    });
  });

  it('T15.6: Retorna ultimas_ventas ordenadas cronológicamente de la más reciente a la más antigua con ítems y pagos', async () => {
    // 1. Cobrar primera orden en Mesa 7
    const r1 = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 7,
      mesero: 'carlos',
      metodo: 'Efectivo',
      metodoPago: 'Efectivo',
      items: [{ id: 1, nombre: 'Imperial Regular', precio: 1800, cantidad: 1, destino: 'barra' }]
    });
    assert.equal(r1.status, 200);

    // 2. Cobrar segunda orden en Mesa 8
    const r2 = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 8,
      mesero: 'maria',
      metodo: 'Tarjeta',
      metodoPago: 'Tarjeta',
      items: [{ id: 2, nombre: 'Pilsen', precio: 1800, cantidad: 2, destino: 'barra' }]
    });
    assert.equal(r2.status, 200);

    // 3. Consultar reporte de ventas
    const hoy = new Date().toISOString().substring(0, 10);
    const rRep = await req(`/api/admin/reportes/ventas-productos?desde=${hoy}&hasta=${hoy}`);
    assert.equal(rRep.status, 200);
    assert.ok(Array.isArray(rRep.body.ultimas_ventas));
    assert.ok(rRep.body.ultimas_ventas.length >= 2);

    // La venta más reciente (Mesa 8 / Pilsen / Tarjeta) debe ser la primera
    const primerVenta = rRep.body.ultimas_ventas[0];
    const segundaVenta = rRep.body.ultimas_ventas[1];

    assert.equal(primerVenta.mesa_id, 8);
    assert.equal(primerVenta.mesero, 'maria');
    assert.equal(primerVenta.metodo_pago, 'Tarjeta');
    assert.ok(primerVenta.items.length > 0);
    assert.equal(primerVenta.items[0].nombre, 'Pilsen');

    assert.equal(segundaVenta.mesa_id, 7);
    assert.equal(segundaVenta.mesero, 'carlos');
    assert.equal(segundaVenta.metodo_pago, 'Efectivo');
  });
});
