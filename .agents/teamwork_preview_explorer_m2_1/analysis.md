# Backend Analysis — Milestone 2: KDS States, Partial Deliveries & Wait Time Tooltips

## Executive Summary
This analysis investigates the backend architecture in `server.js` and `database.js` for **Milestone 2 (R2)**. It diagnoses the current gap where KDS item state changes do not automatically recompute or persist table states (`activa`, `esperando_parcial`, `esperando`) in SQLite, nor emit the necessary Socket.IO real-time events. Furthermore, it details how `creado_en` / `hora_pedido` timestamps are recorded and provides a comprehensive backend implementation specification for the Worker.

---

## 1. Database Schema & State Model

### 1.1 Tables in `database.js`
- **`Mesas`**:
  - Columns: `id`, `negocio_id`, `numero`, `zona_id`, `capacidad`, `estado`, `mesero`, `x`, `y`, `forma`.
  - Current `estado` values: `'libre'`, `'abierta'`, `'esperando'`.
  - **Required M2 `estado` values**:
    - `'libre'`: Table has no active account.
    - `'abierta'`: Table has an active account containing only non-kitchen products (bar/drinks) or 0 kitchen items.
    - `'esperando'`: Table has kitchen items and 0 are ready (`listo` = 0, `pendiente` > 0).
    - `'esperando_parcial'`: Table has kitchen items and SOME are ready while OTHERS are pending (`listo` > 0, `pendiente` > 0).
    - `'activa'`: Table has kitchen items and ALL are ready (`listo` > 0, `pendiente` = 0). Represented as Blue in UI, indicating customers have received all food.
    - `'cuenta'` / `'cuenta_pedida'`: Bill requested.

- **`Ordenes`**:
  - Columns: `id`, `negocio_id`, `numero_orden`, `mesa_id`, `mesero`, `fecha_apertura`, `fecha_cierre`, `estado`, `subtotal`, `descuento_happy_hour`, `servicio_10`, `iva_13`, `total`.
  - Currently, multiple queries hardcode:
    `WHERE estado IN ('abierta', 'esperando', 'cuenta_pedida')` (e.g. `server.js:352`, `445`, `462`, `520`, `895`).
  - **Critical Finding**: If an order transitions to `'activa'` or `'esperando_parcial'`, queries with `IN ('abierta', 'esperando', 'cuenta_pedida')` will fail to join the active order, wiping out the order ID, items list, and totals!
  - **Remediation**: All active order queries across `server.js` MUST query:
    `estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')`
    (or `estado NOT IN ('pagada', 'fusionada', 'anulada')`).

- **`DetalleOrden`**:
  - Columns: `id`, `orden_id`, `producto_id`, `nombre_producto`, `precio_unitario`, `cantidad`, `subtotal`, `notas`, `curso`, `destino`, `estado_comanda`, `hora_pedido`, `hora_listo`.
  - Migration required in `database.js`:
    `db.run("ALTER TABLE DetalleOrden ADD COLUMN creado_en TEXT", () => {});`
    `db.run("ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_numero TEXT", () => {});`
  - In `app.post('/api/comandas/enviar')`, `INSERT INTO DetalleOrden` should record `hora_pedido` and `creado_en` simultaneously using ISO timestamp strings.

---

## 2. Table State Recalculation Algorithm

The table state evaluator mirrors `evaluarEstadoMesaKDS` (from `test/helpers/test-server.js` and `test/e2e/tier1-features.test.js`):

```javascript
function evaluarEstadoMesaKDS(detalles = []) {
  // 1. Filter items routed to kitchen
  const cocinaItems = detalles.filter(
    (it) => it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
  );

  if (!cocinaItems.length) return 'abierta';

  // 2. Classify statuses
  const listos = cocinaItems.filter(
    (it) => it.estado_comanda === 'listo' || it.estado_comanda === 'entregado'
  );
  const pendientes = cocinaItems.filter(
    (it) => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando'
  );

  // 3. State transition matrix
  if (pendientes.length === 0 && listos.length > 0) {
    return 'activa'; // All dishes ready -> Blue "Activa"
  } else if (listos.length > 0 && pendientes.length > 0) {
    return 'esperando_parcial'; // Partial delivery
  } else {
    return 'esperando'; // All dishes pending
  }
}
```

