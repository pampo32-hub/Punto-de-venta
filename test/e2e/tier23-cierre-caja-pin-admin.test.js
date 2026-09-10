const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 23: Cierre Parcial (Corte X) y Cierre Z con PIN de Administrador', () => {
  let server;
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    if (server) await server.stop();
  });

  beforeEach(async () => {
    await server.resetDb();
  });

  it('T23.1: POST /api/auth/verificar-pin-admin valida PINs de administrador y rechaza incorrectos', async () => {
    // PIN correcto maestro 1234
    const res1234 = await server.request('/api/auth/verificar-pin-admin', {
      method: 'POST',
      body: { pin: '1234' }
    });
    assert.equal(res1234.status, 200);
    assert.equal(res1234.data.ok, true);

    // PIN correcto dev 9999
    const res9999 = await server.request('/api/auth/verificar-pin-admin', {
      method: 'POST',
      body: { pin: '9999' }
    });
    assert.equal(res9999.status, 200);
    assert.equal(res9999.data.ok, true);

    // PIN incorrecto 7788
    const resInvalido = await server.request('/api/auth/verificar-pin-admin', {
      method: 'POST',
      body: { pin: '7788' }
    });
    assert.equal(resInvalido.status, 401);
    assert.match(resInvalido.data.error, /PIN de Administrador/);
  });

  it('T23.2: GET /api/caja/corte-x rechaza PIN incorrecto con 401 y permite con PIN válido', async () => {
    // Abrir una caja primero
    await server.dbRun("INSERT INTO Cajas (cajero, fecha_apertura, monto_inicial, estado) VALUES ('Cajero Test', datetime('now'), 50000, 'abierta')");

    // Con PIN inválido en headers
    const resInvalido = await server.request('/api/caja/corte-x', {
      headers: { 'x-supervisor-pin': '7788' }
    });
    assert.equal(resInvalido.status, 401);
    assert.match(resInvalido.data.error, /Corte X no autorizado/);

    // Con PIN válido de Administrador
    const resValido = await server.request('/api/caja/corte-x', {
      headers: { 'x-supervisor-pin': '1234' }
    });
    assert.equal(resValido.status, 200);
    assert.equal(resValido.data.tipo, 'Corte X (Parcial)');
    assert.equal(resValido.data.fondo_inicial, 50000);
  });

  it('T23.3: POST /api/caja/cierre-z rechaza PIN incorrecto y ejecuta cierre con PIN válido', async () => {
    // Abrir una caja
    await server.dbRun("INSERT INTO Cajas (cajero, fecha_apertura, monto_inicial, estado) VALUES ('Cajero Test', datetime('now'), 50000, 'abierta')");

    // Con PIN incorrecto en body
    const resRechazado = await server.request('/api/caja/cierre-z', {
      method: 'POST',
      body: {
        efectivo_real_contado: 50000,
        notas: 'Intento con PIN invalido',
        adminPin: '7788'
      }
    });
    assert.equal(resRechazado.status, 401);
    assert.match(resRechazado.data.error, /Cierre Z no autorizado/);

    // Con PIN correcto de Administrador
    const resAprobado = await server.request('/api/caja/cierre-z', {
      method: 'POST',
      body: {
        efectivo_real_contado: 50000,
        notas: 'Cierre correcto autorizado',
        adminPin: '1234'
      }
    });
    assert.equal(resAprobado.status, 200);
    assert.equal(resAprobado.data.ok, true);
    assert.equal(resAprobado.data.tipo, 'Cierre Z (Final)');
  });

  it('T23.4: Modal y controladores de PIN de Administrador presentes en frontend', () => {
    // modal en index.html
    assert.ok(indexHtml.includes('id="modalSolicitarPinAdmin"'), 'Debe existir modalSolicitarPinAdmin en HTML');
    assert.ok(indexHtml.includes('id="pinAdminDotsDisplay"'), 'Debe existir visor de dots de PIN admin');
    assert.ok(indexHtml.includes('presionarTeclaPinAdmin'), 'Debe existir teclado numérico para PIN admin');

    // funciones en app.js
    assert.ok(appJs.includes('window.solicitarPinAdmin = function'), 'Debe existir función solicitarPinAdmin');
    assert.ok(appJs.includes('window.validarPinAdminManual'), 'Debe existir validación manual de PIN');
    assert.ok(appJs.includes('window.solicitarPinAdmin({'), 'generarCorteX y abrirModalCierreZ deben invocar solicitarPinAdmin');
  });

  it('T23.5: Característica de Arqueo Ciego en Cierre Z presente en HTML y controladores frontend', () => {
    assert.ok(indexHtml.includes('id="btnCorteZCiego"'), 'Debe existir btnCorteZCiego en HTML');
    assert.ok(indexHtml.includes('id="czAvisoCiegoBox"'), 'Debe existir aviso de modo ciego en modal Cierre Z');
    assert.ok(indexHtml.includes('id="czResumenEsperadoBox"'), 'Debe existir contenedor de resumen esperado para ocultarlo en modo ciego');
    assert.ok(appJs.includes('arqueo_ciego_cierre_z'), 'app.js debe verificar la característica arqueo_ciego_cierre_z');
    assert.ok(appJs.includes('_cierreZEsCiego'), 'app.js debe controlar el estado ciego de cierre Z');
  });
});

