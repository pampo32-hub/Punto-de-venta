# Technical Analysis: Backend Comanda Dispatch (`POST /api/comandas/enviar`) & Table State Transitions (R1)

**Author:** Explorer M1.2  
**Milestone:** M1 (Dynamic Comandas & Foundation)  
**Target File:** `C:\Users\Juan\punto-de-venta\server.js` (lines 530–606)  
**Date:** 2026-09-03  

---

## 1. Executive Summary

Requirement **R1** specifies dynamic comanda dispatch logic in GastroBar Pro:
- If new kitchen/food items are added to an order, the dispatch action sends them to kitchen ("🔥 Enviar a Cocina") and transitions the table to waiting state (`'esperando'`).
- If only beverages or bar items are added ("💾 Guardar"), the table must NOT transition to `'esperando'`, nor should kitchen staff be notified with kitchen bells or false KDS tickets. The table must transition to `'abierta'` (if previously `'libre'`) or remain in its current state (if already `'esperando'` or `'activa'`).

**Core Finding:**  
In the existing codebase (`server.js`, lines 530–606), the route `POST /api/comandas/enviar` **unconditionally** forces:
1. `Ordenes.estado = 'esperando'` (lines 543, 549)
2. `Mesas.estado = 'esperando'` (line 552)
3. `io.emit('nueva_comanda', ...)` (line 599), which triggers `sonarCampanaCocina()` (kitchen bell sound) on all client terminals and reloads KDS tickets.
4. `io.emit('mesa_actualizada', { mesaId, estado: 'esperando', total })` (line 600).

This occurs **even if the order contains only drinks (e.g., 2 beers)** or even if no new items were added.

---

## 2. Deep Dive: Current Implementation Flaws (`server.js:530–606`)

```javascript
// Current code in server.js lines 535-553:
let orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
const ahora = new Date().toISOString();
let ordenId;

if (!orden) {
  const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
  const r = await dbRun(
    `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
     VALUES (?, ?, ?, ?, ?, 'esperando')`,
    [numOrden, mesaId, cliente, mesero, ahora]
  );
  ordenId = r.lastID;
} else {
  ordenId = orden.id;
  await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
}

await dbRun("UPDATE Mesas SET estado = 'esperando', mesero = ? WHERE id = ?", [mesero, mesaId]);
```

### Critical Flaws Identified:

1. **Premature State Mutation**:  
   The updates to `Ordenes` and `Mesas` occur at lines 543, 549, and 552 **before** the `items` loop (line 555) has even run. The server sets `estado = 'esperando'` without inspecting what products are being ordered.
2. **Missing Destination Check**:  
   There is zero logic checking `it.destino === 'cocina'` vs `it.destino === 'barra'`.
3. **No Distinction of Unsent vs Sent Items**:  
   Existing items loaded from the backend have `id_detalle_existente` (or `enviado: true`). The current code ignores `it.enviado`. If all items were already sent, it still mutates the table to `'esperando'`.
4. **Kitchen Alert Pollution**:  
   At line 599:
   ```javascript
   io.emit('nueva_comanda', { mesaId, ordenId, comandas: nuevasComandas });
   ```
   In `public/app.js` line 113:
   ```javascript
   socket.on('nueva_comanda', (d) => {
     sonarCampanaCocina(); // RINGS KITCHEN BELL!
     cargarKDSDesdeBackend();
     cargarMesasDesdeBackend();
   });
   ```
   Every beverage order rings the physical kitchen bell sound and forces KDS to fetch `/api/kds?destino=cocina`, returning 0 new items.
5. **Hardcoded Socket Table Status**:  
   At line 600, `io.emit('mesa_actualizada', { mesaId, estado: 'esperando', total })` broadcasts `estado: 'esperando'` regardless of what state the table actually holds.
6. **Lack of Mesa Existence Validation**:  
   If `mesaId` does not exist in `Mesas`, `UPDATE Mesas` silently affects 0 rows, while `INSERT INTO Ordenes` creates an orphan order. It should return HTTP 404.

---

## 3. Destination Filtering & Unsent Item Identification

### 3.1 Item Structure Harmonization
Clients and tests pass items in slightly differing key formats:
- **Frontend (`public/app.js`)**: `{ id, nombre, precio, cantidad, destino, curso, enviado, id_detalle_existente }`
- **E2E Tests / Interface Contract (`PROJECT.md` § Interface Contracts)**: `{ producto_id, nombre_producto, precio_unitario, cantidad, destino, curso, enviado }`

To guarantee 100% resilience across both opaque-box tests and the web client:
```javascript
const prodId = it.producto_id || it.id;
let nombre = it.nombre || it.nombre_producto;
let precio = it.precio != null ? Number(it.precio) : (it.precio_unitario != null ? Number(it.precio_unitario) : null);
let destino = it.destino;
let curso = it.curso;

// If essential metadata is omitted in test payloads, resolve from Productos table
if ((!nombre || precio == null || !destino || !curso) && prodId) {
  const prodDb = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
  if (prodDb) {
    if (!nombre) nombre = prodDb.nombre;
    if (precio == null) precio = prodDb.precio;
    if (!destino) destino = prodDb.destino;
    if (!curso) curso = prodDb.curso || 2;
  }
}
destino = destino || 'cocina';
curso = curso || 2;
```

