# Handoff Report: Survey of Testing Infrastructure & Table Management (R4)

**Agent:** Explorer Survey 3  
**Working Directory:** C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3  
**Workspace:** C:\Users\Juan\punto-de-venta  
**Parent Agent:** 5aba5165-6495-47b3-a6cf-9cb338097fb9 (parent)  
**Date:** 2026-09-03  
**Type:** Hard Handoff (Investigation & Survey Complete)

---

## 1. Observation

### 1.1 Testing Setup and Environment
1. **Package Scripts and Dependencies:**
   - File: package.json (lines 10–13):
     `json
     "scripts": {
       "start": "node server.js",
       "dev": "node --watch server.js"
     }
     `
     Observed: No "test" script is present.
   - Dependencies: cors@2.8.6, dotenv@17.4.2, express@5.2.1, qrcode@1.5.4, socket.io@4.8.3, sqlite3@6.0.1. No testing framework (Jest, Vitest, Mocha) is installed.
2. **Node.js Runtime & PowerShell Constraint:**
   - Command: 
ode -v returned 24.20.0.
   - Command: 
pm -v failed with:
     `
     npm : No se puede cargar el archivo C:\Program Files\nodejs\npm.ps1 porque la ejecución de scripts está deshabilitada en este sistema... CategoryInfo: SecurityError: (:) [], PSSecurityException
     `
   - Command: 
pm.cmd -v succeeded and returned 11.19.0.
3. **Built-in Node.js Test Runner:**
   - Running 
ode --test executed cleanly with:
     `
     ℹ tests 0
     ℹ suites 0
     ℹ pass 0
     ℹ duration_ms 12.9629
     `
   - A verification script testing SQLite in-memory table merging executed via 
ode --test in 82ms with 100% pass rate.
4. **Existing Tests in Codebase:**
   - Search across C:\Users\Juan\punto-de-venta for *test* and *spec* (excluding 
ode_modules and .git) returned 0 results.
5. **Server Top-Level Binding:**
   - File: server.js (lines 836–844):
     `javascript
     server.listen(PORT, () => {
       console.log('========================================================');
       console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
       // ...
     });
     `
     Observed: server.listen() is executed immediately on module import, and module.exports is omitted at the bottom of the file (lines 880–889).

### 1.2 Table State & Merging Mechanics
1. **Database Schema:**
   - File: database.js (lines 29–43, 117–135, 140–156):
     - Mesas: contains id, 
umero, zona_id, capacidad, estado, mesero, x, y, orma. Lacks any field for merged relationships (unida_a_mesa_id).
     - Ordenes: contains id, 
umero_orden, mesa_id, estado, subtotal, descuento_happy_hour, servicio_10, iva_13, 	otal. Lacks parent order reference (orden_padre_id).
     - DetalleOrden: contains id, orden_id, producto_id, 
ombre_producto, precio_unitario, cantidad, subtotal, 
otas, curso, destino, estado_comanda, hora_pedido, hora_listo. Lacks origen_mesa_id, origen_mesa_numero, and orden_original_id.
2. **Current Table Merging Endpoint:**
   - File: server.js (lines 459–483):
     `javascript
     app.post('/api/mesas/unir', async (req, res) => {
       const { mesaPrincipalId, mesaSecundariaId } = req.body;
       const orden1 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaPrincipalId]);
       const orden2 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaSecundariaId]);
       // ...
       await dbRun('UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?', [orden1.id, orden2.id]);
       // ...
       await dbRun("UPDATE Ordenes SET estado = 'fusionada', total = 0 WHERE id = ?", [orden2.id]);
       await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [mesaSecundariaId]);
       // ...
     });
     `
     Observed: When orden2 items are updated to orden1.id, all table provenance is permanently lost. mesaSecundariaId is set to libre, making it appear vacant. No endpoint exists to undo or separate merged tables.
3. **Current Salon Map Table Interactions:**
   - File: public/app.js (lines 764–803):
     enderSalón binds only a click listener:
     `javascript
     card.addEventListener('click', () => abrirComanderoMesa(m.id));
     `
     There is no drag or long-press handler on the operational floor map.
