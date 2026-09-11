const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 49: Dispositivos Autorizados (Device Whitelisting) & Sesión Única Activa', () => {
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

  it('T49.1: Cuando restringir_dispositivos está ACTIVO, login de salonero desde equipo no registrado recibe 403 Forbidden', async () => {
    // 1. Activar restricción de dispositivos en el negocio
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_dispositivos: true,
        restringir_ip_operativos: false,
        pinAdmin: '1234'
      }
    });

    // 2. Intentar login de salonero desde dispositivo desconocido
    const loginDispDesconocido = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-device-token': 'token_desconocido_cliente_123'
      },
      body: {
        usuario: 'carlos',
        password: 'mesero123',
        deviceToken: 'token_desconocido_cliente_123'
      }
    });

    assert.strictEqual(loginDispDesconocido.status, 403);
    assert.strictEqual(loginDispDesconocido.data.dispositivo_no_autorizado, true);
    assert.ok(loginDispDesconocido.data.error.toLowerCase().includes('dispositivo') || loginDispDesconocido.data.error.toLowerCase().includes('terminal'));
  });

  it('T49.2: Autorizar dispositivo permite login exitoso 200 OK del personal operativo', async () => {
    // 1. Activar restricción de dispositivos
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_dispositivos: true,
        pinAdmin: '1234'
      }
    });

    // 2. Autorizar dispositivo "Tablet Salón 1" con PIN admin
    const autRes = await server.request('/api/admin/dispositivos/autorizar', {
      method: 'POST',
      body: {
        device_token: 'tablet_oficial_salon_001',
        nombre_dispositivo: 'Tablet Salón 1',
        tipo_dispositivo: 'tablet',
        pinAdmin: '1234'
      }
    });

    assert.strictEqual(autRes.status, 200);
    assert.strictEqual(autRes.data.ok, true);

    // 3. Login de salonero desde el dispositivo autorizado
    const loginExitoso = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-device-token': 'tablet_oficial_salon_001'
      },
      body: {
        usuario: 'carlos',
        password: 'mesero123',
        deviceToken: 'tablet_oficial_salon_001'
      }
    });

    assert.strictEqual(loginExitoso.status, 200);
    assert.strictEqual(loginExitoso.data.ok, true);
    assert.strictEqual(loginExitoso.data.usuario.rol, 'salonero');
  });

  it('T49.3: Listar y Revocar dispositivo vuelve a bloquear el acceso en esa terminal', async () => {
    // 1. Activar restricción y autorizar dispositivo
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_dispositivos: true,
        pinAdmin: '1234'
      }
    });

    await server.request('/api/admin/dispositivos/autorizar', {
      method: 'POST',
      body: {
        device_token: 'pc_barra_temp_99',
        nombre_dispositivo: 'PC Barra Temporal',
        tipo_dispositivo: 'pc',
        pinAdmin: '1234'
      }
    });

    // 2. Listar dispositivos autorizados
    const listRes = await server.request('/api/admin/dispositivos', { method: 'GET' });
    assert.strictEqual(listRes.status, 200);
    const disp = listRes.data.dispositivos.find(d => d.device_token === 'pc_barra_temp_99');
    assert.ok(disp);

    // 3. Revocar dispositivo
    const delRes = await server.request(`/api/admin/dispositivos/${disp.id}`, {
      method: 'DELETE',
      body: { pinAdmin: '1234' }
    });
    assert.strictEqual(delRes.status, 200);

    // 4. Intentar login de salonero desde el dispositivo revocado -> debe dar 403
    const loginRevocado = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-device-token': 'pc_barra_temp_99'
      },
      body: {
        usuario: 'carlos',
        password: 'mesero123'
      }
    });

    assert.strictEqual(loginRevocado.status, 403);
    assert.strictEqual(loginRevocado.data.dispositivo_no_autorizado, true);
  });

  it('T49.4: Admin, Superadmin y Developer acceden desde dispositivos no registrados (Bypass Total)', async () => {
    // 1. Activar restricción de dispositivos
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_dispositivos: true,
        pinAdmin: '1234'
      }
    });

    // 2. Login de Administrador desde dispositivo no registrado
    const loginAdmin = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-device-token': 'celular_personal_admin_no_registrado'
      },
      body: {
        usuario: 'admin',
        password: 'admin123'
      }
    });

    assert.strictEqual(loginAdmin.status, 200);
    assert.strictEqual(loginAdmin.data.ok, true);
    assert.strictEqual(loginAdmin.data.usuario.rol, 'admin');

    // 3. Login de Developer desde dispositivo no registrado
    const loginDev = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-device-token': 'laptop_remota_dev'
      },
      body: {
        usuario: 'dev',
        password: 'dev123'
      }
    });

    assert.strictEqual(loginDev.status, 200);
    assert.strictEqual(loginDev.data.ok, true);
    assert.strictEqual(loginDev.data.usuario.rol, 'developer');
  });

  it('T49.5: Sesión Única Activa genera y actualiza session_id único en cada login', async () => {
    // 1. Primer login de salonero
    const login1 = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'carlos',
        password: 'mesero123'
      }
    });

    assert.strictEqual(login1.status, 200);
    const session1 = login1.data.session_id;
    assert.ok(session1);

    // 2. Verificar en BD que el usuario tiene session1
    const userDb1 = await server.dbGet('SELECT ultimo_token_sesion FROM Usuarios WHERE usuario = "carlos"');
    assert.strictEqual(userDb1.ultimo_token_sesion, session1);

    // 3. Segundo login de salonero (en otro dispositivo)
    const login2 = await server.request('/api/auth/login', {
      method: 'POST',
      body: {
        usuario: 'carlos',
        password: 'mesero123'
      }
    });

    assert.strictEqual(login2.status, 200);
    const session2 = login2.data.session_id;
    assert.ok(session2);
    assert.notStrictEqual(session1, session2);

    // 4. Verificar en BD que la sesión se actualizó a session2
    const userDb2 = await server.dbGet('SELECT ultimo_token_sesion FROM Usuarios WHERE usuario = "carlos"');
    assert.strictEqual(userDb2.ultimo_token_sesion, session2);
  });
});
