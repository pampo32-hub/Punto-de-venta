# Handoff Report: Frontend Comandero Button Mechanics (R1 / F1 & F2)

**Author**: Explorer M1.1  
**Working Directory**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_1`  
**Handoff Type**: Hard (Task complete)  

---

## 1. Observation

Direct code observations from `C:\Users\Juan\punto-de-venta`:

1. **`public/app.js` (lines 23-46)**:
   ```javascript
   function actualizarBotonEnviarComanda() {
     const btn = document.getElementById('btnEnviarComandaCocina');
     if (!btn) return;

     if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
       btn.innerHTML = '💾 Guardar';
       btn.className = 'btn-btn-cmd guardar';
       return;
     }

     // Verifica si hay algún alimento/platillo para cocina
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
   }
   ```
   Directly observed: `tieneComida` does **not** check `!it.enviado`. When items with `enviado: true` exist in `estado.mesaActiva.items`, `tieneComida` remains `true`.

2. **`public/app.js` (lines 959-995)**:
   ```javascript
   document.getElementById('btnEnviarComandaCocina').addEventListener('click', async () => {
     if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
       alert('No hay productos en la comanda.');
       return;
     }

     const tieneComida = estado.mesaActiva.items.some(it => 
       it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
     );

     try {
       const res = await fetch('/api/comandas/enviar', { ... });
       const data = await res.json();
       sonarCampanaCocina();
       alert(tieneComida ? '🔔 ¡Comanda enviada a cocina!' : '💾 ¡Comanda guardada con éxito!');
       estado.mesaActiva.items.forEach(it => it.enviado = true);
   ```
   Directly observed: The click handler also evaluates `tieneComida` without checking `!it.enviado`. Furthermore, `sonarCampanaCocina()` is called before `alert()` unconditionally, ringing the kitchen audio bell regardless of whether the comanda contained food or only drinks.

3. **`public/app.js` (lines 827-837)**:
   ```javascript
   mesa.items = (data.items || []).map(it => ({
     id_detalle_existente: it.id,
     id: it.producto_id,
     nombre: it.nombre_producto,
     precio: it.precio_unitario,
     cantidad: it.cantidad,
     notas: it.notas,
     curso: it.curso || 2,
     destino: it.destino,
     enviado: true
   }));
   ```
   Directly observed: Reopened tables load all existing items from the database with `enviado: true`.

4. **`public/styles.css` (lines 846-848)**:
   ```css
   .btn-btn-cmd.cocina { background: var(--accent); color: #fff; }
   .btn-btn-cmd.split { background: #8b5cf6; color: #fff; }
   .btn-btn-cmd.cobrar { background: var(--success); color: #fff; }
   ```
   Directly observed: There is no CSS rule for `.btn-btn-cmd.guardar`.

5. **`public/index.html` (line 474)**:
   ```html
   <button class="btn-btn-cmd cocina" id="btnEnviarComandaCocina">
     🔥 Enviar a Cocina
   </button>
   ```
   Directly observed: The initial button markup has class `btn-btn-cmd cocina` and text `🔥 Enviar a Cocina`.

---

## 2. Logic Chain

1. **Premise**: In restaurant workflows (R1), when a waiter sends food to the kitchen, those dishes enter preparation. If the waiter reopens the table later and adds only beverages (or if an order contains only beverages), the kitchen does not need to prepare dishes. Therefore, the button must display `"💾 Guardar"` and saving must not notify the kitchen.
2. **From Observation 1 & 3**: When a table is opened with previously sent food, `estado.mesaActiva.items` contains items with `destino: 'cocina'` and `enviado: true`. In `actualizarBotonEnviarComanda()`, `tieneComida` evaluates to `true` because it does not filter by `!it.enviado`. As a result, even if the waiter only adds drinks, the button remains stuck on `"🔥 Enviar a Cocina"`.
3. **From Observation 2**: In `#btnEnviarComandaCocina`'s click handler, `tieneComida` is computed without `!it.enviado`. Therefore, saving drinks on an existing table alerts `'🔔 ¡Comanda enviada a cocina!'` and rings the kitchen audio bell, falsely indicating that dishes were sent to the kitchen.
4. **Resolution**: Replacing `tieneComida` with:
   ```javascript
   const tieneNuevosCocina = estado.mesaActiva.items.some(it => 
     !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
   );
   ```
   both in `actualizarBotonEnviarComanda()` and in the `#btnEnviarComandaCocina` click handler cleanly decouples unsent kitchen items from already sent items and drinks.
5. **From Observation 4 & 5**: Adding `.btn-btn-cmd.guardar { background: var(--primary); color: #fff; }` in `public/styles.css` and changing the static HTML default to `"💾 Guardar"` in `public/index.html` ensures complete visual and structural consistency across all lifecycle states.

---

## 3. Caveats

- **Backend Table State Transition**: When `POST /api/comandas/enviar` is invoked with only drinks, `server.js` currently executes `UPDATE Mesas SET estado = 'esperando'`. The master plan (`PROJECT.md` line 48) specifies: *"If any items have destino === 'cocina', table transitions to 'esperando'. If all are 'barra', table remains in current state (or 'abierta')"*. This backend table status transition is tracked under backend Milestone 1/2 tasks.
- **Audio Bell on Error**: In the catch block of `btnEnviarComandaCocina` (line 991), `sonarCampanaCocina()` was also called unconditionally. It should only sound if `tieneNuevosCocina` was `true`.
- **Course Selection UI**: `.btn-course-opt` elements in `modalModificadores` do not yet have click listeners to change `estado.itemModificando.curso`. This does not affect R1 button toggling because newly added food items default to `curso: 2` and `destino: 'cocina'`.

---

## 4. Conclusion

The Comandero button mechanics require **four targeted modifications**:
1. In `public/app.js` (`actualizarBotonEnviarComanda`): Replace `tieneComida` condition with `tieneNuevosCocina = estado.mesaActiva.items.some(it => !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')))` and update button text and classes accordingly.
2. In `public/app.js` (`#btnEnviarComandaCocina` click listener): Use `tieneNuevosCocina` to govern whether `sonarCampanaCocina()` sounds and whether the alert says `'🔔 ¡Comanda enviada a cocina!'` vs `'💾 ¡Comanda guardada con éxito!'`. Call `actualizarBotonEnviarComanda()` after marking items as `enviado = true`.
3. In `public/styles.css`: Add rule `.btn-btn-cmd.guardar { background: var(--primary); color: #fff; }`.
4. In `public/index.html`: Update default button text and class to `<button class="btn-btn-cmd guardar" id="btnEnviarComandaCocina">💾 Guardar</button>`.

All detailed line references, before/after snippets, and state transition matrices are documented in `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_1\analysis.md`.

---

## 5. Verification Method

### 5.1 Static Verification
Inspect `public/app.js` lines 23-46 and lines 959-995:
- Verify `actualizarBotonEnviarComanda()` checks `!it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))`.
- Verify `#btnEnviarComandaCocina` click handler checks `tieneNuevosCocina` and conditionally rings bell and emits `'💾 ¡Comanda guardada con éxito!'` vs `'🔔 ¡Comanda enviada a cocina!'`.
- Verify `public/styles.css` contains `.btn-btn-cmd.guardar`.

### 5.2 Functional / Test Verification
Once server and test harness are active, execute the test runner:
```powershell
node --test test/
```
In an automated browser or manual verification:
1. Open empty table: Button must read `"💾 Guardar"`.
2. Add "Corona" (`destino: 'barra'`): Button must remain `"💾 Guardar"`.
3. Add "Hamburguesa" (`destino: 'cocina'`): Button must toggle to `"🔥 Enviar a Cocina"`.
4. Click `"🔥 Enviar a Cocina"`: Bell rings, alert shows `"🔔 ¡Comanda enviada a cocina!"`, modal closes.
5. Reopen same table: Button must show `"💾 Guardar"`.
6. Add "Imperial" (`destino: 'barra'`): Button must remain `"💾 Guardar"`.
7. Click `"💾 Guardar"`: Bell does NOT ring, alert shows `"💾 ¡Comanda guardada con éxito!"`.
8. Reopen table, add "Alitas BBQ" (`destino: 'cocina'`): Button must immediately switch back to `"🔥 Enviar a Cocina"`.
9. Remove "Alitas BBQ" (decrement quantity to 0): Button must switch back to `"💾 Guardar"`.
