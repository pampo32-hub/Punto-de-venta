const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 52: Desambiguación Multi-Comercio en Login (Resolución de Colisión de Usuarios)', () => {
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

  it('T52.1: Detecta colisión cuando dos negocios tienen el mismo usuario y contraseña, y retorna los comercios', async () => {
    // 1. Asegurar que existan al menos 2 negocios
    const hash = await bcrypt.hash('1234', 10);
    
    // Crear Negocio 100 si no existe
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, slogan, activo) VALUES (100, 'Café El Paraíso', 'El mejor café', 1)`);
    // Crear Negocio 200 si no existe
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, slogan, activo) VALUES (200, 'Parrillada Don Juan', 'Carnes al carbón', 1)`);

    // Crear usuario admin_colision en Negocio 100
    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (100, 'admin_colision', 'Admin Paraiso', ?, '1234', 'admin', 1)`,
      [hash]
    );

    // Crear usuario admin_colision en Negocio 200 con la misma contraseña y pin
    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (200, 'admin_colision', 'Admin Parrillada', ?, '1234', 'admin', 1)`,
      [hash]
    );

    // 2. Intentar login genérico sin especificar negocio
    const res = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'admin_colision',
        password: '1234'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.requiere_seleccion_negocio, true);
    assert.ok(Array.isArray(res.data.comercios));
    assert.strictEqual(res.data.comercios.length, 2);

    const negIds = res.data.comercios.map(c => c.negocio_id);
    assert.ok(negIds.includes(100));
    assert.ok(negIds.includes(200));

    const neg100 = res.data.comercios.find(c => c.negocio_id === 100);
    assert.strictEqual(neg100.negocio_nombre, 'Café El Paraíso');
    assert.strictEqual(neg100.nombre_completo, 'Admin Paraiso');
  });

  it('T52.2: Permite login directo especificando negocio_id (ej: URL o enlace directo)', async () => {
    const hash = await bcrypt.hash('1234', 10);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (100, 'Café El Paraíso', 1)`);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (200, 'Parrillada Don Juan', 1)`);

    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (100, 'admin_colision_2', 'Admin Paraiso', ?, '1234', 'admin', 1)`,
      [hash]
    );
    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (200, 'admin_colision_2', 'Admin Parrillada', ?, '1234', 'admin', 1)`,
      [hash]
    );

    // Login enviando negocio_id: 200
    const res = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'admin_colision_2',
        password: '1234',
        negocio_id: 200
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.usuario.negocio_id, 200);
    assert.strictEqual(res.data.negocio.id, 200);
    assert.strictEqual(res.data.negocio.nombre, 'Parrillada Don Juan');
    assert.strictEqual(res.data.usuario.nombre, 'Admin Parrillada');
  });

  it('T52.3: Permite login seleccionando usuario_id puntual (desde el modal de desambiguación)', async () => {
    const hash = await bcrypt.hash('1234', 10);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (100, 'Café El Paraíso', 1)`);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (200, 'Parrillada Don Juan', 1)`);

    const r1 = await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (100, 'admin_colision_3', 'Admin Paraiso', ?, '1234', 'admin', 1)`,
      [hash]
    );
    const r2 = await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (200, 'admin_colision_3', 'Admin Parrillada', ?, '1234', 'admin', 1)`,
      [hash]
    );

    // Login enviando usuario_id del primer negocio
    const res = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'admin_colision_3',
        password: '1234',
        usuario_id: r1.lastID
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.usuario.id, r1.lastID);
    assert.strictEqual(res.data.usuario.negocio_id, 100);
    assert.strictEqual(res.data.negocio.nombre, 'Café El Paraíso');
  });

  it('T52.4: Rechaza con 401 si la contraseña es incorrecta (no revela comercios a atacantes)', async () => {
    const hash = await bcrypt.hash('1234', 10);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (100, 'Café El Paraíso', 1)`);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (200, 'Parrillada Don Juan', 1)`);

    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (100, 'admin_colision_4', 'Admin Paraiso', ?, '1234', 'admin', 1)`,
      [hash]
    );
    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (200, 'admin_colision_4', 'Admin Parrillada', ?, '1234', 'admin', 1)`,
      [hash]
    );

    // Contraseña errónea
    const res = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'admin_colision_4',
        password: 'clave_incorrecta_999'
      }
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.requiere_seleccion_negocio, undefined);
  });

  it('T52.5: Ingresa directamente sin modal si el usuario pertenece a un solo negocio', async () => {
    const hash = await bcrypt.hash('secreto123', 10);
    await server.dbRun(`INSERT OR IGNORE INTO Negocios (id, nombre, activo) VALUES (100, 'Café El Paraíso', 1)`);

    await server.dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, pin, rol, activo)
       VALUES (100, 'usuario_sin_colision', 'Roberto Único', ?, '5555', 'cajero', 1)`,
      [hash]
    );

    const res = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'usuario_sin_colision',
        password: 'secreto123'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.usuario.negocio_id, 100);
    assert.strictEqual(res.data.requiere_seleccion_negocio, undefined);
  });
});
