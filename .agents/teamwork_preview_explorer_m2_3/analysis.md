# Milestone 2 Analysis Report: KDS States, Partial Deliveries & Wait Time Tooltips (R2)

**Author:** Explorer 3 (Milestone 2 - Test Suite, Boundaries & Challenger Strategies)  
**Date:** 2026-09-03  
**Working Directory:** `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m2_3`  
**Workspace:** `C:\Users\Juan\punto-de-venta`  

---

## 1. Executive Summary

Milestone 2 operationalizes **Requirement R2** ("Estados de KDS, Entregas Parciales y Tiempos de Espera") across three key features:
1. **F4 (KDS Table State Transition)**: When all kitchen items for a table are marked `"listo"`, the table transitions to state `"activa"` with blue visual styling (`#1e40af` / `#2563eb`).
2. **F5 (Elapsed Wait Time Tooltip)**: Hover or tap on a table card with food in preparation displays a tooltip showing elapsed minutes from the earliest kitchen comanda (`"⏱️ Esperando hace X min"`).
3. **F6 (Partial Delivery Tracking)**: If only part of a table's kitchen items are ready while others are pending/preparing, the table displays `"esperando_parcial"` and the tooltip lists **only** the pending dishes (omitting ready dishes).

### Critical Architectural Finding
A thorough audit of the codebase revealed a **significant disconnect** between the existing E2E test suite and the actual system implementation:
- The existing tests in `test/e2e/tier1-features.test.js` (T1.7–T1.11) and `test/e2e/tier2-boundaries.test.js` (T2.6–T2.10) test the helper functions `evaluarEstadoMesaKDS()` and `formatearTooltipEspera()` in `test/helpers/test-server.js` as isolated unit tests.
- In `server.js`, `POST /api/kds/:detalleId/estado` (lines 769–780) **only updates `DetalleOrden`**. It does **NOT** check order dish completeness, does **NOT** update `Mesas.estado` to `'activa'` or `'esperando_parcial'`, does **NOT** update `Ordenes.estado`, and does **NOT** emit `mesa_actualizada`.
- In `server.js`, `GET /api/mesas` (line 352) has a join predicate:  
  `LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'cuenta_pedida')`  
  If an order transitions to `'activa'` or `'esperando_parcial'`, this query will **fail to join the active order**, leaving `orden_activa_id` as `NULL`!
- In `public/app.js` and `public/styles.css`, there are **no CSS classes** for `.mesa-render-card.activa` or `.mesa-render-card.esperando_parcial`, no tooltip DOM element on hover/tap, and the table card dictionary `estadoEtiqueta` lacks entries for `'activa'` and `'esperando_parcial'`.

This report verifies every existing test assertion, analyzes 10 critical edge cases, and provides empirical challenger test strategies and commands for the Worker, Reviewers, and Challengers.

---

## 2. Verification of Existing Test Suite (T1.5–T1.12 & T2.6–T2.10)

The E2E suite consists of 58 tests executed via Node's native runner (`node --test`). Below is the granular audit of every test relating to Feature 2 (R2):

### 2.1 Tier 1: Feature Coverage (`test/e2e/tier1-features.test.js`)

