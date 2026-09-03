# Comprehensive Survey Report: Business Logic, State Engines, Comandas, KDS & Happy Hour

**Project**: GastroBar Pro (Punto de Venta)  
**Investigator**: Explorer 2 (Survey Phase)  
**Date**: 2026-09-03  
**Working Directory**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2`  
**Workspace Directory**: `C:\Users\Juan\punto-de-venta`  

---

## Executive Summary

This investigation analyzed the business logic, data models, state stores, and calculation engines across `database.js`, `server.js`, `public/app.js`, `public/index.html`, and `public/styles.css`. We identified the root causes of all bugs and architectural gaps for:
1. **Comandas & KDS (R1, R2)**: Food vs. beverage identification, dynamic button toggling (`🔥 Enviar a Cocina` vs `💾 Guardar`), KDS status transitions, wait times, partial deliveries, and table states/colors.
2. **Happy Hour (R3)**: 2x1 promotional pricing calculation discrepancies between menu catalog and ticket, database flag disconnects, and the complete lack of automated timer and expiration logic.

---

## 1. Comandas & KDS (Requirements R1 & R2)

### 1.1 Food vs. Beverage Classification Engine

#### Data Model Analysis
The codebase contains destination fields in three separate database tables (`database.js`):
1. **`Categorias.destino`** (`TEXT DEFAULT 'cocina'`, lines 57-58):
   - Current database values (`pos.db`):
     - `id: 1` ('Bebidas & Cervezas'): `destino = 'barra'`
     - `id: 2` ('Coctelería & Tragos'): `destino = 'barra'`
     - `id: 3` ('Bocas & Entradas'): `destino = 'cocina'`
     - `id: 4` ('Platos Fuertes'): `destino = 'cocina'`
     - `id: 5` ('Hamburguesas & Snacks'): `destino = 'cocina'`
     - `id: 6` ('Postres & Café'): `destino = 'cocina'`
2. **`Productos.destino`** (`TEXT DEFAULT 'cocina'`, line 70):
   - Products with `id: 1..7` (Imperial, Pilsen, Corona, Refresco, Mojito, Margarita, Gin Tonic) have `destino = 'barra'`.
   - Products with `id: 8..17` (Chifrijo, Alitas, Ceviche, Rib Eye, Arroz Mariscos, Hamburguesa, Patacones, Sandwich, Tres Leches, Cafe) have `destino = 'cocina'`.
3. **`DetalleOrden.destino`** (`TEXT DEFAULT 'cocina'`, line 150):
   - When comanda items are dispatched in `server.js` (line 561), `it.destino || 'cocina'` is stored per item.

#### Current Detection Logic in Frontend (`public/app.js`)
In `actualizarBotonEnviarComanda()` (lines 33-37) and `btnEnviarComandaCocina.click` (lines 965-967):
```javascript
const tieneComida = estado.mesaActiva.items.some(it => 
  it.destino === 'cocina' || 
  (it.curso && it.curso <= 3 && it.destino !== 'barra')
);
```

#### Why R1 Fails (Root Cause)
- In `public/app.js` (lines 705-720 & 827-837), each item in `estado.mesaActiva.items` contains an `enviado` boolean:
  - Loaded items from the database have `enviado: true` (and `id_detalle_existente`).
  - Newly added items in the current session have `enviado: false` (no `id_detalle_existente`).
- However, `actualizarBotonEnviarComanda()` inspects **all items on the table**, completely ignoring whether an item has `enviado: true`!
- **Concrete failure scenario**:
  1. A table orders a Hamburger (`destino = 'cocina'`). Waiter clicks "🔥 Enviar a Cocina".
  2. The Hamburger is dispatched and marked `enviado: true`.
  3. Later, the table asks for a Beer (`destino = 'barra'`). Waiter opens the comandero modal.
  4. Waiter adds the Beer (`enviado: false`, `destino: 'barra'`).
  5. `actualizarBotonEnviarComanda()` runs: `estado.mesaActiva.items.some(...)` evaluates to `true` because the *previously sent* Hamburger has `destino === 'cocina'`.
  6. The button displays **"🔥 Enviar a Cocina"**, violating R1!
  7. When clicked, it alerts *"🔔 ¡Comanda enviada a cocina!"* even though only a bar item was added.

#### Exact Solution for R1
```javascript
// public/app.js line 23
function actualizarBotonEnviarComanda() {
  const btn = document.getElementById('btnEnviarComandaCocina');
  if (!btn) return;

  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
    return;
  }

  // Only consider items that have NOT been sent yet (!it.enviado)
  const tieneComidaNueva = estado.mesaActiva.items.some(it => 
    !it.enviado && (
      it.destino === 'cocina' || 
      (it.curso && it.curso <= 3 && it.destino !== 'barra')
    )
  );

  if (tieneComidaNueva) {
    btn.innerHTML = '🔥 Enviar a Cocina';
    btn.className = 'btn-btn-cmd cocina';
  } else {
    btn.innerHTML = '💾 Guardar';
    btn.className = 'btn-btn-cmd guardar';
  }
}
```
And in `btnEnviarComandaCocina.click` (`public/app.js` line 965):
```javascript
const tieneComidaNueva = estado.mesaActiva.items.some(it => 
  !it.enviado && (
    it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
  )
);
// Alert reflects reality:
alert(tieneComidaNueva ? '🔔 ¡Comanda enviada a cocina!' : '💾 ¡Comanda guardada con éxito!');
```

---

### 1.2 KDS Status Transitions, Wait Times, and Partial Deliveries (R2)

#### Current Implementation in Backend (`server.js`)
1. **Comanda Dispatch** (`POST /api/comandas/enviar`, lines 530-606):
   - Line 552: `await dbRun("UPDATE Mesas SET estado = 'esperando', mesero = ? WHERE id = ?", [mesero, mesaId]);`
   - **Flaw**: Sets table state to `'esperando'` even if only bar/beverage items were added, or if no kitchen items are pending.
2. **KDS Dispatch** (`POST /api/kds/:detalleId/estado`, lines 684-695):
   - Updates `DetalleOrden.estado_comanda` (`'listo'`) and `hora_listo`.
   - Emits `io.emit('comanda_estado_cambiado', { detalleId, estado })`.
   - **Flaw**: It does NOT query the order or table. It does NOT check whether all items for that table are ready. It never changes `Mesas.estado`.
3. **Socket Listener in Client** (`public/app.js` lines 108-141):
   - There is NO listener for `comanda_estado_cambiado`! The client never knows a comanda was updated unless manually switching tabs.

#### Table State Machine Requirements (R2)
`Mesas.estado` must support the following lifecycle:

| State | Label | Color / CSS Class | Description / Condition |
|---|---|---|---|
| `libre` | Libre | Green (`#10b981`) | Table has no active order. |
| `ocupada` | Ocupada | Red (`#ef4444`) | Table has an open order, but no kitchen items waiting (e.g. drinks only). |
| `esperando` | Esperando Comida | Orange (`#f97316`) | Kitchen items sent; **0** ready dishes, **1+** pending/preparing dishes. |
| `esperando_parcial` | Esperando Parcial | Amber / Yellow (`#f59e0b`) | Multiple kitchen items ordered; **1+** dishes marked ready, but **1+** dishes still pending/preparing. |
| `activa` | Activa (Servida) | Blue (`#0284c7`, glow `#38bdf8`) | **All** kitchen dishes marked "Listo". Customers are actively eating. |
| `cuenta` | Cuenta Pedida | Amber pulsing (`#f59e0b`) | Customers requested the bill. |

