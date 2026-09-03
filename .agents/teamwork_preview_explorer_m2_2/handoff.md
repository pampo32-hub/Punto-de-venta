# Handoff Report: Frontend UI & CSS Architecture for Milestone 2 (KDS States, Partial Deliveries & Wait Time Tooltips)

**Agent**: Explorer 2 (teamwork_preview_explorer_m2_2)  
**Parent Agent**: daee7906-6fc1-4186-8f07-d5a1ff0ad582 (parent)  
**Working Directory**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m2_2`  
**Workspace Directory**: `C:\Users\Juan\punto-de-venta`  
**Date**: 2026-09-03  
**Handoff Type**: Hard Handoff (Investigation & Architecture Complete)

---

## 1. Observation

1. **Table States Rendering in `public/app.js` (`renderSalón`)**:
   - In `public/app.js` lines 780–786:
     ```javascript
     const estadoEtiqueta = {
       libre: 'Libre',
       ocupada: 'Ocupada',
       abierta: 'Abierta',
       esperando: 'Esperando',
       cuenta: 'Cuenta Pedida'
     }[m.estado] || 'Libre';
     ```
   - Verbatim Observation: Neither `'activa'` nor `'esperando_parcial'` is present in `estadoEtiqueta`. If a table is in state `'activa'` or `'esperando_parcial'`, its label defaults to `'Libre'`.

2. **CSS Table States in `public/styles.css`**:
   - In `public/styles.css` lines 370–395:
     ```css
     .mesa-render-card.libre { border-color: #10b98166; ... }
     .mesa-render-card.ocupada { border-color: #ef444499; ... }
     .mesa-render-card.abierta { border-color: var(--primary); ... }
     .mesa-render-card.esperando { border-color: var(--accent); ... }
     .mesa-render-card.cuenta { border-color: var(--warning); ... }
     ```
   - Verbatim Observation: CSS rules for `.mesa-render-card.activa` and `.mesa-render-card.esperando_parcial` do NOT exist anywhere in `public/styles.css`.
   - Tooltip styles (`.mesa-tooltip`, `.m-wait-chip`, `.tooltip-header`, `.tooltip-list`) do not exist in `public/styles.css`.

3. **Salon Legend in `public/index.html`**:
   - In `public/index.html` lines 250–255:
     ```html
     <div class="legend-group">
       <span class="legend-badge libre"><span class="dot"></span> Libre</span>
       <span class="legend-badge ocupada"><span class="dot"></span> Ocupada</span>
       <span class="legend-badge esperando"><span class="dot"></span> Esperando Comida</span>
       <span class="legend-badge cuenta"><span class="dot"></span> Cuenta Pedida</span>
     </div>
     ```
   - Verbatim Observation: The legend lacks entries for "Esperando Parcial" and "Activa".
   - Corresponding dot indicators in `public/styles.css` lines 278–281 lack `.legend-badge.activa .dot` and `.legend-badge.esperando_parcial .dot`.

4. **KDS Dispatching and Socket Handlers in `public/app.js`**:
   - In `public/app.js` lines 1066–1079 (`window.despacharKDSBackend`):
     Calls `cargarKDSDesdeBackend()`, but does NOT call `cargarMesasDesdeBackend()`.
   - In `public/app.js` lines 108–139:
     Socket listener `socket.on('comanda_estado_cambiado')` is NOT registered. When another station dispatches dishes, the salon floor map is not refreshed.

5. **Existing E2E Test Suite Status**:
   - Executed command: `npm.cmd test`
   - Result: 58 test cases passing across 12 suites in 3.139s (Exit code 0).
   - Domain specification functions already implemented in `test/helpers/test-server.js`:
     - `evaluarEstadoMesaKDS(detalles)` (lines 274–293)
     - `formatearTooltipEspera(primeraComandaHora, itemsPendientes, ahora)` (lines 300–314)

---

## 2. Logic Chain

1. **Activa Blue State Requirement**:
   - *Requirement (R2)*: When all kitchen items for a table are marked "Listo", the table transitions to "Activa" (color Blue).
   - *Observation*: `server.js` updates `Mesas.estado = 'activa'`. When `renderSalón()` renders the card, it assigns class `mesa-render-card activa`.
   - *Inference*: Without `.mesa-render-card.activa` in CSS and without `activa: 'Activa'` in `estadoEtiqueta`, the table renders without blue styling and displays "Libre".
   - *Deduction*: Adding `.mesa-render-card.activa` (`border-color: #2563eb`, background gradient with blue tint, badge background `#1d4ed8`, text `#93c5fd`) and mapping `activa: 'Activa'` completes the requirement.

2. **Esperando Parcial State Requirement**:
   - *Requirement (R2)*: If only a portion of dishes are ready and others pending, table shows "Esperando Parcial" and the tooltip lists ONLY pending dishes.
   - *Observation*: `server.js` sets `Mesas.estado = 'esperando_parcial'`. Currently `renderSalón()` falls back to "Libre".
   - *Inference*: Adding `.mesa-render-card.esperando_parcial` (`border-color: #f59e0b`, amber gradient background, badge `#78350f` with gold text `#fde047`) and mapping `esperando_parcial: 'Esperando Parcial'` satisfies visual requirement.
   - *Deduction*: Tooltip generation logic must filter out ready dishes (`estado_comanda === 'listo'`) and format only pending dishes (`estado_comanda IN ('pendiente', 'preparando')`).

3. **Wait Tooltip & Touch Interaction**:
   - *Requirement (R2)*: Hover or tap on table card must show tooltip with pending dishes and elapsed time ("Esperando hace X min").
   - *Observation*: Desktop users hover with a mouse (`:hover`), whereas tablet/mobile users tap with fingers (`click` / `touchstart`).
   - *Inference*: Clicking on a table card currently triggers `abrirComanderoMesa(m.id)` to open the order modal. If a touch user taps the card to view the tooltip, it would open the modal and dismiss the floor map.
   - *Deduction*: Adding a visible wait chip (`.m-wait-chip` showing `⏱️ Xm`) with `e.stopPropagation()` enables mobile users to tap the chip to toggle the tooltip (`.mesa-tooltip.show-touch`) without opening the order modal, while desktop users see the tooltip on mouse hover anywhere on the card.

4. **KDS Dispatch Synchronization**:
   - *Requirement (R2)*: Table state updates when kitchen dispatches dishes.
   - *Observation*: When a dish is marked ready in KDS, `server.js` emits `comanda_estado_cambiado` and `mesa_actualizada`.
   - *Inference*: Registering `socket.on('comanda_estado_cambiado')` and calling `cargarMesasDesdeBackend()` in `despacharKDSBackend` guarantees the floor map updates in real time on both the dispatching terminal and peer terminals.

---

## 3. Caveats

1. **Backend Dependency on `/api/mesas` Data Structure**:
   - For the tooltip to display instant wait times and pending dish names without asynchronous hover lag, `GET /api/mesas` should return `primera_comanda_hora` and `items_pendientes` for active tables.
   - *Explorer 1* is responsible for adding these fields to `GET /api/mesas` in `server.js`. The frontend plan includes graceful fallbacks (`m.primera_comanda_hora || null`, `m.items_pendientes || []`) so the UI never crashes if fields are omitted.
2. **Milestone 4 Drag & Drop Coexistence**:
   - Milestone 4 will introduce long-press drag-and-drop on table cards. The tooltip touch implementation uses a dedicated `.m-wait-chip` tap listener with `e.stopPropagation()`, ensuring zero conflict with future pointer drag-and-drop gestures.
3. **No Code Modification Undertaken**:
   - As an Explorer agent, no changes have been committed to `public/app.js`, `public/styles.css`, or `public/index.html`. All changes are detailed in the Worker implementation plan.

---

## 4. Conclusion

A concrete, production-ready frontend plan is established for Worker implementation:
1. **`public/styles.css`**: Add `.mesa-render-card.activa` (Blue `#2563eb`), `.mesa-render-card.esperando_parcial` (Amber `#f59e0b`), `.legend-badge.activa`, `.legend-badge.esperando_parcial`, `.m-wait-chip`, `.mesa-tooltip` with smart top/bottom arrow positioning, and `.show-touch` styles.
2. **`public/app.js`**:
   - Implement and export `evaluarEstadoMesaKDS` and `formatearTooltipEspera`.
   - Update `renderSalón()` to render `estadoEtiqueta` ('Activa', 'Esperando Parcial'), native title attributes, `.m-wait-chip`, and `.mesa-tooltip`.
   - Attach touch tap handler to `.m-wait-chip` (`e.stopPropagation()`) and document-level click-outside dismisser.
   - Register `socket.on('comanda_estado_cambiado')` and call `cargarMesasDesdeBackend()` in `despacharKDSBackend`.
   - Add a 30-second live minute ticker for active tables.
3. **`public/index.html`**: Add "Esperando Parcial" and "Activa" badges to `.legend-group`.

---

## 5. Verification Method

### 5.1 Automated Regression Verification
Run the 58 E2E test cases:
```powershell
npm.cmd test
```
*Expected Result*: All 58 tests pass (100% pass rate, exit code 0).

### 5.2 Unit Verification of Exported Domain Contracts
Run Node one-liner to verify frontend functions match test contracts:
```powershell
node -e "const { evaluarEstadoMesaKDS, formatearTooltipEspera } = require('./test/helpers/test-server.js'); console.log(evaluarEstadoMesaKDS([{destino:'cocina', estado_comanda:'listo'}])); console.log(formatearTooltipEspera(new Date(Date.now()-720000).toISOString(), ['Rib Eye']).titulo);"
```
*Expected Output*:
```
activa
⏱️ Esperando hace 12 min
```

### 5.3 UI DOM & Visual Inspection
1. Inspect `public/app.js` with `view_file` to ensure `estadoEtiqueta` includes `activa` and `esperando_parcial`, and `formatearTooltipEspera` is defined.
2. Inspect `public/styles.css` with `view_file` to verify `.mesa-render-card.activa` (#2563eb) and `.mesa-render-card.esperando_parcial` (#f59e0b).
3. Inspect `public/index.html` with `view_file` to verify `.legend-group` contains the 2 new badges.

### 5.4 Invalidation Conditions
This handoff is invalidated if:
1. `npm test` fails or regresses any test.
2. Table in "activa" renders as green or red instead of Blue (`#2563eb`).
3. Tooltip on a partially dispatched table contains dishes marked as "listo" or bar drinks.
4. Tapping a table wait chip on mobile forces the table modal to open instead of toggling the tooltip.
