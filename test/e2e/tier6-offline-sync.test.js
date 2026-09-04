const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 6: Offline-First Resilience, Batch Sync & Idempotency', () => {
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

  function req(endpoint, method = 'GET', body = null) {
    return server.request(endpoint, { method, body }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T6.1: GET /api/ping responds with status 200 and timestamp', async () => {
    const res = await req('/api/ping');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.timestamp === 'number');
  });

  it('T6.2: POST /api/comandas/enviar respects idempotencyKey on retry', async () => {
    const idKey = 'test-uuid-comanda-1001';

    // First attempt
    const res1 = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      mesero: 'Carlos Salonero',
      idempotencyKey: idKey,
      items: [
        { id: 1, nombre: 'Imperial', precio: 1800, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(res1.status, 200);
    assert.ok(res1.body.ordenId);

    // Second attempt with exact same idempotencyKey (simulating reconnect network retry)
    const res2 = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      mesero: 'Carlos Salonero',
      idempotencyKey: idKey,
      items: [
        { id: 1, nombre: 'Imperial', precio: 1800, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(res2.status, 200);
    assert.ok(res2.body.message.includes('idempotente'));

    // Verify order was NOT duplicated.
    // 2 Imperials with 2x1 promo = 1 charged (1800) + 10% serv (180) + 13% iva (234) = 2214
    const mesas = (await req('/api/mesas')).body.mesas;
    const mesa2 = mesas.find(m => m.id === 2);
    assert.equal(mesa2.orden_total, 2214);
  });

  it('T6.3: POST /api/sync/batch processes pending queued offline actions and filters duplicates', async () => {
    const key1 = 'batch-key-mesa-3';
    const key2 = 'batch-key-mesa-4';

    const batchPayload = {
      acciones: [
        {
          id: 101,
          idempotencyKey: key1,
          tipo: 'ENVIAR_COMANDA',
          endpoint: '/api/comandas/enviar',
          payload: {
            mesaId: 3,
            mesero: 'Juan Jival',
            items: [
              { id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina' }
            ]
          }
        },
        {
          id: 102,
          idempotencyKey: key2,
          tipo: 'ENVIAR_COMANDA',
          endpoint: '/api/comandas/enviar',
          payload: {
            mesaId: 4,
            mesero: 'Juan Jival',
            items: [
              { id: 2, nombre: 'Pilsen', precio: 1800, cantidad: 2, destino: 'barra' }
            ]
          }
        }
      ]
    };

    // First batch run
    const syncRes1 = await req('/api/sync/batch', 'POST', batchPayload);
    assert.equal(syncRes1.status, 200);
    assert.equal(syncRes1.body.ok, true);
    assert.equal(syncRes1.body.procesadas.length, 2);
    assert.equal(syncRes1.body.duplicadas.length, 0);

    // Verify tables are occupied with orders
    const mesas = (await req('/api/mesas')).body.mesas;
    const m3 = mesas.find(m => m.id === 3);
    const m4 = mesas.find(m => m.id === 4);
    assert.equal(m3.estado, 'esperando');
    assert.equal(m4.estado, 'abierta');

    // Second batch run with same items (simulating reconnect retry)
    const syncRes2 = await req('/api/sync/batch', 'POST', batchPayload);
    assert.equal(syncRes2.status, 200);
    assert.equal(syncRes2.body.ok, true);
    assert.equal(syncRes2.body.procesadas.length, 0);
    assert.equal(syncRes2.body.duplicadas.length, 2);
  });

  it('T6.4: POST /api/sync/batch handles customer bill request PEDIR_CUENTA', async () => {
    // Open table 5
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 5,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
    });

    const syncRes = await req('/api/sync/batch', 'POST', {
      acciones: [
        {
          id: 201,
          idempotencyKey: 'bill-req-mesa-5',
          tipo: 'PEDIR_CUENTA',
          endpoint: '/api/cliente/mesa/5/pedir-cuenta',
          payload: { mesaId: 5 }
        }
      ]
    });

    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.body.procesadas.length, 1);

    const m5 = (await req('/api/mesas')).body.mesas.find(m => m.id === 5);
    assert.equal(m5.estado, 'cuenta');
    assert.equal(m5.pidio_cuenta_qr, 1);
  });
});