#### Backend State Machine Transition Logic
When `POST /api/kds/:detalleId/estado` or `POST /api/comandas/enviar` executes:
1. Retrieve `orden_id` and `mesa_id` for the affected item(s).
2. Query active kitchen items:
   ```sql
   SELECT id, nombre_producto, cantidad, estado_comanda, hora_pedido 
   FROM DetalleOrden 
   WHERE orden_id = ? AND destino = 'cocina' AND estado_comanda != 'anulado';
   ```
3. Calculate:
   - `totalCocina = items.length`
   - `listosCocina = items.filter(i => i.estado_comanda === 'listo').length`
   - `pendientesCocina = items.filter(i => i.estado_comanda !== 'listo').length`
4. State Resolution:
   - If current table state is `'cuenta'`, preserve `'cuenta'`.
   - If `totalCocina === 0`: table state is `'ocupada'` (or `'activa'`).
   - If `pendientesCocina === 0` && `totalCocina > 0`: table state transitions to `'activa'` (Color Azul!).
   - If `listosCocina > 0` && `pendientesCocina > 0`: table state transitions to `'esperando_parcial'` (Color Ámbar!).
   - If `listosCocina === 0` && `pendientesCocina > 0`: table state transitions to `'esperando'` (Color Naranja!).
5. Execute:
   ```javascript
   await dbRun("UPDATE Mesas SET estado = ? WHERE id = ?", [nuevoEstadoMesa, mesaId]);
   io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa });
   ```

