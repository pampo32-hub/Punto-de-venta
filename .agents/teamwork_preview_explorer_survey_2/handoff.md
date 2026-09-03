# Handoff Report: Business Logic, Comandas, KDS & Happy Hour (R1, R2, R3)

**Author**: Explorer 2 (Survey Phase)  
**Recipient**: Parent Agent / Implementer  
**Date**: 2026-09-03  
**Working Directory**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2`  
**Workspace Directory**: `C:\Users\Juan\punto-de-venta`  
**Detailed Report**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2\analysis.md`  

---

## 1. Observation

### 1.1 Comandas & Food vs Beverage Classification (R1)
- In `database.js` (lines 57-58, 70, 150), `Categorias`, `Productos`, and `DetalleOrden` define a `destino` column defaulting to `'cocina'`.
- Running `node -e "const db = require('./database'); db.all('SELECT id, nombre, destino FROM Categorias', (e, r) => console.log(r));"` confirms:
  - Categories 1 & 2 (`'Bebidas & Cervezas'`, `'Coctelería & Tragos'`) have `destino = 'barra'`.
  - Categories 3 to 6 (`'Bocas & Entradas'`, `'Platos Fuertes'`, `'Hamburguesas & Snacks'`, `'Postres & Café'`) have `destino = 'cocina'`.
- In `public/app.js` (lines 709-720 & 827-837):
  - Items loaded from an existing order have `enviado: true` and `id_detalle_existente`.
  - New items added to the table have `enviado: false`.
- In `public/app.js` (lines 23-46), `actualizarBotonEnviarComanda()` contains:
  ```javascript
  const tieneComida = estado.mesaActiva.items.some(it => 
    it.destino === 'cocina' || 
    (it.curso && it.curso <= 3 && it.destino !== 'barra')
  );
  if (tieneComida) {
    btn.innerHTML = '🔥 Enviar a Cocina';
    btn.className = 'btn-btn-cmd cocina';
  } else {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
  }
  ```
  `actualizarBotonEnviarComanda()` evaluates all items in `estado.mesaActiva.items` without checking `!it.enviado`.
- In `public/app.js` (lines 965-982), `btnEnviarComandaCocina` click handler repeats this unconditioned `some()` check and alerts `'🔔 ¡Comanda enviada a cocina!'` instead of saving.
- In `server.js` (line 552), `POST /api/comandas/enviar` unconditionally executes:
  `UPDATE Mesas SET estado = 'esperando', mesero = ? WHERE id = ?`, regardless of whether new kitchen items were dispatched.

### 1.2 KDS Status Transitions, Wait Times & Partial Deliveries (R2)
- In `server.js` (lines 684-695), `POST /api/kds/:detalleId/estado` only executes:
  `UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?` and emits `comanda_estado_cambiado`.
  It does NOT query `Ordenes` or `Mesas`, does NOT evaluate whether all or some dishes are ready, and does NOT update `Mesas.estado`.
- In `public/app.js` (lines 109-141), WebSockets listeners include `nueva_comanda`, `mesa_actualizada`, `lanzar_fuertes`, `comanda_anulada`, `producto_agotado_cambiado`, `producto_visual_cambiado`, `mesas_reorganizadas`, `cliente_pidio_cuenta`.
  `comanda_estado_cambiado` has **no listener**.
- In `server.js` (lines 345-358), `GET /api/mesas` queries `Mesas` left joined with `Ordenes`. It does not return any details about pending kitchen items, wait times, or dish completion counts.
- In `public/styles.css` (lines 370-389):
  Only `.mesa-render-card.libre`, `.mesa-render-card.ocupada`, `.mesa-render-card.esperando`, and `.mesa-render-card.cuenta` are defined.
  Classes `.mesa-render-card.activa` (blue) and `.mesa-render-card.esperando_parcial` are **absent**.
- In `public/index.html` (lines 251-255), the salon legend only has badges for `libre`, `ocupada`, `esperando`, and `cuenta`. Badges for `esperando_parcial` and `activa` are absent.
- In `public/styles.css`, grep search for `tooltip` returns 0 results. No tooltip styling or markup exists on `.mesa-render-card`.

