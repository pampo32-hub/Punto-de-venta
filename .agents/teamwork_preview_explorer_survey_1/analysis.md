# GastroBar Pro - Architecture, UI & State Structure Survey Report (Explorer 1)

**Date**: 2026-09-03  
**Working Directory**: `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_1`  
**Target Codebase**: `C:\Users\Juan\punto-de-venta`  
**Integrity Mode**: Development  
**Audience**: Orchestrator, Implementation Engineers, QA & Testing Agents  

---

## 1. Executive Summary

GastroBar Pro is a single-page application (SPA) Point of Sale (POS) and Kitchen Display System (KDS) designed for restaurants, gastro-bars, and lounges. The system is built with a **Node.js + Express 5** backend, **Socket.IO** for real-time duplex communication, **SQLite3** for embedded data persistence, and a vanilla JavaScript / HTML5 / CSS3 responsive frontend.

This survey provides a comprehensive architectural assessment of the codebase with specific focus on the upcoming functional milestones:
- **R1: Dynamic Comanda Actions ("Enviar a Cocina" vs "Guardar")**
- **R2: KDS States, Partial Deliveries & Elapsed Wait Times (Active Blue State & Tooltips)**
- **R3: Happy Hour 2x1 Promotions & Automated Expiration Schedule**
- **R4: Touch & Pointer Drag & Drop for Moving, Merging, and Splitting Tables with Origin Traceability**

---

## 2. Codebase Architecture & File Layout

The project follows a lightweight, consolidated monorepo structure without transpilers or build bundles:

```
C:\Users\Juan\punto-de-venta\
├── .agents/                          # Teamwork multi-agent metadata
│   ├── orchestrator_1/               # Master orchestrator planning & briefings
│   ├── teamwork_preview_explorer_survey_1/ # Explorer 1 (This agent)
│   ├── teamwork_preview_explorer_survey_2/ # Explorer 2 (Business logic)
│   └── teamwork_preview_explorer_survey_3/ # Explorer 3 (Testing & table management)
├── public/                           # Frontend client application
│   ├── index.html                    # Main POS SPA shell (~932 lines)
│   ├── app.js                        # Client state, event handlers & DOM logic (~1980 lines)
│   ├── styles.css                    # Design system, themes, animations & layout (~2389 lines)
│   └── cliente.html                  # Mobile QR self-service client view (~681 lines)
├── database.js                       # SQLite database schema, migrations & seeders (~324 lines)
├── server.js                         # Express 5 HTTP REST API & Socket.IO server (~889 lines)
├── pos.db                            # SQLite database binary
├── package.json                      # NPM dependencies and run scripts
└── README.md                         # Project documentation
```

### Key File Responsibilities
| File | Size / Lines | Key Responsibilities |
|---|---|---|
| `database.js` | 324 lines | Table creation (`Mesas`, `Ordenes`, `DetalleOrden`, `Productos`, `Categorias`, `Cajas`, `Usuarios`, etc.), column migrations via `ALTER TABLE`, initial demo seed data. |
| `server.js` | 889 lines | Express 5 application setup, Socket.IO websocket broadcaster, REST endpoints for auth, tables, orders, catalog, KDS, cash desk, and digital invoicing. |
| `public/index.html` | 932 lines | Complete HTML template containing the landing/login view, developer SaaS console, main POS viewport with 5 sub-views (`view-salon`, `view-editor-plano`, `view-kds`, `view-caja`, `view-facturacion`), and 8 overlay modals. |
| `public/app.js` | 1980 lines | Global reactive state store (`const estado`), Socket.IO listeners, DOM rendering engines (`renderSalón`, `renderKDS`, `renderGridProductos`, `renderTicketItems`, `renderEditorPlano`), and modal orchestrators. |
| `public/styles.css` | 2389 lines | Dark theme styling (`#090d16`), glassmorphism, responsive CSS grid and flexbox rules, keyframe animations, course badges, and table card states. |

