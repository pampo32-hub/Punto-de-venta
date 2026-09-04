const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 8: Inventario Inteligente por Recetas, Escandallos y Kardex 2026', () => {
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

  it('T8.1: GET /api/admin/recetas/:productoId returns recipe cost, margins and portional yield', async () => {
    // Consultar resumen de recetas para ubicar el platillo con escandallo
    const resumenRes = await req('/api/admin/recetas/resumen');
    assert.equal(resumenRes.status, 200);
    assert.ok(Array.isArray(resumenRes.body));

    const platilloConReceta = resumenRes.body.find(r => r.total_ingredientes > 0) || resumenRes.body[0];
    assert.ok(platilloConReceta, 'Debe haber al menos un platillo en el menú');

    const res = await req(`/api/admin/recetas/${platilloConReceta.producto_id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.producto_id, platilloConReceta.producto_id);
    assert.ok(res.body.costo_receta >= 0, 'Costo de receta debe ser >= 0');
    assert.ok(res.body.precio_venta > 0, 'Precio de venta debe ser > 0');
    assert.ok(res.body.margen_bruto !== undefined, 'Margen bruto debe estar definido');
    assert.ok(res.body.margen_porc !== undefined, 'Margen % debe estar definido');
    assert.ok(res.body.food_cost_porc !== undefined, 'Food cost % debe estar definido');
    assert.ok(res.body.porciones_disponibles >= 0, 'Porciones disponibles debe ser número válido');

    assert.ok(Array.isArray(res.body.ingredientes), 'Debe devolver arreglo de ingredientes');
    if (res.body.ingredientes.length > 0) {
      const primerIng = res.body.ingredientes[0];
      assert.ok(primerIng.insumo_nombre, 'Ingrediente debe tener nombre');
      assert.ok(primerIng.cantidad_bruta > 0, 'Cantidad bruta debe ser > 0');
      assert.ok(primerIng.subtotal_costo >= 0, 'Subtotal costo debe ser >= 0');
    }
  });

  it('T8.2: POST and DELETE /api/admin/recetas/:productoId/ingredientes manages recipe items dynamically', async () => {
    // Registrar un nuevo insumo de prueba
    const nuevoInsumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Bacon Ahumado Premium Test',
      categoria: 'Carnes',
      unidad_medida: 'porciones',
      stock_actual: 50,
      stock_minimo: 10,
      costo_unitario: 600,
      usuarioNombre: 'Admin Chef'
    });
    assert.equal(nuevoInsumoRes.status, 201);
    const insumoId = nuevoInsumoRes.body.id;

    // Obtener costo actual del platillo 13
    const recAntes = await req('/api/admin/recetas/13');
    assert.equal(recAntes.status, 200);
    const costoAntes = recAntes.body.costo_receta;

    // Agregar bacon a la receta (1 porción con 5% de merma: 600 * 1.05 = 630)
    const addRes = await req('/api/admin/recetas/13/ingredientes', 'POST', {
      insumo_id: insumoId,
      cantidad: 1,
      merma_porcentaje: 5
    });
    assert.equal(addRes.status, 200);
    assert.equal(addRes.body.ok, true);

    // Verificar que el costo de la receta aumentó proporcionalmente (+630)
    const recDespues = await req('/api/admin/recetas/13');
    assert.ok(recDespues.body.costo_receta > costoAntes);
    const itemBacon = recDespues.body.ingredientes.find(i => i.insumo_id === insumoId);
    assert.ok(itemBacon, 'Bacon debe estar en la receta');
    assert.equal(itemBacon.merma_porcentaje, 5);
    assert.equal(itemBacon.subtotal_costo, 630);

    // Eliminar el ingrediente de la receta
    const delRes = await req(`/api/admin/recetas/13/ingredientes/${insumoId}`, 'DELETE');
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.ok, true);

    // Verificar que el costo regresó a su valor previo
    const recFinal = await req('/api/admin/recetas/13');
    assert.equal(recFinal.body.costo_receta, costoAntes);
  });

  it('T8.3: descontarInventarioPorItems proportionally deducts recipe ingredients and writes Kardex ledger', async () => {
    // Ubicar un insumo vinculado a la receta de la hamburguesa (id 13)
    const rec = await req('/api/admin/recetas/13');
    assert.ok(rec.body.ingredientes.length > 0, 'La receta debe tener ingredientes vinculados');

    const ingPrueba = rec.body.ingredientes[0];
    const insumoId = ingPrueba.insumo_id;
    const stockPrevio = ingPrueba.stock_actual;
    const cantReceta = ingPrueba.cantidad_bruta;

    // Enviar comanda con 2 unidades del platillo 13
    const orderRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Mesero Test',
      items: [
        { id: 13, nombre: 'Hamburguesa Doble Bacon-Cheddar', cantidad: 2, precio: 6500, destino: 'cocina' }
      ]
    });
    assert.equal(orderRes.status, 200);

    // Verificar deducción de inventario del insumo: stockPrevio - (cantReceta * 2)
    const invDespues = await req('/api/admin/inventario');
    const insumoDespues = invDespues.body.find(i => i.id === insumoId);
    assert.ok(insumoDespues);
    assert.equal(insumoDespues.stock_actual, stockPrevio - (cantReceta * 2));

    // Verificar que se escribió en InventarioMovimientos (Kardex)
    const kardexRes = await req(`/api/admin/inventario/${insumoId}/kardex`);
    assert.equal(kardexRes.status, 200);
    assert.ok(kardexRes.body.movimientos.length > 0);

    const ultimoMov = kardexRes.body.movimientos[0];
    assert.equal(ultimoMov.tipo, 'venta');
    assert.equal(ultimoMov.cantidad, cantReceta * 2);
    assert.equal(ultimoMov.stock_previo, stockPrevio);
    assert.equal(ultimoMov.stock_nuevo, stockPrevio - (cantReceta * 2));
    assert.ok(ultimoMov.motivo.toLowerCase().includes('comanda'));
  });

  it('T8.4: Manual inventory adjustment writes to Kardex with financial impact', async () => {
    // Entrada de 20 unidades por compra
    const ajusteEntrada = await req('/api/admin/inventario/1/ajuste', 'POST', {
      tipo: 'entrada',
      cantidad: 20,
      motivo: 'Factura Distribuidora #9981',
      usuarioNombre: 'Bodeguero Carlos'
    });
    assert.equal(ajusteEntrada.status, 200);
    assert.equal(ajusteEntrada.body.nuevo_stock, ajusteEntrada.body.stock_previo + 20);

    // Merma de 3 unidades
    const ajusteMerma = await req('/api/admin/inventario/1/ajuste', 'POST', {
      tipo: 'merma',
      cantidad: 3,
      motivo: 'Botella rota en transporte',
      usuarioNombre: 'Chef Mario'
    });
    assert.equal(ajusteMerma.status, 200);
    assert.equal(ajusteMerma.body.nuevo_stock, ajusteMerma.body.stock_previo - 3);

    // Verificar Kardex de insumo 1
    const kardex = await req('/api/admin/inventario/1/kardex');
    assert.equal(kardex.status, 200);

    const movMerma = kardex.body.movimientos.find(m => m.tipo === 'merma');
    assert.ok(movMerma);
    assert.equal(movMerma.cantidad, 3);
    assert.equal(movMerma.usuario_nombre, 'Chef Mario');

    const movEntrada = kardex.body.movimientos.find(m => m.tipo === 'entrada');
    assert.ok(movEntrada);
    assert.equal(movEntrada.cantidad, 20);
    assert.equal(movEntrada.usuario_nombre, 'Bodeguero Carlos');
  });

  it('T8.5: GET /api/admin/inventario/sugerencia-compras generates replenishment quantities and estimated budget', async () => {
    // Fijar stock del insumo 1 en 2 (siendo mínimo 12)
    const fijarRes = await req('/api/admin/inventario/1/ajuste', 'POST', {
      tipo: 'fijar',
      cantidad: 2,
      motivo: 'Conteo físico de fin de turno',
      usuarioNombre: 'Supervisor'
    });
    assert.equal(fijarRes.status, 200);

    const res = await req('/api/admin/inventario/sugerencia-compras');
    assert.equal(res.status, 200);
    assert.ok(res.body.articulos_a_comprar >= 1);
    assert.ok(res.body.presupuesto_total_estimado > 0);

    const itemBajo = res.body.items.find(i => i.id === 1);
    assert.ok(itemBajo, 'El insumo con stock bajo debe aparecer en la orden de compras sugerida');
    assert.equal(itemBajo.stock_actual, 2);
    assert.ok(itemBajo.cantidad_sugerida >= 10, 'Debe sugerir reponer hasta el stock objetivo');
    assert.ok(itemBajo.costo_estimado > 0);
  });
});
