const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 12: Visualización del Atendiente / Creador de Cuenta en Hover de Mesa (2026)', () => {
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

  it('T12.1: Enviar comanda con salonero Carlos Solano guarda orden_mesero y mesero en base de datos', async () => {
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 2,
      mesero: 'Carlos Solano',
      items: [
        { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra' }
      ]
    });
    assert.equal(resCmd.status, 200);

    // Consultar /api/mesas
    const resMesas = await req('/api/mesas');
    assert.equal(resMesas.status, 200);

    const mesa2 = resMesas.body.mesas.find(m => m.id === 2);
    assert.ok(mesa2, 'Mesa 2 debe existir');
    assert.equal(mesa2.orden_mesero, 'Carlos Solano');
    assert.equal(mesa2.mesero, 'Carlos Solano');
  });

  it('T12.2: Enviar comanda con salonera Sofía Morales persiste y devuelve su nombre en la mesa activa', async () => {
    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 4,
      mesero: 'Sofía Morales',
      items: [
        { id: 8, nombre: 'Chifrijo', precio: 5500, cantidad: 1, destino: 'cocina' }
      ]
    });
    assert.equal(resCmd.status, 200);

    const resMesas = await req('/api/mesas');
    const mesa4 = resMesas.body.mesas.find(m => m.id === 4);
    assert.ok(mesa4);
    assert.equal(mesa4.orden_mesero, 'Sofía Morales');
  });

  it('T12.3: La interfaz pública contiene la clase CSS .mesa-tooltip-mesero y el renderizado en app.js', () => {
    const cssContent = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
    const appJsContent = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

    assert.ok(cssContent.includes('.mesa-tooltip-mesero'), 'styles.css debe incluir estilos para .mesa-tooltip-mesero');
    assert.ok(cssContent.includes('.m-tip-mesero-nom'), 'styles.css debe incluir .m-tip-mesero-nom');

    assert.ok(appJsContent.includes('mesa-tooltip-mesero'), 'app.js debe generar la estructura HTML mesa-tooltip-mesero');
    assert.ok(appJsContent.includes('👤 Atendido por:'), 'app.js debe incluir la etiqueta 👤 Atendido por:');
    assert.ok(appJsContent.includes('card.setAttribute(\'title\','), 'app.js debe actualizar el title nativo con el atendiente');
  });

  it('T12.4: Múltiples mesas abiertas muestran de forma independiente a sus respectivos saloneros', async () => {
    // Mesa 1 con Don Alberto (Admin)
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Don Alberto',
      items: [{ id: 1, nombre: 'Imperial', precio: 2000, cantidad: 1, destino: 'barra' }]
    });

    // Mesa 3 con Carlos Solano
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 3,
      mesero: 'Carlos Solano',
      items: [{ id: 8, nombre: 'Chifrijo', precio: 5500, cantidad: 1, destino: 'cocina' }]
    });

    // Mesa 5 con Sofía Morales
    await req('/api/comandas/enviar', 'POST', {
      mesaId: 5,
      mesero: 'Sofía Morales',
      items: [{ id: 2, nombre: 'Pilsen', precio: 2000, cantidad: 2, destino: 'barra' }]
    });

    const resMesas = await req('/api/mesas');
    const m1 = resMesas.body.mesas.find(m => m.id === 1);
    const m3 = resMesas.body.mesas.find(m => m.id === 3);
    const m5 = resMesas.body.mesas.find(m => m.id === 5);

    assert.equal(m1.orden_mesero, 'Don Alberto');
    assert.equal(m3.orden_mesero, 'Carlos Solano');
    assert.equal(m5.orden_mesero, 'Sofía Morales');
  });
});