#### Elapsed Wait Time Calculation Engine
- **First comanda timestamp**: `primera_comanda_hora` = minimum `hora_pedido` among all **pending** kitchen dishes (`estado_comanda IN ('pendiente', 'preparando')`).
- **Wait time in minutes**:
  ```javascript
  const elapsedMs = Math.max(0, Date.now() - new Date(primera_comanda_hora).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const textoTiempo = elapsedMinutes === 0 
    ? 'Esperando hace menos de 1 min' 
    : `Esperando hace ${elapsedMinutes} min`;
  ```

#### Tooltip & Partial Delivery Tracking
- In `GET /api/mesas` (`server.js` line 348), enrich each table object with:
  - `items_cocina_pendientes`: array of only unserved dishes `[{ nombre_producto, cantidad, hora_pedido }]`.
  - `primera_comanda_hora`: earliest timestamp among pending dishes.
  - `total_cocina`, `listos_cocina`, `pendientes_cocina`.
- In `renderSalón()` (`public/app.js` line 764):
  - If `m.pendientes_cocina > 0`, render an interactive tooltip on the `.mesa-render-card`.
  - Tooltip content:
    1. Header with stopwatch: `⏱️ ${textoTiempo}`.
    2. Status pill: `"Esperando Parcial"` vs `"En Espera"`.
    3. Item list: **Strictly excludes delivered/ready dishes**, displaying only pending dishes (e.g. `1x Arroz con Mariscos`).
  - Add a visible mini-badge directly on the card: `<span class="m-time-badge">⏱️ ${elapsedMinutes}m</span>`.
- Tooltip CSS in `public/styles.css`:
  - Show on hover on desktop (`:hover .mesa-kds-tooltip`).
  - Support touch tap on tablet/mobile by toggling an `.active-tooltip` class or direct click.

#### Missing CSS in `public/styles.css`
The following classes are currently completely missing and must be added:
```css
/* ESTADOS DE MESAS: ACTIVA (AZUL) Y ESPERANDO PARCIAL (ÁMBAR) */
.mesa-render-card.activa {
  border-color: var(--primary);
  background: linear-gradient(180deg, #111827 0%, #0369a144 100%);
  box-shadow: 0 0 14px rgba(2, 132, 199, 0.35);
}

.mesa-render-card.esperando_parcial {
  border-color: #f59e0b;
  background: linear-gradient(180deg, #111827 0%, #b4530944 100%);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.25);
}

.legend-badge.activa .dot { background: var(--primary); }
.legend-badge.esperando_parcial .dot { background: #f59e0b; }

/* KDS WAIT TIME TOOLTIP */
.mesa-kds-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 210px;
  max-width: 290px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.7);
  z-index: 1000;
  display: none;
  pointer-events: none;
}
.mesa-render-card:hover .mesa-kds-tooltip {
  display: block;
}
```

---

## 2. Happy Hour (Requirement R3)

### 2.1 Current State Analysis & Critical Discrepancies

#### 1. Database Schema & Data Disconnect
- Schema: Table `Productos` has `happy_hour INTEGER DEFAULT 0` (`database.js` lines 72, 83).
- Data Inspection: In `pos.db`, **`happy_hour = 0` for 100% of products**.
  - Beers (Imperial, Pilsen, Corona) and cocktails (Mojito, Margarita) all have `happy_hour: 0`.
- Effect on Client:
  In `public/app.js` line 642: `happyHour: Boolean(p.happy_hour)` evaluates to `false`.
  - Line 675: `isPromo = estado.happyHourActivo && p.happyHour` is always `false`.
  - Line 683: `${isPromo ? '<span class="prod-badge-promo">2x1</span>' : ''}` is never rendered.
  - Line 933: `if (it.happyHour && it.cantidad >= 2)` in `recalcularTotalesTicket()` is always `false`.
  - Result: The frontend ticket **never** displays the Happy Hour discount row (`#comHappyHourRow` remains hidden), and the total does not reflect any 2x1 promotion.

