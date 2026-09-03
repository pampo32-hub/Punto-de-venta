# Detailed Technical Analysis: KDS States, Partial Deliveries & Wait Time Tooltips (Frontend UI & CSS)

**Explorer**: Explorer 2 (Milestone 2 - Frontend UI & CSS)  
**Target Files**: `public/app.js`, `public/styles.css`, `public/index.html`  
**Reference Contracts**: `ORIGINAL_REQUEST.md` (R2), `PROJECT.md` (M2: F4, F5, F6), `test/helpers/test-server.js`, `test/e2e/tier1-features.test.js`

---

## 1. Executive Summary

Milestone 2 Requirement 2 (R2) dictates three primary visual and interactive capabilities on the restaurant floor map and KDS:
1. **Activa State (Color Blue)**: When all kitchen items belonging to a table are marked "Listo" in KDS, the table transitions to "Activa" (color Blue, `#2563eb` / `#3b82f6`), visually signaling to waitstaff and runners that customers have received all their prepared food.
2. **Esperando Parcial State & Pending Filter**: If a table has multiple kitchen items and only some have been marked "Listo", the table displays the status **"Esperando Parcial"** (color Amber/Gold `#f59e0b`), and its wait-time tooltip displays **only the pending dishes** (excluding already served/ready dishes).
3. **Elapsed Wait Time Tooltip (Hover & Tap)**: Hovering with a mouse or tapping on mobile displays a tooltip/indicator showing:
   - Header: `"⏱️ Esperando hace X min"` calculated from the timestamp of the earliest comanda.
   - List: Bulleted list of pending kitchen dishes awaiting dispatch.
   - Non-blocking interaction: Tapping the wait chip on touch screens does not accidentally open the table order modal.

Currently in the codebase:
- Table states in `public/app.js` and `public/styles.css` only recognize `libre`, `ocupada`, `abierta`, `esperando`, and `cuenta`. The states `activa` and `esperando_parcial` are completely absent in CSS and fall back to "Libre" in `renderSalón()`.
- Tooltip markup, CSS, and touch/hover listeners do not exist.
- Kitchen dispatch in `public/app.js` (`despacharKDSBackend`) does not refresh the floor map tables (`cargarMesasDesdeBackend()`), and `comanda_estado_cambiado` socket event is not registered.

---

## 2. Current Architecture & Gap Analysis

### 2.1 Table Rendering in `public/app.js` (`renderSalón`)
- **Current Location**: `public/app.js`, lines 763–803.
- **Current Logic**:
  ```javascript
  const estadoEtiqueta = {
    libre: 'Libre',
    ocupada: 'Ocupada',
    abierta: 'Abierta',
    esperando: 'Esperando',
    cuenta: 'Cuenta Pedida'
  }[m.estado] || 'Libre';
  ```
- **Gaps**:
  - If `m.estado === 'activa'`, `estadoEtiqueta` falls back to `'Libre'`!
  - If `m.estado === 'esperando_parcial'`, `estadoEtiqueta` falls back to `'Libre'`!
  - `card.className` receives `m.estado`, but there are no CSS rules for `.activa` or `.esperando_parcial`.
  - No tooltip DOM element or title attribute is rendered.
  - No wait-time calculation exists in `renderSalón()`.

### 2.2 Table Card Styles in `public/styles.css`
- **Current Location**: `public/styles.css`, lines 370–395 and 420–425.
- **Current Rules**:
  ```css
  .mesa-render-card.libre { border-color: #10b98166; background: ...; }
  .mesa-render-card.ocupada { border-color: #ef444499; background: ...; }
  .mesa-render-card.abierta { border-color: var(--primary); background: ...; }
  .mesa-render-card.esperando { border-color: var(--accent); background: ...; }
  .mesa-render-card.cuenta { border-color: var(--warning); background: ...; }
  ```
- **Gaps**:
  - Missing `.mesa-render-card.activa`: Needs `#2563eb` / `#3b82f6` border, `#1d4ed8` gradient tint, and blue badge (`#1e3a8a` bg, `#93c5fd` text).
  - Missing `.mesa-render-card.esperando_parcial`: Needs `#f59e0b` amber border, amber gradient tint, and amber badge (`#78350f` bg, `#fde047` text).
  - Missing `.legend-badge.activa` and `.legend-badge.esperando_parcial` in the salon header legend.
  - Missing `.mesa-tooltip`, `.m-wait-chip`, `.tooltip-header`, `.tooltip-list`, and responsive arrow CSS.

