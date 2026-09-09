const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');
const path = require('path');

describe('Tier 34: Modificar y Eliminar Kárdex (Gestión de Stock, PIN) y Modal de Agotados desde Admin Panel', () => {
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

    // Buscar puerto libre
    const server = http.createServer(serverModule.app || serverModule);
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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

  it('1. HTML: Verifica que modalAgotados tenga prioridad de z-index y card-agotados llame ejecutarAccionAdmin("agotados")', () => {
    const indexPath = path.join(__dirname, '../../index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    assert.ok(html.includes('id="modalAgotados" style="z-index: 100020;"'), 'modalAgotados debe tener z-index: 100020;');
    assert.ok(html.includes('onclick="ejecutarAccionAdmin(\'agotados\')"'), 'card-agotados debe ejecutar accion agotados');
    assert.ok(html.includes('id="modalEditarKardex"'), 'Debe existir modalEditarKardex');
    assert.ok(html.includes('id="modalConfirmarEliminarKardex"'), 'Debe existir modalConfirmarEliminarKardex');
  });

  it('2. Backend: Modificar un movimiento de Kárdex sin ajustar stock (solo historial)', async () => {
    // 1. Crear insumo de prueba
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Carne Molida Premium Test 34',
      categoria: 'Carnes',
      unidad_medida: 'kg',
      stock_actual: 20,
      stock_minimo: 5,
      costo_unitario: 4000
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(insumoRes.status, 201);
    const insumoId = insumoRes.body.id;

    // 2. Crear movimiento inicial
    const ajusteRes = await req(`/api/admin/inventario/${insumoId}/ajuste`, 'POST', {
      tipo: 'entrada',
      cantidad: 10,
      motivo: 'Compra inicial lote A',
      costo_unitario: 4000
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(ajusteRes.status, 200);

    // Consultar movimientos
    const movsRes = await req(`/api/admin/inventario/${insumoId}/kardex`, 'GET', null, { 'x-user-rol': 'admin' });
    const mov = movsRes.body.movimientos[0];
    assert.ok(mov, 'Debe existir el movimiento creado');
    const movId = mov.id;

    // 3. Modificar motivo y fecha sin alterar stock (ajustar_stock = false)
    const editRes = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'PUT', {
      tipo: 'entrada',
      cantidad: 10,
      motivo: 'Compra corregida Factura #8899',
      ajustar_stock: false
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.body.success, true);
    assert.strictEqual(editRes.body.movimiento.motivo, 'Compra corregida Factura #8899');

    // Verificar que stock_actual en Inventario sigue siendo 30
    const checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 30);
  });

  it('3. Backend: Modificar cantidad de movimiento de Kárdex CON ajuste de stock automático', async () => {
    // 1. Crear insumo
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Queso Mozzarella Test 34',
      categoria: 'Lácteos',
      unidad_medida: 'kg',
      stock_actual: 10,
      stock_minimo: 2,
      costo_unitario: 5000
    }, { 'x-user-rol': 'admin' });

    const insumoId = insumoRes.body.id;

    // 2. Registrar entrada de 10 -> stock queda en 20
    await req(`/api/admin/inventario/${insumoId}/ajuste`, 'POST', {
      tipo: 'entrada',
      cantidad: 10,
      motivo: 'Entrada factura 1'
    }, { 'x-user-rol': 'admin' });

    const movsRes = await req(`/api/admin/inventario/${insumoId}/kardex`, 'GET', null, { 'x-user-rol': 'admin' });
    const movId = movsRes.body.movimientos[0].id;

    // 3. Modificar entrada de 10 a 15 con ajustar_stock: true -> stock debe aumentar 5 y quedar en 25
    const editRes = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'PUT', {
      tipo: 'entrada',
      cantidad: 15,
      motivo: 'Entrada corregida a 15kg reales',
      ajustar_stock: true
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.body.movimiento.cantidad, 15);

    const checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 25);
  });

  it('4. Backend: Eliminar movimiento de Kárdex CON reversión de stock (revertir_stock: true)', async () => {
    // 1. Insumo inicial con 50 unidades
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Cerveza Corona Test 34',
      categoria: 'Bebidas',
      unidad_medida: 'unidad',
      stock_actual: 50,
      stock_minimo: 10,
      costo_unitario: 1200
    }, { 'x-user-rol': 'admin' });

    const insumoId = insumoRes.body.id;

    // 2. Registrar merma de 5 unidades -> stock queda en 45
    await req(`/api/admin/inventario/${insumoId}/ajuste`, 'POST', {
      tipo: 'merma',
      cantidad: 5,
      motivo: 'Botellas quebradas por error'
    }, { 'x-user-rol': 'admin' });

    let checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 45);

    const movsRes = await req(`/api/admin/inventario/${insumoId}/kardex`, 'GET', null, { 'x-user-rol': 'admin' });
    const movId = movsRes.body.movimientos[0].id;

    // 3. Eliminar la merma con revertir_stock: true -> Debe devolver las 5 unidades al stock (45 + 5 = 50)
    const delRes = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'DELETE', {
      revertir_stock: true
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.body.success, true);

    checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 50, 'El stock debe volver a 50 al revertir la merma eliminada');
  });

  it('5. Backend: Eliminar movimiento de Kárdex SIN revertir stock (solo borrar línea histórica)', async () => {
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Refresco Kola Test 34',
      categoria: 'Bebidas',
      unidad_medida: 'unidad',
      stock_actual: 30,
      stock_minimo: 5,
      costo_unitario: 800
    }, { 'x-user-rol': 'admin' });

    const insumoId = insumoRes.body.id;

    await req(`/api/admin/inventario/${insumoId}/ajuste`, 'POST', {
      tipo: 'merma',
      cantidad: 4,
      motivo: 'Merma de prueba'
    }, { 'x-user-rol': 'admin' });

    let checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 26);

    const movsRes = await req(`/api/admin/inventario/${insumoId}/kardex`, 'GET', null, { 'x-user-rol': 'admin' });
    const movId = movsRes.body.movimientos[0].id;

    // Eliminar con revertir_stock: false
    const delRes = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'DELETE', {
      revertir_stock: false
    }, { 'x-user-rol': 'admin' });

    assert.strictEqual(delRes.status, 200);

    // Stock debe seguir siendo 26
    checkInsumo = await req(`/api/admin/inventario/${insumoId}`, 'GET', null, { 'x-user-rol': 'admin' });
    assert.strictEqual(checkInsumo.body.stock_actual, 26);
  });

  it('6. Seguridad y PIN: Usuario salonero/cajero requiere PIN válido para modificar o eliminar Kárdex', async () => {
    const insumoRes = await req('/api/admin/inventario', 'POST', {
      nombre: 'Vino Tinto Seguridad Test 34',
      categoria: 'Licores',
      unidad_medida: 'botella',
      stock_actual: 10,
      stock_minimo: 2,
      costo_unitario: 8000
    }, { 'x-user-rol': 'admin' });

    const insumoId = insumoRes.body.id;

    await req(`/api/admin/inventario/${insumoId}/ajuste`, 'POST', {
      tipo: 'entrada',
      cantidad: 2,
      motivo: 'Entrada de prueba'
    }, { 'x-user-rol': 'admin' });

    const movsRes = await req(`/api/admin/inventario/${insumoId}/kardex`, 'GET', null, { 'x-user-rol': 'admin' });
    const movId = movsRes.body.movimientos[0].id;

    // Intento 1: Usuario con rol 'salonero' sin PIN -> 403
    const intentoSinPin = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'PUT', {
      cantidad: 5
    }, { 'x-user-rol': 'salonero' });

    assert.strictEqual(intentoSinPin.status, 403, 'Debe ser denegado para salonero sin PIN');

    // Intento 2: Usuario salonero con PIN incorrecto -> 403
    const intentoPinMalo = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'PUT', {
      cantidad: 5
    }, { 'x-user-rol': 'salonero', 'x-supervisor-pin': '0000' });

    assert.strictEqual(intentoPinMalo.status, 403, 'Debe ser denegado con PIN incorrecto');

    // Intento 3: Usuario salonero con PIN correcto (1234 por defecto) -> 200
    const intentoPinBueno = await req(`/api/admin/inventario/kardex/movimientos/${movId}`, 'PUT', {
      motivo: 'Autorizado con PIN',
      ajustar_stock: false
    }, { 'x-user-rol': 'salonero', 'x-supervisor-pin': '1234' });

    assert.strictEqual(intentoPinBueno.status, 200, 'Debe permitir con PIN válido');
  });
});