### 3.2 Unsent Kitchen Item Detection
An item is **new** if `!it.id_detalle_existente && !it.enviado`.  
An item is destined for the **kitchen** if:
```javascript
it.destino === 'cocina' || (it.destino !== 'barra' && it.curso && it.curso <= 3)
```
Thus:
```javascript
const tieneNuevosCocina = itemsProcesados.some(it => 
  it.destino === 'cocina' || (it.destino !== 'barra' && it.curso && it.curso <= 3)
);
```

---

## 4. Table & Order State Transition Matrix

The table state machine must satisfy all dining phases across Milestones 1 and 2:

| Prior Mesa State | Items Received | Target Mesa State | Target Orden State | Emit `nueva_comanda`? | Rationale |
|---|---|---|---|---|---|
| `libre` | Only Bar (`destino: 'barra'`) | `abierta` | `abierta` | **NO** | Customers seated drinking; no food ordered. Kitchen not disturbed. |
| `libre` | Kitchen (`destino: 'cocina'`) | `esperando` | `esperando` | **YES** | Food ordered; table is waiting for kitchen preparation. |
| `abierta` | Only Bar (`destino: 'barra'`) | `abierta` | `abierta` (unchanged) | **NO** | Additional round of drinks; table remains open. |
| `abierta` | Kitchen (`destino: 'cocina'`) | `esperando` | `esperando` | **YES** | First food order sent to kitchen; table transitions to waiting. |
| `esperando` | Only Bar (`destino: 'barra'`) | `esperando` | `esperando` (unchanged) | **NO** | Drinks added while still waiting for food; table remains waiting. |
| `esperando` | Kitchen (`destino: 'cocina'`) | `esperando` | `esperando` | **YES** | Additional food items sent; kitchen notified. |
| `activa` (M2) | Only Bar (`destino: 'barra'`) | `activa` | `activa` (unchanged) | **NO** | Food already eaten/served; drinks ordered. Table stays Blue (`activa`). |
| `activa` (M2) | Kitchen (`destino: 'cocina'`) | `esperando` | `esperando` | **YES** | Dessert or additional dish ordered; table flips back to Orange (`esperando`). |

### State Representation Note (`'abierta'` vs `'ocupada'`)
- `PROJECT.md` line 48 specifies: *"If all are 'barra', table remains in current state (or 'abierta')."*
- `database.js` defines `Ordenes.estado TEXT DEFAULT 'abierta'`.
- To maintain UI harmony:
  - If a table was `'libre'` and only bar drinks are saved, setting `Mesas.estado = 'abierta'` adheres strictly to the contract.
  - In `public/app.js`, `estadoEtiqueta` should recognize `'abierta'` (e.g. `'Abierta'` / `'Ocupada'`), and `public/styles.css` should ensure `.mesa-render-card.abierta` shares the same occupied badge styling.

---

## 5. Socket.IO Emission Protocol

### 5.1 Event: `nueva_comanda`
- **Condition**: ONLY when `comandasCocina.length > 0`.
- **Payload**: `{ mesaId, ordenId, comandas: comandasCocina }`
- **Result**: Kitchen terminal sounds bell `sonarCampanaCocina()`, loads tickets. Terminals without kitchen items are NOT spammed with sounds.

### 5.2 Event: `mesa_actualizada`
- **Condition**: ALWAYS emitted when comanda is processed.
- **Payload**: `{ mesaId, estado: nuevoEstadoMesa, total }`
- **Result**: Floor plan map updates badge, color, and running table total in real time.

---

## 6. Detailed Implementation Blueprint for `server.js`

Replace lines 530–606 in `server.js` with the following implementation:

