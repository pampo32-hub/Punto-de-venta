const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

describe('Tier 31: Auditoría de Cierres Forzados con Saldo Pendiente (General para todos)', () => {
  let serverInstance;
  let baseUrl;

  const req = (endpoint, method = 'GET', body = null, headers = {}) => {
    return new Promise((resolve, reject) => {
      const u = new URL(endpoint, baseUrl);
      const opt = {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-negocio-id': '1',
          ...headers
        }
      };
      const r = http.request(opt, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const data = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode, data, headers: res.headers, raw });
          } catch (e) {
            resolve({ status: res.statusCode, data: raw, headers: res.headers, raw });
          }
        });
      });
      r.on('error', reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  };

  before(async () => {
    delete require.cache[require.resolve('../../server.js')];
    delete require.cache[require.resolve('../../database.js')];
    const { server } = require('../../server.js');
    serverInstance = server;
    await new Promise((resolve) => {
      if (serverInstance.listening) {
        const addr = serverInstance.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        serverInstance.listen(0, '127.0.0.1', () => {
          const addr = serverInstance.address();
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }
    });
  });

  after(async () => {
    if (serverInstance && serverInstance.close) {
      await new Promise(r => serverInstance.close(r));
    }
  });

  it('T31.1: Liberar mesa con saldo pendiente registra evento en Auditoría con negocioId correcto', async () => {
    // 1. Crear comanda con saldo en mesa de GastroBar (Negocio 1)
    const comandaRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Mesero Test',
      items: [
        { id: 1, nombre: 'Hamburguesa', precio: 5000, cantidad: 2, destino: 'cocina' }
      ]
    }, { 'x-negocio-id': '1' });
    assert.strictEqual(comandaRes.status, 200);

    // 2. Liberar mesa con saldo
    const liberarRes = await req('/api/mesas/1/liberar', 'POST', {
      usuarioNombre: 'Admin General',
      pinAutorizado: '1234',
      motivo: 'Cliente se fue sin pagar'
    }, { 
      'x-negocio-id': '1',
      'x-user-rol': 'admin',
      'x-supervisor-pin': '1234'
    });
    assert.strictEqual(liberarRes.status, 200);
    assert(liberarRes.data.saldoAnulado > 0, 'Debe haber saldo anulado');

    // 3. Consultar Auditoría para verificar el registro
    const auditRes = await req('/api/admin/auditoria?negocio_id=1&limite=5', 'GET', null, { 
      'x-user-rol': 'admin', 
      'x-negocio-id': '1' 
    });
    assert.strictEqual(auditRes.status, 200);
    const eventos = Array.isArray(auditRes.data) ? auditRes.data : [];
    const eventoCierre = eventos.find(ev => ev.accion === 'cierre_forzado_cuenta' || ev.accion === 'liberacion_forzada_mesa');
    assert(eventoCierre, 'Debe existir un evento de cierre forzado en auditoría');
    assert.strictEqual(Number(eventoCierre.negocio_id), 1);
    assert(eventoCierre.monto > 0, 'El monto en auditoría debe ser mayor a 0');
    assert(eventoCierre.detalle.includes('Mesa') || eventoCierre.detalle.includes('mesa'), 'El detalle debe mencionar la mesa');
  });

  it('T31.2: Reset forzado de mesa con saldo activo en Sandbox (Negocio 2) registra evento en Auditoría', async () => {
    // 1. Obtener mesas del negocio 2
    const mesasRes = await req('/api/mesas?negocio_id=2', 'GET', null, { 'x-negocio-id': '2' });
    assert.strictEqual(mesasRes.status, 200);
    const mesa2 = (mesasRes.data.mesas || mesasRes.data || []).find(m => Number(m.negocio_id) === 2) || { id: 101, numero: 'Mesa 1' };

    // 2. Crear comanda en negocio 2
    await req('/api/comandas/enviar', 'POST', {
      mesaId: mesa2.id,
      mesero: 'Sandbox Tester',
      items: [
        { id: 1, nombre: 'Pizza Test', precio: 8000, cantidad: 1, destino: 'cocina' }
      ]
    }, { 'x-negocio-id': '2' });

    // 3. Resetear mesa (Reset forzado)
    const resetRes = await req(`/api/mesas/${mesa2.id}/reset`, 'POST', {
      usuarioNombre: 'Admin Sandbox'
    }, { 
      'x-negocio-id': '2',
      'x-user-rol': 'admin'
    });
    assert.strictEqual(resetRes.status, 200);

    // 4. Consultar Auditoría para negocio 2
    const auditRes2 = await req('/api/admin/auditoria?negocio_id=2&limite=5', 'GET', null, { 
      'x-user-rol': 'admin', 
      'x-negocio-id': '2' 
    });
    assert.strictEqual(auditRes2.status, 200);
    const eventos2 = Array.isArray(auditRes2.data) ? auditRes2.data : [];
    const eventoReset = eventos2.find(ev => ev.accion === 'cierre_forzado_cuenta');
    assert(eventoReset, 'Debe existir un evento de cierre forzado por reset en auditoría');
    assert.strictEqual(Number(eventoReset.negocio_id), 2, 'Debe pertenecer a negocio 2');
    assert(eventoReset.monto > 0, 'El monto anulado debe registrarse');
  });
});
