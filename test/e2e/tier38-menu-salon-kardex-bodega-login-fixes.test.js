const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const { app } = require('../../server');

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

test('TIER 38: Menú, Salón, Kárdex, Bodega, Login y Categorías', async (t) => {
  let testServer;
  let port;

  await t.test('0. Setup del servidor de pruebas', async () => {
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        port = testServer.address().port;
        resolve();
      });
    });
    assert.ok(port > 0, 'Servidor debe iniciar en un puerto dinámico');
  });

  await t.test('1. Backend: POST /api/categorias y POST /api/admin/categorias crean categorías correctamente', async () => {
    const nombreCatTest = 'Categoría Test Tier38 ' + Date.now();
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/categorias',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      }
    }, {
      nombre: nombreCatTest,
      icono: '🍹',
      destino: 'barra',
      negocio_id: 1
    });

    assert.equal(res.status, 201, 'Debe retornar 201 Created');
    assert.ok(res.body.categoria && res.body.categoria.id, 'Debe retornar la categoría creada');
    assert.equal(res.body.categoria.nombre, nombreCatTest);
    assert.equal(res.body.categoria.icono, '🍹');
    assert.equal(res.body.categoria.destino, 'barra');

    // Probar eliminación limpia
    const delRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/categorias/' + res.body.categoria.id,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      }
    });
    assert.equal(delRes.status, 200, 'Debe permitir eliminar la categoría de prueba');
  });

  await t.test('2. Backend: POST /api/admin/inventario/:id/eliminar-existencias vacía el stock y genera registro de Auditoría', async () => {
    const invRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario',
      method: 'GET',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(invRes.status, 200);
    assert.ok(Array.isArray(invRes.body) && invRes.body.length > 0, 'Debe haber insumos');
    const insumo = invRes.body[0];

    // Ajuste previo
    await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario/' + insumo.id + '/ajuste',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      }
    }, {
      tipo: 'fijar',
      cantidad: 25,
      motivo: 'Ajuste previo prueba Tier 38'
    });

    // Vaciar existencias
    const vaciarRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario/' + insumo.id + '/eliminar-existencias',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      }
    }, {
      motivo: 'Merma total autorizada en prueba Tier38',
      usuarioNombre: 'Admin Tester'
    });

    assert.equal(vaciarRes.status, 200, 'Debe responder 200 OK');
    assert.equal(vaciarRes.body.stock_actual, 0, 'El stock actual resultante debe ser 0');
    assert.equal(vaciarRes.body.stock_previo, 25, 'El stock previo debe coincidir');

    // Verificar Auditoría
    const auditRes = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/auditoria',
      method: 'GET',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(auditRes.status, 200);
    const eventos = auditRes.body;
    const eventoBodega = (eventos || []).find(e => e.accion === 'eliminar_existencia_bodega');
    assert.ok(eventoBodega, 'Debe existir un evento de auditoría con accion eliminar_existencia_bodega');
    assert.equal(eventoBodega.modulo, 'bodega');
    assert.ok(eventoBodega.detalle.includes(insumo.nombre));
  });

  await t.test('3. Frontend: Verificación de funciones expuestas en window en app.js', () => {
    const appJs = fs.readFileSync('public/app.js', 'utf8');

    assert.ok(appJs.includes('window.obtenerModoVistaMenuActual'), 'window.obtenerModoVistaMenuActual debe estar definido');
    assert.ok(appJs.includes('window.cambiarModoVistaMenuComandero'), 'window.cambiarModoVistaMenuComandero debe estar definido');
    assert.ok(appJs.includes('window.cambiarModoVistaSalon'), 'window.cambiarModoVistaSalon debe estar definido');
    assert.ok(appJs.includes('window.renderGrillaOrdenada'), 'window.renderGrillaOrdenada debe estar definido');
    assert.ok(appJs.includes('window.abrirModalNuevaCategoria'), 'window.abrirModalNuevaCategoria debe estar definido');
    assert.ok(appJs.includes('window.guardarNuevaCategoria'), 'window.guardarNuevaCategoria debe estar definido');
    assert.ok(appJs.includes('window.confirmarEliminarCategoria'), 'window.confirmarEliminarCategoria debe estar definido');
    assert.ok(appJs.includes('window.ejecutarEliminarCategoriaConfirmada'), 'window.ejecutarEliminarCategoriaConfirmada debe estar definido');
    assert.ok(appJs.includes('window.abrirModalEditarKardex'), 'window.abrirModalEditarKardex debe estar definido');
    assert.ok(appJs.includes('window.guardarEdicionKardex'), 'window.guardarEdicionKardex debe estar definido');
    assert.ok(appJs.includes('window.confirmarEliminarKardex'), 'window.confirmarEliminarKardex debe estar definido');
    assert.ok(appJs.includes('window.ejecutarEliminarKardexConfirmado'), 'window.ejecutarEliminarKardexConfirmado debe estar definido');
    assert.ok(appJs.includes('window.confirmarEliminarExistenciasBodega'), 'window.confirmarEliminarExistenciasBodega debe estar definido');
    assert.ok(appJs.includes('window.ejecutarEliminarExistenciasBodegaConfirmado'), 'window.ejecutarEliminarExistenciasBodegaConfirmado debe estar definido');
  });

  await t.test('4. Frontend: Verificación de modales en index.html', () => {
    const html = fs.readFileSync('public/index.html', 'utf8');

    assert.ok(html.includes('id="modalNuevaCategoria"'), 'modalNuevaCategoria debe estar en index.html');
    assert.ok(html.includes('id="modalConfirmarEliminarCategoria"'), 'modalConfirmarEliminarCategoria debe estar en index.html');
    assert.ok(html.includes('id="modalConfirmarEliminarExistencias"'), 'modalConfirmarEliminarExistencias debe estar en index.html');
    assert.ok(html.includes('id="modalEditarKardex"'), 'modalEditarKardex debe estar en index.html');
    assert.ok(html.includes('id="modalConfirmarEliminarKardex"'), 'modalConfirmarEliminarKardex debe estar en index.html');
    assert.ok(html.includes('id="btnAbrirModalNuevaCategoria"'), 'Botón para abrir modal nueva categoría debe estar en comandero');
  });

  await t.test('5. Teardown', async () => {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });
});
