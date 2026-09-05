const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 10: Auto-conversión a Insumo en Kárdex, Enlace Inmediato y Similitud >=95%', () => {
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

  function normalizar(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function calcularSimilitud(strA, strB) {
    const a = normalizar(strA);
    const b = normalizar(strB);
    if (!a || !b) return 0;
    if (a === b) return 1.0;

    const palabrasA = a.split(' ').filter(Boolean).sort().join(' ');
    const palabrasB = b.split(' ').filter(Boolean).sort().join(' ');
    if (palabrasA === palabrasB) return 1.0;

    const getBigrams = (s) => {
      const bigrams = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const bg = s.substring(i, i + 2);
        bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
      }
      return bigrams;
    };

    let dice = 0;
    if (a.length > 1 && b.length > 1) {
      const bgA = getBigrams(a);
      const bgB = getBigrams(b);
      let matches = 0;
      let totalA = 0;
      for (const [bg, count] of bgA.entries()) {
        totalA += count;
        if (bgB.has(bg)) matches += Math.min(count, bgB.get(bg));
      }
      let totalB = 0;
      for (const count of bgB.values()) totalB += count;
      dice = (2 * matches) / (totalA + totalB);
    }

    const lenA = a.length;
    const lenB = b.length;
    const matrix = [];
    for (let i = 0; i <= lenB; i++) matrix[i] = [i];
    for (let j = 0; j <= lenA; j++) matrix[0][j] = j;

    for (let i = 1; i <= lenB; i++) {
      for (let j = 1; j <= lenA; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
      }
    }
    const levSim = 1 - (matrix[lenB][lenA] / Math.max(lenA, lenB));
    return Math.max(dice, levSim);
  }

  it('T10.1: Algoritmo de similitud detecta coincidencias exactas, con tildes y palabras transpuestas >= 95%', () => {
    assert.equal(calcularSimilitud('Cacique 1000ml', 'cacique 1000ml'), 1.0);
    assert.equal(calcularSimilitud('Flor de Caña', 'flor de cana'), 1.0);
    assert.equal(calcularSimilitud('Cerveza Corona', 'Corona Cerveza'), 1.0);

    const simTypo = calcularSimilitud('Cerveza Imperial Silver 350ml', 'Cerveza Imperial Silve 350ml');
    assert.ok(simTypo >= 0.95, `Similitud esperada >= 0.95 pero fue ${simTypo}`);

    const simDiff = calcularSimilitud('Hamburguesa Clásica', 'Cerveza Heineken');
    assert.ok(simDiff < 0.5, `Similitud esperada < 0.5 pero fue ${simDiff}`);
  });

  it('T10.2: Creación automática de insumo en bodega y vinculación 1 a 1 de nuevo producto al Kárdex', async () => {
    const rInsumo = await req('/api/admin/inventario', 'POST', {
      nombre: 'Red Bull Energy 250ml',
      categoria: 'Bebidas',
      unidad_medida: 'unidades',
      stock_actual: 48,
      stock_minimo: 6,
      costo_unitario: 1200,
      es_licor: 0
    });
    assert.equal(rInsumo.status, 201);
    const insumoId = rInsumo.body.insumoId;
    assert.ok(insumoId);

    const rProd = await req('/api/productos', 'POST', {
      nombre: 'Red Bull Energy Drink',
      precio: 2500,
      categoria_id: 1,
      destino: 'barra',
      curso: 1,
      kardex_tipo: 'unidad',
      insumo_id: insumoId,
      cantidad_descuento: 1,
      insumo_stock_actual: 48,
      insumo_costo_unitario: 1200,
      insumo_stock_minimo: 6
    });
    assert.equal(rProd.status, 201);
    const productoId = rProd.body.producto.id;
    assert.ok(productoId);

    const rLink = await req(`/api/productos/${productoId}/kardex-link`);
    assert.equal(rLink.status, 200);
    assert.equal(rLink.body.vinculado, true);
    assert.equal(rLink.body.kardex_tipo, 'unidad');
    assert.equal(rLink.body.insumo_id, insumoId);
    assert.equal(rLink.body.stock_actual, 48);
    assert.equal(rLink.body.costo_unitario, 1200);
  });

  it('T10.3: Venta y cobro directo de producto auto-convertido descuenta 1 unidad en inventario y genera asiento en Kárdex', async () => {
    const rInsumo = await req('/api/admin/inventario', 'POST', {
      nombre: 'Cerveza Stella Artois',
      categoria: 'Bebidas',
      unidad_medida: 'botellas',
      stock_actual: 10,
      stock_minimo: 2,
      costo_unitario: 1100
    });
    const insumoId = rInsumo.body.insumoId;

    const rProd = await req('/api/productos', 'POST', {
      nombre: 'Stella Artois Botella',
      precio: 2000,
      categoria_id: 1,
      destino: 'barra',
      kardex_tipo: 'unidad',
      insumo_id: insumoId
    });
    const productoId = rProd.body.producto.id;

    const rCobro = await req('/api/ordenes/directo/cobrar', 'POST', {
      mesaId: 1,
      mesero: 'Salonero Test',
      metodoPago: 'efectivo',
      items: [
        { id: productoId, nombre: 'Stella Artois Botella', precio: 2000, cantidad: 2, notas: '', curso: 1, destino: 'barra' }
      ]
    });
    assert.equal(rCobro.status, 200);
    assert.equal(rCobro.body.ok, true);

    const rInv = await req(`/api/admin/inventario/${insumoId}`);
    assert.equal(rInv.status, 200);
    assert.equal(rInv.body.stock_actual, 8);

    const rKardex = await req(`/api/admin/inventario/${insumoId}/kardex`);
    assert.equal(rKardex.status, 200);
    const movVenta = rKardex.body.movimientos.find(m => m.tipo === 'venta' || m.tipo === 'salida' || m.tipo_movimiento === 'salida_venta' || m.tipo_movimiento === 'salida');
    assert.ok(movVenta, 'Debe registrarse movimiento de salida por venta');
    assert.equal(movVenta.cantidad, 2);
  });
});
