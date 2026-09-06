const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 18: Seguridad Integral: Contraseña Temporal, PIN por Mesa y Autoservicio de PIN', () => {
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

  it('T18.1: Creación de empleado operativo por Admin establece debe_cambiar_password = 1', async () => {
    const resCrear = await req('/api/admin/empleados', 'POST', {
      negocio_id: 1,
      usuario: 'mesero_nuevo',
      nombre_completo: 'Lucía Méndez',
      password: 'temp_pass_123',
      rol: 'salonero',
      genero: 'F',
      pin: '5566'
    });
    assert.equal(resCrear.status, 200);

    // Login con clave temporal
    const resLogin = await req('/api/auth/login', 'POST', {
      usuario: 'mesero_nuevo',
      password: 'temp_pass_123'
    });
    assert.equal(resLogin.status, 200);
    assert.equal(resLogin.body.ok, true);
    assert.equal(resLogin.body.debe_cambiar_password, true);
    assert.equal(resLogin.body.usuario.debe_cambiar_password, true);
  });

  it('T18.2: POST /api/auth/cambiar-password-temporal actualiza credenciales y limpia la bandera', async () => {
    // 1. Crear usuario
    await req('/api/admin/empleados', 'POST', {
      negocio_id: 1,
      usuario: 'carlos_test',
      nombre_completo: 'Carlos Test',
      password: 'temp1234Password',
      rol: 'salonero',
      genero: 'M',
      pin: '1234'
    });

    // 2. Intentar cambiar con contraseña temporal equivocada
    const rFail = await req('/api/auth/cambiar-password-temporal', 'POST', {
      usuario: 'carlos_test',
      password_actual: 'wrongPassword',
      password_nuevo: 'miNuevaClaveSegura2026',
      pin_nuevo: '7788'
    });
    assert.equal(rFail.status, 401);

    // 3. Cambiar con contraseña temporal correcta
    const rSuccess = await req('/api/auth/cambiar-password-temporal', 'POST', {
      usuario: 'carlos_test',
      password_actual: 'temp1234Password',
      password_nuevo: 'miNuevaClaveSegura2026',
      pin_nuevo: '7788'
    });
    assert.equal(rSuccess.status, 200);
    assert.equal(rSuccess.body.ok, true);

    // 4. Iniciar sesión con la nueva clave personal: debe_cambiar_password debe ser false
    const rLoginNuevo = await req('/api/auth/login', 'POST', {
      usuario: 'carlos_test',
      password: 'miNuevaClaveSegura2026'
    });
    assert.equal(rLoginNuevo.status, 200);
    assert.equal(rLoginNuevo.body.ok, true);
    assert.equal(rLoginNuevo.body.debe_cambiar_password, false);
    assert.equal(rLoginNuevo.body.usuario.pin, '7788');
  });

  it('T18.3: POST /api/auth/validar-pin-mesa valida PIN de 4 dígitos y conmuta mesero', async () => {
    // 1. Crear un salonero con PIN conocido '4321'
    await req('/api/admin/empleados', 'POST', {
      negocio_id: 1,
      usuario: 'sofia_salonera',
      nombre_completo: 'Sofía Romero',
      password: 'sofiaPass123',
      rol: 'salonero',
      genero: 'F',
      pin: '4321'
    });

    // 2. Validar con PIN correcto
    const rPinOk = await req('/api/auth/validar-pin-mesa', 'POST', {
      pin: '4321',
      negocio_id: 1
    });
    assert.equal(rPinOk.status, 200);
    assert.equal(rPinOk.body.ok, true);
    assert.equal(rPinOk.body.usuario.nombre, 'Sofía Romero');
    assert.equal(rPinOk.body.usuario.rolEtiqueta, 'Salonera');

    // 3. Validar con PIN incorrecto
    // 3. Validar con PIN incorrecto (no registrado)
    const rPinFail = await req('/api/auth/validar-pin-mesa', 'POST', {
      pin: '9999',
      pin: '0000',
      pin: '9876',
      negocio_id: 1
    });
    assert.equal(rPinFail.status, 401);
  });

  it('T18.4: POST /api/usuarios/cambiar-pin permite autoservicio de PIN validando credencial', async () => {
    // 1. Crear usuario
    const rEmp = await req('/api/admin/empleados', 'POST', {
      negocio_id: 1,
      usuario: 'roberto_caja',
      nombre_completo: 'Roberto Cajero',
      password: 'robertoPassword99',
      rol: 'cajero',
      genero: 'M',
      pin: '2222'
    });
    const usuarioId = rEmp.body.id;

    // 2. Intentar cambiar PIN con PIN actual incorrecto
    const rPinErr = await req('/api/usuarios/cambiar-pin', 'POST', {
      usuarioId,
      pin_actual: '0000',
      pin_nuevo: '8888'
    });
    assert.equal(rPinErr.status, 401);

    // 3. Cambiar PIN con PIN actual correcto
    const rPinOk = await req('/api/usuarios/cambiar-pin', 'POST', {
      usuarioId,
      pin_actual: '2222',
      pin_nuevo: '8888'
    });
    assert.equal(rPinOk.status, 200);
    assert.equal(rPinOk.body.ok, true);
    assert.equal(rPinOk.body.nuevoPin, '8888');

    // 4. Probar que el nuevo PIN '8888' funciona en /api/auth/validar-pin-mesa
    const rCheck = await req('/api/auth/validar-pin-mesa', 'POST', {
      pin: '8888',
      negocio_id: 1
    });
    assert.equal(rCheck.status, 200);
    assert.equal(rCheck.body.usuario.nombre, 'Roberto Cajero');
  });
});
