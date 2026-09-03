const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 5: Table Split with Occupied Source Table & Alternative Table Restoration', () => {
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

  it('T5.1: If original source table is free, split works directly and restores both tables', async () => {
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 8,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra', notas: 'Fria' }]
    });
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 9,
      items: [{ id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina', notas: 'Termino medio' }]
    });

    const mBefore = (await req('/api/mesas')).body.mesas;
    const m8Before = mBefore.find(m => m.id === 8);
    const m9Before = mBefore.find(m => m.id === 9);

    const mergeRes = await req('/api/mesas/unir', 'POST', { mesaPrincipalId: 9, mesaSecundariaId: 8 });
    assert.equal(mergeRes.status, 200);

    const mMerged = (await req('/api/mesas')).body.mesas;
    const m8Merged = mMerged.find(m => m.id === 8);
    assert.equal(m8Merged.estado, 'libre');

    const sepRes = await req('/api/mesas/separar', 'POST', { mesaId: 9 });
    assert.equal(sepRes.status, 200);
    assert.ok(!sepRes.body.requiereDestino);

    const mAfter = (await req('/api/mesas')).body.mesas;
    const m8After = mAfter.find(m => m.id === 8);
    const m9After = mAfter.find(m => m.id === 9);

    assert.equal(m8After.orden_total, m8Before.orden_total);
    assert.equal(m9After.orden_total, m9Before.orden_total);
  });

  it('T5.2: If original source table is occupied, prompt/flag requires alternative destination table', async () => {
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 10,
      items: [{ id: 2, nombre: 'Pilsen', precio: 1800, cantidad: 2, destino: 'barra', notas: 'Con sal' }]
    });
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 11,
      items: [{ id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina', notas: 'Bien cocido' }]
    });

    await req('/api/mesas/unir', 'POST', { mesaPrincipalId: 11, mesaSecundariaId: 10 });

    await req('/api/comandas/enviar', 'POST', {
      mesaId: 10,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra', notas: 'Cliente nuevo' }]
    });

    const m10Ocupada = (await req('/api/mesas')).body.mesas.find(m => m.id === 10);
    assert.notEqual(m10Ocupada.estado, 'libre');

    const checkRes = await req('/api/mesas/separar', 'POST', { mesaId: 11 });
    assert.equal(checkRes.status, 200);
    assert.equal(checkRes.body.requiereDestino, true);
    assert.equal(checkRes.body.mesaOriginalOcupada, true);
    assert.match(checkRes.body.message, /ocupada|currently occupied/i);
  });

  it('T5.3: Restoring into an available table (e.g. Mesa 7) restores all snapshot data exactly and restores Mesa 6 to pre-merge state', async () => {
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 5,
      items: [{ id: 2, nombre: 'Pilsen', precio: 1800, cantidad: 2, destino: 'barra', notas: 'Con sal' }]
    });
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 6,
      items: [{ id: 11, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, destino: 'cocina', notas: 'Termino 3/4' }]
    });

    const m5Before = (await req('/api/mesas')).body.mesas.find(m => m.id === 5);
    const m6Before = (await req('/api/mesas')).body.mesas.find(m => m.id === 6);

    await req('/api/mesas/unir', 'POST', { mesaPrincipalId: 6, mesaSecundariaId: 5 });

    await req('/api/comandas/enviar', 'POST', {
      mesaId: 5,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 3, destino: 'barra', notas: 'Nuevos clientes' }]
    });

    const m5Ocupada = (await req('/api/mesas')).body.mesas.find(m => m.id === 5);
    assert.notEqual(m5Ocupada.estado, 'libre');

    const restoreRes = await req('/api/mesas/separar', 'POST', { mesaId: 6, destinoMesaId: 7 });
    assert.equal(restoreRes.status, 200);

    const mAfter = (await req('/api/mesas')).body.mesas;
    const m5After = mAfter.find(m => m.id === 5);
    const m6After = mAfter.find(m => m.id === 6);
    const m7After = mAfter.find(m => m.id === 7);

    assert.notEqual(m5After.estado, 'libre');
    assert.equal(m6After.orden_total, m6Before.orden_total);
    assert.equal(m7After.orden_total, m5Before.orden_total);

    const ord7 = await req('/api/ordenes/mesa/7');
    assert.ok(ord7.body.items.some(it => it.nombre_producto === 'Pilsen' && it.notas === 'Con sal'));
  });

  it('T5.4: Rejects destination table if selected destination table is also occupied', async () => {
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
    });
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
    });
    await req('/api/mesas/unir', 'POST', { mesaPrincipalId: 2, mesaSecundariaId: 1 });

    await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
    });

    await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      items: [{ id: 1, nombre: 'Imperial', precio: 1800, cantidad: 1, destino: 'barra' }]
    });

    const failRes = await req('/api/mesas/separar', 'POST', { mesaId: 2, destinoMesaId: 3 });
    assert.equal(failRes.status, 400);
    assert.match(failRes.body.error, /ocupada/i);
  });
});