```javascript
app.post('/api/comandas/enviar', async (req, res) => {
  try {
    const { mesaId, mesero = 'Juan Jival', cliente = 'Cliente General', items = [], happyHourActivo = false } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'La comanda no contiene productos' });
    }

    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    // 1. Identify newly added unsent items
    const nuevosItems = items.filter(it => !it.id_detalle_existente && !it.enviado);
    if (!nuevosItems.length && items.length > 0) {
      // Re-save without new items: calculate existing totals safely
      const ordenExistente = await dbGet(
        "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'activa', 'cuenta_pedida')",
        [mesaId]
      );
      return res.json({
        message: 'Comanda guardada con éxito',
        ordenId: ordenExistente ? ordenExistente.id : null,
        total: ordenExistente ? ordenExistente.total : 0,
        estado: mesa.estado,
        tieneCocina: false
      });
    }

    // 2. Resolve product details for each new item (supporting both frontend and opaque test formats)
    const itemsProcesados = [];
    for (const it of nuevosItems) {
      const prodId = it.producto_id || it.id;
      let nombre = it.nombre || it.nombre_producto;
      let precio = it.precio != null ? Number(it.precio) : (it.precio_unitario != null ? Number(it.precio_unitario) : null);
      let destino = it.destino;
      let curso = it.curso;

      if ((!nombre || precio == null || !destino || !curso) && prodId) {
        const prodDb = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
        if (prodDb) {
          if (!nombre) nombre = prodDb.nombre;
          if (precio == null) precio = prodDb.precio;
          if (!destino) destino = prodDb.destino;
          if (!curso) curso = prodDb.curso || 2;
        }
      }

      itemsProcesados.push({
        id: prodId,
        nombre: nombre || 'Producto',
        precio: precio || 0,
        cantidad: Number(it.cantidad) || 1,
        notas: it.notas || '',
        curso: curso || 2,
        destino: destino || 'cocina'
      });
    }

    // 3. Evaluate if any new item is destined for kitchen
    const tieneNuevosCocina = itemsProcesados.some(it => 
      it.destino === 'cocina' || (it.destino !== 'barra' && it.curso && it.curso <= 3)
    );

    // 4. Find or create active order
    let orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'activa', 'cuenta_pedida')",
      [mesaId]
    );
    const ahora = new Date().toISOString();
    let ordenId;

    if (!orden) {
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const estadoInicialOrden = tieneNuevosCocina ? 'esperando' : 'abierta';
      const r = await dbRun(
        `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [numOrden, mesaId, cliente, mesero, ahora, estadoInicialOrden]
      );
      ordenId = r.lastID;
    } else {
      ordenId = orden.id;
      if (tieneNuevosCocina) {
        await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
      }
    }

    // 5. Determine and persist table state
    let nuevoEstadoMesa;
    if (tieneNuevosCocina) {
      nuevoEstadoMesa = 'esperando';
    } else {
      nuevoEstadoMesa = (mesa.estado === 'libre') ? 'abierta' : mesa.estado;
    }

    await dbRun("UPDATE Mesas SET estado = ?, mesero = ? WHERE id = ?", [nuevoEstadoMesa, mesero, mesaId]);

    // 6. Insert new items into DetalleOrden
    const nuevasComandas = [];
    for (const it of itemsProcesados) {
      const subtotal = it.precio * it.cantidad;
      const rItem = await dbRun(
        `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, hora_pedido)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, it.id, it.nombre, it.precio, it.cantidad, subtotal, it.notas, it.curso, it.destino, ahora]
      );
      nuevasComandas.push({
        id: rItem.lastID,
        orden_id: ordenId,
        nombre_producto: it.nombre,
        cantidad: it.cantidad,
        notas: it.notas,
        curso: it.curso,
        destino: it.destino,
        hora_pedido: ahora
      });
    }

    // 7. Calculate order totals and Happy Hour discounts
    const rows = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [ordenId]);
    let subtotal = rows.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);

    let descuentoHH = 0;
    if (happyHourActivo) {
      rows.forEach(r => {
        if (r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')) {
          const pares = Math.floor(r.cantidad / 2);
          descuentoHH += pares * r.precio_unitario;
        }
      });
    }

    const subNeto = subtotal - descuentoHH;
    const servicio = Math.round(subNeto * 0.10);
    const iva = Math.round(subNeto * 0.13);
    const total = subNeto + servicio + iva;

    await dbRun(
      "UPDATE Ordenes SET subtotal = ?, descuento_happy_hour = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?",
      [subtotal, descuentoHH, servicio, iva, total, ordenId]
    );

    // 8. Sockets: Only notify kitchen if kitchen items were dispatched
    const comandasCocina = nuevasComandas.filter(c => c.destino === 'cocina');
    if (comandasCocina.length > 0) {
      io.emit('nueva_comanda', { mesaId, ordenId, comandas: comandasCocina });
    }

    // Always notify salon of table status and updated total
    io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa, total });

    res.json({
      message: tieneNuevosCocina ? 'Comanda enviada a cocina' : 'Comanda guardada con éxito',
      ordenId,
      total,
      estado: nuevoEstadoMesa,
      tieneCocina: tieneNuevosCocina
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

---

## 7. Verification Plan

1. **Unit / Integration Verification with `node:test`**:
   - `test/e2e/tier1-features.test.js`: Run tests T1.1 through T1.6.
   - `test/e2e/tier2-boundaries.test.js`: Run tests T2.1 through T2.6.
2. **Specific Assertions to Add / Check**:
   - Verify `mesa.estado === 'abierta'` when submitting only beverages to a previously `'libre'` table.
   - Verify `nueva_comanda` socket event is NOT received by KDS when submitting only beverages.
   - Verify `mesa.estado === 'esperando'` when adding a food item.
3. **Execution Command**:
   ```bash
   node --test test/e2e/tier1-features.test.js test/e2e/tier2-boundaries.test.js
   ```
