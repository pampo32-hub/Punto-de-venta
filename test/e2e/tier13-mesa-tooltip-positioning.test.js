const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 13: Posicionamiento Inteligente y Scroll del Tooltip en Mesas Superiores (2026)', () => {
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

  it('T13.1: CSS contiene max-height y overflow-y: auto para permitir scroll fino en comandas con muchos productos', () => {
    const cssContent = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

    assert.ok(cssContent.includes('.mesa-tooltip-list'), 'styles.css debe incluir .mesa-tooltip-list');
    assert.match(cssContent, /max-height:\s*180px/, 'Debe limitar la altura a 180px');
    assert.match(cssContent, /overflow-y:\s*auto/, 'Debe permitir scroll vertical');
    assert.ok(cssContent.includes('.mesa-tooltip-list::-webkit-scrollbar'), 'Debe definir scrollbar personalizado');
    assert.match(cssContent, /pointer-events:\s*auto/, 'Debe permitir interacción del mouse para hacer scroll');
  });

  it('T13.2: app.js implementa el umbral ampliado de 250px y detección dinámica de espacio hacia arriba', () => {
    const appJsContent = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

    assert.ok(appJsContent.includes('const isNearTop = (m.y || 0) < 250;'), 'Debe usar 250px como umbral inicial');
    assert.ok(appJsContent.includes('espacioArriba < 240'), 'Debe detectar dinámicamente si hay menos de 240px arriba');
    assert.ok(appJsContent.includes('tip.classList.add(\'tooltip-bottom\')'), 'Debe añadir tooltip-bottom dinámicamente');
    assert.ok(appJsContent.includes('e.relatedTarget && tip && (tip === e.relatedTarget || tip.contains(e.relatedTarget))'), 'Debe mantener el tooltip abierto al pasar el mouse sobre él');
  });

  it('T13.3: Mesa superior con más de 6 consumos se guarda y entrega todos los ítems listados', async () => {
    // Mesa 1 suele ubicarse en la parte superior del salón
    const itemsComanda = [
      { id: 1, nombre: 'Imperial Regular', precio: 2000, cantidad: 2, destino: 'barra' },
      { id: 2, nombre: 'Pilsen', precio: 2000, cantidad: 2, destino: 'barra' },
      { id: 3, nombre: 'Bavaria Gold', precio: 2500, cantidad: 1, destino: 'barra' },
      { id: 8, nombre: 'Chifrijo', precio: 5500, cantidad: 2, destino: 'cocina' },
      { id: 9, nombre: 'Alitas BBQ', precio: 4500, cantidad: 1, destino: 'cocina' },
      { id: 10, nombre: 'Ceviche Mixto', precio: 6000, cantidad: 1, destino: 'cocina' },
      { id: 11, nombre: 'Patacones con Frijoles', precio: 3500, cantidad: 1, destino: 'cocina' }
    ];

    const resCmd = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Carlos Solano',
      items: itemsComanda
    });
    assert.equal(resCmd.status, 200);

    const resMesas = await req('/api/mesas');
    const mesa1 = resMesas.body.mesas.find(m => m.id === 1);
    assert.ok(mesa1, 'Mesa 1 debe existir');
    assert.equal(mesa1.orden_mesero, 'Carlos Solano');
    assert.ok(mesa1.todos_platillos.length >= 7, 'Debe registrar todos los consumos en la mesa');
  });
});
