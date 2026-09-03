# Technical Analysis: Test Infrastructure & Server Test Harness (F3)

**Agent:** Explorer M1.3  
**Working Directory:** `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_3`  
**Target Codebase:** `C:\Users\Juan\punto-de-venta`  
**Milestone:** Milestone 1 (Feature F3)  
**Date:** 2026-09-03  

---

## 1. Executive Summary

This investigation analyzes the test infrastructure and test harness configuration for **GastroBar Pro** under Milestone 1 (Feature F3). 

Currently:
1. `server.js` executes `server.listen(PORT, ...)` unconditionally at line 837 upon being required or executed, and omits `module.exports`. Any automated test or script attempting to `require('./server')` immediately binds port 4000 (causing `EADDRINUSE` conflicts) and receives an empty object `{}`.
2. `package.json` contains only `"start"` and `"dev"` scripts; no `"test"` script is defined.
3. In this Windows PowerShell environment, invoking `npm` triggers a `PSSecurityException` because script execution for `npm.ps1` is disabled. However, `npm.cmd` and direct `node` commands execute cleanly.
4. Node.js v24.20.0 provides a powerful built-in test runner (`node:test`, `node:assert`, and global `fetch`) that requires zero external dependencies, executes test suites in under 70 milliseconds, and seamlessly supports ephemeral port allocation (`port: 0`).

This report provides the exact code modifications required for `server.js` and `package.json`, complete unified diffs, teardown mechanics for Socket.IO/HTTP servers, and a robust test server harness design.

---

## 2. Current State Analysis

### 2.1 `server.js` Architecture & Export Gap

- **File Path:** `C:\Users\Juan\punto-de-venta\server.js` (889 lines total)
- **Component Instantiation (Lines 9–13):**
  ```javascript
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });
  ```
- **Unconditional Listen (Lines 836–844):**
  ```javascript
  // Iniciar Servidor
  server.listen(PORT, () => {
    console.log('========================================================');
    console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
    console.log('📍 Puerto: ' + PORT);
    console.log('🌐 URL Local: http://localhost:' + PORT);
    console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
    console.log('========================================================');
  });
  ```
- **Post-Listen Routes & Missing Export (Lines 847–889):**
  After the `server.listen()` call, lines 847–888 define additional client QR routes (`GET /api/cliente/mesa/:id` and `POST /api/cliente/mesa/:id/pedir-cuenta`). Line 889 is the end of the file. There is **no** `module.exports` statement anywhere in `server.js`.
  
#### Failure Modes when imported in Tests:
- Running `node -e "const s = require('./server'); console.log(s);"` returns `Exported: {}` and triggers the full server startup banner on port 4000.
- If port 4000 is occupied (e.g. active development instance), `require('./server')` crashes with `Error: listen EADDRINUSE: address already in use :::4000`.
- Because `server` is not exported, test runners cannot call `server.close()`, causing the Node.js event loop to hang indefinitely on open socket handles.

---

### 2.2 `package.json` Scripts & Dependencies

- **File Path:** `C:\Users\Juan\punto-de-venta\package.json`
- **Current Content:**
  ```json
  {
    "dependencies": {
      "cors": "^2.8.6",
      "dotenv": "^17.4.2",
      "express": "^5.2.1",
      "qrcode": "^1.5.4",
      "socket.io": "^4.8.3",
      "sqlite3": "^6.0.1"
    },
    "scripts": {
      "start": "node server.js",
      "dev": "node --watch server.js"
    }
  }
  ```
- **Observations:**
  - No testing framework (Jest, Mocha, Vitest, etc.) is installed in dependencies or devDependencies.
  - No `"test"` script exists in `scripts`. Calling `npm test` fails with `npm error Missing script: "test"`.

---

### 2.3 Windows PowerShell Environment Constraint

On the host machine (Windows 11 / PowerShell):
```powershell
PS C:\Users\Juan\punto-de-venta> npm -v
npm : No se puede cargar el archivo C:\Program Files\nodejs\npm.ps1 porque la ejecución de scripts está deshabilitada en este sistema.
+ CategoryInfo          : SecurityError: (:) [], PSSecurityException
+ FullyQualifiedErrorId : UnauthorizedAccess
```
However:
- `npm.cmd -v` succeeds immediately and reports `11.19.0`.
- `node -v` reports `v24.20.0`.
- `node --test` runs directly and exits with code 0.

