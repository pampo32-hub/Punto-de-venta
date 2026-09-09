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

test('Tier 44: Ajustes de Inventario (Entrada/Merma) y Modales de Insumos', async (t) => {
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

  let testInsumoId;

  await t.test('1. Backend: Registrar Nuevo Insumo (/api/admin/inventario)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    }, {
      nombre: 'Queso Mozzarella Tier44 ' + Date.now(),
      categoria: 'Lácteos',
      unidad_medida: 'kg',
      stock_actual: 10,
      stock_minimo: 3,
      costo_unitario: 3500,
      negocio_id: 1,
      usuarioNombre: 'Admin Tester'
    });

    assert.equal(res.status, 201);
    testInsumoId = res.body.id || res.body.insumoId;
    assert.ok(testInsumoId > 0, 'Insumo creado con ID');
  });

  await t.test('2. Backend: Aplicar Ajuste de Entrada de Mercadería (/api/admin/inventario/:id/ajuste)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario/' + testInsumoId + '/ajuste',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    }, {
      tipo: 'entrada',
      cantidad: 5,
      motivo: 'Compra Factura #9812',
      usuarioNombre: 'Admin Tester',
      negocio_id: 1
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.nuevo_stock, 15, 'Stock debe ser 10 + 5 = 15');
  });

  await t.test('3. Backend: Aplicar Ajuste de Merma/Pérdida (/api/admin/inventario/:id/ajuste)', async () => {
    const res = await makeRequest({
      hostname: 'localhost',
      port,
      path: '/api/admin/inventario/' + testInsumoId + '/ajuste',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    }, {
      tipo: 'merma',
      cantidad: 2,
      motivo: 'Vencimiento / Descarte',
      usuarioNombre: 'Admin Tester',
      negocio_id: 1
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.nuevo_stock, 13, 'Stock debe ser 15 - 2 = 13');
  });

  await t.test('4. Frontend: Integridad de Selectores e IDs de Modales en app.js y public/app.js', async () => {
    const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
    const pubAppJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

    for (const [nombre, code] of [['app.js', appJs], ['public/app.js', pubAppJs]]) {
      assert.ok(code.includes('window.guardarAjusteInventario'), nombre + ' debe definir window.guardarAjusteInventario');
      assert.ok(code.includes('selectAjusteInsumo'), nombre + ' debe leer selectAjusteInsumo');
      assert.ok(code.includes('txtAjusteCantidad'), nombre + ' debe leer txtAjusteCantidad');
      assert.ok(code.includes('window.abrirModalNuevoInsumo'), nombre + ' debe definir window.abrirModalNuevoInsumo');
      assert.ok(code.includes('window.guardarNuevoInsumo'), nombre + ' debe definir window.guardarNuevoInsumo');
      assert.ok(code.includes('window.abrirModalEditarInsumo'), nombre + ' debe definir window.abrirModalEditarInsumo');
      assert.ok(code.includes('window.guardarEdicionInsumo'), nombre + ' debe definir window.guardarEdicionInsumo');
    }
  });

  await t.test('5. Teardown', async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    assert.ok(true, 'Servidor cerrado');
  });
});
