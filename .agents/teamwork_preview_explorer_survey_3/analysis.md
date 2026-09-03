# Comprehensive Survey & Architectural Analysis: Testing Infrastructure & Table Management (R4)

**Project:** GastroBar Pro (Punto de Venta - Restaurante & Bar)  
**Investigator:** Explorer Survey 3  
**Date:** 2026-09-03  
**Scope:** Testing Infrastructure, Table Drag & Drop (Mouse + Touch Long-press), Table Move/Merge/Split Mechanics, and Per-Item Provenance Traceability (R4).

---

## 1. Executive Summary

GastroBar Pro is an Express 5 + Socket.IO + SQLite POS application serving restaurant and bar workflows. The application frontend is a vanilla JavaScript Single Page Application (public/app.js, 1,980 lines) styled with vanilla CSS (public/styles.css, 2,966 lines) and templated in public/index.html (932 lines).

Key findings from our survey:
1. **Testing Infrastructure:** Currently, there are **zero** test files in the project, and package.json contains no test runner dependencies and no test script. However, the runtime environment is **Node.js v24.20.0**, which contains a built-in, production-grade test runner (
ode:test and 
ode:assert). It executes with zero external dependencies, runs in sub-100ms, and supports describe, it, subtests, mocks, and code coverage. Furthermore, on Windows PowerShell, running 
pm directly is blocked by execution policy (
pm.ps1), requiring the use of 
pm.cmd.
2. **Current Table State & Merge Defect:** Moving and merging tables are currently implemented solely via a modal with <select> drop-downs (#modalMoverUnir). When /api/mesas/unir executes, it indiscriminately reassigns orden_id on all items from the secondary table to the primary table (UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?), sets the secondary order to estado = 'fusionada', and marks the secondary table as libre. **Crucially, all item provenance is erased**: DetalleOrden lacks any reference to the originating table. Additionally, there is **no undo/split mechanism** to separate merged tables.
3. **Drag & Drop for Table Management (R4):** In the salon map view (#mesasCanvasView), table elements only have simple click listeners that open the ordering modal (brirComanderoMesa). Drag & drop exists only in the layout editor (enderEditorPlano), but is absent from the operational floor map. To implement R4, a unified **Pointer Events** architecture with a **long-press timer (400–450ms)** and a **jitter threshold (10px)** is needed to cleanly distinguish between a quick tap (opening the comandero) and a long press (activating drag mode or table separation).
4. **Item Provenance & Billing Traceability:** By introducing origen_mesa_id, origen_mesa_numero, and orden_original_id into DetalleOrden, items can be clearly tagged with [Mesa X] across the ticket list, kitchen display (KDS), split bill view, and customer receipt. This also enables a 100% deterministic, non-destructive "Separar Mesas" (undo merge) endpoint.

---

## 2. Testing Infrastructure & Test Suite

### 2.1 Current State Analysis
- **Node Runtime:** 24.20.0 (Node.js 24 LTS / current).
- **npm Version:** 11.19.0.
- **Operating System / Shell:** Windows 10/11 running PowerShell.
- **Execution Policy Limitation:** Executing 
pm in PowerShell invokes C:\Program Files\nodejs\npm.ps1, which raises PSSecurityException: UnauthorizedAccess because script execution is restricted on this machine. **Workaround:** Always invoke 
pm.cmd (e.g., 
pm.cmd test, 
pm.cmd start).
- **Installed Dependencies (package.json):**
  `json
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
  `
- **Existing Tests:** None exist. Searching for *test* and *spec* across the workspace yields 0 files.
- **Current Server Architecture Limitation:** server.js ends with an immediate call to server.listen(PORT) at line 837 and does not export pp or server. If required by a test file, it binds to port 4000 immediately, causing port conflict errors if the server is running.

### 2.2 Recommended Test Runner: Native 
ode:test
Node.js 24 includes the native 
ode:test module and 
ode:assert/strict.
- **Advantages:**
  1. Zero external dependencies (no need to install or maintain Jest, Vitest, Mocha, Chai).
  2. Native CommonJS compatibility without babel/bundler configs.
  3. Blinding execution speed (unit tests run in ~50ms; SQLite integration tests run in ~80ms).
  4. Built-in async/await, test lifecycle hooks (efore, fter, eforeEach, fterEach).
  5. Built-in test coverage via 
ode --test --experimental-test-coverage.
  6. Automatic file discovery: 
ode --test discovers **/*.test.js, **/*.spec.js, and files inside 	est/.
  7. Built-in mocking (	est.mock).

### 2.3 Proposed package.json Scripts
`json
"scripts": {
  "start": "node server.js",
  "dev": "node --watch server.js",
  "test": "node --test",
  "test:watch": "node --test --watch",
  "test:coverage": "node --test --experimental-test-coverage"
}
`

### 2.4 Server Export & Test Isolation Strategy
To make server.js testable without port conflicts:
1. Wrap the listen call in server.js:
   `javascript
   if (require.main === module) {
     server.listen(PORT, () => {
       console.log('🍔🍻 PUNTO DE VENTA INICIADO en puerto ' + PORT);
     });
   }
   module.exports = { app, server, io };
   `
2. In API integration tests:
   `javascript
   const { app, server } = require('../server');
   let testServer, baseUrl;

   before(async () => {
     await new Promise((resolve) => {
       testServer = server.listen(0, () => {
         baseUrl = http://localhost:;
         resolve();
       });
     });
   });

   after(async () => {
     await new Promise((resolve) => testServer.close(resolve));
   });
   `
3. Use Node 24's global etch to make HTTP requests against aseUrl.
4. For database isolation in tests, use an in-memory SQLite database (:memory:) or set process.env.DB_PATH = ':memory:' to ensure test runs do not alter pos.db.

### 2.5 Planned Test Suite Structure
`
test/
├── unit/
│   ├── business-logic.test.js    # Tax (13%), service (10%), Happy Hour 2x1 calculations
│   ├── table-state.test.js       # Table status transitions: libre, ocupada, esperando, esperando_parcial, activa
│   └── kitchen-button.test.js    # Enviar a Cocina vs Guardar button rules
├── integration/
│   ├── api-tables-move.test.js   # POST /api/mesas/mover
│   ├── api-tables-merge.test.js  # POST /api/mesas/unir (with item provenance)
│   ├── api-tables-split.test.js  # POST /api/mesas/separar (undo merge)
│   ├── api-comandas.test.js      # Kitchen courses, partial KDS dispatch, KDS ready updates
│   └── api-happyhour.test.js     # Happy hour manual toggle & auto-expiration
└── e2e/
    └── drag-drop-gestures.test.js # Touch/mouse long press, jitter tolerance, drop targets
`

---

## 3. Table Management (R4): State Modeling & Mechanics

### 3.1 Current Table Schema (database.js)
`sql
CREATE TABLE Mesas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER DEFAULT 1,
  numero TEXT NOT NULL,
  zona_id INTEGER,
  capacidad INTEGER DEFAULT 4,
  estado TEXT DEFAULT 'libre', -- 'libre', 'ocupada', 'esperando', 'cuenta'
  mesero TEXT,
  x INTEGER DEFAULT 40,
  y INTEGER DEFAULT 40,
  forma TEXT DEFAULT 'square'
);

CREATE TABLE Ordenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER DEFAULT 1,
  numero_orden TEXT NOT NULL,
  mesa_id INTEGER,
  tipo TEXT DEFAULT 'mesa',
  cliente TEXT DEFAULT 'Cliente General',
  mesero TEXT NOT NULL,
  fecha_apertura TEXT NOT NULL,
  fecha_cierre TEXT,
  estado TEXT DEFAULT 'abierta', -- 'abierta', 'esperando', 'cuenta_pedida', 'pagada', 'fusionada'
  subtotal REAL DEFAULT 0,
  descuento_happy_hour REAL DEFAULT 0,
  servicio_10 REAL DEFAULT 0,
  iva_13 REAL DEFAULT 0,
  total REAL DEFAULT 0,
  notas TEXT
);

CREATE TABLE DetalleOrden (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id INTEGER NOT NULL,
  producto_id INTEGER NOT NULL,
  nombre_producto TEXT NOT NULL,
  precio_unitario REAL NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  subtotal REAL NOT NULL,
  notas TEXT,
  curso INTEGER DEFAULT 2,
  destino TEXT DEFAULT 'cocina',
  estado_comanda TEXT DEFAULT 'pendiente', -- 'pendiente', 'preparando', 'listo', 'anulado'
  hora_pedido TEXT NOT NULL,
  hora_listo TEXT
);
`

### 3.2 Identified Deficiencies in Existing Merge (/api/mesas/unir)
In server.js lines 459–483:
`javascript
app.post('/api/mesas/unir', async (req, res) => {
  const { mesaPrincipalId, mesaSecundariaId } = req.body;
  // ...
  await dbRun('UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?', [orden1.id, orden2.id]);
  // Recalculates totals on orden1
  await dbRun("UPDATE Ordenes SET estado = 'fusionada', total = 0 WHERE id = ?", [orden2.id]);
  await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [mesaSecundariaId]);
  // ...
});
`
Flaws:
1. DetalleOrden has no record of which table an item came from. Once merged, items from Mesa 2 become indistinguishable from items originally on Mesa 1.
2. mesaSecundariaId is reset to 'libre', which makes Mesa 2 appear empty on the floor plan even though its guests are still seated and merged into Mesa 1.
3. No reference is kept between orden1 and orden2 or mesa1 and mesa2.
4. "Separar Mesas" (undo) is impossible with the current data structure.

### 3.3 Proposed Schema Extensions
To support full traceability and reversible merging:

#### 1. Mesas Table Extension
`sql
ALTER TABLE Mesas ADD COLUMN unida_a_mesa_id INTEGER DEFAULT NULL;
`
- If unida_a_mesa_id is non-null, this table is physically and logically merged into the parent table.
- Its visual state is rendered with a distinct merged badge (e.g. 🔗 Unida a Mesa X), allowing users to tap or long-press it.

#### 2. Ordenes Table Extension
`sql
ALTER TABLE Ordenes ADD COLUMN orden_padre_id INTEGER DEFAULT NULL;
`
- When orden2 is merged into orden1, orden2.estado = 'fusionada' and orden2.orden_padre_id = orden1.id.
- The original record for orden2 remains in the database with its opening timestamp, waiter, etc.

#### 3. DetalleOrden Table Extension
`sql
ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_id INTEGER DEFAULT NULL;
ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_numero TEXT DEFAULT NULL;
ALTER TABLE DetalleOrden ADD COLUMN orden_original_id INTEGER DEFAULT NULL;
`
- When an item is added to an order, origen_mesa_id and origen_mesa_numero are populated with the active table's ID and number (e.g., 10, 'Mesa 1').
- When merged, orden_id points to the active combined order (orden1.id), but origen_mesa_id, origen_mesa_numero, and orden_original_id remain intact.

---

## 4. Interactive Drag & Drop System (Mouse & Touch Long-Press)

### 4.1 Challenge: Quick Tap vs Long Press vs Scroll
On touchscreen tablets (iPad/Android) and desktop browsers:
- A short tap/click (< 400ms) on a table must open the comandero (brirComanderoMesa).
- A long-press (>= 400ms) without moving must initiate **drag mode** (or the context action if the table is already merged).
- If the finger moves before 400ms (e.g., panning the floor map), the long-press must be cancelled immediately.

### 4.2 Pointer Events Implementation Strategy
We recommend using standard **Pointer Events** (pointerdown, pointermove, pointerup, pointercancel) over separate mouse and touch listeners:
1. **Unified Event Model:** Handles mouse, pen, and touch with identical coordinates (e.clientX, e.clientY).
2. **setPointerCapture(pointerId):** Ensures events continue streaming to the dragged element even if the cursor moves rapidly across the window.
3. **Prevent Default Text Selection / Scroll:** Apply CSS 	ouch-action: none and user-select: none to draggable table cards.

### 4.3 Detailed Gesture State Machine
`
[User Pointer Down]
       │
       ▼
Start Long-Press Timer (420ms)
Record (startX, startY)
       │
       ├──────────────────────────────────────────────────────┐
       │ (User releases before 420ms & moved < 10px)          │ (Moved > 10px before 420ms)
       ▼                                                      ▼
Cancel Timer -> Quick Tap -> Open Comandero              Cancel Timer -> Normal Scroll/Pan
       │
       ▼ (Timer expires after 420ms & movement <= 10px)
Vibrate (40ms haptic if supported)
Enter DRAG MODE:
  - Add '.is-dragging' to source table card
  - Create floating drag avatar/ghost appended to document.body
  - Set ghost position: fixed, pointer-events: none, z-index: 9999
       │
       ▼ (pointermove)
Update Ghost Position to (e.clientX, e.clientY)
Detect Target Element:
  const elBelow = document.elementFromPoint(e.clientX, e.clientY);
  const targetCard = elBelow?.closest('.mesa-render-card');
Highlight Drop Target:
  - If targetCard exists and targetId !== sourceId:
      - If target.estado === 'libre': add class '.drop-candidate-move' (green halo)
      - If target.estado !== 'libre': add class '.drop-candidate-merge' (purple halo)
       │
       ▼ (pointerup / pointercancel)
Remove Ghost Element & Highlighting Classes
If dropped on valid target (targetId !== sourceId):
  - If target is 'libre' -> Open Move Confirmation Dialog
  - If target is occupied -> Open Merge Confirmation Dialog
Else:
  - Snap back (no action)
`

---

## 5. Confirmation Dialogs: Move vs Merge

### 5.1 Requirement Specification
From ORIGINAL_REQUEST.md:
- **Unir Mesas:** If dropped on another table that already has an account (ocupada, esperando, ctiva, cuenta):
  Show confirmation: *"¿Deseas unir la Mesa X con la Mesa Y? [Sí] [No]"*.
- **Mover Mesa:** If dropped on an empty table (libre):
  Show confirmation: *"¿Deseas mover la Mesa X a la Mesa Y? [Sí] [No]"*.

### 5.2 Modal Dialog Implementation
While window.confirm() works for basic alerts, it blocks browser rendering, looks dated, and is clumsy on tablets. We recommend adding a dedicated confirmation modal #modalConfirmarMoverUnir in index.html:
`html
<div class="modal-backdrop" id="modalConfirmarAccionMesa">
  <div class="modal-dialog confirm-dialog">
    <div class="dialog-header">
      <h3 id="confirmAccionTitulo">Confirmar Acción de Mesa</h3>
      <button class="btn-icon-close" id="btnCerrarConfirmAccion">✕</button>
    </div>
    <div class="dialog-body">
      <div class="confirm-icon-box" id="confirmAccionIcono">🔄</div>
      <p class="confirm-message" id="confirmAccionMensaje">¿Deseas mover la Mesa 1 a la Mesa 3?</p>
      <div class="confirm-details-box" id="confirmAccionDetalles"></div>
    </div>
    <div class="dialog-footer">
      <button class="btn-sec" id="btnCancelarAccionMesa">No, Cancelar</button>
      <button class="btn-pri" id="btnAceptarAccionMesa">Sí, Confirmar</button>
    </div>
  </div>
</div>
`

---

## 6. Undo / Split Tables Functionality ("Separar Mesas")

### 6.1 Requirement Specification
*"Separar Mesas (Deshacer): Si dos mesas fueron unidas por error, al mantener presionado sobre la mesa unida debe mostrar la opción de 'Separar Mesas', restaurando las cuentas y consumos separados a su estado original previo."*

### 6.2 UX Interaction Flow
1. When user initiates a long press on a table that has merged tables (unida_a_mesa_id != null or has tables linked to it):
   - Rather than dragging immediately, show a quick action popover / modal:
     - **Mesa 1 (Unida con Mesa 2)**
     - [✂️ Separar Mesas]
     - [🔄 Arrastrar Mesa]
     - [Cancelar]
2. Additionally, in the comandero window (#modalComandero), if mesa.unida_a_mesa_id != null or mesa.mesasUnidas?.length > 0, display a prominent [✂️ Separar Mesas] button in the header.

### 6.3 Backend Endpoint: POST /api/mesas/separar
`javascript
app.post('/api/mesas/separar', async (req, res) => {
  const { mesaPrincipalId, mesaSecundariaId } = req.body;
  
  // 1. Get orders
  const ordenPrincipal = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaPrincipalId]);
  const ordenSecundaria = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado = 'fusionada' AND orden_padre_id = ?", [mesaSecundariaId, ordenPrincipal.id]);
  
  // 2. Move items back to secondary order based on item provenance
  await dbRun(
    "UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ? AND (origen_mesa_id = ? OR orden_original_id = ?)",
    [ordenSecundaria.id, ordenPrincipal.id, mesaSecundariaId, ordenSecundaria.id]
  );

  // 3. Recalculate totals for both orders
  await recalcularTotalesOrden(ordenPrincipal.id);
  await recalcularTotalesOrden(ordenSecundaria.id);

  // 4. Restore secondary order and table states
  await dbRun("UPDATE Ordenes SET estado = 'esperando', orden_padre_id = NULL WHERE id = ?", [ordenSecundaria.id]);
  await dbRun("UPDATE Mesas SET estado = 'esperando', unida_a_mesa_id = NULL WHERE id = ?", [mesaSecundariaId]);
  
  // Check if primary table has any other merged tables; if not, clear unida flags
  const otrasUnidas = await dbAll("SELECT id FROM Mesas WHERE unida_a_mesa_id = ?", [mesaPrincipalId]);
  if (!otrasUnidas.length) {
    await dbRun("UPDATE Mesas SET unida_a_mesa_id = NULL WHERE id = ?", [mesaPrincipalId]);
  }

  // 5. Emit real-time updates via Socket.IO
  io.emit('mesas_separadas', { mesaPrincipalId, mesaSecundariaId, orden1Id: ordenPrincipal.id, orden2Id: ordenSecundaria.id });

  res.json({ message: 'Mesas separadas exitosamente y cuentas restauradas intactas' });
});
`

---

## 7. Item Provenance & Ticket/Bill Traceability

### 7.1 Requirement Specification
*"Cuando dos mesas están unidas, la comanda, desglose y factura deben mostrar claramente al lado de cada producto a qué mesa original pertenece (ej. [Mesa 1] Hamburguesa, [Mesa 2] Corona)."*

### 7.2 UI Rendering Points

1. **Comandero Ticket (enderTicketItems in public/app.js):**
   `javascript
   const mesaTag = it.origen_mesa_numero ? <span class="mesa-origin-badge">[]</span>  : '';
   // Renders: "[Mesa 1] Hamburguesa Doble Bacon"
   `

2. **Kitchen Display System (enderKDS):**
   `javascript
   // In each ticket card item:
   const originLabel = c.origen_mesa_numero && c.origen_mesa_numero !== c.mesa_numero 
     ? <small class="kds-origin-tag">()</small> 
     : '';
   `

3. **Split Bill Modal (configurarColumnasSplit):**
   Displays [Mesa X] Producto on each item pill so customers dividing their bill know who ordered what.

4. **Payment Receipt / Factura Express:**
   The itemized breakdown on printed/electronic tickets prints:
   `
   ------------------------------------------
   Cant  Descripción                     Total
   ------------------------------------------
   1     [Mesa 1] Hamburguesa Bacon    ₡ 5,500
   2     [Mesa 2] Corona 355ml         ₡ 5,000
   ------------------------------------------
   `

---

## 8. Cross-Cutting Analysis: Interactions with R1, R2, R3

| Requirement | Description | Intersection with Table & Order State |
|---|---|---|
| **R1 (Comandero Button)** | Toggle between 🔥 Enviar a Cocina and 💾 Guardar | Must check items.some(it => !it.enviado && it.destino === 'cocina'). When tables are merged, any new food item added under either origin mesa must trigger 🔥 Enviar a Cocina. |
| **R2 (KDS & Table States)** | KDS completion sets table to **Activa (Azul)**; partial dispatch sets **Esperando Parcial** with tooltip | When tables are merged, pending KDS items are aggregated. If all food items across both merged tables are ready, both merged tables update to ctiva. Tooltips display pending items grouped or tagged by table. |
| **R3 (Happy Hour)** | 2x1 promotions calculated accurately and auto-disabled at scheduled time | Happy Hour 2x1 calculation must apply to all eligible items in the combined order, while maintaining accurate per-item price provenance. |

---

## 9. Risk Analysis & Mitigation

1. **Touch Scroll Conflict:**
   - *Risk:* Long press might trigger browser text selection or viewport pinch/zoom.
   - *Mitigation:* Set user-select: none; -webkit-user-select: none; touch-action: none; on table cards. Cancel long-press timer if pointer moves > 10px before the 400ms threshold.
2. **Data Integrity on Undo (Separar Mesas):**
   - *Risk:* If additional items were ordered after merging, where do they go when separating?
   - *Mitigation:* Any item ordered after merging is tagged with origen_mesa_id = mesaPrincipalId (or the waiter's explicitly chosen table seat). When separated, items tagged with Mesa 2 go back to Mesa 2, and items tagged with Mesa 1 stay with Mesa 1. Neither table loses items.
3. **Database Concurrency:**
   - *Risk:* SQLite table lock errors during concurrent socket updates.
   - *Mitigation:* Wrap table transfers and merge operations in database transactions or sequential promises (db.serialize()).