**Prescription:** Development and CI workflows in this environment must either run `node --test` directly or invoke `npm.cmd test`.

---

## 3. Detailed Refactoring Specifications

### 3.1 Refactoring `server.js`

To make `server.js` fully importable and testable without side effects:
1. Wrap the `server.listen(...)` block in a CommonJS entrypoint guard: `if (require.main === module) { ... }`.
2. Move the entrypoint guard to the **bottom** of the file (after line 888) so all routes, middlewares, and error handlers are registered before the server begins accepting incoming connections.
3. Export `{ app, server, io }` via `module.exports`.

#### Proposed Code Structure for `server.js`:
At the bottom of `server.js` (replacing the old lines 836–844 and appending after line 889):
```javascript
// ============================================================================
// 12. INICIAR SERVIDOR & EXPORTAR (ENTRYPOINT & TEST HARNESS)
// ============================================================================
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('========================================================');
    console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
    console.log('📍 Puerto: ' + PORT);
    console.log('🌐 URL Local: http://localhost:' + PORT);
    console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
    console.log('========================================================');
  });
}

module.exports = { app, server, io };
```

#### Exact Unified Diff for `server.js`:
```diff
--- a/server.js
+++ b/server.js
@@ -833,16 +833,6 @@
   }
 });
 
-// Iniciar Servidor
-server.listen(PORT, () => {
-  console.log('========================================================');
-  console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
-  console.log('📍 Puerto: ' + PORT);
-  console.log('🌐 URL Local: http://localhost:' + PORT);
-  console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
-  console.log('========================================================');
-});
-
 
 // ============================================================================
 // ENDPOINTS PARA EL CLIENTE (ESCANEÓ QR EN MESA)
@@ -887,3 +877,18 @@
   }
 });
 
+// ============================================================================
+// 12. INICIAR SERVIDOR & EXPORTAR (ENTRYPOINT & TEST HARNESS)
+// ============================================================================
+if (require.main === module) {
+  server.listen(PORT, () => {
+    console.log('========================================================');
+    console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
+    console.log('📍 Puerto: ' + PORT);
+    console.log('🌐 URL Local: http://localhost:' + PORT);
+    console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
+    console.log('========================================================');
+  });
+}
+
+module.exports = { app, server, io };
```

---

### 3.2 Refactoring `package.json`

Add the standard `"test": "node --test"` script. Optionally add `"test:watch": "node --test --watch"`.

#### Exact Unified Diff for `package.json`:
```diff
--- a/package.json
+++ b/package.json
@@ -9,7 +9,8 @@
   },
   "scripts": {
     "start": "node server.js",
-    "dev": "node --watch server.js"
+    "dev": "node --watch server.js",
+    "test": "node --test"
   }
 }
```

---

## 4. Node 24 Native Test Runner & Harness Verification

### 4.1 Benchmark & Execution Results

We verified the Node 24 test runner directly in the project environment using inline tests:
- Basic assertion test: **5.53 ms**
- Express ephemeral HTTP server test: **53.56 ms**
- Express + Socket.IO lifecycle test: **61.11 ms**
- Full multi-test describe/suite lifecycle test: **66.15 ms**

All benchmarks completed in under 70 ms with zero external test packages.

### 4.2 Socket.IO & HTTP Teardown Semantics

A critical finding discovered during empirical testing:
- Socket.IO attaches to the underlying Node.js `http.Server`.
- Calling `io.close(callback)` **automatically closes the underlying HTTP server** and sets `server.listening = false`.
- If a test helper attempts to call `server.close()` after `io.close()`, Node throws:
  `Error: Server is not running.`
- **Safe Teardown Pattern:**
  ```javascript
  function stopTestServer(server, io) {
    return new Promise((resolve, reject) => {
      if (io) {
        io.close((err) => {
          if (err && err.message !== 'Server is not running.') return reject(err);
          resolve();
        });
      } else if (server && server.listening) {
        server.close((err) => {
          if (err && err.message !== 'Server is not running.') return reject(err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  ```

### 4.3 Testing Real-time WebSockets without `socket.io-client`

