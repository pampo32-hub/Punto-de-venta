const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 16: Frontend Syntax Integrity, Auth Security & Full Browser Login Lifecycle', () => {
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

  function req(endpoint, method = 'GET', body = null, headers = {}) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T16.1: Verificación Estática de Sintaxis: Ningún archivo JS tiene errores de sintaxis', () => {
    const rootDir = path.resolve(__dirname, '../../');
    const files = [
      'public/app.js',
      'public/sw.js',
      'public/offline-sync.js',
      'public/offline-db.js',
      'server.js'
    ];

    for (const f of files) {
      const fullPath = path.join(rootDir, f);
      assert.doesNotThrow(() => {
        execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
      }, `El archivo ${f} contiene un error de sintaxis que bloquea la carga del navegador.`);
    }
  });

  it('T16.2: API /api/auth/login valida credenciales de todos los roles y rechaza contraseñas inválidas', async () => {
    // 1. Acceso Developer
    const rDev = await req('/api/auth/login', 'POST', { usuario: 'dev', password: 'dev123' });
    assert.equal(rDev.status, 200);
    assert.equal(rDev.body.usuario.rol, 'developer');

    // 2. Acceso Admin
    const rAdmin = await req('/api/auth/login', 'POST', { usuario: 'admin', password: 'admin123' });
    assert.equal(rAdmin.status, 200);
    assert.equal(rAdmin.body.usuario.rol, 'admin');

    // 3. Acceso Cajero
    const rCajero = await req('/api/auth/login', 'POST', { usuario: 'cajero', password: 'caja123' });
    assert.equal(rCajero.status, 200);
    assert.equal(rCajero.body.usuario.rol, 'cajero');

    // 4. Acceso Salonero (Carlos)
    const rCarlos = await req('/api/auth/login', 'POST', { usuario: 'carlos', password: 'mesero123' });
    assert.equal(rCarlos.status, 200);
    assert.equal(rCarlos.body.usuario.rol, 'salonero');
    assert.equal(rCarlos.body.usuario.genero, 'M');
    assert.equal(rCarlos.body.usuario.rolEtiqueta, 'Salonero');

    // 5. Acceso Salonera (Sofía)
    const rSofia = await req('/api/auth/login', 'POST', { usuario: 'sofia', password: 'mesera123' });
    assert.equal(rSofia.status, 200);
    assert.equal(rSofia.body.usuario.rol, 'salonero');
    assert.equal(rSofia.body.usuario.genero, 'F');
    assert.equal(rSofia.body.usuario.rolEtiqueta, 'Salonera');

    // 6. Rechazo de credenciales incorrectas
    const rBadPass = await req('/api/auth/login', 'POST', { usuario: 'admin', password: 'wrongpassword' });
    assert.equal(rBadPass.status, 401);

    // 7. Rechazo de datos faltantes
    const rMissing = await req('/api/auth/login', 'POST', { usuario: 'admin' });
    assert.equal(rMissing.status, 400);
  });

  it('T16.3: Integridad de Navegador: Carga de página sin excepciones y login exitoso de cada usuario', async () => {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    let chromeExists = false;
    try {
      const fs = require('fs');
      if (fs.existsSync(chromePath)) chromeExists = true;
    } catch (_) {}

    if (!chromeExists) {
      return;
    }

    const port = 9296;
    const chrome = spawn(chromePath, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--window-size=1440,920',
      `--user-data-dir=${path.join(require('os').tmpdir(), 'chrome_tier16_' + Date.now())}`,
      `http://localhost:${server.port}`
    ]);

    await new Promise(r => setTimeout(r, 2000));

    try {
      const targets = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json`, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', reject);
      });

      const page = targets.find(t => t.type === 'page' && t.url.includes(`localhost:${server.port}`));
      assert.ok(page, 'Página debe existir en Chrome');

      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let msgId = 1;
      const send = (method, params = {}) => new Promise(resolve => {
        const curId = msgId++;
        const handler = (m) => {
          const res = JSON.parse(m.data);
          if (res.id === curId) {
            ws.removeEventListener('message', handler);
            resolve(res.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });

      const browserErrors = [];
      ws.addEventListener('message', (m) => {
        const msg = JSON.parse(m.data);
        if (msg.method === 'Runtime.exceptionThrown') {
          browserErrors.push(msg.params.exceptionDetails);
        }
      });

      await new Promise(resolve => { ws.onopen = resolve; });
      await send('Runtime.enable');
      await send('Page.enable');
      await send('Network.enable');

      let loaded = false;
      for (let i = 0; i < 50; i++) {
        const chk = await send('Runtime.evaluate', {
          expression: 'typeof window.cargarCredencialDemo === "function"',
          returnByValue: true
        });
        if (chk?.result?.value === true) {
          loaded = true;
          break;
        }
        await new Promise(r => setTimeout(r, 100));
      }
      assert.ok(loaded, 'window.cargarCredencialDemo debe estar disponible en la ventana');

      assert.equal(browserErrors.length, 0, `No debe haber errores de sintaxis en el navegador.`);

      const loginAdminRes = await send('Runtime.evaluate', {
        expression: `
          (async () => {
            cargarCredencialDemo('admin', 'admin123');
            for (let i = 0; i < 40; i++) {
              if (window.estado && window.estado.usuarioActual && window.estado.usuarioActual.usuario === 'admin') break;
              await new Promise(r => setTimeout(r, 100));
            }
            return {
              landingActive: document.getElementById('landingLoginView').classList.contains('active'),
              posMainActive: document.getElementById('posMainView').classList.contains('active'),
              user: window.estado ? window.estado.usuarioActual : null
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      const rAdm = loginAdminRes.result.value;
      assert.ok(rAdm, 'Respuesta de login admin debe existir');
      assert.equal(rAdm.landingActive, false, 'Landing debe desaparecer tras login');
      assert.equal(rAdm.posMainActive, true, 'POS Principal debe activarse tras login de Admin');
      assert.equal(rAdm.user.usuario, 'admin');

      const loginCarlosRes = await send('Runtime.evaluate', {
        expression: `
          (async () => {
            cerrarSesion();
            await new Promise(r => setTimeout(r, 200));
            cargarCredencialDemo('carlos', 'mesero123');
            for (let i = 0; i < 40; i++) {
              if (window.estado && window.estado.usuarioActual && window.estado.usuarioActual.usuario === 'carlos') break;
              await new Promise(r => setTimeout(r, 100));
            }
            return {
              landingActive: document.getElementById('landingLoginView').classList.contains('active'),
              posMainActive: document.getElementById('posMainView').classList.contains('active'),
              user: window.estado ? window.estado.usuarioActual : null
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      const rCarl = loginCarlosRes.result.value;
      assert.ok(rCarl);
      assert.equal(rCarl.landingActive, false);
      assert.equal(rCarl.posMainActive, true);
      assert.equal(rCarl.user.usuario, 'carlos');

      const loginDevRes = await send('Runtime.evaluate', {
        expression: `
          (async () => {
            cerrarSesion();
            await new Promise(r => setTimeout(r, 200));
            cargarCredencialDemo('dev', 'dev123');
            for (let i = 0; i < 40; i++) {
              if (window.estado && window.estado.usuarioActual && window.estado.usuarioActual.usuario === 'dev') break;
              await new Promise(r => setTimeout(r, 100));
            }
            return {
              landingActive: document.getElementById('landingLoginView').classList.contains('active'),
              devPortalActive: document.getElementById('developerPortalView').classList.contains('active'),
              user: window.estado ? window.estado.usuarioActual : null
            };
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      const rDev2 = loginDevRes.result.value;
      assert.ok(rDev2);
      assert.equal(rDev2.landingActive, false);
      assert.equal(rDev2.devPortalActive, true);
      assert.equal(rDev2.user.usuario, 'dev');

    } finally {
      chrome.kill();
    }
  });
});
