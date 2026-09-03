# Analysis: Frontend Comandero Button Mechanics (R1 / F1 & F2)

**Explorer**: Explorer M1.1  
**Target Milestone**: Milestone 1 (M1)  
**Target Feature**: F1 (Dynamic Comanda Button) & F2 (Comanda State Reset)  
**Date**: 2026-09-03  

---

## 1. Executive Summary

Requirement R1 dictates that the main comanda action button (`#btnEnviarComandaCocina`) must dynamically alternate between:
- **`"🔥 Enviar a Cocina"`** (class `btn-btn-cmd cocina`) when there are unsent food/kitchen items.
- **`"💾 Guardar"`** (class `btn-btn-cmd guardar`) when the table has only drinks, when all existing food items have already been sent to preparation, or when the table is empty.

Investigation of `public/app.js`, `public/index.html`, and `public/styles.css` identified **three critical issues**:
1. **Missing `!it.enviado` check in `actualizarBotonEnviarComanda()` (lines 34-37)**: The existing implementation tests `it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')` without verifying whether the item has already been sent (`it.enviado`). Once a dish is ordered, the button permanently displays `"🔥 Enviar a Cocina"` on subsequent re-openings, even if only drinks are added.
2. **Missing `!it.enviado` check and unconditional bell ringing in click handler (lines 959-995)**: Clicking the button evaluates `tieneComida` across all items (including already sent ones), falsely triggering `"🔔 ¡Comanda enviada a cocina!"` and ringing the kitchen audio bell when only drinks were added to an existing table.
3. **Missing `.btn-btn-cmd.guardar` CSS class in `public/styles.css`**: While `.btn-btn-cmd.cocina` is styled with `background: var(--accent); color: #fff;`, `.guardar` is completely missing, leaving the button unstyled/transparent when in `"💾 Guardar"` state.

---

## 2. Interaction of `actualizarBotonEnviarComanda()` with `estado.mesaActiva.items`

### 2.1 State Lifecycle & Item Schema
In `public/app.js`, `estado.mesaActiva` represents the currently selected table. Its items array `estado.mesaActiva.items` holds item objects with the following schema:
- `id`: Product ID (`INTEGER`)
- `nombre`: Product display name (`TEXT`)
- `precio`: Unit price (`REAL`)
- `cantidad`: Item quantity (`INTEGER`)
- `notas`: Cooking notes or modifications (`TEXT`)
- `destino`: Destination routing (`'cocina'` for food, `'barra'` for drinks/bar)
- `curso`: Course number (1 = Entrada, 2 = Plato Fuerte, 3 = Postre)
- `happyHour`: Happy hour eligibility flag (`BOOLEAN`)
- `enviado`: Boolean flag indicating whether the item has already been dispatched to backend/kitchen (`true` if already dispatched/loaded from DB, `false` if newly added in the current session)
- `id_detalle_existente`: Backend primary key in `DetalleOrden` (present if loaded from database)

### 2.2 Entry Points Modifying `estado.mesaActiva.items`
1. **Opening Table (`abrirComanderoMesa`, lines 813-851)**:
   - Fetches open order from `/api/ordenes/mesa/:mesaId`.
   - Existing items from DB are mapped with `enviado: true`.
   - If no order exists, `mesa.items = []`.
   - Calls `renderTicketItems()`, which internally invokes `actualizarBotonEnviarComanda()`.
2. **Adding Items (`agregarAlTicketOneTap`, lines 693-727)**:
   - Increments quantity if an un-sent matching item (`it.id === prodId && !it.enviado`) already exists.
   - Otherwise, pushes a new item with `enviado: false`.
   - Calls `renderTicketItems()`, which invokes `actualizarBotonEnviarComanda()`.
3. **Modifying Quantity (`modificarCantidadTicket`, lines 904-917)**:
   - When decrementing to 0 on an unsent item (`!item.enviado`), the item is spliced from `estado.mesaActiva.items`.
   - Calls `renderTicketItems()`, which invokes `actualizarBotonEnviarComanda()`.
