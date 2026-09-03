# Handoff Report - Explorer Survey 1 (Architecture, UI & State Structure)

**Agent ID**: `teamwork_preview_explorer_survey_1`  
**Parent Agent**: `orchestrator_1` (`5aba5165-6495-47b3-a6cf-9cb338097fb9`)  
**Handoff Type**: Hard (Task Complete)  
**Report Reference**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_1\analysis.md`  

---

## 1. Observation

1. **Tech Stack & Dependencies**:
   - `package.json` lines 1–15 shows dependencies: `"cors": "^2.8.6"`, `"dotenv": "^17.4.2"`, `"express": "^5.2.1"`, `"qrcode": "^1.5.4"`, `"socket.io": "^4.8.3"`, `"sqlite3": "^6.0.1"`.
   - Scripts are `"start": "node server.js"` and `"dev": "node --watch server.js"`. No automated test framework is configured.

2. **Comandero Button Defect (R1)**:
   - `public/index.html` line 474: `<button class="btn-btn-cmd cocina" id="btnEnviarComandaCocina">🔥 Enviar a Cocina</button>`.
   - `public/app.js` lines 23–46: `actualizarBotonEnviarComanda()` evaluates:
     ```javascript
     const tieneComida = estado.mesaActiva.items.some(it => 
       it.destino === 'cocina' || 
       (it.curso && it.curso <= 3 && it.destino !== 'barra')
     );
     ```
     This inspects all items currently attached to `estado.mesaActiva.items`, regardless of whether `it.enviado` is true or false.
   - When table orders are fetched in `abrirComanderoMesa()` (`app.js` line 836), existing items are mapped with `enviado: true`. Newly added items (`app.js` line 718) have `enviado: false`. Because `actualizarBotonEnviarComanda()` does not check `!it.enviado`, existing food items permanently keep the button in "🔥 Enviar a Cocina" mode even if only bar drinks are newly added.

3. **KDS State & Wait Time Disconnect (R2)**:
   - `server.js` lines 684–695 (`app.post('/api/kds/:detalleId/estado')`) only updates `DetalleOrden.estado_comanda` and `hora_listo`. It does NOT query parent orders to determine if all kitchen items for that table are finished, never updates `Mesas.estado` to `'activa'`, and does not emit `mesa_actualizada`.
   - `public/app.js` lines 110–140: Socket.IO listeners handle `nueva_comanda`, `mesa_actualizada`, `lanzar_fuertes`, `comanda_anulada`, `producto_agotado_cambiado`, `producto_visual_cambiado`, `mesas_reorganizadas`, and `cliente_pidio_cuenta`. **`comanda_estado_cambiado` is completely unhandled.**
   - In `public/styles.css` lines 370–418, only `.libre` (green), `.ocupada` (red), `.esperando` (orange), and `.cuenta` (amber pulse) are styled. There are no styles for `.activa` (blue) or `.esperando_parcial`.
   - In `public/app.js` lines 764–803 (`renderSalón`), no tooltip exists on `.mesa-render-card`; hover only scales the card.

4. **Happy Hour Discrepancies (R3)**:
   - In `pos.db`, query `SELECT id, nombre, precio, destino, happy_hour FROM Productos` returned `happy_hour: 0` for all 17 seeded items.
   - `public/app.js` line 675: `const isPromo = estado.happyHourActivo && p.happyHour;`. Because `p.happyHour` is always false, 2x1 badges never render in catalog.
   - `server.js` lines 580–587 calculates discounts using hardcoded name substrings: `r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')`, diverging from the client.
   - `public/app.js` lines 1916–1934 (`initHappyHour`): only toggles `estado.happyHourActivo = !estado.happyHourActivo`. There is no schedule check or auto-deactivation timer.

5. **Table Move, Merge, Split & Drag & Drop (R4)**:
   - `public/app.js` lines 800: `card.addEventListener('click', () => abrirComanderoMesa(m.id));`. There is no touch or mouse dragging in `renderSalón` (it only exists in `renderEditorPlano`, lines 1727–1769).
   - `server.js` lines 459–483 (`app.post('/api/mesas/unir')`): merges orders with `UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?`. It does not record `mesa_origen` on `DetalleOrden`.
   - `database.js` table `DetalleOrden` lacks columns for `mesa_origen` or `orden_origen_id`. As a consequence, merged item origins cannot be displayed in tickets or KDS, and undoing/separating merged tables is currently impossible.

---

## 2. Logic Chain

