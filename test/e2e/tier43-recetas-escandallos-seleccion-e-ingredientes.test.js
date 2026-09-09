const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('../../server');

let server;
let baseUrl;

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) { parsed = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

test('Tier 43: Fichas Técnicas, Escandallos, Selección de Recetas y Asignación de Ingredientes', async (t) => {
  let port;

  await t.test('0. Setup del Servidor de Pruebas', async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        baseUrl = 'http://localhost:' + port;
        resolve();
      });
    });
    assert.ok(port > 0, 'Servidor iniciado correctamente');
  });

  let testProductoId;
  let testInsumoId;

  await t.test('1. Backend: Listar Resumen de Recetas (/api/admin/recetas/resumen)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/recetas/resumen?negocio_id=1',
      method: 'GET',
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'Debe devolver un arreglo de productos para recetas');
    assert.ok(res.body.length > 0, 'Debe contener al menos 1 producto');
    
    const primerPlatillo = res.body[0];
    assert.ok(primerPlatillo.producto_id || primerPlatillo.id, 'Debe incluir ID del producto');
    assert.ok(primerPlatillo.nombre || primerPlatillo.producto_nombre, 'Debe incluir nombre');
    testProductoId = primerPlatillo.producto_id || primerPlatillo.id;
  });

  await t.test('2. Backend: Crear Insumo y Asignar Ingrediente a la Receta', async () => {
    const nombreInsumo = 'Insumo Test Receta Tier43 ' + Date.now();
    const resInv = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    }, {
      nombre: nombreInsumo,
      unidad_medida: 'kg',
      stock_actual: 10,
      stock_minimo: 2,
      costo_unitario: 500,
      categoria: 'Carnes',
      negocio_id: 1
    });

    assert.equal(resInv.status, 201);
    testInsumoId = resInv.body.id || resInv.body.insumoId;
    assert.ok(testInsumoId > 0, 'Insumo creado con ID');

    const resVincular = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/recetas/' + testProductoId + '/ingredientes',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    }, {
      insumo_id: testInsumoId,
      cantidad: 0.25,
      merma_porcentaje: 10,
      usuarioNombre: 'Chef Tester'
    });

    assert.equal(resVincular.status, 200);
    assert.equal(resVincular.body.ok, true);
  });

  await t.test('3. Backend: Consultar Ficha Técnica Detallada (/api/admin/recetas/:productoId)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/recetas/' + testProductoId + '?negocio_id=1',
      method: 'GET',
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.ingredientes && res.body.ingredientes.length > 0);
    
    const ing = res.body.ingredientes.find(i => Number(i.insumo_id) === Number(testInsumoId));
    assert.ok(ing, 'El ingrediente recién vinculado debe estar en la ficha técnica');
    assert.equal(ing.cantidad_bruta, 0.25);
    assert.equal(ing.merma_porcentaje, 10);
    assert.ok(ing.subtotal_costo > 0, 'Debe calcular el costo subtotal del ingrediente');
  });

  await t.test('4. Backend: Eliminar Ingrediente de la Receta', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/recetas/' + testProductoId + '/ingredientes/' + testInsumoId,
      method: 'DELETE',
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const resFicha = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/recetas/' + testProductoId + '?negocio_id=1',
      method: 'GET',
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });

    const ing = (resFicha.body.ingredientes || []).find(i => Number(i.insumo_id) === Number(testInsumoId));
    assert.equal(ing, undefined, 'El ingrediente debe haber sido desvinculado');
  });

  await t.test('5. Frontend: Integridad y Funciones Globales en app.js y public/app.js', async () => {
    const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const pubAppJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

    for (const [nombre, code] of [['app.js', appJs], ['public/app.js', pubAppJs]]) {
      assert.ok(code.includes('window.inicializarPanelRecetas'), nombre + ' debe definir window.inicializarPanelRecetas');
      assert.ok(code.includes('window.renderOpcionesProductosReceta'), nombre + ' debe definir window.renderOpcionesProductosReceta');
      assert.ok(code.includes('window.filtrarProductosReceta'), nombre + ' debe definir window.filtrarProductosReceta');
      assert.ok(code.includes('window.cargarFichaTecnica'), nombre + ' debe definir window.cargarFichaTecnica');
      assert.ok(code.includes('window.guardarIngredienteReceta'), nombre + ' debe definir window.guardarIngredienteReceta');
      assert.ok(code.includes('window.eliminarIngredienteReceta'), nombre + ' debe definir window.eliminarIngredienteReceta');
      assert.ok(code.includes('const nid ='), nombre + ' debe definir nid en inicializarPanelRecetas');
    }
  });

  await t.test('6. Teardown', async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    assert.ok(true, 'Servidor cerrado');
  });
});