| Test ID | Test Title & Scope | Code Location | What It Asserts | Nature & Implementation Status |
|---|---|---|---|---|
| **T1.5** | `POST /api/comandas/enviar` creates order and transitions table to `"esperando"` | Lines 118–145 | 1. `res.status === 200`<br>2. `res.data.ordenId` truthy<br>3. `SELECT estado, mesero FROM Mesas`: `estado === 'esperando'`, `mesero === 'Carlos Solano'` | **Full Integration Test**: Exercises HTTP endpoint, SQLite persistence, and verifies `Mesas.estado`. |
| **T1.6** | `POST /api/comandas/enviar` saves bar items without failing | Lines 147–174 | 1. `res.status === 200`<br>2. `itemsDb.length === 1`<br>3. `itemsDb[0].destino === 'barra'` | **Full Integration Test**: Verifies bar items persist in `DetalleOrden` with `destino = 'barra'`. |
| **T1.7** | Table evaluates to `"esperando"` when all kitchen items are pending | Lines 180–187 | `evaluarEstadoMesaKDS(items) === 'esperando'` for pending/preparing items | **Contract Helper Unit Test**: Tests in-memory logic of helper in `test-server.js`. Does not hit `server.js` or DB. |
| **T1.8** | Table evaluates to `"esperando_parcial"` when some dishes are ready and others pending | Lines 189–197 | `evaluarEstadoMesaKDS(items) === 'esperando_parcial'` when 1 listo, 1 pendiente, 1 preparando | **Contract Helper Unit Test**: Tests in-memory logic of helper in `test-server.js`. |
| **T1.9** | Table evaluates to `"activa"` (Blue) when ALL kitchen items are marked `"listo"` | Lines 199–206 | `evaluarEstadoMesaKDS(items) === 'activa'` when 2 of 2 items are 'listo' | **Contract Helper Unit Test**: Tests in-memory logic of helper in `test-server.js`. |
| **T1.10** | Wait tooltip calculates correct elapsed minutes from `primera_comanda_hora` | Lines 208–217 | `formatearTooltipEspera(t0, ['Rib Eye', 'Chifrijo'], t0 + 12m)` returns `minutos: 12`, `titulo: '⏱️ Esperando hace 12 min'`, and includes dish names | **Contract Helper Unit Test**: Validates mathematical difference and string formatting. |
| **T1.11** | Wait tooltip excludes completed dishes and lists only pending items | Lines 219–229 | `formatearTooltipEspera(t0, ['Ceviche Mixto con Aguacate'], t0 + 10m)` returns `items.length === 1` | **Contract Helper Unit Test**: Validates pending list inclusion and completed omission. |
| **T1.12** | `POST /api/kds/:detalleId/estado` updates item status in `DetalleOrden` | Lines 230–253 | 1. Creates comanda via `POST /api/comandas/enviar`<br>2. Calls `POST /api/kds/:detalleId/estado` with `{ estado: 'listo' }`<br>3. Verifies DB: `estado_comanda === 'listo'`, `hora_listo !== null` | **Partial Integration Test**: Tests `DetalleOrden` update. **MISSING ASSERTION:** Does NOT verify that `Mesas.estado` transitioned to `'activa'`! |

### 2.2 Tier 2: Boundary & Corner Cases (`test/e2e/tier2-boundaries.test.js`)

| Test ID | Test Title & Scope | Code Location | What It Asserts | Nature & Implementation Status |
|---|---|---|---|---|
| **T2.6** | Table with only bar items (0 kitchen items) evaluates to `"abierta"`, never `"esperando"` | Lines 127–134 | `evaluarEstadoMesaKDS(barItems) === 'abierta'` when all items have `destino === 'barra'` | **Contract Helper Unit Test**: Verifies bar-only orders never flag waiting state. |
| **T2.7** | Single kitchen item table transitions directly from `"esperando"` to `"activa"` | Lines 136–145 | With 1 kitchen item: `'pendiente'` yields `'esperando'`; `'listo'` directly yields `'activa'` (skips partial) | **Contract Helper Unit Test**: Validates 1-item boundary (no partial state possible). |
| **T2.8** | Out-of-order KDS dispatch maintains accurate pending list | Lines 147–163 | 4 items (Ceviche: listo, Rib Eye: prep, Hamburguesa: listo, Postre: pend) -> `'esperando_parcial'`, pending list: `['Plato 1: Rib Eye', 'Postre: Tres Leches']` | **Contract Helper Unit Test**: Validates non-sequential kitchen completion. |
| **T2.9** | Wait time boundary: 0 minutes elapsed formats cleanly | Lines 164–171 | `now - justOrdered = 20s` -> `minutos: 0`, `titulo: '⏱️ Esperando hace 0 min'` | **Contract Helper Unit Test**: Validates zero-minute clamping and label format. |
| **T2.10** | Multiple kitchen orders at different times calculate wait time from earliest order | Lines 173–185 | Earliest timestamp (25 mins ago vs 5 mins ago) is used -> `minutos: 25` | **Contract Helper Unit Test**: Validates `MIN(hora_pedido)` policy for multi-comanda tables. |

