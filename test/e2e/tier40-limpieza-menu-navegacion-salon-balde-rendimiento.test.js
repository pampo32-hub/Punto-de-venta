const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { app } = require('../../server');

test('TIER 40: Limpieza de Tarjetas de Menú, Retorno a Salón y Rendimiento de Baldes de Cerveza', async (t) => {
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

  await t.test('1. Frontend: Eliminación de "● Disponible" y categoría/destino en tarjetas de productos de fotos grandes', () => {
    ['app.js', 'public/app.js'].forEach(filePath => {
      const js = fs.readFileSync(filePath, 'utf8');
      assert.ok(!js.includes('class="prod-card-large-meta"'), `No debe existir prod-card-large-meta en ${filePath}`);
      assert.ok(!js.includes('● Disponible'), `No debe existir la leyenda '● Disponible' en ${filePath}`);
    });
  });

  await t.test('2. Frontend: Retorno garantizado al Salón en cerrarComandero y navegación', () => {
    ['app.js', 'public/app.js'].forEach(filePath => {
      const js = fs.readFileSync(filePath, 'utf8');
      assert.ok(js.includes('window.cerrarComandero'), `window.cerrarComandero debe estar definido en ${filePath}`);
      assert.ok(js.includes('data-view="salon"'), `data-view=salon debe estar referenciado en ${filePath}`);
      assert.ok(js.includes('view-salon'), `view-salon debe activarse en ${filePath}`);
    });
  });

  await t.test('3. Backend: Registro y Rendimiento de Baldes de 6 Cervezas en /api/admin/reportes/ventas-productos', async () => {
    // 1. Crear una comanda con un Balde de 6 cervezas (2x Imperial Regular, 2x Pilsen, 2x Imperial Light)
    const comandaRes = await fetch(`${baseUrl}/api/comandas/enviar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        mesaId: 1,
        mesero: 'Mesero Tester Tier40',
        cliente: 'Cliente Balde Tier40',
        items: [
          {
            id: 'balde_test_' + Date.now(),
            producto_id: 875,
            nombre: 'Balde Nacional (6 unidades)',
            precio: 7500,
            cantidad: 1,
            notas: '2x Imperial Regular, 2x Pilsen, 2x Imperial Light',
            destino: 'barra',
            curso: 1,
            es_balde: true,
            desglose_balde: { '29': 2, '23': 2, '16': 2 }
          }
        ]
      })
    });

    assert.equal(comandaRes.status, 200, 'Comanda de balde debe crearse con 200');
    const comandaData = await comandaRes.json();
    const ordenId = comandaData.ordenId || comandaData.id;
    assert.ok(ordenId, 'Debe devolver el id de la orden');

    // 2. Pagar la orden para que figure en ventas oficiales
    const pagoRes = await fetch(`${baseUrl}/api/ordenes/${ordenId}/cobrar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        metodo: 'Efectivo',
        monto: 7500,
        montoRecibido: 10000,
        cambio: 2500,
        usuarioNombre: 'Cajero Tester'
      })
    });

    assert.equal(pagoRes.status, 200, 'Pago de orden debe procesarse con 200');

    // 3. Consultar el reporte de ventas y rendimiento
    const hoy = new Date().toISOString().split('T')[0];
    const reporteRes = await fetch(`${baseUrl}/api/admin/reportes/ventas-productos?desde=${hoy}&hasta=${hoy}`, {
      method: 'GET',
      headers: { 'x-user-rol': 'admin' }
    });

    assert.equal(reporteRes.status, 200, 'Reporte de ventas debe retornar 200');
    const reporteData = await reporteRes.json();

    assert.ok(reporteData.productos && reporteData.productos.length > 0, 'Debe haber productos en el reporte');
    const productoBalde = reporteData.productos.find(p => (p.producto_nombre || '').toLowerCase().includes('balde'));
    assert.ok(productoBalde, 'El balde debe estar registrado en el reporte de ventas y rendimiento');

    assert.equal(productoBalde.cantidad_vendida >= 1, true, 'Debe registrar al menos 1 unidad vendida de balde');
    assert.equal(productoBalde.total_ingresos >= 7500, true, 'Debe registrar ingresos del balde');
    assert.equal(productoBalde.categoria_nombre, 'Cervezas', 'Categoría debe ser Cervezas');
    assert.equal(productoBalde.categoria_icono, '🍺', 'Icono de categoría debe ser cerveza');

    // Verificar que los insumos requeridos incluyan las 6 cervezas y costo positivo
    assert.ok(productoBalde.costo_insumos_total > 0, 'El costo total de insumos del balde debe ser mayor a 0');
    assert.ok(productoBalde.insumos_requeridos && productoBalde.insumos_requeridos.length > 0, 'Debe listar los insumos consumidos por el balde');
    assert.ok(productoBalde.ganancia_bruta > 0, 'La ganancia bruta debe ser calculada positivamente');
    assert.ok(productoBalde.margen_bruto_pct > 0, 'El margen bruto debe ser mayor a 0%');

    // Verificar que el resumen global contenga el costo de insumos sumado
    assert.ok(reporteData.resumen.total_costo_insumos > 0, 'El resumen global debe sumar el costo de insumos del balde');
  });

  await t.test('4. Teardown', async () => {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });
});
