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

  it('T9.7: Creación de categoría dinámica al vuelo y vinculación directa al crear producto con shot manual de 45ml', async () => {
    // 1. Crear categoría nueva "Aguardientes" con emoji 🍾 y destino barra
    const catRes = await req('/api/categorias', 'POST', {
      nombre: 'Aguardientes y Licores Ticos',
      icono: '🍾',
      destino: 'barra'
    });
    assert.equal(catRes.status, 201);
    assert.ok(catRes.body.categoria);
    assert.equal(catRes.body.categoria.nombre, 'Aguardientes y Licores Ticos');
    assert.equal(catRes.body.categoria.icono, '🍾');
    assert.equal(catRes.body.categoria.destino, 'barra');
    const nuevaCatId = catRes.body.categoria.id;

    // 2. Crear insumo de botella de 1 Litro (1000ml)
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Cacique 1000ml Bar',
      categoria: 'Aguardientes y Licores Ticos',
      unidad_medida: 'botellas',
      stock_actual: 10,
      stock_minimo: 2,
      costo_unitario: 8000,
      es_licor: 1,
      capacidad_ml: 1000,
      medida_shot_ml: 30
    });
    assert.equal(insumoRes.status, 201);
    const insumoId = insumoRes.body.id;

    // 3. Crear producto "Shot de Cacique Especial" con categoría nueva y vinculado a la botella con shot manual de 45ml
    const prodRes = await req('/api/productos', 'POST', {
      nombre: 'Shot de Cacique Especial',
      precio: 1200,
      categoria_id: nuevaCatId,
      destino: 'barra',
      curso: 1,
      kardex_tipo: 'shot',
      insumo_id: insumoId,
      ml_shot: 45
    });
    assert.equal(prodRes.status, 201);
    const prodId = prodRes.body.producto.id;

    // 4. Consultar /api/productos/:id/kardex-link
    const linkRes = await req(`/api/productos/${prodId}/kardex-link`);
    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.body.vinculado, true);
    assert.equal(linkRes.body.kardex_tipo, 'shot');
    assert.equal(linkRes.body.insumo_id, insumoId);
    assert.equal(linkRes.body.ml_shot, 45);
    // 45 / 1000 = 0.045
    assert.equal(linkRes.body.cantidad, 0.045);

    // 5. Enviar comanda con 2 shots (2 * 45ml = 90ml = 0.090 botellas)
    const orderRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Salonero Bar',
      items: [
        { id: prodId, nombre: 'Shot de Cacique Especial', cantidad: 2, precio: 1200, destino: 'barra' }
      ]
    });
    assert.equal(orderRes.status, 200);

    // 6. Verificar stock restante: 10 - 0.09 = 9.91
    const checkRes = await req(`/api/admin/inventario/${insumoId}`);
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.stock_actual, 9.91);

    // 7. Verificar Kardex
    const kardexRes = await req(`/api/admin/inventario/${insumoId}/kardex`);
    assert.ok(kardexRes.body.movimientos.length > 0);
    const mov = kardexRes.body.movimientos[0];
    assert.equal(mov.tipo, 'venta');
    assert.equal(mov.cantidad, 0.09);
    assert.ok(mov.motivo.includes('Shot de Cacique Especial'));
  });

  it('T9.8: PUT /api/productos/:id actualiza datos del producto y su enlace con Kárdex', async () => {
    // 1. Obtener un insumo de licor existente
    const invRes = await req('/api/admin/inventario');
    const ron = invRes.body.find(i => i.es_licor === 1);
    assert.ok(ron);

    // 2. Crear producto sin vincular
    const pRes = await req('/api/productos', 'POST', {
      nombre: 'Trago Simple Test',
      precio: 2000,
      categoria_id: 5,
      destino: 'barra'
    });
    const prodId = pRes.body.producto.id;

    // 3. Actualizar con PUT para vincularlo al Ron con shot de 30ml
    const putRes = await req(`/api/productos/${prodId}`, 'PUT', {
      nombre: 'Shot de Ron Bacardí Editado',
      precio: 2200,
      kardex_tipo: 'shot',
      insumo_id: ron.id,
      ml_shot: 30
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.producto.nombre, 'Shot de Ron Bacardí Editado');
    assert.equal(putRes.body.producto.precio, 2200);

    // 4. Verificar enlace actualizado
    const linkRes = await req(`/api/productos/${prodId}/kardex-link`);
    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.body.vinculado, true);
    assert.equal(linkRes.body.insumo_id, ron.id);
    assert.equal(linkRes.body.ml_shot, 30);
  });

  it('T9.9: Seguridad de Roles: PUT y DELETE /api/productos/:id rechazan saloneros y cajeros (403), permitiendo solo admin y developer', async () => {
    // 1. Crear producto con admin
    const pRes = await req('/api/productos', 'POST', {
      nombre: 'Tequila Don Julio Reposado',
      precio: 4500,
      categoria_id: 1,
      destino: 'barra'
    });
    assert.equal(pRes.status, 201);
    const prodId = pRes.body.producto.id;

    // 2. Intentar editar con rol salonero -> Debe dar 403
    const editSalonero = await req(`/api/productos/${prodId}`, 'PUT', {
      nombre: 'Hacked by Salonero',
      precio: 100
    }, { 'x-user-rol': 'salonero' });
    assert.equal(editSalonero.status, 403);

    // 3. Intentar eliminar con rol cajero -> Debe dar 403
    const delCajero = await req(`/api/productos/${prodId}`, 'DELETE', null, { 'x-user-rol': 'cajero' });
    assert.equal(delCajero.status, 403);

    // 4. Editar con rol developer -> Permitido (200)
    const editDev = await req(`/api/productos/${prodId}`, 'PUT', {
      nombre: 'Tequila Don Julio Reposado 1.5oz',
      precio: 4800
    }, { 'x-user-rol': 'developer' });
    assert.equal(editDev.status, 200);
    assert.equal(editDev.body.producto.nombre, 'Tequila Don Julio Reposado 1.5oz');
  });

  it('T9.10: Sincronización atómica: PUT /api/productos/:id actualiza happy_hour, agotado y sincroniza stock/costo de Kárdex con auditoría de movimientos', async () => {
    // 1. Obtener insumo de licor existente
    const invRes = await req('/api/admin/inventario');
    const licor = invRes.body.find(i => i.es_licor === 1);
    assert.ok(licor);
    const stockPrevio = licor.stock_actual;

    // 2. Crear producto trago vinculado al licor
    const pRes = await req('/api/productos', 'POST', {
      nombre: 'Shot Cacique Prueba Sync',
      precio: 1000,
      kardex_tipo: 'shot',
      insumo_id: licor.id,
      ml_shot: 30
    });
    const prodId = pRes.body.producto.id;

    // 3. Modificar características operativas y ajustar stock/costo del insumo desde el modal
    const nuevoStock = stockPrevio + 5; // ej: se contaron 5 botellas más
    const nuevoCosto = 14500;
    const nuevoMinimo = 3;

    const editRes = await req(`/api/productos/${prodId}`, 'PUT', {
      nombre: 'Shot Cacique Ultra Sync',
      precio: 1200,
      happy_hour: 1,
      agotado: 0,
      destino: 'barra',
      curso: 1,
      kardex_tipo: 'shot',
      insumo_id: licor.id,
      ml_shot: 45,
      insumo_stock_actual: nuevoStock,
      insumo_costo_unitario: nuevoCosto,
      insumo_stock_minimo: nuevoMinimo
    });

    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.producto.nombre, 'Shot Cacique Ultra Sync');
    assert.equal(editRes.body.producto.precio, 1200);
    assert.equal(editRes.body.producto.happy_hour, 1);
    assert.equal(editRes.body.producto.agotado, 0);

    // 4. Verificar que el insumo en Inventario (Kárdex) se actualizó atómicamente
    const checkInv = await req(`/api/admin/inventario/${licor.id}`);
    assert.equal(checkInv.status, 200);
    assert.equal(checkInv.body.stock_actual, nuevoStock);
    assert.equal(checkInv.body.costo_unitario, nuevoCosto);
    assert.equal(checkInv.body.stock_minimo, nuevoMinimo);

    // 5. Verificar que se registró el movimiento de ajuste en InventarioMovimientos (Kardex)
    const kardexRes = await req(`/api/admin/inventario/${licor.id}/kardex`);
    assert.equal(kardexRes.status, 200);
    const movAjuste = kardexRes.body.movimientos.find(m => m.tipo === 'ajuste' || m.tipo === 'ajuste_manual');
    assert.ok(movAjuste, 'Debe registrar movimiento de ajuste en Kárdex');
    assert.ok(movAjuste.motivo.includes('Shot Cacique Ultra Sync') || movAjuste.motivo.includes('Ajuste desde edición de producto'));
  });

  it('T9.11: DELETE /api/productos/:id realiza desactivación suave (activo=0) y desvincula recetas sin romper integridad referencial', async () => {
    // 1. Crear producto de prueba
    const pRes = await req('/api/productos', 'POST', {
      nombre: 'Producto para Eliminar',
      precio: 3000,
      categoria_id: 1,
      destino: 'cocina'
    });
    const prodId = pRes.body.producto.id;

    // 2. Eliminar con DELETE protegido
    const delRes = await req(`/api/productos/${prodId}`, 'DELETE');
    assert.equal(delRes.status, 200);
    assert.ok(delRes.body.success);

    // 3. Verificar que el producto quedó inactivo en base de datos
    const dbRow = await server.dbGet('SELECT id, nombre, activo FROM Productos WHERE id = ?', [prodId]);
    assert.ok(dbRow);
    assert.equal(dbRow.activo, 0, 'El producto debe estar desactivado con activo = 0');

    // 4. En el menú activo no debe listarse
    const menuRes = await req('/api/menu');
    const productosActivos = menuRes.body.productos || [];
    const existeEnMenu = productosActivos.some(p => p.id === prodId);
    assert.equal(existeEnMenu, false, 'No debe aparecer en productos activos del menú');
  });
});
