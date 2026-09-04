const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 9: Control de Licores, Botellas y Medidas de Shots Configurables 2026', () => {
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

  it('T9.1: Insumos de licor iniciales tienen es_licor=1, capacidad_ml=750, medida_shot_ml=30 y rendimiento_shots=25 con cálculo dual', async () => {
    const res = await req('/api/admin/inventario');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));

    const ron = res.body.find(i => i.nombre.includes('Bacardí') || i.nombre.includes('Ron'));
    assert.ok(ron, 'Debe existir insumo de ron en el inventario inicial');
    assert.equal(ron.es_licor, 1);
    assert.equal(ron.capacidad_ml, 750);
    assert.equal(ron.medida_shot_ml, 30);
    assert.equal(ron.rendimiento_shots, 25);
    assert.ok(ron.botellas_enteras !== null);
    assert.ok(ron.shots_remanentes !== null);
    assert.ok(ron.total_shots_actual !== null);
    assert.ok(ron.costo_por_shot !== null);
    assert.equal(ron.costo_por_shot, Math.round((ron.costo_unitario / 25) * 100) / 100);
  });

  it('T9.2: Registrar nuevo licor con capacidad de 1 Litro (1000ml) y shot de 1.5 oz (45ml) calcula rendimiento y costo por shot', async () => {
    const nuevoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Whisky Johnnie Walker Black Label 1L',
      categoria: 'Licores',
      unidad_medida: 'botellas',
      stock_actual: 5,
      stock_minimo: 2,
      costo_unitario: 22000,
      es_licor: 1,
      capacidad_ml: 1000,
      medida_shot_ml: 45
    });

    assert.equal(nuevoRes.status, 201);
    assert.ok(nuevoRes.body.insumoId);
    assert.equal(nuevoRes.body.rendimiento_shots, 22.2);

    const getRes = await req(`/api/admin/inventario/${nuevoRes.body.insumoId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.es_licor, 1);
    assert.equal(getRes.body.capacidad_ml, 1000);
    assert.equal(getRes.body.medida_shot_ml, 45);
    assert.equal(getRes.body.rendimiento_shots, 22.2);
    assert.equal(getRes.body.botellas_enteras, 5);
    assert.equal(getRes.body.shots_remanentes, 0);
    assert.equal(getRes.body.total_shots_actual, Math.round(5 * 22.2));
  });

  it('T9.3: Editar un licor (PUT) permite cambiar capacidad a 1500ml (Magnum) y recalcular rendimiento a 50 shots de 30ml', async () => {
    const listRes = await req('/api/admin/inventario');
    const ron = listRes.body.find(i => i.es_licor === 1);
    assert.ok(ron);

    const editRes = await req(`/api/admin/inventario/${ron.id}`, 'PUT', {
      nombre: ron.nombre + ' Magnum 1.5L',
      categoria: 'Licores',
      unidad_medida: 'botellas',
      stock_minimo: 2,
      costo_unitario: 18000,
      es_licor: 1,
      capacidad_ml: 1500,
      medida_shot_ml: 30
    });

    assert.equal(editRes.status, 200);

    const getRes = await req(`/api/admin/inventario/${ron.id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.capacidad_ml, 1500);
    assert.equal(getRes.body.medida_shot_ml, 30);
    assert.equal(getRes.body.rendimiento_shots, 50);
    assert.equal(getRes.body.costo_por_shot, Math.round(18000 / 50));
  });

  it('T9.4: Venta de un trago/shot descuenta fraccionalmente la botella y registra motivo dual en Kardex', async () => {
    // 1. Obtener licor de prueba (750ml, 30ml shot, 25 shots/botella)
    const listRes = await req('/api/admin/inventario');
    const licor = listRes.body.find(i => i.es_licor === 1 && i.rendimiento_shots === 25);
    assert.ok(licor);
    const stockInicial = licor.stock_actual;

    // 2. Crear producto trago en menú ("Shot de Ron Imperial") y vincularle 1 shot (0.04 botella)
    const catRes = await req('/api/menu');
    const categorias = catRes.body;
    const catId = categorias[0]?.id || 1;

    // Crear producto directamente en la DB
    const prodInsertRes = await server.dbRun(`
      INSERT INTO Productos (categoria_id, nombre, descripcion, precio, activo)
      VALUES (?, 'Shot de Ron Test', 'Trago 1 oz', 2500, 1)
    `, [catId]);
    const prodInsert = prodInsertRes.lastID;

    // Vincular 1 shot = 1/25 = 0.04 botella
    const addIngRes = await req(`/api/admin/recetas/${prodInsert}/ingredientes`, 'POST', {
      insumo_id: licor.id,
      cantidad: 0.04,
      merma_porcentaje: 0
    });
    assert.equal(addIngRes.status, 200);

    // 3. Enviar comanda con 1 Shot de Ron Test
    const orderRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Mesero Test',
      items: [
        { id: prodInsert, nombre: 'Shot de Ron Test', cantidad: 1, precio: 2500, destino: 'barra' }
      ]
    });
    assert.equal(orderRes.status, 200);

    // 4. Verificar que el stock disminuyó en 0.04 botellas (exactamente 1 shot)
    const checkRes = await req(`/api/admin/inventario/${licor.id}`);
    assert.equal(checkRes.status, 200);
    const stockEsperado = Math.round((stockInicial - 0.04) * 100) / 100;
    assert.equal(checkRes.body.stock_actual, stockEsperado);

    // 5. Verificar que el Kardex registra el desglose dual de botellas y shots
    const kardexRes = await req(`/api/admin/inventario/${licor.id}/kardex`);
    assert.equal(kardexRes.status, 200);
    assert.ok(kardexRes.body.movimientos.length > 0);

    const ultimoMov = kardexRes.body.movimientos[0];
    assert.equal(ultimoMov.tipo, 'venta');
    assert.ok(ultimoMov.motivo.includes('shots') || ultimoMov.motivo.includes('shot'), 'Motivo en Kardex debe detallar shots');
    assert.ok(ultimoMov.motivo.includes('Quedan'), 'Motivo debe indicar balance restante de botellas y shots');
  });

  it('T9.5: Venta de una botella completa descuenta 1 botella entera y registra 25 shots descontados en Kardex', async () => {
    const listRes = await req('/api/admin/inventario');
    const licor = listRes.body.find(i => i.es_licor === 1 && i.rendimiento_shots === 25);
    assert.ok(licor);
    const stockInicial = licor.stock_actual;

    const catRes = await req('/api/menu');
    const catId = catRes.body[0]?.id || 1;

    const prodBotellaRes = await server.dbRun(`
      INSERT INTO Productos (categoria_id, nombre, descripcion, precio, activo)
      VALUES (?, 'Botella Ron Entera Test', 'Servicio de botella', 35000, 1)
    `, [catId]);
    const prodBotella = prodBotellaRes.lastID;

    // Vincular 1 botella completa = 1.0
    await req(`/api/admin/recetas/${prodBotella}/ingredientes`, 'POST', {
      insumo_id: licor.id,
      cantidad: 1.0,
      merma_porcentaje: 0
    });

    // Enviar comanda con 1 botella entera
    const orderRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      mesero: 'Mesero Test',
      items: [
        { id: prodBotella, nombre: 'Botella Ron Entera Test', cantidad: 1, precio: 35000, destino: 'barra' }
      ]
    });
    assert.equal(orderRes.status, 200);

    const checkRes = await req(`/api/admin/inventario/${licor.id}`);
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.stock_actual, Math.round((stockInicial - 1.0) * 100) / 100);

    const kardexRes = await req(`/api/admin/inventario/${licor.id}/kardex`);
    const ultimoMov = kardexRes.body.movimientos[0];
    assert.ok(ultimoMov.motivo.includes('1 botella'), 'Debe reflejar venta de 1 botella');
  });

  it('T9.6: GET /api/admin/inventario/:id/kardex devuelve insumo con es_licor y desglose completo', async () => {
    const listRes = await req('/api/admin/inventario');
    const licor = listRes.body.find(i => i.es_licor === 1);
    assert.ok(licor);

    const res = await req(`/api/admin/inventario/${licor.id}/kardex`);
    assert.equal(res.status, 200);
    assert.ok(res.body.insumo);
    assert.equal(res.body.insumo.es_licor, 1);
    assert.ok(res.body.insumo.capacidad_ml > 0);
    assert.ok(res.body.insumo.medida_shot_ml > 0);
    assert.ok(res.body.insumo.rendimiento_shots > 0);
    assert.ok(Array.isArray(res.body.movimientos));
  });
});
