const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, db } = require('../../server');

test('Tier 42: Aislamiento Total de Inventario Sandbox vs Brasas, Vaciado de Bodega y Reversión de Kárdex', async (t) => {
  let server;
  let baseUrl;

  await t.test('0. Setup del Servidor de Pruebas', async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  await t.test('1. Backend: Aislamiento Estricto de Inventario Sandbox (ID: 2) vs Brasas (ID: 1)', async () => {
    const nombreInsumoSandbox = 'Insumo Exclusivo Sandbox ' + Date.now();

    // 1. Crear insumo en Sandbox (negocio_id = 2)
    const resCrear = await fetch(`${baseUrl}/api/admin/inventario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin',
        'x-negocio-id': '2'
      },
      body: JSON.stringify({
        nombre: nombreInsumoSandbox,
        categoria: 'Pruebas Sandbox',
        unidad_medida: 'unidades',
        stock_actual: 100,
        stock_minimo: 10,
        costo_unitario: 2500
      })
    });
    assert.equal(resCrear.status, 201, 'Debe crear el insumo en Sandbox');
    const dataCrear = await resCrear.json();
    const insumoIdSandbox = dataCrear.id || dataCrear.insumoId;
    assert.ok(insumoIdSandbox, 'Debe retornar el ID del insumo creado');
    assert.equal(dataCrear.negocio_id, 2, 'El insumo debe pertenecer a negocio_id = 2');

    // 2. Consultar inventario de Sandbox (ID: 2) -> Debe incluir el insumo
    const resListSandbox = await fetch(`${baseUrl}/api/admin/inventario?negocio_id=2`, {
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '2' }
    });
    assert.equal(resListSandbox.status, 200);
    const listSandbox = await resListSandbox.json();
    const encontradoEnSandbox = listSandbox.find(i => i.id === insumoIdSandbox || i.nombre === nombreInsumoSandbox);
    assert.ok(encontradoEnSandbox, 'El insumo debe existir en el inventario de Sandbox');

    // 3. Consultar inventario de Brasas (ID: 1) -> NO debe incluir el insumo de Sandbox
    const resListBrasas = await fetch(`${baseUrl}/api/admin/inventario?negocio_id=1`, {
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });
    assert.equal(resListBrasas.status, 200);
    const listBrasas = await resListBrasas.json();
    const encontradoEnBrasas = listBrasas.find(i => i.id === insumoIdSandbox || i.nombre === nombreInsumoSandbox);
    assert.equal(encontradoEnBrasas, undefined, 'El insumo de Sandbox NUNCA debe filtrarse al inventario de Brasas');

    // 4. Ajustar stock en Sandbox -> No debe alterar Brasas
    const resAjuste = await fetch(`${baseUrl}/api/admin/inventario/${insumoIdSandbox}/ajuste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin',
        'x-negocio-id': '2'
      },
      body: JSON.stringify({
        tipo: 'salida',
        cantidad: 20,
        motivo: 'Ajuste de prueba en Sandbox',
        usuarioNombre: 'Admin Sandbox'
      })
    });
    assert.equal(resAjuste.status, 200);
    const dataAjuste = await resAjuste.json();
    assert.equal(dataAjuste.nuevo_stock, 80, 'El stock debe reducirse a 80 en Sandbox');

    // 5. Consultar Kárdex de Sandbox vs Brasas
    const resKardexSandbox = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos?insumo_id=${insumoIdSandbox}&negocio_id=2`, {
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '2' }
    });
    assert.equal(resKardexSandbox.status, 200);
    const dataKardexSandbox = await resKardexSandbox.json();
    assert.ok(dataKardexSandbox.movimientos.length > 0, 'Debe haber movimientos en el Kárdex de Sandbox');

    const resKardexBrasas = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos?insumo_id=${insumoIdSandbox}&negocio_id=1`, {
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });
    assert.equal(resKardexBrasas.status, 200);
    const dataKardexBrasas = await resKardexBrasas.json();
    assert.equal(dataKardexBrasas.movimientos.length, 0, 'No debe haber movimientos de este insumo en el Kárdex de Brasas');
  });

  await t.test('2. Backend: Vaciar / Eliminar Existencias en Bodega con Registro en Auditoría', async () => {
    // 1. Crear insumo con 45 unidades
    const nombreInsumo = 'Insumo Vaciado Test ' + Date.now();
    const resCrear = await fetch(`${baseUrl}/api/admin/inventario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' },
      body: JSON.stringify({
        nombre: nombreInsumo,
        categoria: 'Pruebas Vaciado',
        unidad_medida: 'botellas',
        stock_actual: 45,
        stock_minimo: 5,
        costo_unitario: 1200
      })
    });
    assert.equal(resCrear.status, 201);
    const dataCrear = await resCrear.json();
    const insumoId = dataCrear.id || dataCrear.insumoId;

    // 2. Ejecutar vaciado de existencias
    const resVaciar = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}/eliminar-existencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' },
      body: JSON.stringify({
        motivo: 'Vencimiento total del lote',
        usuarioNombre: 'Supervisor Bodega'
      })
    });
    assert.equal(resVaciar.status, 200);
    const dataVaciar = await resVaciar.json();
    assert.equal(dataVaciar.stock_previo, 45);
    assert.equal(dataVaciar.stock_actual, 0);

    // 3. Verificar que en la base de datos el stock es 0
    const resCheck = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}`, {
      headers: { 'x-user-rol': 'admin', 'x-negocio-id': '1' }
    });
    assert.equal(resCheck.status, 200);
    const checkData = await resCheck.json();
    assert.equal(checkData.stock_actual, 0, 'El stock en bodega debe ser 0');

    // 4. Verificar auditoría
    const resAudit = await fetch(`${baseUrl}/api/admin/auditoria`, {
      headers: { 'x-user-rol': 'admin' }
    });
    assert.equal(resAudit.status, 200);
    const eventosAudit = await resAudit.json();
    const eventoVaciado = (eventosAudit || []).find(e => e.accion === 'eliminar_existencia_bodega' && (e.detalle || '').includes(nombreInsumo));
    assert.ok(eventoVaciado, 'Debe registrar evento eliminar_existencia_bodega en auditoría');
  });

  await t.test('3. Backend: Reversión Matemática Exacta de Stock al Eliminar Movimientos de Kárdex', async () => {
    // Insumo base con 50 unidades
    const nombreInsumo = 'Insumo Reversion Test ' + Date.now();
    const resCrear = await fetch(`${baseUrl}/api/admin/inventario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' },
      body: JSON.stringify({
        nombre: nombreInsumo,
        categoria: 'Pruebas Reversión',
        unidad_medida: 'unidades',
        stock_actual: 50,
        stock_minimo: 5,
        costo_unitario: 1000
      })
    });
    assert.equal(resCrear.status, 201);
    const dataCrear = await resCrear.json();
    const insumoId = dataCrear.id || dataCrear.insumoId;

    // A) Probar Reversión de Entrada (+20) -> Stock pasa a 70 -> Revertir -> Vuelve a 50
    const resEntrada = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}/ajuste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' },
      body: JSON.stringify({ tipo: 'entrada', cantidad: 20, motivo: 'Compra lote extra' })
    });
    assert.equal(resEntrada.status, 200);

    const kardexRes1 = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos?insumo_id=${insumoId}&tipo=entrada`, {
      headers: { 'x-user-rol': 'admin' }
    });
    const movEntrada = (await kardexRes1.json()).movimientos[0];
    assert.ok(movEntrada, 'Debe existir movimiento de entrada');

    const resDelEntrada = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos/${movEntrada.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin' },
      body: JSON.stringify({ revertir_stock: true })
    });
    assert.equal(resDelEntrada.status, 200);

    const check1 = await (await fetch(`${baseUrl}/api/admin/inventario/${insumoId}`, { headers: { 'x-user-rol': 'admin' } })).json();
    assert.equal(check1.stock_actual, 50, 'El stock debe revertir a 50 al deshacer la entrada');

    // B) Probar Reversión de Merma/Salida (-15) -> Stock pasa a 35 -> Revertir -> Vuelve a 50
    const resMerma = await fetch(`${baseUrl}/api/admin/inventario/${insumoId}/ajuste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin', 'x-negocio-id': '1' },
      body: JSON.stringify({ tipo: 'merma', cantidad: 15, motivo: 'Merma por caída' })
    });
    assert.equal(resMerma.status, 200);

    const kardexRes2 = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos?insumo_id=${insumoId}&tipo=merma`, {
      headers: { 'x-user-rol': 'admin' }
    });
    const movMerma = (await kardexRes2.json()).movimientos[0];
    assert.ok(movMerma, 'Debe existir movimiento de merma');

    const resDelMerma = await fetch(`${baseUrl}/api/admin/inventario/kardex/movimientos/${movMerma.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': 'admin' },
      body: JSON.stringify({ revertir_stock: true })
    });
    assert.equal(resDelMerma.status, 200);

    const check2 = await (await fetch(`${baseUrl}/api/admin/inventario/${insumoId}`, { headers: { 'x-user-rol': 'admin' } })).json();
    assert.equal(check2.stock_actual, 50, 'El stock debe revertir a 50 al deshacer la merma');
  });

  await t.test('4. Frontend: Código de apertura y cierre de modal sin bloqueos de estilo', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

    assert.ok(appJs.includes("modal.style.display = 'flex'"), 'confirmarEliminarExistenciasBodega debe cambiar display a flex');
    assert.ok(appJs.includes("modal.style.display = 'none'"), 'cerrarModalEliminarExistenciasBodega debe cambiar display a none');
    assert.ok(appJs.includes("'x-negocio-id'"), 'app.js debe enviar x-negocio-id en llamadas de inventario y kárdex');
  });

  await t.test('5. Teardown', async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