#### 2. Backend Hardcoding vs Database Flag
In `server.js` lines 580-587:
```javascript
let descuentoHH = 0;
if (happyHourActivo) {
  rows.forEach(r => {
    if (r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')) {
      const pares = Math.floor(r.cantidad / 2);
      descuentoHH += pares * r.precio_unitario;
    }
  });
}
```
- **Discrepancy**:
  - The backend hardcodes string matching on `'Imperial'`, `'Pilsen'`, and `'Mojito'`.
  - It ignores Corona Extra and other drinks.
  - It ignores the `happy_hour` database column entirely.
  - **Severe Desynchronization**: When a waiter adds 2 Imperials, the client displays total `₡ 3,600 + tax = ₡ 4,428` (no discount). But when sending to `/api/comandas/enviar`, the server calculates `descuentoHH = ₡ 1,800` and saves `total = ₡ 2,214`!
  - When the waiter subsequently loads the table or charges, the numbers disagree between client display and server record.

#### 3. Overwriting Discrepancy in `mesas/unir` and `anular-item`
- In `server.js` `/api/mesas/unir` (lines 468-474) and `/api/comandas/anular-item` (lines 642-648):
  `UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?`
  Neither endpoint accounts for `descuento_happy_hour`! If tables are joined or an item is canceled on an order with Happy Hour, the discount is completely erased.

#### 4. Missing CSS for Promo Badges
In `public/styles.css`, `.prod-badge-promo` does not exist. Even if rendered, it appears unstyled.

---

### 2.2 2x1 Calculation Engine Specification

The 2x1 calculation applies per participating SKU (or category):
$$\text{Pares} = \left\lfloor \frac{\text{cantidad}}{2} \right\rfloor$$
$$\text{Descuento} = \text{Pares} \times \text{precio\_unitario}$$
$$\text{Subtotal Neto} = \text{Subtotal} - \text{Descuento}$$
$$\text{Servicio } 10\% = \text{round}(\text{Subtotal Neto} \times 0.10)$$
$$\text{IVA } 13\% = \text{round}(\text{Subtotal Neto} \times 0.13)$$
$$\text{Total} = \text{Subtotal Neto} + \text{Servicio } 10\% + \text{IVA } 13\%$$

#### Edge Cases
- **Odd quantities** (e.g. 1 unit, 3 units, 5 units):
  - 1 unit: 0 free, paid at regular price.
  - 3 units: 1 free, 2 paid (`Math.floor(3 / 2) = 1`).
  - 5 units: 2 free, 3 paid (`Math.floor(5 / 2) = 2`).
- **Mixed SKUs**:
  - 1 Imperial + 1 Pilsen: If 2x1 is per-SKU, 0 discount. If 2x1 is across all participating beers, pairs can be formed from equal or lowest price. GastroBar Pro currently calculates per-SKU (`it.cantidad >= 2`), which is standard.
- **Display in Catalog**:
  - Display badge: `🍸 2x1 PROMO`.
  - Clear label showing unit price and 2x1 effective price (e.g. `₡ 1,800 (2x1 en HH)`).
- **Display in Ticket**:
  - Next to product: badge `[2x1 HH]` if `it.happyHour && it.cantidad >= 2`.
  - Discount line: `Descuento Happy Hour 2x1: -₡ X.XX`.
  - Subtotal, Servicio 10%, IVA 13%, and Total matching between UI and server.

---

### 2.3 Automated Timer & Expiration Engine

#### Current Implementation
In `public/app.js` (lines 1916-1934), `initHappyHour()` only attaches a click listener to `btnToggleHappyHour` that toggles `estado.happyHourActivo = !estado.happyHourActivo`.
There is NO clock check, NO timer, and NO automatic deactivation when the scheduled time ends.

#### Architecture of Automated Expiration
1. **Configurable Schedule Parameters**:
   - `hhHoraInicio = '16:00'` (4:00 PM)
   - `hhHoraFin = '19:00'` (7:00 PM)
   - Stored in `estado.happyHourConfig = { horaInicio: '16:00', horaFin: '19:00', dias: [1,2,3,4,5] }`.