Since `socket.io-client` is not currently installed in `node_modules`, testing Socket.IO emissions can be achieved cleanly and reliably by spying on the exported `io.emit`:
```javascript
const emittedEvents = [];
const origEmit = io.emit.bind(io);
io.emit = (event, ...args) => {
  emittedEvents.push({ event, args, timestamp: Date.now() });
  return origEmit(event, ...args);
};
```
This allows tests to make standard REST requests via `fetch()` and assert that the expected Socket.IO events (`nueva_comanda`, `mesa_actualizada`, `comanda_estado_cambiado`) were emitted with the exact expected payload.

---

## 5. Test Helper Blueprint: `test/helpers/test-server.js`

To enable clean, isolated opaque-box E2E testing across Tiers 1–4, we provide the following blueprint for `test/helpers/test-server.js`:

```javascript
// test/helpers/test-server.js
const { app, server, io } = require('../../server');

/**
 * Starts the server on an ephemeral OS-assigned port (0).
 * @returns {Promise<{ app: any, server: any, io: any, port: number, baseUrl: string }>}
 */
function startTestServer() {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      const port = server.address().port;
      return resolve({ app, server, io, port, baseUrl: `http://127.0.0.1:${port}` });
    }

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ app, server, io, port, baseUrl });
    });

    server.once('error', reject);
  });
}

/**
 * Cleanly shuts down the Socket.IO engine and HTTP server.
 * @param {any} serverInstance
 * @param {any} ioInstance
 * @returns {Promise<void>}
 */
function stopTestServer(serverInstance = server, ioInstance = io) {
  return new Promise((resolve, reject) => {
    if (ioInstance) {
      ioInstance.close((err) => {
        if (err && err.message !== 'Server is not running.') return reject(err);
        resolve();
      });
    } else if (serverInstance && serverInstance.listening) {
      serverInstance.close((err) => {
        if (err && err.message !== 'Server is not running.') return reject(err);
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  app,
  server,
  io,
  startTestServer,
  stopTestServer
};
```

---

## 6. Sample E2E Smoke Test Blueprint

The following sample test demonstrates how a test file in `test/e2e/server-harness.test.js` or `test/e2e/smoke.test.js` can exercise the refactored server:

```javascript
// test/e2e/smoke.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, io } = require('../helpers/test-server');

describe('Server Test Harness Smoke Suite', () => {
  let baseUrl;
  let serverInstance;
  let ioInstance;
  const socketEvents = [];

  before(async () => {
    // Intercept socket emissions
    const origEmit = io.emit.bind(io);
    io.emit = (event, ...args) => {
      socketEvents.push({ event, args });
      return origEmit(event, ...args);
    };

    const instance = await startTestServer();
    baseUrl = instance.baseUrl;
    serverInstance = instance.server;
    ioInstance = instance.io;
  });

  after(async () => {
    await stopTestServer(serverInstance, ioInstance);
  });

  test('GET /api/mesas returns HTTP 200 and table list', async () => {
    const res = await fetch(`${baseUrl}/api/mesas`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data), 'Response should be an array of tables');
  });

  test('GET /api/productos returns menu catalog', async () => {
    const res = await fetch(`${baseUrl}/api/productos`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data), 'Response should be an array of products');
  });
});
```

---

## 7. Additional Architectural Recommendation: Database Isolation

Currently in `database.js`:
- Line 4: `const dbPath = path.join(__dirname, 'pos.db');`
- Line 5: `const db = new sqlite3.Database(dbPath);`

Because `database.js` hardcodes `pos.db`, running tests against the server will read from and write to the local development database file `pos.db`.

### Recommended Enhancement:
In `database.js` (line 4):
```javascript
const dbPath = process.env.DB_PATH || path.join(__dirname, 'pos.db');
```
This single backward-compatible line allows tests or CI to set `process.env.DB_PATH = ':memory:'` or `process.env.DB_PATH = path.join(__dirname, 'test-pos.db')`, ensuring 100% test isolation without risk of dirtying the development database.

---

## 8. Summary of Action Items for Implementation Workers

1. **`server.js`:**
   - Remove unconditional `server.listen(PORT, ...)` at lines 836–844.
   - Append `if (require.main === module) { server.listen(...) }` and `module.exports = { app, server, io };` at the end of the file.
2. **`package.json`:**
   - Add `"test": "node --test"` to `"scripts"`.
3. **Execution Command:**
   - Instruct test runners and CI to run `node --test` or `npm.cmd test`.
