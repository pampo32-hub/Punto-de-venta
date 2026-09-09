const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');
const path = require('path');

describe('Tier 35: Insumos con Categorias Desplegables, Fraccionamiento en Gramos/Litros y Eliminacion en Bodega', () => {
  let serverProcess;
  let baseUrl;
  let db;

  const req = (endpoint, method = 'GET', body = null, headers = {}) => {
    return new Promise((resolve, reject) => {
      const u = new URL(endpoint, baseUrl);
      const data = body ? JSON.stringify(body) : null;
      const opt = {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-negocio-id': '1',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      };
      const r = http.request(opt, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw });
          } catch (e) {
            resolve({ status: res.statusCode, body: raw, headers: res.headers, raw });
          }
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  };

  before(async () => {
    const serverModule = require('../../server');
    const dbModule = require('../../database');
    db = dbModule.db;

    const server = http.createServer(serverModule.app || serverModule);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = 'http://127.0.0.1:' + port;
        serverProcess = server;
        resolve();
      });
    });
  });

  after(() => {
    if (serverProcess && serverProcess.close) {
      serverProcess.close();
    }
  });

  it('1. HTML: Verifica selectores de categoria, campos personalizados y modal de eliminacion', () => {
    const indexPath = path.join(__dirname, '../../index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    assert.ok(html.includes('id="selectNuevoInsumoCat"'), 'selectNuevoInsumoCat debe existir');
    assert.ok(html.includes('id="selectEditarInsumoCat"'), 'selectEditarInsumoCat debe existir');
    assert.ok(html.includes('id="txtNuevoInsumoCatManual"'), 'txtNuevoInsumoCatManual debe existir');
    assert.ok(html.includes('id="txtEditarInsumoCatManual"'), 'txtEditarInsumoCatManual debe existir');
    assert.ok(html.includes('id="modalConfirmarEliminarInsumo"'), 'modalConfirmarEliminarInsumo debe existir');
  });

  it('2. Backend: Crear insumo de Mariscos & Frios en kg fraccionable en porciones de 200g', async () => {
    const res = await req('/api/admin/inventario', 'POST', {
      nombre: 'Pescado Corvina Ceviche Test 35',
      categoria: 'Mariscos & Fríos',
      unidad_medida: 'kg',
      stock_actual: 10,
      stock_minimo: 3,
      costo_unitario: 2200,
      es_licor: 1,
      capacidad_ml: 1000,
      medida_shot_ml: 200
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id, 'Debe devolver el id del insumo creado');
    assert.strictEqual(res.body.rendimiento_shots, 5, '1000g / 200g = 5 porciones');

    const checkRes = await req('/api/admin/inventario/' + res.body.id, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkRes.status, 200);
    assert.strictEqual(checkRes.body.categoria, 'Mariscos & Fríos');
    assert.strictEqual(checkRes.body.unidad_medida, 'kg');
  });

  it('3. Backend: Editar insumo modificando categoria a Carnes & Embutidos y porcion a 250g', async () => {
    const resCrear = await req('/api/admin/inventario', 'POST', {
      nombre: 'Lomito de Res Test 35',
      categoria: 'Carnes & Embutidos',
      unidad_medida: 'kg',
      stock_actual: 8,
      stock_minimo: 2,
      costo_unitario: 8000,
      es_licor: 1,
      capacidad_ml: 1000,
      medida_shot_ml: 200
    }, { 'x-user-rol': 'admin' });

    const insumoId = resCrear.body.id;

    const editRes = await req('/api/admin/inventario/' + insumoId, 'PUT', {
      nombre: 'Lomito de Res Premium Test 35',
      categoria: 'Carnes & Embutidos',
      unidad_medida: 'kg',
      stock_minimo: 2,
      costo_unitario: 8500,
      es_licor: 1,
      capacidad_ml: 1000,
      medida_shot_ml: 250
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.body.rendimiento_shots, 4, '1000g / 250g = 4 porciones');

    const checkInsumo = await req('/api/admin/inventario/' + insumoId, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.nombre, 'Lomito de Res Premium Test 35');
    assert.strictEqual(checkInsumo.body.rendimiento_shots, 4);
  });

  it('4. Backend: Eliminar insumo directamente con rol admin', async () => {
    const resCrear = await req('/api/admin/inventario', 'POST', {
      nombre: 'Insumo Para Borrar Test 35',
      categoria: 'General',
      unidad_medida: 'unidades',
      stock_actual: 5,
      stock_minimo: 1,
      costo_unitario: 500
    }, { 'x-user-rol': 'admin' });

    const insumoId = resCrear.body.id;

    const delRes = await req('/api/admin/inventario/' + insumoId, 'DELETE', {}, { 'x-user-rol': 'admin' });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.success, true);

    const check = await req('/api/admin/inventario/' + insumoId, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(check.status, 404);
  });

  it('5. Seguridad / PIN: Salonero sin PIN recibe 403, con PIN valido puede eliminar', async () => {
    const resCrear = await req('/api/admin/inventario', 'POST', {
      nombre: 'Insumo Seguridad Test 35',
      categoria: 'General',
      unidad_medida: 'unidades',
      stock_actual: 5,
      stock_minimo: 1,
      costo_unitario: 500
    }, { 'x-user-rol': 'admin' });

    const insumoId = resCrear.body.id;

    const intentoSinPin = await req('/api/admin/inventario/' + insumoId, 'DELETE', {}, { 'x-user-rol': 'salonero' });
    assert.strictEqual(intentoSinPin.status, 403);

    const intentoPinInvalido = await req('/api/admin/inventario/' + insumoId, 'DELETE', {}, {
      'x-user-rol': 'salonero',
      'x-supervisor-pin': '0000'
    });
    assert.strictEqual(intentoPinInvalido.status, 403);

    const intentoPinValido = await req('/api/admin/inventario/' + insumoId, 'DELETE', {}, {
      'x-user-rol': 'salonero',
      'x-supervisor-pin': '1234'
    });
    assert.strictEqual(intentoPinValido.status, 200);
    assert.strictEqual(intentoPinValido.body.success, true);
  });
});