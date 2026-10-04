const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 51: Modificación de Nombres y Roles por Admin y Superadmin (Jerarquía Estricta)', () => {
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

  it('T51.1: Superadmin puede modificar nombres y roles de cualquier colaborador subordinado y admin', async () => {
    // 1. Crear un salonero
    const resCrear = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: {
        usuario: 'salonero_test_1',
        nombre_completo: 'Juan Pérez Salonero',
        password: 'password123',
        rol: 'salonero',
        genero: 'M',
        pin: '5555'
      }
    });
    assert.strictEqual(resCrear.status, 200);
    const empId = resCrear.data.id;

    // 2. Superadmin modifica el nombre y asciende a Admin
    const resModif = await server.request(`/api/admin/empleados/${empId}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'superadmin' },
      body: {
        nombre_completo: 'Juan Pérez Administrador',
        usuario: 'juan_admin',
        rol: 'admin',
        genero: 'M',
        pin: '9999'
      }
    });
    assert.strictEqual(resModif.status, 200);
    assert.strictEqual(resModif.data.ok, true);

    // 3. Verificar que los cambios se guardaron
    const resList = await server.request('/api/admin/empleados', {
      headers: { 'x-user-rol': 'superadmin' }
    });
    const actualizado = resList.data.find(u => u.id === empId);
    assert.ok(actualizado);
    assert.strictEqual(actualizado.nombre_completo, 'Juan Pérez Administrador');
    assert.strictEqual(actualizado.usuario, 'juan_admin');
    assert.strictEqual(actualizado.rol, 'admin');
    assert.strictEqual(actualizado.pin, '9999');
  });

  it('T51.2: Admin regular puede modificar nombre y rol de colaboradores subordinados (salonero -> cajero)', async () => {
    // 1. Crear un salonero
    const resCrear = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: {
        usuario: 'maria_salonera',
        nombre_completo: 'María Gómez',
        password: 'password123',
        rol: 'salonero',
        genero: 'F',
        pin: '1111'
      }
    });
    assert.strictEqual(resCrear.status, 200);
    const empId = resCrear.data.id;

    // 2. Admin regular modifica a María (nombre y rol a cajero)
    const resModif = await server.request(`/api/admin/empleados/${empId}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'admin' },
      body: {
        nombre_completo: 'María Gómez Cajera',
        usuario: 'maria_cajera',
        rol: 'cajero',
        genero: 'F',
        pin: '2222'
      }
    });
    assert.strictEqual(resModif.status, 200);
    assert.strictEqual(resModif.data.ok, true);

    // 3. Comprobar que se actualizó correctamente
    const resList = await server.request('/api/admin/empleados');
    const actualizado = resList.data.find(u => u.id === empId);
    assert.strictEqual(actualizado.nombre_completo, 'María Gómez Cajera');
    assert.strictEqual(actualizado.usuario, 'maria_cajera');
    assert.strictEqual(actualizado.rol, 'cajero');
    assert.strictEqual(actualizado.pin, '2222');
  });

  it('T51.3: Admin regular NO puede modificar a un Superadmin (403 Forbidden)', async () => {
    // 1. Crear un superadmin
    const resCrear = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'developer' },
      body: {
        usuario: 'dueno_restaurante',
        nombre_completo: 'Don Roberto Dueño',
        password: 'password123',
        rol: 'superadmin',
        genero: 'M',
        pin: '0000'
      }
    });
    assert.strictEqual(resCrear.status, 200);
    const superadminId = resCrear.data.id;

    // 2. Admin intenta modificar el nombre o rol del superadmin -> Debe ser rechazado 403
    const resIntento = await server.request(`/api/admin/empleados/${superadminId}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'admin' },
      body: {
        nombre_completo: 'Intento Hack Dueño',
        rol: 'salonero'
      }
    });
    assert.strictEqual(resIntento.status, 403);
    assert.match(resIntento.data.error, /no puede modificar a un Super Administrador/i);
  });

  it('T51.4: Admin regular NO puede modificar a OTRO Administrador (403 Forbidden)', async () => {
    // 1. Crear Admin 2
    const resCrear = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: {
        usuario: 'admin_segundo',
        nombre_completo: 'Carlos Administrador 2',
        password: 'password123',
        rol: 'admin',
        genero: 'M',
        pin: '3333'
      }
    });
    assert.strictEqual(resCrear.status, 200);
    const admin2Id = resCrear.data.id;

    // 2. Admin 1 intenta modificar al Admin 2 -> Debe ser rechazado 403
    const resIntento = await server.request(`/api/admin/empleados/${admin2Id}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'admin' },
      body: {
        nombre_completo: 'Carlos Modificado por Par',
        rol: 'cajero'
      }
    });
    assert.strictEqual(resIntento.status, 403);
    assert.match(resIntento.data.error, /no puede modificar a otros administradores/i);
  });

  it('T51.5: Admin regular NO puede ascender colaboradores a roles Admin o Superadmin (403 Forbidden)', async () => {
    // 1. Crear un salonero
    const resCrear = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: {
        usuario: 'salonero_aspirante',
        nombre_completo: 'Pedro Aspirante',
        password: 'password123',
        rol: 'salonero',
        genero: 'M',
        pin: '4444'
      }
    });
    const saloneroId = resCrear.data.id;

    // 2. Admin intenta ascender a Pedro a 'admin' -> Debe ser rechazado 403
    const intentoAscensoAdmin = await server.request(`/api/admin/empleados/${saloneroId}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'admin' },
      body: {
        nombre_completo: 'Pedro Jefe',
        rol: 'admin'
      }
    });
    assert.strictEqual(intentoAscensoAdmin.status, 403);
    assert.match(intentoAscensoAdmin.data.error, /solo puede asignar roles subordinados/i);

    // 3. Admin intenta ascender a Pedro a 'superadmin' -> Debe ser rechazado 403
    const intentoAscensoSuper = await server.request(`/api/admin/empleados/${saloneroId}`, {
      method: 'PUT',
      headers: { 'x-user-rol': 'admin' },
      body: {
        nombre_completo: 'Pedro Super',
        rol: 'superadmin'
      }
    });
    assert.strictEqual(intentoAscensoSuper.status, 403);
  });

  it('T51.6: Eliminación estricta: Admin no puede despedir a Superadmin ni a otro Admin; sí puede a subordinados', async () => {
    // 1. Crear Superadmin, Admin 2 y Salonero
    const rSuper = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'developer' },
      body: { usuario: 'super_boss', nombre_completo: 'El Patrón', password: '123', rol: 'superadmin' }
    });
    const rAdmin2 = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: { usuario: 'colega_admin', nombre_completo: 'Colega Admin', password: '123', rol: 'admin' }
    });
    const rSub = await server.request('/api/admin/empleados', {
      method: 'POST',
      headers: { 'x-user-rol': 'superadmin' },
      body: { usuario: 'empleado_baja', nombre_completo: 'Empleado Baja', password: '123', rol: 'salonero' }
    });

    const superId = rSuper.data.id;
    const admin2Id = rAdmin2.data.id;
    const subId = rSub.data.id;

    // 2. Admin intenta eliminar a Superadmin -> 403
    const intentoDelSuper = await server.request(`/api/admin/empleados/${superId}`, {
      method: 'DELETE',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.strictEqual(intentoDelSuper.status, 403);

    // 3. Admin intenta eliminar a otro Admin -> 403
    const intentoDelAdmin = await server.request(`/api/admin/empleados/${admin2Id}`, {
      method: 'DELETE',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.strictEqual(intentoDelAdmin.status, 403);

    // 4. Admin elimina al salonero subordinado -> 200 OK
    const delSub = await server.request(`/api/admin/empleados/${subId}`, {
      method: 'DELETE',
      headers: { 'x-user-rol': 'admin' }
    });
    assert.strictEqual(delSub.status, 200);
    assert.strictEqual(delSub.data.ok, true);
  });
});