### Transition Triggers:
1. **Kitchen item marked ready/listo/entregado** via `/api/kds/:detalleId/estado` or `/api/comandas/:id/estado`:
   - Runs `evaluarEstadoMesaKDS(activeItems)`.
   - Updates `Mesas.estado` and `Ordenes.estado`.
   - Emits `comanda_estado_cambiado`, `comanda_actualizada`, and `mesa_actualizada`.
2. **Item annulled** via `/api/comandas/anular-item`:
   - Anulled items are excluded (`estado_comanda != 'anulado'`).
   - Runs `evaluarEstadoMesaKDS(remainingItems)`.
   - Updates `Mesas.estado` and `Ordenes.estado`.
   - Emits `mesa_actualizada`.
3. **New food items sent** via `/api/comandas/enviar`:
   - If `tieneNuevosCocina === true`:
     Table transitions to `'esperando'`.
   - If `tieneNuevosCocina === false` (e.g. only drinks):
     Table maintains its previous state (`'esperando'`, `'esperando_parcial'`, or `'activa'`).

---

## 3. KDS Endpoints Inspection & Design

### Current Endpoints:
- `GET /api/kds`: Returns items where `estado_comanda IN ('pendiente', 'preparando')`.
- `POST /api/kds/:detalleId/estado`: Updates `DetalleOrden.estado_comanda` and `hora_listo`, but does NOT update `Mesas.estado` or emit `mesa_actualizada`.

### Target Unified Endpoints:
1. **`POST /api/kds/:detalleId/estado` & `PUT /api/kds/:detalleId/estado`**
2. **`PUT /api/comandas/:id/estado` & `POST /api/comandas/:id/estado`**
   All 4 routes delegate to a single core handler: `actualizarEstadoComanda(detalleId, nuevoEstado)`:
   - Validates item existence in `DetalleOrden`.
   - Updates `estado_comanda = ?` and `hora_listo = COALESCE(?, hora_listo)`.
   - Finds parent order and mesa.
   - Recalculates `nuevoEstadoMesa` via `evaluarEstadoMesaKDS`.
   - Updates `Mesas SET estado = ?` and `Ordenes SET estado = ?`.
   - Emits Socket.IO events:
     - `comanda_estado_cambiado` (for backward compatibility)
     - `comanda_actualizada` (per R2 specification)
     - `mesa_actualizada` (payload: `{ id: mesaId, mesaId, estado: nuevoEstadoMesa, total: orden.total }`)
   - Returns `{ ok: true, detalleId, estado: nuevoEstado, mesaId, nuevoEstadoMesa }`.

3. **`GET /api/comandas/activas`**:
   - Returns all kitchen items currently in preparation or pending.
   - Joins `DetalleOrden`, `Ordenes`, and `Mesas`.
   - Includes `creado_en: d.hora_pedido`, `mesa_id`, `mesa_numero`, `estado_comanda`, `curso`, `notas`.

---

## 4. Wait Time Calculation & Tooltip Delivery Engine

### 4.1 Elapsed Wait Time Formula
Per contract (`formatearTooltipEspera`):
- `primeraComandaHora`: Minimum / earliest ISO timestamp (`hora_pedido` or `creado_en`) among kitchen items for that table.
- Elapsed time calculation:
  ```javascript
  const diffMs = Math.max(0, Date.now() - new Date(primeraComandaHora).getTime());
  const minutos = Math.floor(diffMs / 60000);
  const titulo = `⏱️ Esperando hace ${minutos} min`;
  ```
- Boundary case: `minutos === 0` formats cleanly as `"⏱️ Esperando hace 0 min"`.