### 2.3 Salon Header Legend in `public/index.html`
- **Current Location**: `public/index.html`, lines 250–255.
- **Current HTML**:
  ```html
  <div class="legend-group">
    <span class="legend-badge libre"><span class="dot"></span> Libre</span>
    <span class="legend-badge ocupada"><span class="dot"></span> Ocupada</span>
    <span class="legend-badge esperando"><span class="dot"></span> Esperando Comida</span>
    <span class="legend-badge cuenta"><span class="dot"></span> Cuenta Pedida</span>
  </div>
  ```
- **Gaps**:
  - Legend does not show "Esperando Parcial" or "Activa".

### 2.4 KDS Synchronization & Sockets
- **Current Location**: `public/app.js`, lines 106–140 and 1066–1079.
- **Current Logic**:
  ```javascript
  window.despacharKDSBackend = async function(detalleId) {
    try {
      await fetch(`/api/kds/${detalleId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'listo' })
      });
      sonarCampanaCocina();
      alert('🍽️ Comanda marcada como lista.');
      cargarKDSDesdeBackend();
    } catch (e) {
      sonarCampanaCocina();
    }
  };
  ```
- **Gaps**:
  - `despacharKDSBackend` does not call `cargarMesasDesdeBackend()`. If the user switches back to Salón view, tables might have stale state until manual refresh.
  - `socket.on('comanda_estado_cambiado')` is missing; when kitchen marks an item ready on another device, waitstaff salon map is not notified to reload.

---

## 3. Detailed Specification for Required Changes

### 3.1 Domain Functions Contract (Matching `test-server.js`)
To guarantee 100% interoperability with E2E tests, the frontend must implement and expose the domain evaluators:

```javascript
/**
 * R2 Contract: Evaluates table status from kitchen orders.
 * If all kitchen items are ready -> 'activa' (Blue)
 * If some are ready and some pending -> 'esperando_parcial'
 * If none ready and some pending -> 'esperando'
 * If no kitchen items -> 'abierta'
 */
function evaluarEstadoMesaKDS(detalles = []) {
  const cocinaItems = detalles.filter(
    (it) => it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
  );

  if (!cocinaItems.length) return 'abierta';

  const listos = cocinaItems.filter((it) => it.estado_comanda === 'listo');
  const pendientes = cocinaItems.filter(
    (it) => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando'
  );

  if (pendientes.length === 0 && listos.length > 0) {
    return 'activa';
  } else if (listos.length > 0 && pendientes.length > 0) {
    return 'esperando_parcial';
  } else {
    return 'esperando';
  }
}

/**
 * R2 Contract: Formats elapsed wait tooltip.
 * Header: "⏱️ Esperando hace X min"
 * Items: list of only pending dishes.
 */
function formatearTooltipEspera(primeraComandaHora, itemsPendientes = [], ahora = new Date()) {
  if (!primeraComandaHora) {
    return { minutos: 0, titulo: '⏱️ Esperando hace 0 min', items: [], tooltipText: '⏱️ Esperando hace 0 min' };
  }
  const fechaPedido = new Date(primeraComandaHora);
  const diffMs = Math.max(0, ahora.getTime() - fechaPedido.getTime());
  const minutos = Math.floor(diffMs / 60000);

  const titulo = `⏱️ Esperando hace ${minutos} min`;
  const itemsList = itemsPendientes.map((it) => (typeof it === 'string' ? it : it.nombre_producto || it.nombre));

  return {
    minutos,
    titulo,
    items: itemsList,
    tooltipText: `${titulo}${itemsList.length ? '\n' + itemsList.map((i) => `• ${i}`).join('\n') : ''}`
  };
}

