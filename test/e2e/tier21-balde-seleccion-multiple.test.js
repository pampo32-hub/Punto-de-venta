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
        { id: 5, nombre: 'Imperial Ultra', precio: 1900, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 6, nombre: 'Pilsen 6.0', precio: 1900, categoria_id: 4, destino: 'barra', curso: 1 },
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
    
    assert.equal(filtradas.length, 6);
    assert.ok(filtradas.some(p => p.nombre === 'Imperial Regular'));
    assert.ok(filtradas.some(p => p.nombre === 'Imperial Silver'));
    assert.ok(filtradas.some(p => p.nombre === 'Imperial Ultra'));
    assert.ok(filtradas.some(p => p.nombre === 'Pilsen'));
    assert.ok(filtradas.some(p => p.nombre === 'Pilsen 6.0'));
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

    // Agregar 2 Imperial Ultra (id: 5)
    assert.equal(incrementar(5), true);
    assert.equal(incrementar(5), true);
    assert.equal(seleccion[5], 2);

    // Agregar 2 Imperial Regular (id: 1)
    assert.equal(incrementar(1), true);
    assert.equal(incrementar(1), true);
    assert.equal(seleccion[1], 2);

    // Agregar 1 Imperial Silver (id: 2) y 1 Pilsen 6.0 (id: 6) -> Total 6
    assert.equal(incrementar(2), true);
    assert.equal(incrementar(6), true);

    const totalSeis = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalSeis, 6);

    // Intentar agregar una 7ma cerveza -> Debe ser rechazado
    assert.equal(incrementar(3), false);
    assert.equal(incrementar(5), false);
    const totalSigueSeis = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalSigueSeis, 6);

    // Decrementar 1 Ultra
    decrementar(5);
    assert.equal(seleccion[5], 1);
    const totalCinco = Object.values(seleccion).reduce((a, b) => a + b, 0);
    assert.equal(totalCinco, 5);

    // Ahora sí se puede agregar 1 Pilsen (id: 3)
    assert.equal(incrementar(3), true);
    assert.equal(seleccion[3], 1);
  });

  it('T21.4: Confirmación genera desglose legible con nombres completos y agrega Balde a ₡7.500', () => {
    const seleccion = { 1: 2, 2: 1, 5: 2, 6: 1 };
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
    assert.ok(items[0].notas.includes('2x Imperial Regular'));
    assert.ok(items[0].notas.includes('1x Imperial Silver'));
    assert.ok(items[0].notas.includes('2x Imperial Ultra'));
    assert.ok(items[0].notas.includes('1x Pilsen 6.0'));
    assert.deepEqual(items[0].desglose_balde, { 1: 2, 2: 1, 5: 2, 6: 1 });
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
          notas: '2x Imperial Ultra, 2x Imperial Regular, 1x Imperial Silver, 1x Pilsen 6.0',
          destino: 'barra',
          curso: 1,
          es_balde: true,
          desglose_balde: { 5: 2, 1: 2, 2: 1, 6: 1 }
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
    assert.equal(itemBalde.notas, '2x Imperial Ultra, 2x Imperial Regular, 1x Imperial Silver, 1x Pilsen 6.0');
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

  it('T21.7: Descuento milimétrico en Kárdex por cada cerveza del Balde Nacional (2x Ultra, 2x Regular, 1x Silver, 1x Pilsen)', async () => {
    // 1. Preparar stock inicial en Inventario
    await server.dbRun("INSERT OR REPLACE INTO Inventario (id, nombre, stock_actual, costo_unitario, stock_minimo, unidad_medida) VALUES (101, 'Imperial Ultra', 20, 900, 5, 'botellas')");
    await server.dbRun("INSERT OR REPLACE INTO Inventario (id, nombre, stock_actual, costo_unitario, stock_minimo, unidad_medida) VALUES (102, 'Imperial Regular', 20, 850, 5, 'botellas')");
    await server.dbRun("INSERT OR REPLACE INTO Inventario (id, nombre, stock_actual, costo_unitario, stock_minimo, unidad_medida) VALUES (103, 'Imperial Silver', 20, 850, 5, 'botellas')");
    await server.dbRun("INSERT OR REPLACE INTO Inventario (id, nombre, stock_actual, costo_unitario, stock_minimo, unidad_medida) VALUES (104, 'Pilsen 6.0', 20, 900, 5, 'botellas')");

    // 2. Enviar comanda con Balde Nacional y desglose explícito
    const postRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Juan Jival',
      items: [
        {
          producto_id: 99,
          nombre: 'Balde Nacional (6 unidades)',
          precio: 7500,
          cantidad: 1,
          notas: '2x Imperial Ultra, 2x Imperial Regular, 1x Imperial Silver, 1x Pilsen 6.0',
          destino: 'barra',
          curso: 1,
          es_balde: true,
          desglose_balde: { 101: 2, 102: 2, 103: 1, 104: 1 }
        }
      ]
    });

    assert.equal(postRes.status, 200);

    // 3. Verificar que el stock_actual de cada cerveza en Inventario se redujo exactamente
    const ultra = await server.dbGet('SELECT stock_actual FROM Inventario WHERE id = 101');
    const regular = await server.dbGet('SELECT stock_actual FROM Inventario WHERE id = 102');
    const silver = await server.dbGet('SELECT stock_actual FROM Inventario WHERE id = 103');
    const pilsen = await server.dbGet('SELECT stock_actual FROM Inventario WHERE id = 104');

    assert.equal(ultra.stock_actual, 18, 'Imperial Ultra debe haber bajado de 20 a 18 (-2)');
    assert.equal(regular.stock_actual, 18, 'Imperial Regular debe haber bajado de 20 a 18 (-2)');
    assert.equal(silver.stock_actual, 19, 'Imperial Silver debe haber bajado de 20 a 19 (-1)');
    assert.equal(pilsen.stock_actual, 19, 'Pilsen 6.0 debe haber bajado de 20 a 19 (-1)');

    // 4. Verificar registros de auditoría en InventarioMovimientos para estos insumos
    const movUltra = await server.dbGet("SELECT * FROM InventarioMovimientos WHERE insumo_id = 101 AND cantidad = 2");
    const movRegular = await server.dbGet("SELECT * FROM InventarioMovimientos WHERE insumo_id = 102 AND cantidad = 2");
    const movSilver = await server.dbGet("SELECT * FROM InventarioMovimientos WHERE insumo_id = 103 AND cantidad = 1");
    const movPilsen = await server.dbGet("SELECT * FROM InventarioMovimientos WHERE insumo_id = 104 AND cantidad = 1");

    assert.ok(movUltra, 'Movimiento de 2 unidades para Imperial Ultra debe existir');
    assert.ok(movRegular, 'Movimiento de 2 unidades para Imperial Regular debe existir');
    assert.ok(movSilver, 'Movimiento de 1 unidad para Imperial Silver debe existir');
    assert.ok(movPilsen, 'Movimiento de 1 unidad para Pilsen 6.0 debe existir');
    assert.ok(movUltra.motivo.includes('Balde Nacional'));
  });
});