---

## 3. Tech Stack & Dependencies

From `package.json`:
- **Node.js Runtime** (v18+ recommended)
- **Express**: `^5.2.1` (Next-generation Express with native Promise handling in routes)
- **Socket.IO**: `^4.8.3` (Bi-directional WebSocket engine for terminal synchronization)
- **SQLite3**: `^6.0.1` (Embedded file-based SQL database)
- **QRCode**: `^1.5.4` (Server-side dynamic QR generation for table self-service)
- **CORS**: `^2.8.6` (Cross-origin resource sharing middleware)
- **dotenv**: `^17.4.2` (Environment variables management)

*Observation*: There is currently no automated test runner (such as Jest, Mocha, or Vitest) or assertion library configured in `package.json`. Testing is currently manual.

---

## 4. State Management Architecture

### 4.1 Client-Side State (`public/app.js`)
Global state is encapsulated in a single in-memory object on line 73:
```javascript
const estado = {
  usuarioActual: null,       // Authenticated employee object { id, nombre, rol, ... }
  negocioActual: null,       // Current restaurant tenant
  mesaActiva: null,          // Selected table object currently being viewed/ordered
  itemModificando: null,     // Item index during modifier editing
  splitPersonas: 4,          // Number of people for equal bill splitting
  splitColumnas: [],         // Item allocations for custom bill splitting
  happyHourActivo: true,     // Boolean toggle for Happy Hour 2x1 promotions
  
  // Data synchronized with backend
  zonas: [],                 // Zonas del restaurante (Salón, Barra, Terraza, VIP)
  mesas: [],                 // Tables array with live status, order totals, and coordinates
  categorias: [],            // Product categories (Bebidas, Entradas, Platos, etc.)
  productos: [],             // Full product catalog with pricing and flags
  comandasKDS: [],           // Active kitchen/bar orders in preparation
  meserosReporte: []         // Tip pool & waiter statistics
};
```

### 4.2 Server-Side State & Persistence (`database.js` & `pos.db`)
State is persisted in SQLite with relational foreign keys:
- `Mesas`: `id`, `numero`, `zona_id`, `capacidad`, `estado` (`libre`, `ocupada`, `esperando`, `cuenta`), `mesero`, `x`, `y`, `forma`, `ancho`, `alto`.
- `Ordenes`: `id`, `numero_orden`, `mesa_id`, `cliente`, `mesero`, `fecha_apertura`, `fecha_cierre`, `estado` (`abierta`, `esperando`, `cuenta_pedida`, `pagada`, `fusionada`), `subtotal`, `descuento_happy_hour`, `servicio_10`, `iva_13`, `total`.
- `DetalleOrden`: `id`, `orden_id`, `producto_id`, `nombre_producto`, `precio_unitario`, `cantidad`, `subtotal`, `notas`, `curso` (1: Entrada, 2: Fuerte, 3: Postre), `destino` (`cocina`, `barra`), `estado_comanda` (`pendiente`, `preparando`, `listo`, `anulado`), `hora_pedido`, `hora_listo`.

---

## 5. Deep Dive Component & View Survey

### 5.1 Comandero & Order Taking View (`#modalComandero`) — Requirement R1

#### Location & Structure
- **HTML Container**: `public/index.html` lines 422–487 (`<div class="modal-backdrop" id="modalComandero">`).
- **Layout**: Two-column layout in desktop, tabbed layout in mobile:
  - Left Column (`#comanderoCatalogCol`): Category chips (`#comCategoryChips`) + 1-tap product cards (`#comProductsGrid`).
  - Right Column (`#comanderoTicketCol`): Table title, order number, items list (`#comTicketItemsList`), course fire button (`#btnLanzarPlatosFuertes`), calculation summary (`#comSubtotal`, `#comHappyHourRow`, `#comServicio`, `#comIva`, `#comTotal`), and action buttons (`#btnEnviarComandaCocina`, `#btnAbrirSplitBill`, `#btnAbrirCobroModal`).

