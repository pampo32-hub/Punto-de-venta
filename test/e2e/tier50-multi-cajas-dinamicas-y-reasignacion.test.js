const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 50: Selección Dinámica de Cajas Físicas, Pre-asignación & Reasignación en Caliente', () => {
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

  it('T50.1: GET /api/cajas-fisicas retorna los puntos de cobro físicos configurados y su estado de disponibilidad', async () => {
    const res = await server.request('/api/cajas-fisicas');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.ok(Array.isArray(res.data.puntos));
    assert.ok(res.data.puntos.length >= 4);

    // Todas las cajas deben estar disponibles al inicio
    for (const punto of res.data.puntos) {
      assert.strictEqual(punto.ocupada, false);
      assert.strictEqual(punto.turno_activo, null);
    }
  });

  it('T50.2: Cajero A abre Caja 1 dinámicamente; intento de Cajero B de abrir la misma Caja 1 recibe 409 Conflict', async () => {
    // 1. Cajero A abre Caja 1 (Principal)
    const aperturaA = await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 1, // Admin / Cajero A
        caja_fisica_id: 1,
        monto_inicial: 50000,
        observaciones: 'Apertura inicial Caja 1'
      }
    });

    assert.strictEqual(aperturaA.status, 200);
    assert.strictEqual(aperturaA.data.ok, true);
    assert.strictEqual(aperturaA.data.caja.caja_fisica_id, 1);
    assert.strictEqual(aperturaA.data.caja.estado, 'abierta');

    // 2. Cajero B (ID 2) intenta abrir la misma Caja Física 1 -> Debe ser rechazada con 409 Conflict
    const aperturaBConflicto = await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 2,
        caja_fisica_id: 1,
        monto_inicial: 30000,
        observaciones: 'Intento duplicado en Caja 1'
      }
    });

    assert.strictEqual(aperturaBConflicto.status, 409);
    assert.strictEqual(aperturaBConflicto.data.ok, false);
    assert.ok(aperturaBConflicto.data.error.toLowerCase().includes('en uso') || aperturaBConflicto.data.error.toLowerCase().includes('abierta'));
  });

  it('T50.3: Cajero B abre Caja 2 (Barra) exitosamente permitiendo turnos simultáneos aislados', async () => {
    // 1. Abrir Caja 1 con usuario 1
    await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 1,
        caja_fisica_id: 1,
        monto_inicial: 50000
      }
    });

    // 2. Abrir Caja 2 con usuario 2
    const aperturaB = await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 2,
        caja_fisica_id: 2,
        monto_inicial: 25000
      }
    });

    assert.strictEqual(aperturaB.status, 200);
    assert.strictEqual(aperturaB.data.ok, true);
    assert.strictEqual(aperturaB.data.caja.caja_fisica_id, 2);

    // 3. Consultar /api/cajas-fisicas: Caja 1 y 2 ocupadas, Caja 3 y 4 disponibles
    const resPuntos = await server.request('/api/cajas-fisicas');
    assert.strictEqual(resPuntos.status, 200);
    const p1 = resPuntos.data.puntos.find(p => p.id === 1);
    const p2 = resPuntos.data.puntos.find(p => p.id === 2);
    const p3 = resPuntos.data.puntos.find(p => p.id === 3);

    assert.strictEqual(p1.ocupada, true);
    assert.strictEqual(p2.ocupada, true);
    assert.strictEqual(p3.ocupada, false);

    // 4. Consultar /api/caja/actual con todas=true
    const resTodas = await server.request('/api/caja/actual?todas=true');
    assert.strictEqual(resTodas.status, 200);
    assert.strictEqual(resTodas.data.ok, true);
    assert.strictEqual(resTodas.data.cajasAbiertas.length, 2);
  });

  it('T50.4: Reasignación de turno activo en caliente requiere PIN Admin válido y actualiza cajero y/o caja física', async () => {
    // 1. Abrir Caja 1 con usuario 1
    const ap = await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 1,
        caja_fisica_id: 1,
        monto_inicial: 40000
      }
    });
    const cajaId = ap.data.caja.id;

    // 2. Intentar reasignar con PIN incorrecto -> 401 / 403
    const resPinInvalido = await server.request('/api/admin/cajas/reasignar', {
      method: 'POST',
      body: {
        caja_id: cajaId,
        nuevo_usuario_id: 2,
        pinAdmin: '9999',
        pinAdmin: '0000',
        motivo: 'Cambio de turno'
      }
    });
    assert.strictEqual(resPinInvalido.status, 401);
    assert.strictEqual(resPinInvalido.data.ok, false);

    // 3. Reasignar exitosamente el turno a Usuario 2 y mover a Caja Física 3 (Terraza) con PIN 1234
    const resReasignar = await server.request('/api/admin/cajas/reasignar', {
      method: 'POST',
      body: {
        caja_id: cajaId,
        nuevo_usuario_id: 2,
        nueva_caja_fisica_id: 3,
        pinAdmin: '1234',
        motivo: 'Relevo de almuerzo y traslado a terraza'
      }
    });

    assert.strictEqual(resReasignar.status, 200);
    assert.strictEqual(resReasignar.data.ok, true);
    assert.strictEqual(resReasignar.data.caja.usuario_id, 2);
    assert.strictEqual(resReasignar.data.caja.caja_fisica_id, 3);

    // 4. Verificar que Caja 1 quedó liberada y Caja 3 quedó ocupada
    const resPuntos = await server.request('/api/cajas-fisicas');
    const p1 = resPuntos.data.puntos.find(p => p.id === 1);
    const p3 = resPuntos.data.puntos.find(p => p.id === 3);
    assert.strictEqual(p1.ocupada, false);
    assert.strictEqual(p3.ocupada, true);
    assert.strictEqual(p3.turno_activo.usuario_id, 2);
    assert.ok(p3.turno_activo);
  });

  it('T50.5: Pre-asignación de caja habitual en gestión de empleados (/api/admin/empleados)', async () => {
    // 1. Guardar empleado asignándole caja habitual 2 (Barra)
    const empRes = await server.request('/api/admin/empleados', {
      method: 'POST',
      body: {
        nombre: 'Mesero Barra Express',
        usuario: 'mesero_barra',
        password: 'password123',
        rol: 'cajero',
        caja_defecto_id: 2,
        pinAdmin: '1234'
      }
    });

    assert.strictEqual(empRes.status, 200);
    assert.strictEqual(empRes.data.ok, true);

    // 2. Listar empleados y verificar que caja_defecto_id persiste
    const listRes = await server.request('/api/admin/empleados');
    assert.strictEqual(listRes.status, 200);
    const empleados = Array.isArray(listRes.data) ? listRes.data : (listRes.data.empleados || []);
    const empCreado = empleados.find(e => e.usuario === 'mesero_barra');
    assert.ok(empCreado);
    assert.strictEqual(Number(empCreado.caja_defecto_id), 2);
  });

  it('T50.6: Corte X y Cierre Z operan correctamente sobre la caja física especificada', async () => {
    // 1. Abrir Caja 1
    const ap1 = await server.request('/api/caja/abrir', {
      method: 'POST',
      body: {
        usuario_id: 1,
        caja_fisica_id: 1,
        monto_inicial: 50000
      }
    });
    const caja1Id = ap1.data.caja.id;

    // 2. Consultar Corte X de Caja 1
    const corteX = await server.request('/api/caja/corte-x?caja_id=' + caja1Id + '&usuario_id=1');
    assert.strictEqual(corteX.status, 200);
    assert.strictEqual(corteX.data.ok, true);
    assert.strictEqual(corteX.data.corte.caja_id, caja1Id);
    assert.strictEqual(corteX.data.corte.caja_fisica_id, 1);

    // 3. Ejecutar Cierre Z de Caja 1
    const cierreZ = await server.request('/api/caja/cierre-z', {
      method: 'POST',
      body: {
        caja_id: caja1Id,
        usuario_id: 1,
        monto_final_real: 50000,
        observaciones: 'Cierre de turno normal'
      }
    });

    assert.strictEqual(cierreZ.status, 200);
    assert.strictEqual(cierreZ.data.ok, true);
    assert.strictEqual(cierreZ.data.caja.estado, 'cerrada');

    // 4. Verificar que Caja 1 vuelve a estar disponible
    const resPuntos = await server.request('/api/cajas-fisicas');
    const p1 = resPuntos.data.puntos.find(p => p.id === 1);
    assert.strictEqual(p1.ocupada, false);
  });
});
