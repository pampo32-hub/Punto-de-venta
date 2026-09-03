# Handoff Report: Milestone 2 Test Suite, Boundaries & Challenger Strategies

**Agent:** Explorer 3 (Milestone 2)  
**Working Directory:** `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m2_3`  
**Target:** Orchestrator, Worker M2, Reviewers & Challengers  
**Date:** 2026-09-03  

---

## 1. Observation

### Observation 1.1: E2E Test Suite Status
Running the existing test suite:
- Command: `node --test --test-concurrency=1 test/e2e/*.test.js`
- Output verbatim:
  ```
  ✔ Tier 1: Feature Coverage (R1 - R4) (772.6069ms)
  ✔ Tier 2: Boundary & Corner Cases (R1 - R4) (701.76ms)
  ✔ Tier 3: Cross-Feature Combinations (669.2751ms)
  ✔ Tier 4: Real-World Workload Scenarios (747.275ms)
  ℹ tests 58
  ℹ suites 12
  ℹ pass 58
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 3183.9416
  ```
All 58 tests currently pass.

### Observation 1.2: Tests for Feature 2 Test Isolated Helpers, Not Full-Stack Endpoints
In `test/e2e/tier1-features.test.js`:
- Lines 180–187 (T1.7):
  ```javascript
  it('T1.7: Table evaluates to "esperando" when all kitchen items are pending', () => {
    const items = [
      { id: 1, nombre_producto: 'Chifrijo', destino: 'cocina', estado_comanda: 'pendiente' },
      { id: 2, nombre_producto: 'Rib Eye', destino: 'cocina', estado_comanda: 'preparando' }
    ];
    const estado = evaluarEstadoMesaKDS(items);
    assert.strictEqual(estado, 'esperando');
  });
  ```
- Lines 189–197 (T1.8): Calls `evaluarEstadoMesaKDS(items)` with 1 ready, 2 pending, asserting `'esperando_parcial'`.
- Lines 199–206 (T1.9): Calls `evaluarEstadoMesaKDS(items)` with 2 ready items, asserting `'activa'`.
- Lines 208–217 (T1.10): Calls `formatearTooltipEspera(...)` asserting `minutos === 12` and `titulo === '⏱️ Esperando hace 12 min'`.
- Lines 219–229 (T1.11): Calls `formatearTooltipEspera(...)` asserting only pending items are in `tooltip.items`.
- Lines 230–253 (T1.12):
  ```javascript
  const kdsRes = await server.request(`/api/kds/${detalle.id}/estado`, {
    method: 'POST',
    body: { estado: 'listo' }
  });
  assert.strictEqual(kdsRes.status, 200);
  const updated = await server.dbGet('SELECT estado_comanda, hora_listo FROM DetalleOrden WHERE id = ?', [detalle.id]);
  assert.strictEqual(updated.estado_comanda, 'listo');
  assert.ok(updated.hora_listo, 'hora_listo timestamp should be populated');
  ```
  T1.12 asserts that `DetalleOrden.estado_comanda` is updated and `hora_listo` is populated, but does **not** assert that `Mesas.estado` transitioned to `'activa'` in SQLite.

In `test/e2e/tier2-boundaries.test.js`:
- Lines 127–185 (T2.6–T2.10): Directly tests `evaluarEstadoMesaKDS` and `formatearTooltipEspera` for bar-only items (`'abierta'`), single kitchen item transition (`'esperando'` -> `'activa'`), out-of-order dispatch, 0-minute boundary (`'⏱️ Esperando hace 0 min'`), and earliest order timestamp. None of these tests execute HTTP requests against `server.js` or query SQLite.

### Observation 1.3: Backend KDS Handler Does Not Update Table State
In `server.js`, lines 769–780:
```javascript
app.post('/api/kds/:detalleId/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    await dbRun('UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?', [estado, horaListo, req.params.detalleId]);
    
    io.emit('comanda_estado_cambiado', { detalleId: req.params.detalleId, estado });
    res.json({ message: 'Estado KDS actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```
`POST /api/kds/:detalleId/estado` does **not** recalculate kitchen completeness, does **not** update `Mesas.estado` to `'activa'` or `'esperando_parcial'`, does **not** update `Ordenes.estado`, and does **not** emit `mesa_actualizada`.

### Observation 1.4: `GET /api/mesas` Excludes `'activa'` and `'esperando_parcial'` Orders
In `server.js`, lines 348–355:
```javascript
    const mesas = await dbAll(`
      SELECT m.*, o.id as orden_activa_id, o.numero_orden, o.subtotal, o.descuento_happy_hour, 
             o.servicio_10, o.iva_13, o.total as orden_total, o.mesero as orden_mesero, o.cliente
      FROM Mesas m
      LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'cuenta_pedida')
      ORDER BY m.id ASC
    `);
```
The `LEFT JOIN` on `Ordenes` explicitly checks `o.estado IN ('abierta', 'esperando', 'cuenta_pedida')`. When an order transitions to `'activa'` or `'esperando_parcial'`, this join fails, resulting in `orden_activa_id = NULL`.

### Observation 1.5: Frontend Salon Map Lacks M2 States, Colors and Tooltips
In `public/app.js`, lines 780–786:
```javascript
    const estadoEtiqueta = {
      libre: 'Libre',
      ocupada: 'Ocupada',
      abierta: 'Abierta',
      esperando: 'Esperando',
      cuenta: 'Cuenta Pedida'
    }[m.estado] || 'Libre';
```
No mappings exist for `activa` or `esperando_parcial`.
In `public/styles.css`, lines 370–425: styles exist for `.mesa-render-card.libre`, `.ocupada`, `.abierta`, `.esperando`, `.cuenta`, but **no CSS class exists for `.activa` or `.esperando_parcial`**.
No tooltip element or hover/tap handler exists in `public/app.js`.

