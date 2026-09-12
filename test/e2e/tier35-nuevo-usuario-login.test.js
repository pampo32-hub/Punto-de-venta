const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 35: Autenticación de nuevos usuarios creados por Admin y Dev', () => {
  let server;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.stop();
  });

  function req(endpoint, method = 'GET', body = null, headers = { 'x-user-rol': 'admin' }) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T35.1: Nuevo empleado creado por Admin puede iniciar sesión con username exacto, mayúsculas, PIN y Nombre Completo', async () => {
    const testUser = 'empleado_test_' + Date.now();
    const testPass = 'claveSecreta2026';
    const testPin = '7890';
    const testNombre = 'Juan Perez Empleado';
    const deviceToken = 'dev_term_' + Date.now();

    const resCrear = await req('/api/admin/empleados', 'POST', {
      negocio_id: 1,
      usuario: testUser,
      nombre_completo: testNombre,
      password: testPass,
      pin: testPin,
      rol: 'salonero',
      genero: 'M'
    }, { 'x-user-rol': 'developer' });

    assert.equal(resCrear.status, 200, 'Crear empleado debe responder 200');

    // 1. Login con username exacto
    const login1 = await req('/api/auth/login', 'POST', {
      usuario: testUser,
      password: testPass,
      deviceToken
    });
    assert.equal(login1.status, 200, 'Login con username exacto');
    assert.equal(login1.body.ok, true);

    // 2. Login con username en MAYÚSCULAS (mismo dispositivo)
    const login2 = await req('/api/auth/login', 'POST', {
      usuario: testUser.toUpperCase(),
      password: testPass,
      deviceToken
    });
    assert.equal(login2.status, 200, 'Login con username en MAYÚSCULAS');
    assert.equal(login2.body.ok, true);

    // 3. Login con PIN directo (mismo dispositivo)
    const login3 = await req('/api/auth/login', 'POST', {
      pin: testPin,
      deviceToken
    });
    assert.equal(login3.status, 200, 'Login con PIN');
    assert.equal(login3.body.ok, true);

    // 4. Login con Nombre Completo (mismo dispositivo)
    const login4 = await req('/api/auth/login', 'POST', {
      usuario: testNombre,
      password: testPass,
      deviceToken
    });
    assert.equal(login4.status, 200, 'Login con Nombre Completo');
    assert.equal(login4.body.ok, true);

    // 5. Debe aparecer en usuarios públicos
    const resPub = await req('/api/auth/usuarios-publicos', 'GET');
    assert.equal(resPub.status, 200);
    const encontrado = resPub.body.some(u => u.usuario.toLowerCase() === testUser.toLowerCase());
    assert.equal(encontrado, true, 'Debe listarse en usuarios públicos');
  });

  it('T35.2: Nuevo usuario creado por Developer Console puede iniciar sesión inmediatamente', async () => {
    const devUser = 'dev_operario_' + Date.now();
    const devPass = 'miPass2026';
    const devPin = '3344';

    const resCrearDev = await req('/api/dev/usuarios', 'POST', {
      negocio_id: 1,
      usuario: devUser,
      nombre_completo: 'Operario Especial',
      password: devPass,
      pin: devPin,
      rol: 'cajero',
      genero: 'M'
    }, { 'x-user-rol': 'developer' });

    assert.equal(resCrearDev.status, 200);

    const login = await req('/api/auth/login', 'POST', {
      usuario: devUser,
      password: devPass
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.ok, true);
    assert.equal(login.body.usuario.rol, 'cajero');
  });
});

