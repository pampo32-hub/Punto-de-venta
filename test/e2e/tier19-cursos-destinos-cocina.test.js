const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 19: Cursos individuales, destinos sugeridos y enrutamiento estricto a cocina', () => {
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

  it('T19.1: Creacion y edicion de productos con cursos individuales 1 a 6 y destinos barra/cocina', async () => {
    // 1. Crear producto con curso 6 (Otros) y destino barra
    const resCrear = await req('/api/productos', 'POST', {
      nombre: 'Piqueo Especial de la Casa',
      precio: 3500,
      categoria_id: 2,
      curso: 6,
      destino: 'barra'
    });
    assert.equal(resCrear.status, 201);
    const prodId = resCrear.body.producto?.id || resCrear.body.id;
    assert.ok(prodId, 'Debe devolver el id del producto creado');

    // 2. Verificar que se guardo correctamente
    const resGet = await req('/api/menu');
    const prod = resGet.body.productos.find(p => p.id === prodId);
    assert.ok(prod, 'El producto debe encontrarse en el menú');
    assert.equal(prod.curso, 6);
    assert.equal(prod.destino, 'barra');

    // 3. Editar producto a curso 4 (Postres) y destino cocina
    const resPut = await req('/api/productos/' + prodId, 'PUT', {
      nombre: 'Piqueo Especial Dulce',
      precio: 3800,
      categoria_id: 3,
      curso: 4,
      destino: 'cocina'
    });
    assert.equal(resPut.status, 200);

    const resGetAfter = await req('/api/menu');
    const prodAfter = resGetAfter.body.productos.find(p => p.id === prodId);
    assert.equal(prodAfter.curso, 4);
    assert.equal(prodAfter.destino, 'cocina');
  });

  it('T19.2: Comanda mixta: Solo productos con destino cocina van al KDS de cocina', async () => {
    const resProds = await req('/api/menu');
    const prods = resProds.body.productos || [];

    const alitas = prods.find(p => /alita/i.test(p.nombre)) || { id: 101, nombre: 'Alitas BBQ', precio: 4500, destino: 'cocina', curso: 2 };
    const pescado = prods.find(p => /pescado|casado|arroz/i.test(p.nombre)) || { id: 102, nombre: 'Pescado Entero', precio: 7000, destino: 'cocina', curso: 3 };
    const cerveza = prods.find(p => /imperial|pilsen|cerveza/i.test(p.nombre)) || { id: 103, nombre: 'Imperial Regular', precio: 1800, destino: 'barra', curso: 1 };
    const cafe = prods.find(p => /café|cafe/i.test(p.nombre)) || { id: 104, nombre: 'Café chorreado tradicional', precio: 1500, destino: 'barra', curso: 5 };

    const comandaRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Carlos Salonero',
      items: [
        { id: alitas.id, nombre: alitas.nombre, precio: alitas.precio, cantidad: 1, destino: 'cocina', curso: 2 },
        { id: pescado.id, nombre: pescado.nombre, precio: pescado.precio, cantidad: 1, destino: 'cocina', curso: 3 },
        { id: cerveza.id, nombre: cerveza.nombre, precio: cerveza.precio, cantidad: 2, destino: 'barra', curso: 1 },
        { id: cafe.id, nombre: cafe.nombre, precio: cafe.precio, cantidad: 1, destino: 'barra', curso: 5 }
      ]
    });
    assert.equal(comandaRes.status, 200);

    // 1. KDS Cocina: Debe tener UNICAMENTE Alitas y Pescado
    const kdsCocina = await req('/api/kds?destino=cocina');
    assert.equal(kdsCocina.status, 200);
    const mesa1Cocina = kdsCocina.body.find(m => m.mesa_id === 1 || m.id === 1 || m.numero === 1 || m.mesa_numero === 1);
    assert.ok(mesa1Cocina, 'Mesa 1 debe aparecer en KDS cocina');
    
    // Obtener todos los items devueltos en la comanda de cocina
    const itemsCocina = kdsCocina.body.filter(c => c.mesa_id === 1 || c.mesa_numero === 1 || c.mesa === 'Mesa 1');
    const nombresCocina = itemsCocina.map(i => i.nombre_producto || i.nombre || i.platillo);
    assert.ok(nombresCocina.some(n => /alita/i.test(n)), 'Cocina debe contener Alitas');
    assert.ok(nombresCocina.some(n => /pescado|casado|arroz/i.test(n)), 'Cocina debe contener Pescado');
    assert.ok(!nombresCocina.some(n => /imperial|pilsen|cerveza/i.test(n)), 'Cocina NO debe contener Cervezas');
    assert.ok(!nombresCocina.some(n => /café|cafe/i.test(n)), 'Cocina NO debe contener Café');

    // 2. KDS Barra: Debe tener UNICAMENTE Cervezas y Café
    const kdsBarra = await req('/api/kds?destino=barra');
    assert.equal(kdsBarra.status, 200);
    const itemsBarra = kdsBarra.body.filter(c => c.mesa_id === 1 || c.mesa_numero === 1 || c.mesa === 'Mesa 1');
    assert.ok(itemsBarra.length > 0, 'Mesa 1 debe aparecer en KDS barra');

    const nombresBarra = itemsBarra.map(i => i.nombre_producto || i.nombre || i.platillo);
    assert.ok(nombresBarra.some(n => /imperial|pilsen|cerveza/i.test(n)), 'Barra debe contener Cerveza');
    assert.ok(nombresBarra.some(n => /café|cafe/i.test(n)), 'Barra debe contener Café');
    assert.ok(!nombresBarra.some(n => /alita/i.test(n)), 'Barra NO debe contener Alitas');
    assert.ok(!nombresBarra.some(n => /pescado|casado|arroz/i.test(n)), 'Barra NO debe contener Pescado');
  });

  it('T19.3: Comanda solo con bebidas no genera pedidos pendientes en KDS Cocina', async () => {
    const resProds = await req('/api/menu');
    const prods = resProds.body.productos || [];
    const cerveza = prods.find(p => /imperial|pilsen|cerveza/i.test(p.nombre)) || { id: 103, nombre: 'Imperial Regular', precio: 1800, destino: 'barra', curso: 1 };

    const comandaRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      mesero: 'Sofía Salonera',
      items: [
        { id: cerveza.id, nombre: cerveza.nombre, precio: cerveza.precio, cantidad: 3, destino: 'barra', curso: 1 }
      ]
    });
    assert.equal(comandaRes.status, 200);

    const kdsCocina = await req('/api/kds?destino=cocina');
    const mesa2Cocina = kdsCocina.body.find(m => (m.mesa_id === 2 || m.id === 2 || m.numero === 2 || m.mesa_numero === 2));
    assert.equal(mesa2Cocina, undefined, 'Mesa con solo bebidas no debe figurar en KDS Cocina');
  });
});