---

## 2. Logic Chain

1. **Premise 1 (from Obs 1.1 & 1.2)**: The existing 58 tests in Tiers 1-4 pass because tests for Feature 2 (T1.7–T1.11 and T2.6–T2.10) test contract helper functions exported by `test/helpers/test-server.js` in memory.
2. **Premise 2 (from Obs 1.3)**: `server.js` only updates `DetalleOrden` when KDS items are marked ready. Because `Mesas.estado` is never updated upon KDS completion, tables in a live environment remain in `'esperando'` indefinitely, violating Requirement R2 ("Cuando todas las comandas de cocina de una mesa se marquen como 'Listas', la mesa debe pasar a estado Activa (color Azul)").
3. **Premise 3 (from Obs 1.4)**: If `Mesas.estado` and `Ordenes.estado` were updated to `'activa'` or `'esperando_parcial'` without modifying `server.js:352`, `GET /api/mesas` would disassociate the table from its active order, causing total display `—` and preventing comandero re-opening.
4. **Premise 4 (from Obs 1.5)**: Even if the backend returned the updated table states, the frontend floor map would render tables with default styling, missing badges ("Libre" fallback), and would not display wait times or pending item tooltips on hover/tap.
5. **Conclusion**: To fulfill Milestone 2, Worker must implement the backend state machine in `POST /api/kds/:detalleId/estado`, update `GET /api/mesas` join and data payload, update `public/app.js` and `public/styles.css` for visual card states and tooltips, and Challengers must add empirical white-box tests that query SQLite and DOM elements directly to guarantee genuine end-to-end functionality.

---

## 3. Caveats

- **No modifications made**: In strict accordance with the read-only Explorer role, no source code, HTML, CSS, or test files were altered.
- **Mobile Touch vs Click Interaction**: On touch devices, a single tap currently opens the comandero (`abrirComanderoMesa`). For the tooltip on touch ("tap en táctil"), the frontend could display the tooltip in a preview popover or long-press, or tap card to show tooltip and a button to open comandero. Explorer 2 is detailing the exact UX pattern for this.
- **Assumptions**: We assume the database schema in SQLite does not require a new migration because `Mesas.estado` and `Ordenes.estado` are `TEXT` fields capable of storing `'activa'` and `'esperando_parcial'`.

---

## 4. Conclusion

1. **Test Suite Coverage Gap**: The current E2E suite verifies the domain mathematical rules for M2, but does not assert real server/database state changes on KDS dispatch.
2. **Backend Action Items**:
   - Update `server.js` `POST /api/kds/:detalleId/estado` to recalculate kitchen dish readiness (`SELECT estado_comanda FROM DetalleOrden WHERE orden_id = ? AND destino = 'cocina' AND estado_comanda != 'anulado'`), update `Mesas.estado` (`activa`, `esperando_parcial`, or `esperando`), update `Ordenes.estado`, and emit `mesa_actualizada` and `comanda_estado_cambiado`.
   - Update `server.js` `GET /api/mesas` line 352 to include `'activa'` and `'esperando_parcial'` in `o.estado IN (...)`, and provide `primera_comanda_hora` and `items_pendientes_cocina`.
   - Update `server.js` `POST /api/comandas/anular-item` to recalculate table state when an item is cancelled.
3. **Frontend Action Items**:
   - `public/app.js`: Add `'activa': 'Activa'` and `'esperando_parcial': 'Esperando Parcial'` to `estadoEtiqueta`. Add tooltip calculation and rendering on hover/tap.
   - `public/styles.css`: Add `.mesa-render-card.activa` (blue theme `#1e40af` / `#2563eb`), `.mesa-render-card.esperando_parcial` (amber theme), and `.mesa-wait-tooltip` styles. Add legend badges.
4. **Challenger Action Items**:
   - Implement `test/challenger-m2-kds.test.js` covering Suites 1 to 5 (Full-stack DB persistence, Socket.IO broadcasts, state reversibility, anulaciones, and DOM/CSS rendering).

---

## 5. Verification Method

### 5.1 Project Test Command
Execute the complete E2E regression suite:
```powershell
node --test --test-concurrency=1 test/e2e/*.test.js
```
Expected output: 58 tests passed, 0 failures, exit code 0.

### 5.2 Individual Feature Verification
```powershell
# Tier 1 Feature Coverage
node --test test/e2e/tier1-features.test.js

# Tier 2 Boundary Coverage
node --test test/e2e/tier2-boundaries.test.js
```

### 5.3 Challenger Test Verification
Once Challengers implement `test/challenger-m2-kds.test.js`:
```powershell
node --test test/challenger-m2-kds.test.js
```

### 5.4 Files to Inspect for Verification
- `server.js`: Lines 352 (`GET /api/mesas`) and 769–780 (`POST /api/kds/:detalleId/estado`).
- `public/app.js`: `renderSalón()` and tooltip generator.
- `public/styles.css`: `.mesa-render-card.activa` and `.mesa-render-card.esperando_parcial`.
- `public/index.html`: `.legend-group` legend items.

### 5.5 Invalidation Conditions
- Any failure in `node --test --test-concurrency=1 test/e2e/*.test.js` invalidates the build.
- If `POST /api/kds/:detalleId/estado` marks the last kitchen dish 'listo' and `SELECT estado FROM Mesas WHERE id = ?` returns `'esperando'` instead of `'activa'`, the implementation is invalid.
- If an `'activa'` table loses its order total or cannot open the comandero due to `orden_activa_id === null`, the implementation is invalid.
- If the wait tooltip includes already delivered dishes or does not calculate elapsed minutes from `MIN(hora_pedido)`, the implementation is invalid.