1. **R1 Deduction**:
   - Observation 2 demonstrates that `actualizarBotonEnviarComanda()` evaluates `tieneComida` across all items without checking `!it.enviado`.
   - When a table with already-sent kitchen food adds drinks, `tieneComida` evaluates to `true` because the previous food item satisfies the condition.
   - Therefore, filtering for `!it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))` will correctly restore dynamic switching between "🔥 Enviar a Cocina" and "💾 Guardar".

2. **R2 Deduction**:
   - Observation 3 proves that KDS state changes are not wired to table state transitions or salon notifications.
   - Because `server.js` does not check remaining kitchen items upon marking an item ready, tables remain stuck in `esperando` even after all dishes are served.
   - When all kitchen items are ready, setting `Mesas.estado = 'activa'`, styling `.mesa-render-card.activa` in blue, and emitting `mesa_actualizada` closes this loop.
   - Implementing a floating tooltip on `.mesa-render-card` calculating elapsed minutes since the earliest `hora_pedido` and listing pending dishes provides the exact real-time visibility required.

3. **R3 Deduction**:
   - Observation 4 shows three breaks in Happy Hour: DB `happy_hour` flag is 0 for all items, client calculation relies on `it.happyHour`, and server calculation relies on string matching.
   - Reconciling the database seed/schema to set `happy_hour = 1` for target drinks and aligning server/client logic fixes promotion application.
   - Adding a 1-minute interval timer comparing current time against the scheduled end time achieves autonomous auto-deactivation.

4. **R4 Deduction**:
   - Observation 5 confirms that salon cards only respond to click events, while merge execution erases table origin metadata.
   - Implementing a long-press listener (>400ms) creates the touch and mouse drag gesture without interfering with single-click opening of the comandero.
   - Adding `mesa_origen` to `DetalleOrden` preserves item origin metadata during merges, enabling `[Mesa 1]` labels and making separation/undo reversible.

---

## 3. Caveats

- **No Automated Tests**: The codebase has 0 automated unit or integration tests. End-to-end verification currently requires spinning up `server.js` and driving HTTP/WebSocket calls.
- **Hardware Integrations**: ESC/POS thermal printers and electronic invoice signatures for Ministerio de Hacienda are currently simulated with dummy/mock responses.
- **Single-Zone Canvas Assumption**: Table coordinates `x` and `y` are stored globally in `Mesas` without per-zone canvas offset separation.

---

## 4. Conclusion

The GastroBar Pro architecture is well-structured and highly amenable to clean modular enhancements. The root causes for all four requirements (R1, R2, R3, and R4) have been isolated down to exact file lines, database queries, and event handlers:
- **R1** requires a 10-line fix in `actualizarBotonEnviarComanda()` in `app.js` and conditional table status update in `server.js`.
- **R2** requires order lifecycle check in `/api/kds/:detalleId/estado`, `.activa` / `.esperando_parcial` CSS classes, a hover/tap tooltip, and a `comanda_estado_cambiado` WebSocket listener.
- **R3** requires seeding `happy_hour = 1` in `database.js`, harmonizing backend/frontend calculation logic, and adding an auto-expiration interval check.
- **R4** requires a pointer/touch long-press drag-and-drop controller on Salón cards, `mesa_origen` schema tracking on `DetalleOrden`, and a separation endpoint.

---

## 5. Verification Method

1. **Examine Source Code Locations**:
   - Verify `actualizarBotonEnviarComanda()` at `C:\Users\Juan\punto-de-venta\public\app.js:23-46`.
   - Verify `renderSalón()` at `C:\Users\Juan\punto-de-venta\public\app.js:764-803`.
   - Verify KDS dispatch route at `C:\Users\Juan\punto-de-venta\server.js:684-695`.
   - Verify Happy Hour calculation at `C:\Users\Juan\punto-de-venta\server.js:580-587`.
   - Verify table merge route at `C:\Users\Juan\punto-de-venta\server.js:459-483`.

2. **Verify Database Content**:
   ```bash
   node -e "const db = require('./database'); db.all('SELECT id, nombre, precio, destino, happy_hour FROM Productos', (err, rows) => console.log(rows));"
   ```
   Confirms that all products currently have `happy_hour: 0`.

3. **Verify Server Execution**:
   ```bash
   cd C:\Users\Juan\punto-de-venta
   node server.js
   ```
   Access `http://localhost:4000` to inspect UI rendering and verify absence of blue `.activa` state on delivered tables.
