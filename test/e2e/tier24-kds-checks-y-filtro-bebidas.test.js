const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 24: KDS Cocina - Exclusión de Bebidas y Selección con Checkboxes', () => {
  let server;
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.stop();
  });

  beforeEach(async () => {
    await server.resetDb();
  });

  it('T24.1: Comanda mixta envía a Cocina únicamente alimentos y excluye bebidas', async () => {
    const mesa = await server.dbGet('SELECT id FROM Mesas LIMIT 1');
    const mesaId = mesa.id;

    // Enviar comanda con 1 Casado (comida) y 2 Cervezas (bebida)
    const resComanda = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId,
        mesero: 'Cocinero Test',
        items: [
          { id: 67, nombre: 'Casado con pescado frito', precio: 4500, cantidad: 1, destino: 'cocina', curso: 3 },
          { id: 78, nombre: 'Imperial Light', precio: 1500, cantidad: 2, destino: 'barra', curso: 1 }
        ]
      }
    });
    assert.equal(resComanda.status, 200);

    // Consultar KDS de Cocina
    const resKdsCocina = await server.request('/api/kds?destino=cocina');
    assert.equal(resKdsCocina.status, 200);
    const itemsCocina = resKdsCocina.data;

    // Debe contener únicamente el Casado y NO la Imperial Light
    assert.equal(itemsCocina.length, 1);
    assert.equal(itemsCocina[0].nombre_producto, 'Casado con pescado frito');
    assert.equal(itemsCocina[0].destino, 'cocina');
  });

  it('T24.2: Comanda exclusiva de bebidas no crea comandas en cocina y deja mesa en estado abierta', async () => {
    const mesa = await server.dbGet('SELECT id FROM Mesas LIMIT 1');
    const mesaId = mesa.id;

    // Enviar comanda solo con cervezas y refrescos
    const resComanda = await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId,
        mesero: 'Mesero Test',
        items: [
          { id: 78, nombre: 'Imperial Light', precio: 1500, cantidad: 2, destino: 'barra', curso: 1 },
          { id: 100, nombre: 'Fresco de Cas', precio: 1200, cantidad: 1, destino: 'barra', curso: 1 }
        ]
      }
    });
    assert.equal(resComanda.status, 200);

    // Consultar KDS Cocina
    const resKdsCocina = await server.request('/api/kds?destino=cocina');
    assert.equal(resKdsCocina.status, 200);
    assert.equal(resKdsCocina.data.length, 0);

    // Mesa debe estar en estado 'abierta' (o no 'esperando' de cocina)
    const mesaActual = await server.dbGet('SELECT estado FROM Mesas WHERE id = ?', [mesaId]);
    assert.equal(mesaActual.estado, 'abierta');
  });

  it('T24.3: POST /api/kds/despachar-lote sirve platillos seleccionados y actualiza el estado', async () => {
    const mesa = await server.dbGet('SELECT id FROM Mesas LIMIT 1');
    const mesaId = mesa.id;

    // Enviar 2 platillos de comida a cocina
    await server.request('/api/comandas/enviar', {
      method: 'POST',
      body: {
        mesaId,
        mesero: 'Mesero Test',
        items: [
          { id: 67, nombre: 'Casado con pescado frito', precio: 4500, cantidad: 1, destino: 'cocina', curso: 3 },
          { id: 89, nombre: 'Vigorón costarricense', precio: 3800, cantidad: 1, destino: 'cocina', curso: 1 }
        ]
      }
    });

    const kdsAntes = await server.request('/api/kds?destino=cocina');
    assert.equal(kdsAntes.data.length, 2);
    const primerId = kdsAntes.data[0].id;
    const segundoId = kdsAntes.data[1].id;

    // Servir solo 1 platillo mediante lote
    const resDespacho1 = await server.request('/api/kds/despachar-lote', {
      method: 'POST',
      body: { itemIds: [primerId], estado: 'listo' }
    });
    assert.equal(resDespacho1.status, 200);
    assert.equal(resDespacho1.data.ok, true);
    assert.equal(resDespacho1.data.actualizados, 1);

    // KDS cocina ahora solo debe mostrar 1 platillo pendiente
    const kdsMedio = await server.request('/api/kds?destino=cocina');
    assert.equal(kdsMedio.data.length, 1);
    assert.equal(kdsMedio.data[0].id, segundoId);

    // Servir el platillo restante
    const resDespacho2 = await server.request('/api/kds/despachar-lote', {
      method: 'POST',
      body: { itemIds: [segundoId], estado: 'listo' }
    });
    assert.equal(resDespacho2.status, 200);

    // KDS cocina ahora debe estar completamente vacío
    const kdsFinal = await server.request('/api/kds?destino=cocina');
    assert.equal(kdsFinal.data.length, 0);
  });

  it('T24.4: Métodos de selección y despacho de KDS presentes en app.js', () => {
    assert.match(appJs, /toggleSeleccionarTodosKDS/);
    assert.match(appJs, /actualizarContadorSeleccionKDS/);
    assert.match(appJs, /despacharSeleccionadosKDS/);
    assert.match(appJs, /kds-item-checkbox/);
  });
});