#### Button Under Investigation: `#btnEnviarComandaCocina`
- **Location in HTML**: `public/index.html` line 474:
  ```html
  <button class="btn-btn-cmd cocina" id="btnEnviarComandaCocina">
    🔥 Enviar a Cocina
  </button>
  ```
- **Current Dynamic Text Logic**: `public/app.js` lines 23–46:
  ```javascript
  function actualizarBotonEnviarComanda() {
    const btn = document.getElementById('btnEnviarComandaCocina');
    if (!btn) return;

    if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
      btn.innerHTML = '💾 Guardar';
      btn.className = 'btn-btn-cmd guardar';
      return;
    }

    // Flawed logic: checks ANY item in the order, ignoring whether it was already sent!
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

#### Root Cause of R1 Defect
1. Items retrieved from the backend when opening a table (`abrirComanderoMesa`, lines 827–837) are tagged with `enviado: true` and `id_detalle_existente: it.id`.
2. Newly added items (`agregarAlTicketOneTap`, lines 709–719) are tagged with `enviado: false` and have no `id_detalle_existente`.
3. Currently, `actualizarBotonEnviarComanda()` evaluates `estado.mesaActiva.items.some(...)` against **all items** in the order, including items already sent (`it.enviado === true`).
4. As a result, if a table already sent a burger in round 1, and the waiter adds 2 beers in round 2 (`it.destino === 'barra'`, `it.enviado === false`), the button remains stuck on **"🔥 Enviar a Cocina"** instead of switching to **"💾 Guardar"**.
5. Furthermore, when clicking the button (`btnEnviarComandaCocina.addEventListener('click')`, line 970), the backend `POST /api/comandas/enviar` unconditionally executes:
   `UPDATE Mesas SET estado = 'esperando' WHERE id = ?`
   even if the new items only went to the bar!

#### Required Solution for R1
1. Modify `actualizarBotonEnviarComanda()` to check:
   ```javascript
   const tieneNuevosDeCocina = estado.mesaActiva.items.some(it => 
     !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
   );
   if (tieneNuevosDeCocina) {
     btn.innerHTML = '🔥 Enviar a Cocina';
     btn.className = 'btn-btn-cmd cocina';
   } else {
     btn.innerHTML = '💾 Guardar';
     btn.className = 'btn-btn-cmd guardar';
   }
   ```
2. When calling `POST /api/comandas/enviar`, if only drinks or non-kitchen items were added, the table should NOT be transitioned to `esperando` (waiting for kitchen food); it should maintain its active or occupied state.

---

### 5.2 Salón & Table Map View (`#view-salon`) — Requirements R2 & R4

#### Location & Structure
- **HTML Container**: `public/index.html` lines 248–281 (`<section id="view-salon" class="pos-view active">`).
- **Canvas Element**: `<div class="mesas-canvas-view" id="mesasCanvasView"></div>` inside `<div class="salon-container" id="salonContainer">`.
- **Rendering Function**: `public/app.js` lines 764–803 (`renderSalón(filtroZona = 'todas')`).

#### Table Card DOM Structure
```html
<div class="mesa-render-card [estado] [round] [silla]" style="left: Xpx; top: Ypx; width: Wpx; height: Hpx;">
  <div class="m-header">
    <span class="m-num">Mesa 1</span>
    <span class="m-badge">Esperando</span>
  </div>
  <div class="m-total">₡ 18,081.00</div>
  <div class="m-footer">
    <span>👥 4p</span>
    <span>SALÓN PRINCIPAL</span>
  </div>
</div>
```