### 1.3 Happy Hour 2x1 & Expiration Engine (R3)
- Running `node -e "const db = require('./database'); db.all('SELECT id, nombre, happy_hour FROM Productos', (e, r) => console.log(r));"` reveals:
  Every product in `pos.db` (including Imperial, Pilsen, Corona, Mojito, Margarita) has `happy_hour: 0`.
- In `public/app.js`:
  - Line 80: `happyHourActivo: true`.
  - Line 642: `happyHour: Boolean(p.happy_hour)` -> Evaluates to `false` for all products.
  - Line 675: `isPromo = estado.happyHourActivo && p.happyHour` -> Evaluates to `false`.
  - Line 683: `prod-badge-promo` is never rendered.
  - Line 933: In `recalcularTotalesTicket()`, `it.happyHour` is `false`, so `descuentoHH` is 0.
- In `public/styles.css`, `.prod-badge-promo` has no CSS declaration.
- In `server.js` (lines 580-587):
  ```javascript
  if (happyHourActivo) {
    rows.forEach(r => {
      if (r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')) {
        const pares = Math.floor(r.cantidad / 2);
        descuentoHH += pares * r.precio_unitario;
      }
    });
  }
  ```
  The backend ignores `p.happy_hour` from the database and uses hardcoded strings. The frontend ticket total and backend stored total diverge.
- In `server.js` `/api/mesas/unir` (lines 468-474) and `/api/comandas/anular-item` (lines 642-648), order recalculations omit `descuento_happy_hour`, resetting it to 0.
- In `public/app.js` (lines 1916-1934), `initHappyHour()` only flips a local boolean upon clicking `btnToggleHappyHour`. There is no schedule comparison, no timer, and no auto-expiration logic.

---

## 2. Logic Chain

1. **R1 Button Toggle**:
   - *From 1.1*: An existing order item has `enviado: true`, whereas newly added products have `enviado: false`.
   - *Reasoning*: The user requirement states that adding drinks or bar items to a table with already-sent food must display `"💾 Guardar"`, and only display `"🔥 Enviar a Cocina"` when *new un-sent* kitchen items exist.
   - *Inference*: Because `actualizarBotonEnviarComanda()` checks `items.some(...)` without filtering by `!it.enviado`, previously sent food items cause `tieneComida` to evaluate to `true` permanently. Filtering by `!it.enviado && (it.destino === 'cocina' || (it.curso <= 3 && it.destino !== 'barra'))` restores exact compliance with R1.

2. **R2 KDS Dispatch & Table States**:
   - *From 1.2*: `POST /api/kds/:detalleId/estado` only modifies `DetalleOrden`, leaving `Mesas.estado` unchanged.
   - *Reasoning*: A table's status reflects the aggregation of its kitchen comanda items:
     - 0 pending kitchen items remaining + at least 1 ready dish $\rightarrow$ all food is delivered $\rightarrow$ table must transition to `'activa'` (Color Azul).
     - At least 1 ready dish + at least 1 pending dish $\rightarrow$ partial food delivery $\rightarrow$ table must transition to `'esperando_parcial'`.
     - 0 ready dishes + at least 1 pending dish $\rightarrow$ initial waiting $\rightarrow$ table is `'esperando'`.
   - *Inference*: Calculating this transition in `POST /api/kds/:detalleId/estado` and `POST /api/comandas/enviar`, saving it to `Mesas`, and emitting `mesa_actualizada` ensures that salon and kitchen remain synchronized.

3. **R2 Elapsed Wait Time & Tooltips**:
   - *From 1.2*: `GET /api/mesas` does not query pending items or timestamps.
   - *Reasoning*: R2 requires showing elapsed time from the first comanda (`"Esperando hace X min"`) and listing *only* pending items on hover/tap.
   - *Inference*: `GET /api/mesas` must join or fetch pending kitchen items from `DetalleOrden` (`estado_comanda IN ('pendiente', 'preparando')`), calculate `primera_comanda_hora` (min `hora_pedido`), and supply `items_cocina_pendientes`. The frontend can then calculate minutes elapsed dynamically and populate the tooltip excluding completed dishes.