### 2.3 Tier 3 & Tier 4 Assertions on Feature 2
- In `tier3-combinations.test.js`:
  - `T3.2`: Merged table partial delivery calls `evaluarEstadoMesaKDS(mergedDishes) === 'esperando_parcial'` and filters pending dish.
  - `T3.3`: Separating merged tables restores table states using `evaluarEstadoMesaKDS`.
  - `T3.6`: Merging active table with waiting table evaluates combined array to `'esperando_parcial'`.
  - `T3.8`: Table migration checks items remain in DB.
- In `tier4-scenarios.test.js`:
  - `T4.1` (Dining Lifecycle): Simulates KDS updates by calling `POST /api/kds/:id/estado`, but evaluates table states in memory via `evaluarEstadoMesaKDS(kitchenCurrent)` rather than checking `SELECT estado FROM Mesas`.

---

## 3. Comprehensive Edge Cases & Vulnerability Analysis

The Explorer investigated all boundary conditions, concurrency issues, and real-world kitchen operations. The following 10 edge cases must be handled by the implementation and defended by challenger tests:

### Edge Case 1: All Dishes Ready (Zero Pending Dishes)
- **Scenario**: Kitchen marks the last pending item ready.
- **Expected Behavior**:
  - `Mesas.estado` transitions to `'activa'`.
  - `Ordenes.estado` transitions to `'activa'`.
  - Card visually switches to blue background/border (`.mesa-render-card.activa`).
  - Badge text displays `"Activa"`.
  - Hover tooltip for pending dishes either hides or indicates "Todos los platillos servidos / Sin platillos pendientes".

### Edge Case 2: Pure Bar / Beverage Orders (Zero Kitchen Dishes)
- **Scenario**: Guests order beers, cocktails, or sodas with `destino === 'barra'`.
- **Expected Behavior**:
  - Table remains in `'abierta'` (or `'ocupada'`), NEVER transitions to `'esperando'`, `'esperando_parcial'`, or `'activa'`.
  - No wait-time tooltip is shown. Bar orders are prepared at the bar station, not in KDS.

### Edge Case 3: Out-of-Order / Mixed-Course Deliveries
- **Scenario**: Table orders Course 1 (Appetizer), Course 2 (Steak), Course 4 (Dessert). Kitchen finishes Course 2 first, or finishes Dessert before Steak.
- **Expected Behavior**:
  - Table state is `'esperando_parcial'`.
  - Tooltip MUST strictly list items with `estado_comanda IN ('pendiente', 'preparando')`.
  - Any item marked `'listo'` MUST NOT appear in the tooltip, regardless of its original course or position.

### Edge Case 4: Cumulative Orders with Multiple Timestamps
- **Scenario**: Guests order Appetizer at 12:00 (`hora_pedido: 12:00`). At 12:15, they add an Entree (`hora_pedido: 12:15`).
- **Expected Behavior**:
  - At 12:20, elapsed wait time must be calculated from **12:00** (`Math.floor((12:20 - 12:00) / 60000) = 20 min`).
  - Reference timestamp MUST be `MIN(hora_pedido)` among all kitchen items of the order.

### Edge Case 5: New Kitchen Item Added to an Already `activa` Table
- **Scenario**: Guests finished their meal (`activa` / Blue). At 12:45, they order an additional kitchen dessert (`Tres Leches`).
- **Expected Behavior**:
  - A new kitchen item with `estado_comanda = 'pendiente'` is inserted into `DetalleOrden`.
  - Table MUST transition back from `'activa'` to `'esperando'` (or `'esperando_parcial'` if previous items are counted).
  - Comanda button must revert from `"💾 Guardar"` to `"🔥 Enviar a Cocina"`.
  - Tooltip reappears listing the new pending dessert.

