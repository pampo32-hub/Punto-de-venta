const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 48: Restricción de Acceso por IP de Red del Bar & Bypass Admin', () => {
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

  it('T48.1: GET /api/ip-actual detecta y devuelve la IP pública/cliente', async () => {
    const res = await server.request('/api/ip-actual', {
      method: 'GET',
      headers: {
        'x-forwarded-for': '201.200.45.88'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ip, '201.200.45.88');
  });

  it('T48.2: GET y PUT /api/admin/seguridad-red permite configurar IP del bar', async () => {
    // 1. Obtener estado inicial
    const getRes = await server.request('/api/admin/seguridad-red', {
      method: 'GET'
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.restringir_ip_operativos, false);

    // 2. Intentar actualizar sin PIN admin o PIN incorrecto (retorna 403)
    const putSinPin = await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_ip_operativos: true,
        ips_permitidas: '201.200.50.10',
        pinAdmin: '9988'
      }
    });
    assert.strictEqual(putSinPin.status, 403);

    // 3. Actualizar con PIN admin correcto (1234)
    const putConPin = await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_ip_operativos: true,
        ips_permitidas: '201.200.50.10\n186.15.20.30',
        pinAdmin: '1234'
      }
    });
    assert.strictEqual(putConPin.status, 200);
    assert.strictEqual(putConPin.data.ok, true);
    assert.strictEqual(putConPin.data.restringir_ip_operativos, true);

    // 4. Verificar persistencia
    const getActualizado = await server.request('/api/admin/seguridad-red', {
      method: 'GET'
    });
    assert.strictEqual(getActualizado.status, 200);
    assert.strictEqual(getActualizado.data.restringir_ip_operativos, true);
    assert.ok(getActualizado.data.ips_permitidas.includes('201.200.50.10'));
  });

  it('T48.3: Cuando la restricción está ACTIVA, personal operativo desde IP no autorizada recibe 403 Forbidden', async () => {
    // 1. Configurar restricción activa para IP del bar 201.200.50.10
    const putRes = await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_ip_operativos: true,
        ips_permitidas: '201.200.50.10',
        pinAdmin: '1234'
      }
    });
    assert.strictEqual(putRes.status, 200);

    // 2. Intentar login de salonero (carlos) desde IP remota no autorizada (198.51.100.99)
    const loginSaloneroCasa = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '198.51.100.99'
      },
      body: {
        usuario: 'carlos',
        password: 'mesero123'
      }
    });

    assert.strictEqual(loginSaloneroCasa.status, 403);
    assert.ok(loginSaloneroCasa.data.error.toLowerCase().includes('red') || loginSaloneroCasa.data.error.toLowerCase().includes('ip') || loginSaloneroCasa.data.error.toLowerCase().includes('wifi'));
  });

  it('T48.4: Cuando la restricción está ACTIVA, personal operativo desde la IP del bar ingresa con éxito 200 OK', async () => {
    // 1. Configurar restricción activa para IP del bar 201.200.50.10
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_ip_operativos: true,
        ips_permitidas: '201.200.50.10, 192.168.1.1',
        pinAdmin: '1234'
      }
    });

    // 2. Login de salonero desde IP autorizada 201.200.50.10
    const loginSaloneroBar = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '201.200.50.10'
      },
      body: {
        usuario: 'carlos',
        password: 'mesero123'
      }
    });

    assert.strictEqual(loginSaloneroBar.status, 200);
    assert.strictEqual(loginSaloneroBar.data.ok, true);
    assert.strictEqual(loginSaloneroBar.data.usuario.rol, 'salonero');
  });

  it('T48.5: Admin, Superadmin y Developer acceden remotamente desde cualquier IP (Bypass 24/7)', async () => {
    // 1. Configurar restricción activa para IP del bar 201.200.50.10
    await server.request('/api/admin/seguridad-red', {
      method: 'PUT',
      body: {
        restringir_ip_operativos: true,
        ips_permitidas: '201.200.50.10',
        pinAdmin: '1234'
      }
    });

    // 2. Login de Administrador desde IP remota de casa (198.51.100.99)
    const loginAdminRemoto = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '198.51.100.99'
      },
      body: {
        usuario: 'admin',
        password: 'admin123'
      }
    });

    assert.strictEqual(loginAdminRemoto.status, 200);
    assert.strictEqual(loginAdminRemoto.data.ok, true);
    assert.strictEqual(loginAdminRemoto.data.usuario.rol, 'admin');

    // 3. Login de Developer desde IP remota
    const loginDevRemoto = await server.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.44'
      },
      body: {
        usuario: 'dev',
        password: 'dev123'
      }
    });

    assert.strictEqual(loginDevRemoto.status, 200);
    assert.strictEqual(loginDevRemoto.data.ok, true);
    assert.strictEqual(loginDevRemoto.data.usuario.rol, 'developer');
  });
});
