# Handoff Report: Test Infrastructure & Server Test Harness (F3)

**Agent:** Explorer M1.3  
**Working Directory:** `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_3`  
**Target Codebase:** `C:\Users\Juan\punto-de-venta`  
**Parent Agent:** `5aba5165-6495-47b3-a6cf-9cb338097fb9` (parent)  
**Date:** 2026-09-03  
**Type:** Hard Handoff (Investigation Complete)  

---

## 1. Observation

### 1.1 `server.js` Startup and Export Mechanics
- **File:** `C:\Users\Juan\punto-de-venta\server.js` (Lines 836–844):
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
- **File:** `C:\Users\Juan\punto-de-venta\server.js` (Lines 847–889):
  Routes `app.get('/api/cliente/mesa/:id', ...)` and `app.post('/api/cliente/mesa/:id/pedir-cuenta', ...)` are declared *after* `server.listen()`.
- **File:** `C:\Users\Juan\punto-de-venta\server.js` (End of file, Line 889):
  No `module.exports` statement exists. Grep for `module.exports` returned 0 results in `server.js`.
- **Command & Output:** Running `node -e "const s = require('./server'); console.log('Exported:', s); process.exit(0);"` returned:
  ```
  🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO
  📍 Puerto: 4000
  Exported: {}
  ```
  Verbatim observation: Requiring `server.js` immediately starts listening on port 4000 and exports an empty object `{}`.

### 1.2 `package.json` Scripts & Dependencies
- **File:** `C:\Users\Juan\punto-de-venta\package.json` (Lines 10–13):
  ```json
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  }
  ```
- Verbatim observation: No `"test"` script exists in `package.json`. No external test libraries (`jest`, `mocha`, `supertest`) are present in `dependencies`.

### 1.3 Windows PowerShell Execution Policy Constraint
- **Command:** `npm -v`
- **Verbatim Error Output:**
  ```
  npm : No se puede cargar el archivo C:\Program Files\nodejs\npm.ps1 porque la ejecución de scripts está deshabilitada en este sistema. Para obtener más información, consulta el tema about_Execution_Policies en https:/go.microsoft.com/fwlink/?LinkID=135170.
  + CategoryInfo          : SecurityError: (:) [], PSSecurityException
  + FullyQualifiedErrorId : UnauthorizedAccess
  ```
- **Command:** `npm.cmd -v` succeeded with exit code 0, returning `11.19.0`.
- **Command:** `node -v` succeeded with exit code 0, returning `v24.20.0`.

### 1.4 Native Node 24 Test Runner Execution
- **Command:** `node --test` executed with exit code 0:
  ```
  ℹ tests 0
  ℹ suites 0
  ℹ pass 0
  ℹ duration_ms 13.9211
  ```
- **Command:** An inline test exercising an ephemeral Express HTTP server on port 0 with Node 24 native `fetch` executed in **53.56 ms**:
  ```
  ✔ ephemeral express server integration test (47.2412ms)
  ℹ tests 1
  ℹ pass 1
  ℹ duration_ms 53.5695
  ```

### 1.5 Socket.IO and Server Teardown Semantics
- **Command:** Testing `io.close()` and `server.close()` revealed that calling `io.close(cb)` automatically closes the underlying HTTP server and sets `server.listening = false`.
- If `server.close()` is subsequently called on the closed server, it triggers:
  `server.close callback error: Server is not running.`

### 1.6 Database Configuration
- **File:** `C:\Users\Juan\punto-de-venta\database.js` (Lines 4–5):
  ```javascript
  const dbPath = path.join(__dirname, 'pos.db');
  const db = new sqlite3.Database(dbPath);
  ```
- Verbatim observation: The database path is currently hardcoded to `pos.db`. Grep for `DB_PATH` across the repository returned 0 matches.

---

## 2. Logic Chain

1. **Top-level execution prevents automated testing:**
   - *Observation 1.1:* `server.js` calls `server.listen(PORT)` at line 837 upon import and exports `{}`.
   - *Reasoning:* Tests attempting to import `server.js` to run integration tests will conflict on port 4000, trigger `EADDRINUSE` errors if port 4000 is occupied, and cannot access `app`, `server`, or `io` because they are not exported.
   - *Conclusion:* Wrapping `server.listen` in `if (require.main === module)` prevents automatic binding during test imports, and `module.exports = { app, server, io }` exposes the required handles.

2. **Server listen placement relative to routes:**
   - *Observation 1.1:* `server.listen` is located at lines 836–844, before client QR routes (lines 847–889).
   - *Reasoning:* Relocating the `if (require.main === module)` block to the very end of `server.js` guarantees that all routes and middleware are registered before the server accepts traffic.