// Global exposure for window and Node test environments
if (typeof window !== 'undefined') {
  window.evaluarEstadoMesaKDS = evaluarEstadoMesaKDS;
  window.formatearTooltipEspera = formatearTooltipEspera;
}
```

### 3.2 Floor Map Rendering (`renderSalón` in `public/app.js`)
Update `renderSalón()` to render the badge, wait chip, and tooltip:

```javascript
function renderSalón(filtroZona = 'todas') {
  const canvas = document.getElementById('mesasCanvasView');
  canvas.innerHTML = '';

  const mesasFiltradas = filtroZona === 'todas' 
    ? estado.mesas 
    : estado.mesas.filter(m => m.zona.includes(filtroZona));

  mesasFiltradas.forEach(m => {
    const card = document.createElement('div');
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    card.className = `mesa-render-card ${m.estado} ${m.forma === 'round' ? 'round' : ''} ${esSilla ? 'silla' : ''}`;
    card.style.left = m.x + 'px';
    card.style.top = m.y + 'px';
    card.style.width = (m.ancho || (esSilla ? 95 : 130)) + 'px';
    card.style.height = (m.alto || (esSilla ? 105 : 120)) + 'px';
    card.setAttribute('data-mesa-id', m.id);
    card.setAttribute('data-estado', m.estado);

    const estadoEtiqueta = {
      libre: 'Libre',
      ocupada: 'Ocupada',
      abierta: 'Abierta',
      esperando: 'Esperando',
      esperando_parcial: 'Esperando Parcial',
      activa: 'Activa',
      cuenta: 'Cuenta Pedida'
    }[m.estado] || 'Libre';

    // Construcción de indicador de tiempo y tooltip si tiene platillos en preparación
    let tooltipHtml = '';
    let waitBadgeHtml = '';

    const tienePreparacion = (m.estado === 'esperando' || m.estado === 'esperando_parcial');

    if (tienePreparacion) {
      const tooltipData = formatearTooltipEspera(m.primera_comanda_hora, m.items_pendientes || []);
      
      // Accesibilidad y tooltip nativo del navegador
      card.title = tooltipData.tooltipText || tooltipData.titulo;
      card.setAttribute('data-tooltip', tooltipData.tooltipText || tooltipData.titulo);

      // Chip indicador visible en cabecera
      waitBadgeHtml = `
        <span class="m-wait-chip" title="${tooltipData.titulo}" data-mesa-id="${m.id}">⏱️ ${tooltipData.minutos}m</span>
      `;

      // Posicionamiento inteligente del tooltip (evitar salirse por arriba)
      const posClass = m.y < 110 ? 'pos-bottom' : '';
      const itemsListHtml = (tooltipData.items && tooltipData.items.length > 0)
        ? `<ul class="tooltip-list">${tooltipData.items.map(it => `<li><span class="dot-icon">⏳</span> ${it}</li>`).join('')}</ul>`
        : '<div class="tooltip-empty">Sin detalles de platillos pendientes</div>';

      tooltipHtml = `
        <div class="mesa-tooltip ${posClass}" role="tooltip">
          <div class="tooltip-header">
            <span class="tooltip-timer">${tooltipData.titulo}</span>
            <span class="tooltip-badge ${m.estado}">${m.estado === 'esperando_parcial' ? 'Parcial' : 'En cola'}</span>
          </div>
          <div class="tooltip-title">Platillos pendientes:</div>
          ${itemsListHtml}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="m-header">
        <span class="m-num">${m.numero}</span>
        <div class="m-badges-row">
          ${waitBadgeHtml}
          <span class="m-badge">${estadoEtiqueta}</span>
        </div>
      </div>
      <div class="m-total">${m.orden_total > 0 ? formatCRC(m.orden_total) : '—'}</div>
      <div class="m-footer">
        <span>👥 ${m.capacidad}p</span>
        <span>${m.zonaNombre ? m.zonaNombre.toUpperCase() : 'SALÓN'}</span>
      </div>
      ${tooltipHtml}
    `;

    // Interacción táctil / tap en móvil para el chip de espera (no abre comandero)
    const waitChip = card.querySelector('.m-wait-chip');
    if (waitChip) {
      waitChip.addEventListener('click', (e) => {
        e.stopPropagation();
        const tt = card.querySelector('.mesa-tooltip');
        if (tt) {
          const wasVisible = tt.classList.contains('show-touch');
          document.querySelectorAll('.mesa-tooltip.show-touch').forEach(el => el.classList.remove('show-touch'));
          if (!wasVisible) {
            tt.classList.add('show-touch');
          }
        }
      });
    }

    // Clic en la mesa abre el comandero (a menos que se haya interactuado con el tooltip)
    card.addEventListener('click', (e) => {
      if (e.target.closest('.mesa-tooltip') || e.target.closest('.m-wait-chip')) return;
      abrirComanderoMesa(m.id);
    });

    canvas.appendChild(card);
  });
}
```

### 3.3 CSS Rules in `public/styles.css`
```css
/* ============================================================= */
/* R2: ESTADOS DE MESA KDS & TOOLTIPS DE ESPERA                 */
/* ============================================================= */

/* 1. MESA ACTIVA (COLOR AZUL - TODO SERVIDO) */
.mesa-render-card.activa {
  border-color: #2563eb !important;
  background: linear-gradient(180deg, #111827 0%, rgba(37, 99, 235, 0.28) 100%) !important;
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.25);
}

.mesa-render-card.activa .m-badge {
  background: #1d4ed8 !important;
  color: #93c5fd !important;
  border: 1px solid rgba(147, 197, 253, 0.3);
}

/* 2. MESA ESPERANDO PARCIAL (AMBER/GOLD - PARTE LISTA, PARTE PENDIENTE) */
.mesa-render-card.esperando_parcial {
  border-color: #f59e0b !important;
  background: linear-gradient(180deg, #111827 0%, rgba(245, 158, 11, 0.22) 100%) !important;
  box-shadow: 0 6px 14px rgba(245, 158, 11, 0.2);
}

.mesa-render-card.esperando_parcial .m-badge {
  background: #78350f !important;
  color: #fde047 !important;
  border: 1px solid rgba(253, 224, 71, 0.3);
}

/* Contenedor de badges en el header de la tarjeta */
.m-badges-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Chip de tiempo de espera visible en la tarjeta */
.m-wait-chip {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(234, 88, 12, 0.25);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.4);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transition: background 0.15s, transform 0.15s;
}

.m-wait-chip:hover {
  background: rgba(234, 88, 12, 0.45);
  transform: scale(1.05);
}

.mesa-render-card.esperando_parcial .m-wait-chip {
  background: rgba(245, 158, 11, 0.25);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.4);
}