4. **Modal Mover / Unir:**
   - File: public/app.js (lines 1238–1314) and public/index.html (lines 687–732):
     Moving and merging are performed strictly through a static modal (#modalMoverUnir) with HTML <select> elements (#selMoverOrigen, #selMoverDestino, #selUnirMesa1, #selUnirMesa2), triggered by a top-bar button (#btnAbrirMoverUnirModal).

---

## 2. Logic Chain

1. **Test Infrastructure Selection:**
   - *Premise:* The project runs on Node.js v24.20.0 and has no external testing libraries installed (Observation 1.1).
   - *Inference:* Node 24's built-in 
ode:test and 
ode:assert modules require zero additional dependencies, execute in sub-100ms, support describe/it/subtests/coverage, and avoid Windows PowerShell installation issues.
   - *Deduction:* Adopting 
ode --test as the primary test runner and configuring "test": "node --test" in package.json provides an instant, zero-cost, robust testing foundation.
2. **Server Testability:**
   - *Premise:* server.js calls server.listen() unconditionally and does not export pp or server (Observation 1.5).
   - *Inference:* Any automated test attempting to equire('./server') will attempt to bind to port 4000, creating port collisions or preventing multi-test parallelism.
   - *Deduction:* Wrapping the listen call in if (require.main === module) and adding module.exports = { app, server, io } allows tests to spin up the server on an ephemeral port (server.listen(0)) and test endpoints using global etch.
3. **Item Provenance & Traceability:**
   - *Premise:* When tables are merged, DetalleOrden.orden_id is updated without retaining the origin table (Observation 2.2), and R4 mandates displaying [Mesa X] Producto on tickets and invoices.
   - *Inference:* Once merged, it is mathematically impossible to know which item came from which table unless additional columns store that metadata before or during the merge.
   - *Deduction:* Adding origen_mesa_id, origen_mesa_numero, and orden_original_id to DetalleOrden preserves the exact origin of every item, fulfilling the ticket traceability requirement.
4. **Undo / Separar Mesas:**
   - *Premise:* R4 requires long-pressing on a merged table to offer "Separar Mesas" and restore accounts intact.
   - *Inference:* Because item provenance is preserved in DetalleOrden and orden2 is retained with orden_padre_id = orden1.id (Observation 2.1 & 2.2 logic), a POST /api/mesas/separar endpoint can reassign items where origen_mesa_id = mesaSecundaria.id back to orden2.id.
   - *Deduction:* Both orders can have their subtotals, taxes, and service charges recalculated deterministically, restoring both tables without data loss.
5. **Touch & Mouse Drag & Drop Disambiguation:**
   - *Premise:* The salon view currently uses a simple click to open the comandero (Observation 3.1), while R4 specifies that long-pressing (click or touch) activates drag mode.
   - *Inference:* A naive mousedown/	ouchstart handler would conflict with regular clicks and page scrolling.
   - *Deduction:* Implementing Pointer Events with a 400–450ms long-press timer and a 10px movement threshold cleanly separates quick clicks (opens comandero), pans/scrolls (cancels timer), and sustained holds (activates drag mode).

---

## 3. Caveats

1. **Touch Scroll Behavior:** In mobile/tablet browsers, if the salon container requires vertical or horizontal scrolling, touching a table card must not trigger drag mode if the user intended to scroll. The 10px movement cancellation threshold addresses this, but touch testing on physical devices is recommended.
2. **Items Added Post-Merge:** If a waiter opens a merged table and adds new items, those items will default to the primary table's origin unless the UI allows the waiter to select which seated table the item belongs to. By default, attributing to the primary table is safe and consistent.
3. **Happy Hour on Merged Tables:** When two tables are merged, any 2x1 promotions from both tables combine. If separated, the promotion recalculation must run independently on each table.
4. **Active Workspace URI vs Path:** The user's metadata lists active workspace as c:\Users\Juan\contabilidad-backend, while the actual GastroBar Pro codebase resides in C:\Users\Juan\punto-de-venta. All commands and file paths must target C:\Users\Juan\punto-de-venta.

---

## 4. Conclusion

1. **Testing Infrastructure:** Adopt native 
ode:test and 
ode:assert. Add "test": "node --test" to package.json. Refactor server.js with if (require.main === module) and export { app, server, io }. Always use 
pm.cmd when invoking npm commands in PowerShell.
2. **Table State Modeling:** Execute non-destructive schema additions in database.js:
   - DetalleOrden: origen_mesa_id, origen_mesa_numero, orden_original_id
   - Mesas: unida_a_mesa_id
   - Ordenes: orden_padre_id
3. **Drag & Drop Engine:** Implement a Pointer Events state machine on .mesa-render-card with a 420ms long-press timer, 10px jitter tolerance, fixed drag avatar ghost, and document.elementFromPoint() drop target detection.
4. **Confirmation & Undo:** Implement confirmation modals for Move (*"¿Deseas mover la Mesa X a la Mesa Y?"*) and Merge (*"¿Deseas unir la Mesa X con la Mesa Y?"*). For merged tables, long-press presents a prompt with [✂️ Separar Mesas], backed by POST /api/mesas/separar.
5. **Item Provenance:** Prefix item names with [Mesa X] in the ticket list, KDS cards, split bill view, and receipt output.

---

## 5. Verification Method

### 5.1 Verifying the Test Runner
Run the following PowerShell command in C:\Users\Juan\punto-de-venta:
`powershell
node --test
`
*Expected Result:* Exits with code 0 and reports test summary (duration, suites, passes).

### 5.2 Verifying 
pm.cmd in PowerShell
Run:
`powershell
npm.cmd run
`
*Expected Result:* Lists lifecycle scripts without PSSecurityException.

### 5.3 Verifying Database Schema and Migrations
Run:
`powershell
node -e "const db = require('./database'); db.all('PRAGMA table_info(Mesas)', (e, r) => { console.log('Mesas columns:', r.map(c => c.name)); process.exit(0); });"
`
*Expected Result:* Displays column list including existing columns (id, 
umero, zona_id, capacidad, estado, mesero, x, y, orma).

### 5.4 Invalidation Conditions
This handoff is invalidated if:
1. External test libraries (like Jest or Mocha) are introduced that break CommonJS or conflict with Node 24.
2. Table merge logic overwrites DetalleOrden records without populating origen_mesa_id.
3. Drag-and-drop implementation intercepts standard clicks, preventing waiters from opening the table comandero.
