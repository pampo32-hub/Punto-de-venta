const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { app } = require('../../server');

test('TIER 39: Remover Badge Categoria de Fotos, Boton Menu Directo y Borrado Total Insumo Bodega', async (t) => {
  let testServer;
  let baseUrl;

  await t.test('0. Setup del servidor de pruebas', async () => {
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        const port = testServer.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    assert.ok(baseUrl, 'Servidor debe iniciar con baseUrl');
  });

  await t.test('1. Verificacion Boton Menu en Navbar (entre Salon y Cocina) en index.html y public/index.html', () => {
    ['index.html', 'public/index.html'].forEach(filePath => {
      const html = fs.readFileSync(filePath, 'utf8');
      assert.ok(html.includes('id="btnNavMenuDirecto"'), 'btnNavMenuDirecto debe existir en ' + filePath);
      assert.ok(html.includes('onclick="abrirMenuDirecto()"'), 'btnNavMenuDirecto debe invocar abrirMenuDirecto() en ' + filePath);

      const salonIdx = html.indexOf('data-view="salon"');
      const menuDirectoIdx = html.indexOf('id="btnNavMenuDirecto"');
      const kdsIdx = html.indexOf('data-view="kds"');

      assert.ok(salonIdx !== -1, 'data-view=salon debe existir en ' + filePath);
      assert.ok(menuDirectoIdx !== -1, 'btnNavMenuDirecto debe existir en ' + filePath);
      assert.ok(kdsIdx !== -1, 'data-view=kds debe existir en ' + filePath);
      assert.ok(salonIdx < menuDirectoIdx && menuDirectoIdx < kdsIdx, 'btnNavMenuDirecto debe estar ubicado exactamente entre Salon y Cocina (KDS) en ' + filePath);
    });
  });

  await t.test('2. Verificacion Eliminacion de Badge de Categoria sobre Fotos en Tarjetas Grandes', () => {
    ['app.js', 'public/app.js'].forEach(filePath => {
      const js = fs.readFileSync(filePath, 'utf8');
      assert.ok(!js.includes('class="prod-card-large-badge"'), 'No debe existir prod-card-large-badge en ' + filePath);
      assert.ok(js.includes('window.abrirMenuDirecto'), 'window.abrirMenuDirecto debe estar definido en ' + filePath);
    });
  });

  await t.test('3. Backend: DELETE /api/admin/inventario/:id elimina completamente insumo y audita', async () => {
    const nombreInsumoTest = 'Insumo Test Tier39 ' + Date.now();
    const createRes = await fetch(`${baseUrl}/api/admin/inventario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        nombre: nombreInsumoTest,
        unidad_medida: 'unidades',
        stock_actual: 50,
        stock_minimo: 5,
        costo_unitario: 1000,
        categoria: 'Pruebas'
      })
    });

    assert.equal(createRes.status, 201, 'Debe crear insumo con 201');
    const createData = await createRes.json();
    const insumoId = createData.id || createData.insumoId;
    assert.ok(insumoId, 'Debe devolver el id del insumo');

    const delRes = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({ usuarioNombre: 'Tester Admin' })
    });

    assert.equal(delRes.status, 200, 'Debe responder 200 al eliminar insumo');
    const delData = await delRes.json();
    assert.ok(delData.message.includes('eliminado correctamente'), 'Mensaje de exito');

    const getRes = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}`, {
      method: 'GET',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(getRes.status, 404, 'Insumo no debe existir tras ser eliminado');

    const auditRes = await fetch(`${baseUrl}/api/admin/auditoria`, {
      method: 'GET',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(auditRes.status, 200);
    const eventos = await auditRes.json();
    const eventoEliminar = (eventos || []).find(e => e.accion === 'eliminar_insumo' && (e.detalle || '').includes(nombreInsumoTest));
    assert.ok(eventoEliminar, 'Debe registrarse evento de auditoria para eliminar_insumo');
  });

  await t.test('4. Teardown', async () => {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });
});
