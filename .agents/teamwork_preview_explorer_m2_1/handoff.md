# Handoff Report — Milestone 2: Backend Architecture & Implementation Plan

**Agent**: `teamwork_preview_explorer_m2_1` (Explorer 1)  
**Mission**: Backend investigation & Worker plan for Milestone 2 (KDS States, Partial Deliveries & Wait Time Tooltips)  
**Type**: Hard Handoff (Task Complete)

---

## 1. Observation

### 1.1 Database Schema & Tables (`database.js`)
- `Mesas` table (`database.js:30-43`): `estado TEXT DEFAULT 'libre'`. Currently transitions to `'libre'`, `'abierta'`, `'esperando'`, `'cuenta'`.
- `Ordenes` table (`database.js:117-135`): `estado TEXT DEFAULT 'abierta'`. Active order queries currently filter:
  `WHERE estado IN ('abierta', 'esperando', 'cuenta_pedida')` at:
  - `server.js:352`: `LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'cuenta_pedida')`
  - `server.js:445`: `SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')`
  - `server.js:462`: `SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')`
  - `server.js:520`: `SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')`
  - `server.js:895`: `SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')`
- `DetalleOrden` table (`database.js:140-158`): Stores `hora_pedido TEXT NOT NULL` and `hora_listo TEXT`. Column `creado_en` is not yet defined in schema, though `hora_pedido` stores the ISO timestamp of creation.

### 1.2 Current KDS Endpoint Behavior (`server.js:769-780`)
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
Direct observations:
- Only updates `DetalleOrden`. Does NOT query the parent `Ordenes` or `Mesas`.
- Does NOT recalculate the table's state (`activa`, `esperando_parcial`, `esperando`).
- Does NOT persist the updated table status into `Mesas.estado`.
- Does NOT emit `mesa_actualizada` to alert salon clients via Socket.IO.
- Does NOT provide endpoints `PUT /api/comandas/:id/estado`, `PUT /api/kds/:detalleId/estado`, or `GET /api/comandas/activas`.

### 1.3 Test Suite & Domain Helper (`test/helpers/test-server.js:274-315`)
- Function `evaluarEstadoMesaKDS(detalles)` strictly encodes:
  - If no kitchen items -> `'abierta'`.
  - If 100% kitchen items are `listo` -> `'activa'`.
  - If some `listo` and some `pendiente`/`preparando` -> `'esperando_parcial'`.
  - If 0 `listo` and all pending -> `'esperando'`.
- Function `formatearTooltipEspera(primeraComandaHora, itemsPendientes, ahora)` computes:
  - `diffMs = ahora.getTime() - new Date(primeraComandaHora).getTime()`.
  - `minutos = Math.floor(diffMs / 60000)`.
  - `titulo = "⏱️ Esperando hace ${minutos} min"`.
  - `items`: array containing only pending dish names.

---

## 2. Logic Chain

1. **Premise 1**: When kitchen cooks mark an item as `listo` in the KDS view, the kitchen display sends an HTTP request (`POST /api/kds/:detalleId/estado` or `PUT /api/comandas/:id/estado`).
2. **Premise 2**: Requirement R2 mandates:
   - When all kitchen items are marked "Listo", table transitions to `"Activa"` (Blue).
   - When only part of the dishes are ready, table transitions to `"Esperando Parcial"`.
   - Tooltips must list only pending dishes and elapsed wait time since the earliest comanda.
3. **Inference 1**: The backend handler for comanda status updates MUST fetch the parent order and table, query all current items for that order, and evaluate the new state using `evaluarEstadoMesaKDS`.
4. **Inference 2**: The backend handler MUST write the new state to `Mesas.estado` and `Ordenes.estado` in SQLite.
5. **Inference 3**: If `Ordenes.estado` is updated to `'activa'` or `'esperando_parcial'`, but `server.js` continues to query `WHERE estado IN ('abierta', 'esperando', 'cuenta_pedida')`, then active orders will become invisible in `/api/mesas`, `/api/ordenes/mesa/:id`, `/api/mesas/mover`, and `/api/mesas/unir`. Therefore, all active order queries MUST be expanded to:
   `estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')`.
6. **Inference 4**: The backend handler MUST emit both `comanda_actualizada` (for KDS synchronization) and `mesa_actualizada` (to notify `public/app.js:117` which triggers `cargarMesasDesdeBackend()`).
7. **Inference 5**: To ensure the floor map displays tooltips instantaneously without hovering network lag, `GET /api/mesas` should aggregate `platos_pendientes`, `primera_comanda_hora`, and `minutos_espera` directly on each table object in a single bulk pass.

---

## 3. Caveats

- **No Source Code Changes**: Explorer 1 is strictly read-only. No edits have been made to `server.js` or `database.js`. Implementation is deferred to the Worker.
- **Frontend Coordination**: The tooltip hover/tap UI and CSS styling (`.mesa-render-card.activa`, `.mesa-render-card.esperando_parcial`) must be implemented by the Worker according to Explorer 2's specifications.
- **Merged Tables**: If a table is merged (`mesas/unir`), items have `origen_mesa_numero`. The backend logic should preserve `[Mesa X] DishName` formatting for pending items in tooltips as demonstrated in `test/e2e/tier3-combinations.test.js:98`.

---

## 4. Conclusion

The Worker implementation plan is concrete, targeted, and verified against the master test suite:

1. **`database.js`**:
   - Add SQLite column migrations for `creado_en` and `origen_mesa_numero` on `DetalleOrden`.
2. **`server.js` Query Harmonization**:
   - Expand all `WHERE estado IN ('abierta', 'esperando', 'cuenta_pedida')` to include `'esperando_parcial'` and `'activa'`.
3. **`server.js` Unified State Transition Engine**:
   - Implement `actualizarEstadoComanda(detalleId, nuevoEstado)` that executes `evaluarEstadoMesaKDS`, updates `DetalleOrden`, `Mesas`, and `Ordenes`, and emits `comanda_estado_cambiado`, `comanda_actualizada`, and `mesa_actualizada`.
4. **Endpoints**:
   - Bind `POST /api/kds/:detalleId/estado`, `PUT /api/kds/:detalleId/estado`, `PUT /api/comandas/:id/estado`, and `POST /api/comandas/:id/estado`.
   - Implement `GET /api/comandas/activas` and `GET /api/mesas/:id/espera`.
   - Augment `GET /api/mesas` with `platos_pendientes`, `primera_comanda_hora`, and `minutos_espera`.
   - Recalculate table states in `POST /api/comandas/anular-item`.

---

## 5. Verification Method

### Test Execution Command
Execute the test suite using Node's native test runner (via cmd or node directly):
```powershell
node --test --test-concurrency=1 test/e2e/*.test.js
```
Or specifically for Feature 2 / R2:
```powershell
node --test test/e2e/tier1-features.test.js
node --test test/e2e/tier2-boundaries.test.js
node --test test/e2e/tier4-scenarios.test.js
```

### Invalidation Conditions
- Any test in `test/e2e/*.test.js` fails (suite must maintain 58/58 passing).
- `POST /api/kds/:detalleId/estado` with `'listo'` does not transition `Mesas.estado` to `'activa'` when all items are ready.
- `GET /api/mesas` does not include `platos_pendientes` or returns completed dishes in the pending list.
- `mesa_actualizada` is not emitted on KDS status transitions.