### Edge Case 6: Cancellation / Anulación of Pending Dishes
- **Scenario**: Table has 2 kitchen dishes: Steak (marked `'listo'`) and Fish (marked `'pendiente'`). Guest cancels the Fish due to delay via `POST /api/comandas/anular-item`.
- **Expected Behavior**:
  - Fish receives `estado_comanda = 'anulado'`.
  - Only valid remaining kitchen item is Steak (`'listo'`).
  - Table MUST immediately transition to `'activa'` (since 100% of remaining, uncancelled kitchen items are ready)!
  - If a table has only 1 kitchen item and it is cancelled, table should revert to `'abierta'`.

### Edge Case 7: Kitchen Status Reversal (Accidental Click in KDS)
- **Scenario**: Cook accidentally clicks "Listo" on Steak, transitioning table to `'activa'`. Cook immediately re-opens the dish, setting it back to `'preparando'` or `'pendiente'`.
- **Expected Behavior**:
  - Table state must revert from `'activa'` back to `'esperando_parcial'` (or `'esperando'`).
  - The dish must reappear in the hover tooltip.

### Edge Case 8: Clock Skew, Rapid Clicks & 0-Minute Boundary
- **Scenario**: Comanda sent at 12:00:10, user hovers over card at 12:00:15 (5 seconds elapsed), or client system clock is slightly behind server clock (`diffMs < 0`).
- **Expected Behavior**:
  - `diffMs` clamped with `Math.max(0, now - t0)`.
  - Tooltip cleanly displays `"⏱️ Esperando hace 0 min"`. Never negative numbers (e.g. `"-1 min"` or `NaN`).

### Edge Case 9: Line Items with Quantity > 1
- **Scenario**: Comanda has `DetalleOrden` row with `nombre_producto: 'Chifrijo'`, `cantidad: 2`.
- **Expected Behavior**:
  - In KDS, the line represents both units.
  - When marked ready, both units are delivered.
  - In tooltip, formatting displays product name clearly (`Chifrijo Tradicional` or `2x Chifrijo Tradicional`).

### Edge Case 10: Merged Tables (R4) with Mixed Kitchen Readiness
- **Scenario**: Table 1 (`activa`) is merged with Table 2 (`esperando`).
- **Expected Behavior**:
  - Combined table has 1 ready item (from Table 1) and 1 pending item (from Table 2).
  - Table evaluates to `'esperando_parcial'`.
  - Tooltip lists ONLY the pending item, tagged with origin: `[Mesa 2] Producto`.

---

## 4. Empirical Challenger Test Strategies

To provide impenetrable quality assurance beyond the existing contract helper unit tests, the Challengers should implement empirical white-box and end-to-end integration tests in `test/challenger-m2-kds.test.js`.

### Proposed Challenger Suites & Test Cases

#### Suite 1: Full-Stack KDS Lifecycle & Database Persistence
- **CH2.1**: `POST /api/kds/:id/estado` setting 1 of 2 dishes to `'listo'` updates `Mesas.estado` in SQLite to `'esperando_parcial'`.
- **CH2.2**: `POST /api/kds/:id/estado` setting 2 of 2 dishes to `'listo'` updates `Mesas.estado` in SQLite to `'activa'`.
- **CH2.3**: `GET /api/mesas` returns `orden_activa_id` and order totals for tables in state `'activa'` and `'esperando_parcial'` (verifying the `LEFT JOIN` fix).
- **CH2.4**: `GET /api/mesas` returns `primera_comanda_hora` and `items_pendientes` for active waiting tables.

#### Suite 2: WebSocket Event Broadcast
- **CH2.5**: Subscribing to Socket.IO `mesa_actualizada` verifies event emission with `{ mesaId, estado: 'esperando_parcial' }` when partial readiness occurs.
- **CH2.6**: Subscribing to Socket.IO `mesa_actualizada` verifies event emission with `{ mesaId, estado: 'activa' }` when all dishes are marked listo.

