const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { spawn } = require('child_process');

test('Tier 37: Eliminación de Categorías en el Menú y Reasignación de Platillos', async (t) => {
  const PORT = 3997;
  const srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    cwd: process.cwd()
  });

  await new Promise(r => setTimeout(r, 2500));

  try {
    // 1. Verificar existencia del modal en HTML
    const htmlContent = fs.readFileSync('public/index.html', 'utf8');
    assert.ok(htmlContent.includes('modalConfirmarEliminarCategoria'), 'El HTML debe contener modalConfirmarEliminarCategoria');
    assert.ok(htmlContent.includes('ejecutarEliminarCategoriaConfirmada'), 'El HTML debe invocar ejecutarEliminarCategoriaConfirmada');

    // 2. Crear una nueva categoría de prueba
    const resCreate = await fetch(`http://localhost:${PORT}/api/categorias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Temporada Navideña Test ' + Date.now(),
        icono: '🎄',
        destino: 'cocina'
      })
    });
    assert.strictEqual(resCreate.ok, true, 'Debe crear la categoría');
    const dataCreate = await resCreate.json();
    const catId = dataCreate.categoria.id;
    assert.ok(catId, 'Debe retornar ID de la categoría creada');

    // 3. Crear un producto asignado a esta categoría
    const resProd = await fetch(`http://localhost:${PORT}/api/productos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        nombre: 'Tamal Navideño Test',
        precio: 2500,
        categoria_id: catId,
        destino: 'cocina',
        curso: 1
      })
    });
    assert.strictEqual(resProd.ok, true, 'Debe crear producto en la nueva categoría');
    const dataProd = await resProd.json();
    const prodId = dataProd.producto ? dataProd.producto.id : dataProd.id;

    // 4. Intentar eliminar categoría con rol salonero sin PIN (debe dar 403)
    const resForbidden = await fetch(`http://localhost:${PORT}/api/categorias/${catId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'salonero'
      }
    });
    assert.strictEqual(resForbidden.status, 403, 'Salonero sin PIN debe recibir 403');

    // 5. Eliminar categoría con PIN de supervisor (debe tener éxito)
    const resDeleteWithPin = await fetch(`http://localhost:${PORT}/api/categorias/${catId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'salonero',
        'x-supervisor-pin': '1234'
      }
    });
    assert.strictEqual(resDeleteWithPin.ok, true, 'Salonero con PIN 1234 debe poder eliminar');
    const dataDel = await resDeleteWithPin.json();
    assert.strictEqual(dataDel.ok, true, 'Debe retornar ok: true');

    // 6. Verificar que la categoría ya no existe en /api/menu
    const resMenu = await fetch(`http://localhost:${PORT}/api/menu`);
    const menu = await resMenu.json();
    const cats = menu.categorias || [];
    const catBorrada = cats.find(c => c.id === catId);
    assert.strictEqual(catBorrada, undefined, 'La categoría eliminada ya no debe figurar en el menú');

    // 7. Verificar que el producto fue reasignado y sigue activo
    const prods = menu.productos || [];
    const prodExistente = prods.find(p => p.nombre === 'Tamal Navideño Test');
    assert.ok(prodExistente, 'El producto debe seguir existiendo');
    assert.notStrictEqual(prodExistente.categoria_id, catId, 'El producto debe haber sido reasignado a otra categoría');

  } finally {
    srv.kill('SIGTERM');
  }
});