#### Current Color Mapping & CSS (`public/styles.css` lines 370–418)
| State | CSS Class | Border Color | Background Gradient | Badge Color |
|---|---|---|---|---|
| Free | `.libre` | `#10b98166` (Green) | `#111827` to `#064e3b33` | `#064e3b` / `#34d399` |
| Occupied | `.ocupada` | `#ef444499` (Red) | `#111827` to `#7f1d1d44` | `#7f1d1d` / `#f87171` |
| Waiting Food | `.esperando` | `var(--accent)` (Orange) | `#111827` to `#7c2d1244` | `#7c2d12` / `#fb923c` |
| Bill Requested| `.cuenta` | `var(--warning)` (Amber) | `#111827` to `#78350f44` | `#78350f` / `#fbbf24` |
| **Active (Food Served)** | **MISSING** | Target: Blue (`#0284c7` / `#38bdf8`) | Target: `#111827` to `#0369a133` | Target: `#0369a1` / `#38bdf8` |
| **Partial Waiting** | **MISSING** | Target: Orange/Amber split | Target: Partial preparation | Target: "Esperando Parcial" |

#### Table Tooltip Analysis
- **Current Behavior**: There is NO tooltip in `renderSalón()`. Hovering simply applies a CSS scale transform (`transform: translateY(-4px) scale(1.02)`).
- **R2 Requirement**:
  - Mesas with kitchen dishes pending must display an informative tooltip/popover on hover (and tap on touch devices).
  - Must display elapsed time since first kitchen order was placed (e.g. *"Esperando hace 12 min"*).
  - Must list **strictly the pending dishes** (`estado_comanda != 'listo' && destino === 'cocina'`), excluding dishes already dispatched.
  - If a table has some dishes ready and some pending, the card must show status **"Esperando Parcial"**.
  - When the last dish is marked ready in KDS, the table card must transition to **"Activa" (Azul)**.

---

### 5.3 KDS (Kitchen Display System) View (`#view-kds`) — Requirement R2

#### Location & Structure
- **HTML Container**: `public/index.html` lines 304–318 (`<section id="view-kds" class="pos-view">`).
- **Card Container**: `<div class="kds-tickets-container" id="kdsTicketsContainer"></div>`.
- **Filtering Tabs**: `todas` (all), `cocina` (kitchen), `barra` (bar).
- **Backend API**: `GET /api/kds?destino=...` (`server.js` lines 660–682).
- **Item Ready Action**: `POST /api/kds/:detalleId/estado` (`server.js` lines 684–695).
- **Client Handler**: `despacharKDSBackend(detalleId)` in `public/app.js` lines 1057–1070.

#### Missing Kitchen-to-Salon Lifecycle Linkage
1. When a cook marks an item as ready via `POST /api/kds/:detalleId/estado`, `server.js` executes:
   ```javascript
   UPDATE DetalleOrden SET estado_comanda = 'listo', hora_listo = ? WHERE id = ?
   io.emit('comanda_estado_cambiado', { detalleId, estado });
   ```
2. **Missing Backend Logic**:
   - `server.js` does NOT inspect the parent order (`orden_id`) or table (`mesa_id`).
   - It does NOT check how many kitchen items remain pending for that order.
   - It never updates `Mesas.estado` to `'activa'` or `'esperando_parcial'`.
   - It does not emit a `mesa_actualizada` event.
3. **Missing Frontend Socket Listener**:
   - In `public/app.js` (lines 110–140), there is NO listener for `comanda_estado_cambiado`!
   - Terminals on the Salón view never update when kitchen marks dishes ready unless someone triggers another action.

---

### 5.4 Menu, Catalog, Ticket & Happy Hour System — Requirement R3

#### Location & Structure
- **Navbar Button**: `public/index.html` lines 194–201:
  ```html
  <div class="happy-hour-pill" id="btnToggleHappyHour" title="Toca para activar o desactivar Happy Hour">
    <span class="hh-icon">🍸</span>
    <div class="hh-info">
      <span class="hh-title">HAPPY HOUR 2x1</span>
      <small id="hhStatusTxt">Activado (4 PM - 7 PM)</small>
    </div>
  </div>
  ```