#### Suite 3: State Reversibility & Anulaciones
- **CH2.7**: Reversing a dish state in KDS from `'listo'` back to `'preparando'` dynamically reverts `Mesas.estado` from `'activa'` to `'esperando_parcial'`.
- **CH2.8**: Cancelling a pending dish (`POST /api/comandas/anular-item`) on an `'esperando_parcial'` table leaves only completed dishes, immediately transitioning `Mesas.estado` to `'activa'`.
- **CH2.9**: Cancelling all kitchen dishes on an `'esperando'` table transitions `Mesas.estado` back to `'abierta'`.

#### Suite 4: Multi-Course & Staggered Comandas
- **CH2.10**: Adding drinks to an `'esperando_parcial'` table preserves `'esperando_parcial'` state and does not add drinks to pending kitchen tooltip list.
- **CH2.11**: Adding a new kitchen dish to an `'activa'` table resets `Mesas.estado` back to `'esperando_parcial'` (or `'esperando'`).
- **CH2.12**: Multi-order wait timer correctly computes elapsed time from the earliest `hora_pedido`.

#### Suite 5: Client DOM & CSS Inspection
- **CH2.13**: Table card rendered in DOM receives CSS class `mesa-render-card activa` when table state is `'activa'`.
- **CH2.14**: Table card rendered in DOM receives CSS class `mesa-render-card esperando_parcial` when table state is `'esperando_parcial'`.
- **CH2.15**: Card badge renders `"Activa"` and `"Esperando Parcial"` respectively.
- **CH2.16**: Table card DOM contains tooltip with `"⏱️ Esperando hace X min"` and exact pending items bullet list.
- **CH2.17**: CSS stylesheet contains `.mesa-render-card.activa` with blue color scheme (`#1e40af` / `#2563eb` / `#1d4ed8`).

---

## 5. Implementation Roadmap for Worker

To assist Worker M2, here is the exact architectural prescription:

### Backend Changes (`server.js`)
1. **In `app.post('/api/kds/:detalleId/estado')` (line 769)**:
   - After updating `DetalleOrden`, retrieve `orden_id` from the updated item.
   - Fetch the order and its `mesa_id`: `SELECT id, mesa_id FROM Ordenes WHERE id = ?`.
   - Query all kitchen items for this order:
     `SELECT id, estado_comanda FROM DetalleOrden WHERE orden_id = ? AND destino = 'cocina' AND estado_comanda != 'anulado'`
   - Compute new table state:
     - If no kitchen items: `'abierta'`
     - Else if all items have `estado_comanda === 'listo'`: `'activa'`
     - Else if at least one item has `estado_comanda === 'listo'`: `'esperando_parcial'`
     - Else: `'esperando'`
   - Update `Mesas`: `UPDATE Mesas SET estado = ? WHERE id = ?`
   - Update `Ordenes`: `UPDATE Ordenes SET estado = ? WHERE id = ?`
   - Emit Socket.IO:
     - `io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: nuevoEstado, ... })`
     - `io.emit('comanda_estado_cambiado', { detalleId, estado, nuevoEstadoMesa: nuevoEstado, mesaId: orden.mesa_id })`
2. **In `app.get('/api/mesas')` (line 352)**:
   - Update `LEFT JOIN` condition:
     ```sql
     LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')
     ```
   - In the select or query mapping, provide `primera_comanda_hora` and `items_pendientes_cocina` (or include subquery):
     ```sql
     (SELECT MIN(hora_pedido) FROM DetalleOrden WHERE orden_id = o.id AND destino = 'cocina' AND estado_comanda != 'anulado') as primera_comanda_hora,
     (SELECT GROUP_CONCAT(nombre_producto, '||') FROM DetalleOrden WHERE orden_id = o.id AND destino = 'cocina' AND estado_comanda IN ('pendiente', 'preparando')) as items_pendientes_cocina
     ```
3. **In `app.post('/api/comandas/anular-item')` (line 708)**:
   - After setting item to `'anulado'`, recalculate table state in the same manner. If remaining items are all `'listo'`, update mesa to `'activa'`.

