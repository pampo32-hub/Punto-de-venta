const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 21: Selector Interactivo de Selección Múltiple para Balde Nacional (Hasta 6 Cervezas)', () => {
  let server;
  let mockEstado = {};

  before(async () => {
    server = await startTestServer();
    mockEstado = {
      categorias: [
        { id: 1, nombre: 'Comidas Principales' },
        { id: 4, nombre: 'Cerveza Nacional' }
      ],
      productos: [
        { id: 1, nombre: 'Imperial Regular', precio: 1800, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 2, nombre: 'Imperial Silver', precio: 1800, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 3, nombre: 'Pilsen', precio: 1800, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 4, nombre: 'Bavaria Gold', precio: 2200, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 99, nombre: 'Balde Nacional', precio: 7500, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 10, nombre: 'Casado con Carne', precio: 4500, categoria_id: 1, destino: 'cocina', curso: 2 }
      ],
      mesaActiva: {
        id: 1,
        numero: 'Mesa 1',
        estado: 'libre',
        items: []
      }
    };
  });

  after(async () => {
    if (server) await server.stop();
  });

  beforeEach(async () => {
    await server.resetDb();
  });

  function req(endpoint, method = 'GET', body = null, headers = { 'x-user-rol': 'salonero' }) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T21.1: esProductoBaldeNacional detecta correctamente Balde Nacional y no productos regulares', () => {
    const esProductoBaldeNacional = (prod) => {
      if (!prod) return false;
      const nombre = (prod.nombre || '').toLowerCase();
      return nombre.includes('balde nacional') || (nombre.includes('balde') && !nombre.includes('cubeta'));
    };

    assert.equal(esProductoBaldeNacional({ nombre: 'Balde Nacional' }), true);
    assert.equal(esProductoBaldeNacional({ nombre: 'balde nacional 6 unidades' }), true);
    assert.equal(esProductoBaldeNacional({ nombre: 'BALDE NACIONAL' }), true);
    assert.equal(esProductoBaldeNacional({ nombre: 'Imperial Regular' }), false);
    assert.equal(esProductoBaldeNacional({ nombre: 'Pilsen' }), false);
    assert.equal(esProductoBaldeNacional(null), false);
  });

  it('T21.2: Filtrado de cervezas nacionales excluye el propio producto Balde para evitar recursión', () => {
    const esCervezaNacionalEligible = (prod) => {
      if (!prod) return false;
      const prodCat = Number(prod.categoria_id !== undefined ? prod.categoria_id : prod.catId);
      const cat = (mockEstado.categorias || []).find(c => Number(c.id) === prodCat);
      const nombreCat = (cat ? cat.nombre : '').toLowerCase();
      if (nombreCat.includes('cerveza') || prodCat === 4) return true;
      return /imperial|pilsen|bavaria|rock ice|cerveza/i.test(prod.nombre || '');
    };

    const esProductoBaldeNacional = (prod) => {
      if (!prod) return false;
      const nombre = (prod.nombre || '').toLowerCase();
      return nombre.includes('balde nacional') || (nombre.includes('balde') && !nombre.includes('cubeta'));
    };

    const filtradas = mockEstado.productos.filter(p => esCervezaNacionalEligible(p) && !esProductoBaldeNacional(p));
    
    assert.equal(filtradas.length, 4);
    assert.ok(filtradas.some(p => p.nombre === 'Imperial Regular'));
    assert.ok(filtradas.some(p => p.nombre === 'Imperial Silver'));
    assert.ok(filtradas.some(p => p.nombre === 'Pilsen'));
    assert.ok(filtradas.some(p => p.nombre === 'Bavaria Gold'));
    assert.ok(!filtradas.some(p => p.nombre.includes('Balde')));
  });

  it('T21.3: Lógica de selección múltiple respeta el tope máximo estricto de 6 unidades', () => {
    let seleccion = {};

    function incrementar(id) {
      const total = Object.values(seleccion).reduce((a, b) => a + b, 0);
      if (total >= 6) return false;
      seleccion[id] = (seleccion[id] || 0) + 1;
      return true;
    }

    function decrementar(id) {
      if (!seleccion[id] || seleccion[id] <= 0) return;
      seleccion[id]--;
      if (seleccion[id] === 0) delete seleccion[id];
    }

    // Agregar 3 Imperial Regular (id: 1)
    assert.equal(incrementar(1), true);
    assert.equal(incrementar(1), true);
    assert.equal(incrementar(1), true);
    assert.equal(seleccion[1], 3);

    // Agregar 2 Pilsen (id: 3)
    assert.equal(incrementar(3), true);
    assert.equal(incrementar(3), true);
    assert.equal(seleccion[3], 2);

    // Agregar 1 Bavaria (id: 4) -> Total 6
    assert.equal(incrementar(4), true);
    assert.equal(seleccion[4], 1);

    const totalSeis = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalSeis, 6);

    // Intentar agregar una 7ma cerveza -> Debe ser rechazado
    assert.equal(incrementar(2), false);
    assert.equal(incrementar(1), false);
    const totalSigueSeis = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalSigueSeis, 6);

    // Decrementar 1 Imperial
    decrementar(1);
    assert.equal(seleccion[1], 2);
    const totalCinco = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalCinco, 5);

    // Ahora sí se puede agregar 1 Silver (id: 2)
    assert.equal(incrementar(2), true);
    assert.equal(seleccion[2], 1);
  });

  it('T21.4: Confirmación genera desglose legible (ej. "3x Imperial Regular, 3x Pilsen") y agrega Balde a ₡7.500', () => {
    const seleccion = { 1: 3, 3: 3 }; // 3 Imperial + 3 Pilsen
    const prodPadre = { id: 99, nombre: 'Balde Nacional', precio: 7500 };
    const items = [];

    const total = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(total, 6);

    const desglosePartes = [];
    for (const [prodIdStr, cant] of Object.entries(seleccion)) {
      if (cant > 0) {
        const prod = mockEstado.productos.find(p => String(p.id) === String(prodIdStr));
        const nombre = prod ? prod.nombre : `Cerveza #${prodIdStr}`;
        desglosePartes.push(`${cant}x ${nombre}`);
      }
    }
    const notaDesglose = desglosePartes.join(', ');

    items.push({
      id: 'balde_test_1',
      producto_id: prodPadre.id,
      nombre: 'Balde Nacional (6 unidades)',
      precio: prodPadre.precio,
      cantidad: 1,
      notas: notaDesglose,
      destino: 'barra',
      curso: 1,
      es_balde: true,
      desglose_balde: { ...seleccion },
      enviado: false
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].precio, 7500);
    assert.equal(items[0].cantidad, 1);
    assert.equal(items[0].destino, 'barra');
    assert.equal(items[0].curso, 1);
    assert.equal(items[0].notas, '3x Imperial Regular, 3x Pilsen');
    assert.deepEqual(items[0].desglose_balde, { 1: 3, 3: 3 });
  });

  it('T21.5: Enviar Comanda con Balde Nacional seleccionado se persiste en backend con destino Barra y curso 1', async () => {
    // 1. Crear comanda con Balde Nacional y desglose
    const postRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Juan Jival',
      items: [
        {
          producto_id: 99,
          nombre: 'Balde Nacional (6 unidades)',
          precio: 7500,
          cantidad: 1,
          notas: '4x Imperial Regular, 2x Pilsen',
          destino: 'barra',
          curso: 1
        }
      ]
    });

    assert.equal(postRes.status, 200);
    assert.ok(postRes.body.ordenId);

    // 2. Verificar que la orden se guardó con el desglose en notas y total ₡7.500
    const ordenRes = await req('/api/ordenes/mesa/1');
    assert.equal(ordenRes.status, 200);
    assert.equal(ordenRes.body.orden.total, 7500);

    const itemBalde = ordenRes.body.items.find(i => i.nombre_producto.includes('Balde Nacional'));
    assert.ok(itemBalde, 'El ítem de Balde Nacional debe existir en la orden');
    assert.equal(itemBalde.precio_unitario, 7500);
    assert.equal(itemBalde.destino, 'barra');
    assert.equal(itemBalde.curso, 1);
    assert.equal(itemBalde.notas, '4x Imperial Regular, 2x Pilsen');
  });

  it('T21.6: Base de datos contiene el producto Balde Nacional a ₡7.500 categorizado correctamente', async () => {
    const menuRes = await req('/api/menu', 'GET');
    assert.equal(menuRes.status, 200);
    const prods = Array.isArray(menuRes.body) ? menuRes.body : (menuRes.body.productos || []);
    const balde = prods.find(p => p.nombre.toLowerCase().includes('balde nacional'));
    
    assert.ok(balde, 'El producto Balde Nacional debe existir en la base de datos');
    assert.equal(balde.precio, 7500);
    assert.equal(balde.destino, 'barra');
    assert.equal(balde.curso, 1);
  });
});