- **Toggle Handler**: `public/app.js` lines 1916–1934 (`initHappyHour()`).
- **Ticket Recalculation**: `public/app.js` lines 919–956 (`recalcularTotalesTicket()`).
- **Backend Calculation**: `server.js` lines 580–587.

#### Discrepancies & Flaws in Happy Hour Implementation
1. **Database Schema vs Implementation**:
   - Database table `Productos` has a `happy_hour INTEGER DEFAULT 0` column.
   - When inspecting `pos.db`, **all 17 seeded products currently have `happy_hour = 0`**.
2. **Catalog Presentation Disconnect**:
   - In `app.js` line 675: `const isPromo = estado.happyHourActivo && p.happyHour;`. Because `p.happyHour` is `false` for every product, the `2x1` badge is never displayed in the catalog, even when Happy Hour is toggled on!
3. **Hardcoded Backend vs Dynamic Frontend Calculation**:
   - In `app.js` line 933:
     ```javascript
     if (it.happyHour && it.cantidad >= 2) {
       const pares = Math.floor(it.cantidad / 2);
       descuentoHH += pares * it.precio;
     }
     ```
     Frontend calculates based on `it.happyHour`.
   - In `server.js` line 581:
     ```javascript
     if (r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')) {
       const pares = Math.floor(r.cantidad / 2);
       descuentoHH += pares * r.precio_unitario;
     }
     ```
     Backend ignores `it.happyHour` completely and uses hardcoded product name string matching!
4. **Lack of Automated Expiration**:
   - The UI states `Activado (4 PM - 7 PM)` in HTML, but there is no timer, cron, or time-checking logic.
   - If Happy Hour is manually turned on, it stays on indefinitely unless clicked again.
   - Requirement R3 requires:
     - Clear 2x1 and discount reflections on catalog cards, prices, and ticket lines.
     - 1-click manual activation.
     - Automatic deactivation without manual intervention once the scheduled end time is reached.

---

### 5.5 Table Management: Move, Merge & Split — Requirement R4

#### Location & Structure
- **Current Move/Merge Modal**: `public/index.html` lines 688–732 (`<div class="modal-backdrop" id="modalMoverUnir">`).
- **Current Behavior**: Activated by clicking "🔄 Mover / Unir Mesas" in the sub-bar. Shows two tabs with `<select>` dropdowns (`selMoverOrigen`, `selMoverDestino`, `selUnirMesa1`, `selUnirMesa2`).
- **Backend Endpoints**:
  - `POST /api/mesas/mover` (`server.js` lines 438–457): Transfers active order from `origenMesaId` to `destinoMesaId`, copies table status, sets origin to `libre`.
  - `POST /api/mesas/unir` (`server.js` lines 459–483): Executes `UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?`, marks secondary order as `fusionada`, sets secondary table to `libre`.

#### Critical Deficiencies for Requirement R4
1. **No Drag & Drop in Salón**:
   - Drag & drop coordinate repositioning exists in the Editor Salón (`renderEditorPlano`, lines 1727–1769), but `renderSalón` only attaches a click listener (`card.addEventListener('click', () => abrirComanderoMesa(m.id))`).
   - There is no long-press detection (timer on pointerdown / touchstart / mousedown).
   - There is no visual drag avatar, drag ghost, or drop-target detection over other table cards.
2. **Confirmation Dialogs Missing**:
   - Dragging table X over empty table Y must trigger: *"¿Deseas mover la Mesa X a la Mesa Y? [Sí] [No]"*.
   - Dragging table X over occupied table Y must trigger: *"¿Deseas unir la Mesa X con la Mesa Y? [Sí] [No]"*.
