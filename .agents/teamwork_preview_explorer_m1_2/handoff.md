# Handoff Report: Explorer M1.2 - Backend Comanda Dispatch & Table State (R1)

**Working Directory:** `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_2`  
**Target File:** `server.js` (`POST /api/comandas/enviar`, lines 530–606)  
**Type:** Hard Handoff (Investigation Complete)  

---

## 1. Observation

1. **Unconditional Table and Order State Mutation in `server.js:542–553`**:
   Direct observation of `server.js`:
   ```javascript
   // server.js:542-546
   const r = await dbRun(
     `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
      VALUES (?, ?, ?, ?, ?, 'esperando')`,
     [numOrden, mesaId, cliente, mesero, ahora]
   );
   // server.js:549
   await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
   // server.js:552
   await dbRun("UPDATE Mesas SET estado = 'esperando', mesero = ? WHERE id = ?", [mesero, mesaId]);
   ```
   Both `Ordenes.estado` and `Mesas.estado` are mutated to `'esperando'` **before** inspecting `items` and regardless of destination.

2. **Unconditional Socket.IO Broadcast to Kitchen in `server.js:599–600`**:
   Direct observation of `server.js`:
   ```javascript
   // server.js:599-600
   io.emit('nueva_comanda', { mesaId, ordenId, comandas: nuevasComandas });
   io.emit('mesa_actualizada', { mesaId, estado: 'esperando', total });
   ```
   `io.emit('nueva_comanda')` is broadcast unconditionally with all items (drinks included).
   `io.emit('mesa_actualizada')` broadcasts hardcoded `estado: 'esperando'`.

3. **Kitchen Bell Triggered on Client upon `nueva_comanda`**:
   Direct observation in `public/app.js` lines 113–117:
   ```javascript
   socket.on('nueva_comanda', (d) => {
     sonarCampanaCocina();
     cargarKDSDesdeBackend();
     cargarMesasDesdeBackend();
   });
   ```
   Whenever `nueva_comanda` is received, `sonarCampanaCocina()` sounds the kitchen bell audio and reloads KDS tickets.

4. **Product Destination Schema in `pos.db`**:
   Direct observation by database query on `Productos`:
   - Beers (`id: 1..3`) and Cocktails (`id: 5..7`) have `destino = 'barra'`.
   - Food dishes (`id: 8..14, 16, 17`) have `destino = 'cocina'`.

5. **Test Assertions in `test/helpers/test-server.js` and `test/e2e/`**:
   Direct observation of `test/helpers/test-server.js` line 279:
   ```javascript
   if (!cocinaItems.length) return 'abierta';
   ```
   Direct observation of `test/e2e/tier2-boundaries.test.js` line 127:
   ```javascript
   it('T2.6: Table with only bar items (0 kitchen items) evaluates to "abierta", never "esperando"', () => {
   ```
   The specification and test contracts expect tables with only bar items to evaluate to `'abierta'`, never `'esperando'`.

---

## 2. Logic Chain

1. **From Observation 1**: Because `Ordenes.estado` and `Mesas.estado` are set to `'esperando'` before looping through `items`, ordering a beer (`destino = 'barra'`) on an empty table turns the table orange (`'esperando'`) as if waiting for food.
2. **From Observation 2 and 3**: Because `io.emit('nueva_comanda')` is sent on every dispatch, ordering drinks rings the physical kitchen bell and reloads the KDS queue for kitchen staff, causing operational noise and displaying 0 new food items.
3. **From Observation 4 and 5**: Products explicitly declare their `destino` in the database (`'cocina'` vs `'barra'`). The requirement R1 explicitly specifies: *"Si en una mesa ya enviada solo se agregan bebidas u otros productos que no van a cocina, el botón debe decir '💾 Guardar'"*, and the system contract specifies: *"If any items have destino === 'cocina', table transitions to 'esperando'. If all are 'barra', table remains in current state (or 'abierta')".*
4. **Step-by-step resolution**:
   - Filter newly added items: `!it.id_detalle_existente && !it.enviado`.
   - Check if any new item has `destino === 'cocina' || (it.destino !== 'barra' && it.curso <= 3)`.
   - If `tieneNuevosCocina === true`:
     - Set `Ordenes.estado = 'esperando'`.
     - Set `Mesas.estado = 'esperando'`.
     - Emit `io.emit('nueva_comanda', { mesaId, ordenId, comandas: comandasCocina })`.
   - If `tieneNuevosCocina === false`:
     - If new order, set `Ordenes.estado = 'abierta'`. If existing order, keep current order estado.
     - If mesa was `'libre'`, set `Mesas.estado = 'abierta'`. If mesa was already in an active state (`'esperando'`, `'activa'`, `'abierta'`), keep `Mesas.estado` unchanged.
     - Do NOT emit `nueva_comanda`.
   - Always emit `io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa, total })`.

---

## 3. Caveats

1. **Client Bell on Click**: In `public/app.js` line 981, `sonarCampanaCocina()` is also called locally in the click listener of `btnEnviarComandaCocina`. While our backend change prevents network broadcast of the bell to all other devices, Explorer M1.1 must guard the local click sound in `public/app.js` with `if (tieneComida) sonarCampanaCocina();`.
2. **UI Class for `'abierta'`**: In `public/styles.css`, `.mesa-render-card.ocupada` exists, while `.mesa-render-card.abierta` should share the same styling to ensure visual consistency when `Mesas.estado = 'abierta'`.
3. No other caveats.

---

## 4. Conclusion

The route `POST /api/comandas/enviar` in `server.js` requires updating to:
1. Inspect unsent items (`!it.id_detalle_existente && !it.enviado`).
2. Evaluate `tieneNuevosCocina` based on `destino === 'cocina'`.
3. Set table state to `'esperando'` ONLY when `tieneNuevosCocina === true`; otherwise transition empty tables to `'abierta'` and preserve existing active table states.
4. Emit `nueva_comanda` ONLY when `comandasCocina.length > 0`.
5. Emit `mesa_actualizada` with the evaluated table state and updated total.

The full replacement code is documented in `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_2\analysis.md` § 6.

---

## 5. Verification Method

1. **Automated Test Run**:
   Execute the project's native test runner:
   ```powershell
   node --test test/e2e/tier1-features.test.js test/e2e/tier2-boundaries.test.js
   ```
2. **API Verification Test**:
   - Send `POST /api/comandas/enviar` with `{ mesaId: 1, items: [{ id: 1, destino: 'barra' }] }`.
   - Query `SELECT estado FROM Mesas WHERE id = 1`: must equal `'abierta'`, NOT `'esperando'`.
   - Query `SELECT estado FROM Ordenes WHERE mesa_id = 1`: must equal `'abierta'`, NOT `'esperando'`.
   - Verify `nueva_comanda` is not emitted on Socket.IO.
3. **Invalidation Condition**:
   If a table with only drinks orders is found with `Mesas.estado = 'esperando'` or triggers `io.emit('nueva_comanda')`, this investigation's findings would be invalidated.