4. **Annulling Items (`btnConfirmarAnulacion`, lines 1335-1373)**:
   - Slices annulled item from `estado.mesaActiva.items`.
   - Calls `renderTicketItems()`, which invokes `actualizarBotonEnviarComanda()`.
5. **Sending / Saving Comanda (`#btnEnviarComandaCocina` click handler, lines 959-995)**:
   - Dispatches items to `/api/comandas/enviar`.
   - Marks all items: `estado.mesaActiva.items.forEach(it => it.enviado = true);`.

---

## 3. Strict Check for Unsent Kitchen Items

### 3.1 Existing (Flawed) Implementation
In `public/app.js` lines 23-46:
```javascript
function actualizarBotonEnviarComanda() {
  const btn = document.getElementById('btnEnviarComandaCocina');
  if (!btn) return;

  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
    return;
  }

  // BUG: Does NOT check !it.enviado
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

### 3.2 Corrected Predicate
The predicate must strictly require `!it.enviado`:
```javascript
const tieneNuevosCocina = estado.mesaActiva.items.some(it => 
  !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
);
```

### 3.3 Predicate Breakdown:
- `!it.enviado`: Prevents previously sent kitchen dishes from keeping the button in the kitchen state.
- `it.destino === 'cocina'`: Direct destination check for dishes flagged for the kitchen.
- `(it.curso && it.curso <= 3 && it.destino !== 'barra')`: Recognizes dishes assigned courses 1-3, while ensuring any beverage with `destino === 'barra'` is excluded.
- If an item is a drink (`destino === 'barra'`), both `it.destino === 'cocina'` and `it.destino !== 'barra'` evaluate to `false`, yielding `false`.

---

## 4. Verification of Button State Transitions

| Scenario | State in `estado.mesaActiva.items` | `tieneNuevosCocina` | Expected Button Text | Expected Class | Verified Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Empty Table** | `items = []` or `null` | `false` (caught by early return) | `💾 Guardar` | `btn-btn-cmd guardar` | Correct |
| **2. Only Drinks Added** | `[{ destino: 'barra', enviado: false }]` | `false` | `💾 Guardar` | `btn-btn-cmd guardar` | Correct |
| **3. Food Added** | `[{ destino: 'cocina', enviado: false }]` | `true` | `🔥 Enviar a Cocina` | `btn-btn-cmd cocina` | Correct |
| **4. Food Dispatched** | `[{ destino: 'cocina', enviado: true }]` | `false` | `💾 Guardar` | `btn-btn-cmd guardar` | Correct (with fix) |
| **5. Reopened + Drinks Added** | `[{ destino: 'cocina', enviado: true }, { destino: 'barra', enviado: false }]` | `false` | `💾 Guardar` | `btn-btn-cmd guardar` | Correct (with fix) |
| **6. Additional Food Added** | `[..., { destino: 'cocina', enviado: false }]` | `true` | `🔥 Enviar a Cocina` | `btn-btn-cmd cocina` | Correct |
| **7. Food Removed / Annulled** | Food removed before send -> remaining only drinks | `false` | `💾 Guardar` | `btn-btn-cmd guardar` | Correct |

---

## 5. Click Handling on `btnEnviarComandaCocina`

### 5.1 Current Logic (lines 959-995)
```javascript
document.getElementById('btnEnviarComandaCocina').addEventListener('click', async () => {
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    alert('No hay productos en la comanda.');
    return;
  }

  // BUG: Checks without !it.enviado
  const tieneComida = estado.mesaActiva.items.some(it => 
    it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
  );

  try {
    const res = await fetch('/api/comandas/enviar', { ... });
    const data = await res.json();
    sonarCampanaCocina(); // BUG: Always rings kitchen bell even if no food sent
    alert(tieneComida ? '🔔 ¡Comanda enviada a cocina!' : '💾 ¡Comanda guardada con éxito!');
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    document.getElementById('modalComandero').classList.remove('active');
    ...
```

### 5.2 Required Behavior
1. Check `tieneNuevosCocina` (unsent items only).
2. If `tieneNuevosCocina` is `true`:
   - Ring `sonarCampanaCocina()`.
   - Alert `"🔔 ¡Comanda enviada a cocina!"`.
3. If `tieneNuevosCocina` is `false` (e.g. only saving drinks or updating non-kitchen items):
   - Do NOT ring `sonarCampanaCocina()`.
   - Alert `"💾 ¡Comanda guardada con éxito!"`.
4. Mark `it.enviado = true` for all items.
5. Invoke `actualizarBotonEnviarComanda()` to guarantee DOM/state sync.

---

## 6. CSS & HTML Inconsistencies

### 6.1 `public/styles.css`
In lines 846-848:
```css
.btn-btn-cmd.cocina { background: var(--accent); color: #fff; }
.btn-btn-cmd.split { background: #8b5cf6; color: #fff; }
.btn-btn-cmd.cobrar { background: var(--success); color: #fff; }
```
**Missing**:
```css
.btn-btn-cmd.guardar { background: var(--primary); color: #fff; }
```
Without this definition, `.btn-btn-cmd.guardar` has no background color. Adding `background: var(--primary)` (`#0284c7`) gives a consistent, high-visibility blue aesthetic matching the POS design system.

### 6.2 `public/index.html`
In line 474:
```html
<button class="btn-btn-cmd cocina" id="btnEnviarComandaCocina">
  🔥 Enviar a Cocina
</button>
```
When first loaded before an order is active, it statically defaults to `🔥 Enviar a Cocina`. It should default to:
```html
<button class="btn-btn-cmd guardar" id="btnEnviarComandaCocina">
  💾 Guardar
</button>
```

---

## 7. Proposed Code Changes for Implementer

### Change 1: `public/app.js` — `actualizarBotonEnviarComanda()` (lines 23-46)
```javascript
function actualizarBotonEnviarComanda() {
  const btn = document.getElementById('btnEnviarComandaCocina');
  if (!btn) return;

  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
    return;
  }

  // Verifica si hay algún alimento/platillo para cocina NO enviado aún
  const tieneNuevosCocina = estado.mesaActiva.items.some(it => 
    !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
  );

  if (tieneNuevosCocina) {
    btn.innerHTML = '🔥 Enviar a Cocina';
    btn.className = 'btn-btn-cmd cocina';
  } else {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
  }
}
```

### Change 2: `public/app.js` — Click Handler `#btnEnviarComandaCocina` (lines 959-995)
```javascript
document.getElementById('btnEnviarComandaCocina').addEventListener('click', async () => {
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    alert('No hay productos en la comanda.');
    return;
  }

  const tieneNuevosCocina = estado.mesaActiva.items.some(it => 
    !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
  );

  try {
    const res = await fetch('/api/comandas/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesaId: estado.mesaActiva.id,
        mesero: estado.usuarioActual ? estado.usuarioActual.nombre : 'Juan Jival',
        items: estado.mesaActiva.items,
        happyHourActivo: estado.happyHourActivo
      })
    });
    const data = await res.json();
    if (tieneNuevosCocina) {
      sonarCampanaCocina();
      alert('🔔 ¡Comanda enviada a cocina!');
    } else {
      alert('💾 ¡Comanda guardada con éxito!');
    }
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    actualizarBotonEnviarComanda();
    
    // CERRAR EL MENÚ DE UNA VEZ
    document.getElementById('modalComandero').classList.remove('active');
    
    cargarMesasDesdeBackend();
    cargarKDSDesdeBackend();
  } catch (e) {
    if (tieneNuevosCocina) sonarCampanaCocina();
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    actualizarBotonEnviarComanda();
    document.getElementById('modalComandero').classList.remove('active');
  }
});
```

### Change 3: `public/styles.css` — Add `.btn-btn-cmd.guardar` (line 847)
```css
.btn-btn-cmd.guardar { background: var(--primary); color: #fff; }
.btn-btn-cmd.cocina { background: var(--accent); color: #fff; }
.btn-btn-cmd.split { background: #8b5cf6; color: #fff; }
.btn-btn-cmd.cobrar { background: var(--success); color: #fff; }
```

### Change 4: `public/index.html` — Default Button Markup (line 474)
```html
<button class="btn-btn-cmd guardar" id="btnEnviarComandaCocina">
  💾 Guardar
</button>
```