### 4.2 Data Provision via `GET /api/mesas`
To prevent frontend network latency or waterfall requests on mouse hover, `GET /api/mesas` should augment each table object with wait-time metadata:
```javascript
m.total_cocina = cocinaItems.length;
m.total_listos = listos.length;
m.primera_comanda_hora = primeraHora;
m.minutos_espera = minutos;
m.platos_pendientes = pendientes.map(it => {
  if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(m.numero)) {
    return `[Mesa ${it.origen_mesa_numero}] ${it.nombre_producto}`;
  }
  return it.nombre_producto;
});
```
This enables the frontend floor map to render badges and tooltips instantaneously on hover or tap without additional API calls.

### 4.3 Dedicated Endpoint `GET /api/mesas/:id/espera`
Provides on-demand wait details for a specific table:
```json
{
  "mesaId": 10,
  "numero": "10",
  "estado": "esperando_parcial",
  "minutos": 12,
  "titulo": "⏱️ Esperando hace 12 min",
  "items": ["Corte Rib Eye 350g"],
  "tooltipText": "⏱️ Esperando hace 12 min\n• Corte Rib Eye 350g",
  "primera_comanda_hora": "2026-09-03T14:18:00.000Z",
  "total_cocina": 2,
  "total_listos": 1
}
```

---

## 5. Socket.IO Real-Time Coordination

| Event Name | Emitted On | Payload | Client Action |
|------------|------------|---------|---------------|
| `mesa_actualizada` | Comanda item marked listo, comanda sent, item anulled, table paid | `{ id, mesaId, estado, total }` | Floor map reloads (`cargarMesasDesdeBackend()`) |
| `comanda_actualizada` | Comanda item state change | `{ id, detalleId, estado, mesaId, ordenId }` | KDS screen updates item status |
| `comanda_estado_cambiado` | Comanda item state change | `{ detalleId, estado, mesaId, ordenId }` | Backward compatibility with existing tests/clients |
| `comanda_anulada` | Supervisor voids item | `{ detalleId, ordenId, producto, motivo }` | KDS & Salon reload |
| `nueva_comanda` | Waiter sends kitchen order | `{ mesaId, ordenId, comandas }` | Kitchen bell sounds, KDS & Salon reload |

---

## 6. Concrete Worker Implementation Plan (Backend)

1. **`database.js` Migrations**:
   - Add `ALTER TABLE DetalleOrden ADD COLUMN creado_en TEXT`
   - Add `ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_numero TEXT`

2. **`server.js` Query Harmonization**:
   - Update all `Ordenes.estado IN ('abierta', 'esperando', 'cuenta_pedida')` queries to include `'esperando_parcial'` and `'activa'`:
     - Line 352 (`/api/mesas`)
     - Line 445 (`/api/mesas/mover`)
     - Line 462, 463 (`/api/mesas/unir`)
     - Line 520 (`/api/ordenes/mesa/:mesaId`)
     - Line 895 (`/api/cliente/mesa/:mesaId`)
     - Line 909 (`/api/cliente/mesa/:mesaId/pedir-cuenta`)
     - Line 934 (`/api/cliente/mesa/:id`)

3. **`server.js` Core Helper `actualizarEstadoComanda`**:
   - Implement state transition logic: `evaluarEstadoMesaKDS`.
   - Update `DetalleOrden.estado_comanda` and `hora_listo`.
   - Update `Mesas.estado` and `Ordenes.estado`.
   - Emit `comanda_estado_cambiado`, `comanda_actualizada`, and `mesa_actualizada`.

4. **`server.js` Endpoints**:
   - Connect `POST /api/kds/:detalleId/estado`, `PUT /api/kds/:detalleId/estado`, `PUT /api/comandas/:id/estado`, `POST /api/comandas/:id/estado` to `actualizarEstadoComanda`.
   - Implement `GET /api/comandas/activas`.
   - Enhance `GET /api/kds` to return `creado_en`.
   - Enhance `GET /api/mesas` with `platos_pendientes`, `primera_comanda_hora`, `minutos_espera`, `total_cocina`, `total_listos`.
   - Implement `GET /api/mesas/:id/espera`.
   - In `POST /api/comandas/anular-item`, trigger table state recalculation.