### Frontend Changes (`public/app.js`, `public/styles.css`, `public/index.html`)
1. **`public/app.js`**:
   - In `cargarMesasDesdeBackend()`: parse `primera_comanda_hora` and `items_pendientes_cocina`.
   - In `renderSalón()`:
     - Add dictionary keys to `estadoEtiqueta`:
       `activa: 'Activa'`, `esperando_parcial: 'Esperando Parcial'`.
     - Construct wait-time tooltip if table is `'esperando'` or `'esperando_parcial'`:
       Compute elapsed minutes: `Math.floor(Math.max(0, Date.now() - new Date(m.primera_comanda_hora).getTime()) / 60000)`.
       Title: `⏱️ Esperando hace ${minutos} min`.
       Items: list of pending dishes.
       Attach tooltip to card: element `.mesa-wait-tooltip` and HTML attribute `title`.
     - When table is `'activa'`, omit waiting tooltip.
   - Sockets: Add listener or ensure `socket.on('comanda_estado_cambiado')` or `socket.on('mesa_actualizada')` triggers `cargarMesasDesdeBackend()`.
2. **`public/styles.css`**:
   - Add `.mesa-render-card.activa`: blue background (`#1e3a8a` / `#1e40af`), blue border (`#3b82f6`), blue badge (`background: #1d4ed8; color: #93c5fd;`).
   - Add `.mesa-render-card.esperando_parcial`: amber background (`#78350f`), amber border (`#f59e0b`), amber badge (`background: #b45309; color: #fde68a;`).
   - Add `.mesa-wait-tooltip` styling: absolute positioning, z-index 100, dark background, rounded corners, padding, typography.
   - Add legend badges: `.legend-badge.activa` (blue dot) and `.legend-badge.esperando_parcial` (amber dot).
3. **`public/index.html`**:
   - In `.legend-group` (lines 250–255), add:
     `<span class="legend-badge activa"><span class="dot"></span> Activa (Servida)</span>`
     `<span class="legend-badge esperando_parcial"><span class="dot"></span> Esperando Parcial</span>`

---

## 6. Testing Commands & Pass Criteria

### 6.1 PowerShell Script Policy Note
On Windows systems, running `npm test` may trigger `PSSecurityException` due to PowerShell script execution policy on `npm.ps1`. Always use `npm.cmd` or direct Node runner commands:
```powershell
# Preferred direct execution
node --test --test-concurrency=1 test/e2e/*.test.js

# Or using npm.cmd wrapper
npm.cmd test
```

### 6.2 Test Commands by Role

| Role | Command Line | Scope / Target | Pass Criteria |
|---|---|---|---|
| **Worker M2** | `node --test test/e2e/tier1-features.test.js` | Fast feedback on Tier 1 (T1.7–T1.12) | 21 / 21 passing, 0 failures, < 1.0s |
| **Worker M2** | `node --test test/e2e/tier2-boundaries.test.js` | Fast feedback on Tier 2 (T2.6–T2.10) | 20 / 20 passing, 0 failures, < 1.0s |
| **Reviewer M2** | `node --test --test-concurrency=1 test/e2e/*.test.js` | Full regression across all 4 tiers | 58 / 58 passing (100%), 0 failures, < 4.0s |
| **Challenger M2** | `node --test test/challenger-m2-kds.test.js` | Adversarial M2 stress harness (DB persistence, Socket.IO, DOM, reversals) | 100% passing, 0 timeouts |
| **Final CI / Lead**| `node --test --test-concurrency=1 test/e2e/*.test.js test/challenger-m2-kds.test.js` | Complete acceptance | All E2E + all challenger tests passing |

---

## 7. Synthesis and Team Coordination

- **Explorer 1** is detailing the backend implementation in `server.js` and `database.js`. Our analysis confirms that `server.js` line 352 (`GET /api/mesas`) and line 769 (`POST /api/kds/:detalleId/estado`) are the critical touchpoints.
- **Explorer 2** is detailing the frontend implementation in `public/app.js` and `public/styles.css`. Our analysis provides the exact CSS selectors, badge labels, and tooltip formatting contract.
- **Worker & Reviewers** have exact pass criteria and edge case checklists to ensure zero regressions and 100% acceptance.