3. **Zero-dependency test automation via Node 24:**
   - *Observations 1.2, 1.3 & 1.4:* The project has no test dependencies installed, but Node.js is `v24.20.0`, which provides native `node:test`, `node:assert`, and global `fetch`.
   - *Reasoning:* Running `node --test` requires no package installation, executes sub-tests in ~50ms, and bypasses Windows PowerShell npm script policy restrictions when invoked directly or via `npm.cmd test`.
   - *Conclusion:* Adding `"test": "node --test"` to `package.json` provides a clean, native test runner.

4. **Ephemeral port allocation:**
   - *Observation 1.4:* Binding `server.listen(0, '127.0.0.1')` assigns an available random high port dynamically.
   - *Reasoning:* Tests can spin up the server on port 0, retrieve `server.address().port`, query endpoints via `fetch("http://127.0.0.1:" + port + "/api/...")`, and run concurrently without port collision.

5. **Safe teardown without socket leaks or errors:**
   - *Observation 1.5:* Calling `io.close()` shuts down both Socket.IO and the attached HTTP server.
   - *Reasoning:* A teardown helper that calls `io.close()` (or `server.close()` only if `server.listening`) avoids `ERR_SERVER_NOT_RUNNING` and releases all ports and timers cleanly.

---

## 3. Caveats

1. **Windows PowerShell Execution Policy:** Running `npm test` directly in PowerShell can trigger `PSSecurityException`. Developers and agents must use `npm.cmd test` or `node --test`.
2. **Database State Persistence:** Because `database.js` currently targets `pos.db` directly (Observation 1.6), running mutating tests directly against `server.js` will modify data in `pos.db`. It is strongly recommended to add `const dbPath = process.env.DB_PATH || path.join(__dirname, 'pos.db');` to `database.js` so test suites can run in `:memory:`.
3. **Absence of `socket.io-client`:** There is no client-side socket library in `node_modules`. Socket.IO events can be cleanly asserted during tests by intercepting `io.emit` calls on the exported `io` instance rather than maintaining physical client connections.
4. **Duplicate Routes at lines 804–834 vs 847–888:** `server.js` contains two sets of client QR endpoints (`/api/cliente/mesa/:mesaId` and `/api/cliente/mesa/:id`). While both currently coexist, moving `server.listen` to the end does not alter routing precedence.

---

## 4. Conclusion

The testing foundation for Milestone 1 (Feature F3) requires two discrete, precise changes:

### 4.1 Changes to `server.js`
1. Remove lines 836–844:
   ```javascript
   // Iniciar Servidor
   server.listen(PORT, () => { ... });
   ```
2. Append at the end of `server.js` (after line 888):
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

### 4.2 Changes to `package.json`
Add `"test": "node --test"` to `"scripts"`:
```json
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test"
  }
```

### 4.3 Test Harness Helper (`test/helpers/test-server.js`)
Provide a reusable test helper for the E2E test writers:
```javascript
const { app, server, io } = require('../../server');

function startTestServer() {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      const port = server.address().port;
      return resolve({ app, server, io, port, baseUrl: `http://127.0.0.1:${port}` });
    }
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ app, server, io, port, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.once('error', reject);
  });
}

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

module.exports = { app, server, io, startTestServer, stopTestServer };
```

---

## 5. Verification Method

### 5.1 Verification of `package.json` and Runner
Execute from `C:\Users\Juan\punto-de-venta`:
```powershell
npm.cmd test
```
*Expected Result:* Runs `node --test`, exits with code 0.

### 5.2 Verification of `server.js` Export and Port Isolation
Execute from `C:\Users\Juan\punto-de-venta`:
```powershell
node -e "const { app, server, io } = require('./server'); if (!app || !server || !io) throw new Error('Failed to export { app, server, io }'); if (server.listening) throw new Error('Server should not listen on require()'); console.log('PASS: server.js exports app, server, io without auto-listening');"
```
*Expected Result:* Exits with code 0 and logs `PASS: server.js exports app, server, io without auto-listening`.

### 5.3 Verification of Ephemeral Test Execution & Teardown
Execute an ephemeral integration test against the exported server:
```powershell
node -e "const { server, io } = require('./server'); server.listen(0, '127.0.0.1', async () => { const port = server.address().port; const res = await fetch('http://127.0.0.1:' + port + '/api/mesas'); const data = await res.json(); console.log('Fetched mesas count:', data.length); io.close(() => { console.log('PASS: Server cleanly terminated'); process.exit(0); }); });"
```
*Expected Result:* Binds to dynamic port, retrieves `/api/mesas`, cleanly closes `io`/`server`, and exits with code 0.

### 5.4 Invalidation Conditions
This analysis is invalidated if:
1. `server.js` introduces ES module syntax (`import`/`export`) without configuring `"type": "module"` in `package.json`.
2. Third-party testing dependencies (Jest, Mocha) are installed that conflict with Node 24 built-in test runner.
3. Teardown logic calls `server.close()` after `io.close()`, causing uncaught `ERR_SERVER_NOT_RUNNING` exceptions.
