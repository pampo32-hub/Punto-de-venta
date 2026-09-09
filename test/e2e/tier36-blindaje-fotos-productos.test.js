const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');

test('Tier 36: Blindaje Total de Fotos e Imágenes de Productos en Menú', async (t) => {
  const PORT = 3998;
  const srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    cwd: process.cwd()
  });

  await new Promise(r => setTimeout(r, 2500));

  try {
    // 1. Obtener lista de productos mediante /api/menu
    const resMenu = await fetch(`http://localhost:${PORT}/api/menu`);
    assert.strictEqual(resMenu.ok, true, 'Debe obtener menú');
    const menuData = await resMenu.json();
    const prods = Array.isArray(menuData) ? menuData : (menuData.productos || []);
    assert.ok(prods.length > 0, 'Debe haber productos en el menú');

    const testProd = prods[0];
    const customImgUrl = 'https://ejemplo-usuario.com/mi-foto-personalizada.jpg';

    // 2. Asignar imagen personalizada mediante /api/productos/:id/visual
    const resVisual = await fetch(`http://localhost:${PORT}/api/productos/${testProd.id}/visual`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen_url: customImgUrl })
    });
    const dataVisual = await resVisual.json();
    assert.strictEqual(resVisual.ok, true, 'Debe permitir asignación manual de foto: ' + JSON.stringify(dataVisual));
    assert.strictEqual(dataVisual.producto.imagen_url, customImgUrl, 'Debe tener la foto personalizada');

    // 3. Editar el producto cambiando precio y nombre SIN enviar imagen_url (o enviando vacío)
    const resEdit = await fetch(`http://localhost:${PORT}/api/productos/${testProd.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        nombre: testProd.nombre + ' Modificado',
        precio: 9999,
        categoria_id: testProd.categoria_id,
        destino: testProd.destino,
        curso: testProd.curso,
        imagen_url: '' // Campo vacío al editar
      })
    });
    const dataEdit = await resEdit.json();
    assert.strictEqual(resEdit.ok, true, 'Debe editar producto: ' + JSON.stringify(dataEdit));

    // 4. Verificar que la imagen NO fue borrada ni cambiada
    const resMenuAfter = await fetch(`http://localhost:${PORT}/api/menu`);
    const menuAfter = await resMenuAfter.json();
    const prodsAfter = Array.isArray(menuAfter) ? menuAfter : (menuAfter.productos || []);
    const prodPreservado = prodsAfter.find(p => p.id === testProd.id);
    assert.strictEqual(prodPreservado.imagen_url, customImgUrl, 'La foto personalizada NO debe ser cambiada por otros cambios');
    assert.strictEqual(prodPreservado.precio, 9999, 'El precio sí debió cambiar');

    // 5. Verificar que sólo se elimina si se solicita explícitamente eliminar_imagen: true
    const resDelImg = await fetch(`http://localhost:${PORT}/api/productos/${testProd.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': 'admin'
      },
      body: JSON.stringify({
        nombre: testProd.nombre,
        precio: testProd.precio,
        eliminar_imagen: true
      })
    });
    const dataDel = await resDelImg.json();
    assert.strictEqual(resDelImg.ok, true, 'Debe procesar solicitud explícita: ' + JSON.stringify(dataDel));
    const resMenuDeleted = await fetch(`http://localhost:${PORT}/api/menu`);
    const menuDeleted = await resMenuDeleted.json();
    const prodsDeleted = Array.isArray(menuDeleted) ? menuDeleted : (menuDeleted.productos || []);
    const prodSinFoto = prodsDeleted.find(p => p.id === testProd.id);
    assert.strictEqual(prodSinFoto.imagen_url, null, 'Foto eliminada únicamente cuando el usuario lo pide explícitamente');

  } finally {
    srv.kill('SIGTERM');
  }
});