4. **R3 Happy Hour 2x1 Alignment & Expiration**:
   - *From 1.3*: In `pos.db`, `happy_hour` is 0 for all items, disabling frontend 2x1 badges and ticket discount calculations, while `server.js` computes discounts using hardcoded product names.
   - *Reasoning*: The database is the single source of truth. If beers and cocktails have `happy_hour = 1` in the database, the frontend catalog can show `2x1 PROMO`, the ticket engine can compute $pares \times precio$, and the backend can match by querying `p.happy_hour = 1`.
   - *From 1.3*: `initHappyHour()` lacks timer logic.
   - *Reasoning*: R3 mandates auto-deactivation when reaching the scheduled end time (e.g. 19:00 / 7:00 PM).
   - *Inference*: Running a clock verification interval (e.g. every 10s) comparing current time against the programmed window auto-expires Happy Hour, updates the UI pill, alerts users, and restores standard catalog prices without manual intervention.

---

## 3. Caveats

1. **Other Explorers / Agents**: Explorer 1 or peer agents may be analyzing Table Drag & Drop (R4) and database synchronization. Changes to `server.js` (`/api/mesas`) and `public/app.js` must coordinate without conflicting with table movement routes.
2. **Order Status Representation**: `Ordenes.estado` in existing code had queries expecting `'activa'`, `'abierta'`, `'esperando'`, and `'cuenta_pedida'`. When transitioning `Mesas.estado` to `'activa'` or `'esperando_parcial'`, queries joining `Ordenes` must ensure `o.estado IN ('abierta', 'esperando', 'activa', 'cuenta_pedida')` so the order remains attached to the table.
3. **Timezones**: Timestamps in SQLite use ISO 8601 strings (`new Date().toISOString()`). Wait time calculation using `Date.now() - new Date(isoString).getTime()` operates correctly across UTC and local time offsets.

---

## 4. Conclusion

The business logic, state machines, and calculations for R1, R2, and R3 are fully analyzed with exact line numbers and concrete code solutions:
- **R1**: Solved by filtering items in `actualizarBotonEnviarComanda()` by `!it.enviado` and checking `destino === 'cocina'`.
- **R2**: Solved by evaluating kitchen comanda completion on KDS dispatch, transitioning tables between `'esperando'`, `'esperando_parcial'`, and `'activa'` (Azul), returning pending items in `/api/mesas`, and rendering a hover/tap tooltip with elapsed wait time.
- **R3**: Solved by updating `happy_hour = 1` in `Productos`, standardizing 2x1 calculations on `p.happy_hour` across catalog and server, adding CSS for `.prod-badge-promo`, and implementing an automated `setInterval` clock check that deactivates Happy Hour when reaching scheduled expiration.

---

## 5. Verification Method

### 5.1 Independent Code & File Inspection
1. Inspect `public/app.js`:
   - Line 23: `actualizarBotonEnviarComanda`
   - Line 675: `renderGridProductos`
   - Line 827: `abrirComanderoMesa`
   - Line 931: `recalcularTotalesTicket`
   - Line 959: `btnEnviarComandaCocina` click handler
   - Line 1916: `initHappyHour`
2. Inspect `server.js`:
   - Line 345: `GET /api/mesas`
   - Line 530: `POST /api/comandas/enviar`
   - Line 580: Hardcoded Happy Hour calculation
   - Line 684: `POST /api/kds/:detalleId/estado`
3. Inspect `public/styles.css`:
   - Lines 370-389: Mesa card states
   - Lack of `.activa`, `.esperando_parcial`, `.mesa-kds-tooltip`, `.prod-badge-promo`.

### 5.2 Test Commands
To verify database contents and Happy Hour flags:
```powershell
node -e "const db = require('./database'); db.all('SELECT id, nombre, precio, destino, happy_hour FROM Productos', (e, r) => console.table(r));"
```
To verify existing categories and destinations:
```powershell
node -e "const db = require('./database'); db.all('SELECT id, nombre, destino FROM Categorias', (e, r) => console.table(r));"
```
To verify server launch and syntax integrity:
```powershell
node -e "require('./server'); setTimeout(() => process.exit(0), 1000);"
```

### 5.3 Invalidation Conditions
- If `Productos` table does not contain `destino` or `happy_hour` columns, database migrations in `database.js` would need adjustment. (Verified: both columns exist).
- If client-side order items did not track `enviado`, an extra field would be required. (Verified: `enviado` is already set when loading and dispatching items).