3. **Irreversible Merge / Loss of Origin Traceability**:
   - When `app.post('/api/mesas/unir')` merges orders, it reassigns `DetalleOrden.orden_id = orden1.id` without saving which table or order each item originally belonged to.
   - `DetalleOrden` has no `mesa_origen` column.
   - Therefore, items in the merged ticket cannot display `[Mesa 1] Hamburguesa` or `[Mesa 2] Corona`.
   - Furthermore, because the link between items and the secondary table is permanently erased, **separating the tables (undoing the merge) is currently impossible!**

---

## 6. Data Flow & Communication Models

### 6.1 Real-Time WebSocket Events Matrix
| Socket Event | Emitted By | Payload | Handled In `app.js`? | Notes |
|---|---|---|---|---|
| `nueva_comanda` | `server.js:599` | `{ mesaId, ordenId, comandas }` | Yes (rings bell, reloads KDS & tables) | Works as intended |
| `mesa_actualizada` | `server.js:600, 721, 828` | `{ mesaId, estado, total }` | Yes (reloads tables) | Missing for KDS completions |
| `lanzar_fuertes` | `server.js:616` | `{ mesaId, mesaNumero, ordenId }` | Yes (alerts, reloads KDS) | Works |
| `comanda_anulada` | `server.js:650` | `{ detalleId, ordenId, producto, motivo }` | Yes (reloads KDS & tables) | Works |
| `comanda_estado_cambiado` | `server.js:690` | `{ detalleId, estado }` | **NO (Missing listener!)** | **Critical bug for R2** |
| `mesas_reorganizadas` | `server.js:369` | `{ posiciones }` | Yes (reloads tables) | Used by salon editor |
| `mesas_unidas` | `server.js:478` | `{ mesaPrincipalId, mesaSecundariaId, ordenPrincipalId }` | **NO (Implicit via fetch response)** | Needs socket propagation |
| `mesa_transferida` | `server.js:452` | `{ origenMesaId, destinoMesaId, ordenId }` | **NO (Implicit via fetch response)** | Needs socket propagation |
| `cliente_pidio_cuenta` | `server.js:827` | `{ mesaId, mesaNumero }` | Yes (alert & sound) | Works |

---

## 7. Discrepancies, Gaps & Architectural Vulnerabilities

```
+-------------------+---------------------------------------------+----------------------------------------------+
| Requirement       | Current Implementation                     | Defect / Architectural Gap                   |
+-------------------+---------------------------------------------+----------------------------------------------+
| R1: Comanda Btn   | Checks any item in order for cocina destino | Checks already-sent items; button stuck on   |
|                   | (app.js:34)                                 | "Enviar a Cocina" even when only adding bar. |
+-------------------+---------------------------------------------+----------------------------------------------+
| R2: KDS States    | Only updates DetalleOrden.estado_comanda    | No parent check; no 'activa' or 'parcial'    |
| & Wait Times      | (server.js:688)                             | table state; no hover/tap tooltip; socket    |
|                   |                                             | event comanda_estado_cambiado ignored.       |
+-------------------+---------------------------------------------+----------------------------------------------+
| R3: Happy Hour    | Manual toggle only; hardcoded product names | Seed DB has happy_hour=0 for all; no auto-   |
|                   | on server; no auto-expiration timer.        | timer; menu cards do not show promo prices.  |
+-------------------+---------------------------------------------+----------------------------------------------+
| R4: Table D&D,    | Modal select dropdowns only; merge deletes  | No long-press drag in salon; no confirmation |
| Merge & Split     | origin mesa linkage from items.             | dialogs; no separate/undo; no traceability.  |
+-------------------+---------------------------------------------+----------------------------------------------+
```

---

## 8. Recommendations & Implementation Blueprint

### Phase 1: Comandero Button Logic (R1)
1. **Frontend (`app.js`)**:
   - In `actualizarBotonEnviarComanda()`, filter specifically for items where `!it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))`.
   - If true: `btn.innerHTML = '🔥 Enviar a Cocina'`, `btn.className = 'btn-btn-cmd cocina'`.
   - If false: `btn.innerHTML = '💾 Guardar'`, `btn.className = 'btn-btn-cmd guardar'`.