.mesa-render-card.esperando_parcial .m-wait-chip:hover {
  background: rgba(245, 158, 11, 0.45);
}

/* 3. COMPONENTE TOOLTIP DE ESPERA */
.mesa-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.78rem;
  color: #f8fafc;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.7);
  z-index: 999;
  pointer-events: none;
  min-width: 190px;
  max-width: 280px;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
  text-align: left;
}

/* Flecha inferior del tooltip */
.mesa-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 6px;
  border-style: solid;
  border-color: #0f172a transparent transparent transparent;
}

/* Posición inferior si la mesa está muy arriba en el lienzo */
.mesa-tooltip.pos-bottom {
  bottom: auto;
  top: calc(100% + 10px);
  transform: translateX(-50%) translateY(-4px);
}

.mesa-tooltip.pos-bottom::after {
  top: auto;
  bottom: 100%;
  border-color: transparent transparent #0f172a transparent;
}

/* Header del tooltip */
.mesa-tooltip .tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #1e293b;
}

.mesa-tooltip .tooltip-timer {
  font-weight: 800;
  color: #fb923c;
  font-size: 0.8rem;
}

.mesa-tooltip .tooltip-badge {
  font-size: 0.62rem;
  font-weight: 800;
  padding: 2px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.mesa-tooltip .tooltip-badge.esperando {
  background: #7c2d12;
  color: #fdba74;
}

.mesa-tooltip .tooltip-badge.esperando_parcial {
  background: #78350f;
  color: #fde047;
}

.mesa-tooltip .tooltip-title {
  font-size: 0.68rem;
  font-weight: 700;
  color: #94a3b8;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mesa-tooltip .tooltip-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mesa-tooltip .tooltip-list li {
  font-size: 0.74rem;
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mesa-tooltip .tooltip-list li .dot-icon {
  font-size: 0.75rem;
}

.mesa-tooltip .tooltip-empty {
  font-size: 0.72rem;
  color: #64748b;
  font-style: italic;
}

/* Activación por hover y por toque en móvil */
.mesa-render-card:hover .mesa-tooltip,
.mesa-tooltip.show-touch {
  opacity: 1 !important;
  visibility: visible !important;
  pointer-events: auto !important;
  transform: translateX(-50%) translateY(0) !important;
}

/* 4. LEYENDA DEL SALÓN */
.legend-badge.activa .dot { background: #2563eb !important; }
.legend-badge.esperando_parcial .dot { background: #f59e0b !important; }
```

### 3.4 HTML Legend in `public/index.html`
Update `.legend-group` in `public/index.html`:
```html
<div class="legend-group">
  <span class="legend-badge libre"><span class="dot"></span> Libre</span>
  <span class="legend-badge ocupada"><span class="dot"></span> Ocupada</span>
  <span class="legend-badge esperando"><span class="dot"></span> Esperando Comida</span>
  <span class="legend-badge esperando_parcial"><span class="dot"></span> Esperando Parcial</span>
  <span class="legend-badge activa"><span class="dot"></span> Activa</span>
  <span class="legend-badge cuenta"><span class="dot"></span> Cuenta Pedida</span>
</div>
```

### 3.5 Real-Time Synchronization & Timer
In `public/app.js`:
1. Register `socket.on('comanda_estado_cambiado')`:
   ```javascript
   socket.on('comanda_estado_cambiado', () => {
     cargarKDSDesdeBackend();
     cargarMesasDesdeBackend();
   });
   ```
2. In `window.despacharKDSBackend(detalleId)`:
   Call `cargarMesasDesdeBackend()` in addition to `cargarKDSDesdeBackend()`.
3. Background 30-second ticker to increment minutes live without page reloads:
   ```javascript
   setInterval(() => {
     const salonView = document.getElementById('view-salon');
     if (salonView && salonView.classList.contains('active')) {
       const hayMesasEsperando = estado.mesas && estado.mesas.some(m => m.estado === 'esperando' || m.estado === 'esperando_parcial');
       if (hayMesasEsperando) {
         renderSalón();
       }
     }
   }, 30000);
   ```
4. Click outside listener to dismiss touch tooltips:
   ```javascript
   document.addEventListener('click', (e) => {
     if (!e.target.closest('.mesa-render-card')) {
       document.querySelectorAll('.mesa-tooltip.show-touch').forEach(el => el.classList.remove('show-touch'));
     }
   });
   ```

---

## 4. Interaction Matrix & Verification Mapping

| Event / Action | Table Before | Items Status | Table After | Badge Text | Card Color | Tooltip Content |
|---|---|---|---|---|---|---|
| Comanda sent with 2 kitchen dishes | `abierta` | 2 pendiente | `esperando` | Esperando | Orange (#f97316) | "Esperando hace 0 min", 2 items |
| Time passes (12 min) | `esperando` | 2 pendiente | `esperando` | Esperando | Orange (#f97316) | "Esperando hace 12 min", 2 items |
| KDS marks 1 dish "listo" | `esperando` | 1 listo, 1 pendiente | `esperando_parcial` | Esperando Parcial | Amber (#f59e0b) | "Esperando hace 12 min", ONLY 1 pending dish |
| Waiter adds drinks | `esperando_parcial` | 1 listo, 1 pend, 2 barra | `esperando_parcial` | Esperando Parcial | Amber (#f59e0b) | "Esperando hace 12 min", ONLY 1 pending dish (no drinks!) |
| KDS marks last dish "listo" | `esperando_parcial` | 2 listo | `activa` | Activa | Blue (#2563eb) | None (all dishes served) |
| Customer requests bill | `activa` | 2 listo | `cuenta` | Cuenta Pedida | Pulsing Gold (#fbbf24) | None |
| Customer pays bill | `cuenta` | Closed | `libre` | Libre | Green (#10b981) | None |

---

## 5. Risk & Mitigation Plan

1. **Risk: Tooltip overflowing viewport top edge.**
   - *Mitigation*: Implemented `.pos-bottom` class when `m.y < 110px`, which renders the tooltip downwards with an upward-pointing triangle arrow.
2. **Risk: Mobile tap on wait chip accidentally opening table order dialog.**
   - *Mitigation*: `e.stopPropagation()` attached to `.m-wait-chip`, plus click-outside dismisser.
3. **Risk: Memory leaks or multiple event listeners on re-rendering.**
   - *Mitigation*: Global click handler registered once at document level, card-specific event listeners attached to fresh elements created per `renderSalón()` cycle.
4. **Risk: Regression of existing 58 E2E test cases.**
   - *Mitigation*: Implementation preserves existing function signatures and adheres strictly to domain evaluators in `test/helpers/test-server.js`.