2. **Periodic Clock Verification**:
   - Run `verificarHorarioHappyHour()` every 10 seconds via `setInterval`.
   - Compares current local time against `hhHoraInicio` and `hhHoraFin`.
   - If `ahora >= hhHoraFin` and `estado.happyHourActivo === true`:
     - Set `estado.happyHourActivo = false`.
     - Update UI pill (`btnToggleHappyHour.classList.add('inactive')`).
     - Update text: `"Desactivado (Finalizó 7:00 PM)"`.
     - Re-render catalog grid (`renderGridProductos`) and ticket totals (`recalcularTotalesTicket`).
     - Emit desktop/in-app notification or alert:
       `"⏰ ¡Happy Hour finalizado! Los precios regulares han sido restablecidos automáticamente."`
3. **Manual Activation Protocol**:
   - If user clicks the pill outside standard hours (or forces ON):
     - Activates for a designated window (e.g. until `hhHoraFin` today, or 60 minutes).
     - Pill displays active status with countdown or end time (e.g. `"Activo hasta 7:00 PM"`).
     - Timer ensures auto-expiration still fires when that end time is reached!

---

## 3. Step-by-Step Implementation Roadmap

### Step 1: Database Seed & Migrations (`database.js`)
- Ensure participating products have `happy_hour = 1`:
  ```sql
  UPDATE Productos SET happy_hour = 1 
  WHERE codigo IN ('BEB01', 'BEB02', 'BEB03', 'COC01', 'COC02') 
     OR nombre LIKE '%Imperial%' 
     OR nombre LIKE '%Pilsen%' 
     OR nombre LIKE '%Corona%' 
     OR nombre LIKE '%Mojito%' 
     OR nombre LIKE '%Margarita%';
  ```

### Step 2: Backend API & State Synchronization (`server.js`)
- In `GET /api/mesas`:
  - Query active kitchen items from `DetalleOrden` grouped by `orden_id`.
  - Attach `items_cocina_pendientes`, `primera_comanda_hora`, `total_cocina`, `listos_cocina`, `pendientes_cocina`.
  - Include `'activa'` in order search queries (`estado IN ('abierta', 'esperando', 'activa', 'cuenta_pedida')`).
- In `POST /api/kds/:detalleId/estado`:
  - When marked `'listo'`, compute table state transition:
    - If all kitchen dishes ready: update `Mesas.estado = 'activa'`.
    - If some dishes ready and some pending: update `Mesas.estado = 'esperando_parcial'`.
  - Emit `io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa })`.
- In `POST /api/comandas/enviar`:
  - Use `DetalleOrden JOIN Productos` to check `happy_hour = 1` for 2x1 calculations instead of hardcoded strings.
  - If no kitchen items are newly sent, do not set table to `'esperando'`.
- In `POST /api/mesas/unir` and `POST /api/comandas/anular-item`:
  - Preserve `descuento_happy_hour` in order recalculations.

### Step 3: Frontend Comandas & Dynamic Button (`public/app.js`)
- Modify `actualizarBotonEnviarComanda()` to check `!it.enviado && (it.destino === 'cocina' || (it.curso <= 3 && it.destino !== 'barra'))`.
- Update click handler to alert `"🔔 ¡Comanda enviada a cocina!"` only if `tieneComidaNueva` is true, otherwise `"💾 ¡Comanda guardada con éxito!"`.

### Step 4: Frontend Salon, Tooltip & Real-Time KDS (`public/app.js` & `public/styles.css`)
- Add socket listener for `comanda_estado_cambiado` to refresh salon and KDS in real-time.
- In `renderSalón()`:
  - Map `activa` -> "Activa", `esperando_parcial` -> "Esperando Parcial".
  - Render tooltip with `⏱️ Esperando hace X min` and pending kitchen dishes.
- In `public/styles.css`:
  - Add styles for `.activa` (blue), `.esperando_parcial` (amber), `.mesa-kds-tooltip`, and `.prod-badge-promo`.
- In `public/index.html`:
  - Add legend badges for `Activa` and `Esperando Parcial`.

### Step 5: Happy Hour 2x1 Display & Automated Timer (`public/app.js` & `public/index.html`)
- In `renderGridProductos()`:
  - Render `2x1 PROMO` badge on participating items when Happy Hour is active.
- In `renderTicketItems()`:
  - Show `[2x1 HH]` tag on qualifying ticket items.
- In `initHappyHour()`:
  - Implement scheduled hours check (e.g. 16:00 - 19:00).
  - Add interval timer for auto-expiration.
  - Provide live countdown / end-time status on the header pill.