2. **Backend (`server.js`)**:
   - In `POST /api/comandas/enviar`, check if any newly inserted item has `destino === 'cocina'`. Only update `Mesas.estado = 'esperando'` if at least one new kitchen item was inserted; otherwise retain `'activa'` or `'ocupada'`.

### Phase 2: KDS States, Tooltip & Wait Times (R2)
1. **Database & Queries**:
   - Update `/api/mesas` endpoint to aggregate pending kitchen items per table:
     - `items_pendientes`: list of pending kitchen items with quantities and names.
     - `primera_hora_pedido`: timestamp of the earliest pending dish.
     - `total_cocina`: total food items sent.
     - `listos_cocina`: food items marked ready.
2. **State & CSS**:
   - Add `.mesa-render-card.activa` (blue gradient `#0284c7`) and `.mesa-render-card.esperando_parcial` in `styles.css`.
   - When all kitchen items are ready: set table status to `activa`.
   - When some kitchen items are ready: set table status to `esperando_parcial`.
3. **Interactive Tooltip**:
   - Attach mouseenter/mouseleave and touch tooltip handlers to `.mesa-render-card`.
   - Tooltip content: calculate elapsed time using `Math.floor((Date.now() - new Date(primera_hora_pedido)) / 60000)` ("Esperando hace X min") and render the exact list of pending dishes.
4. **WebSocket Synchronization**:
   - In `server.js:app.post('/api/kds/:detalleId/estado')`, evaluate order state after updating `DetalleOrden`. If all items are ready, update table to `activa` and emit `mesa_actualizada`.
   - In `app.js`, add socket listener for `comanda_estado_cambiado` to trigger `cargarMesasDesdeBackend()` and `cargarKDSDesdeBackend()`.

### Phase 3: Happy Hour Engine (R3)
1. **Database Seed (`database.js`)**:
   - Set `happy_hour = 1` for Imperial, Pilsen, Corona Extra, Mojito, and Margarita.
2. **Unified Promotion Logic**:
   - Standardize backend (`server.js`) to check `p.happy_hour = 1` rather than hardcoding names.
   - Show dynamic 2x1 promotional pricing and badges in `renderGridProductos()`.
3. **Automated Scheduler**:
   - Implement `checkHappyHourSchedule()` running every minute (or `setInterval`).
   - Define daily schedule (e.g. 16:00 to 19:00).
   - If manually activated, enforce auto-expiration when the scheduled end time is reached, updating the UI badge and notifying the cashier/waiter.

### Phase 4: Drag & Drop Table Move, Merge & Split (R4)
1. **Touch & Mouse Long-Press Engine**:
   - On `.mesa-render-card`, attach `pointerdown` / `touchstart` / `mousedown`.
   - If held for > 400ms without movement, activate "Arrastrar Mesa" mode.
   - Render a floating ghost card following pointer movements.
   - Detect collision/hover over destination table card via `document.elementFromPoint()`.
2. **Context-Aware Confirmation Dialogs**:
   - Destination table is free -> Confirm: *"¿Deseas mover la Mesa X a la Mesa Y?"* -> Call `/api/mesas/mover`.
   - Destination table is occupied -> Confirm: *"¿Deseas unir la Mesa X con la Mesa Y?"* -> Call `/api/mesas/unir`.
3. **Traceability & Reversibility**:
   - Add columns to `DetalleOrden`: `mesa_origen TEXT` (e.g. `'Mesa 1'`) and `orden_origen_id INTEGER`.
   - When merging tables, tag existing items with their table origin.
   - In `Ordenes`, track `orden_fusionada_id` or parent relationship.
   - Render `[Mesa 1] Hamburguesa` in ticket, KDS, and checkout.
   - Add "Separar Mesas" option when long-pressing a merged table to restore separate orders and reopen both tables in their original state.
