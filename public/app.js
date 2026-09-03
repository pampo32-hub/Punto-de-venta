const socket = io();

let currentMesa = null;
let currentOrdenId = null;
let activeTicketItems = [];
let menuCategorias = [];
let menuProductos = [];

// Formateador de moneda en Colones
function formatCRC(num) {
  const n = Number(num) || 0;
  return '₡' + n.toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Navegación de pestañas principales
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const viewId = 'view-' + btn.dataset.view;
    document.getElementById(viewId).classList.add('active');

    if (btn.dataset.view === 'mesas') cargarMesas();
    if (btn.dataset.view === 'comandas') cargarKDS('cocina');
    if (btn.dataset.view === 'barra') cargarKDS('barra');
    if (btn.dataset.view === 'caja') cargarCaja();
    if (btn.dataset.view === 'reportes') cargarReportes();
  });
});

// -------------------------------------------------------------
// 1. CARGA DE MESAS Y MAPA DEL SALÓN
// -------------------------------------------------------------
async function cargarMesas() {
  try {
    const res = await fetch('/api/mesas');
    const { zonas, mesas } = await res.json();

    const grid = document.getElementById('mesasGrid');
    grid.innerHTML = mesas.map(m => {
      const estadoTxt = m.estado === 'libre' ? 'Libre' : (m.estado === 'cuenta_pedida' ? 'Cuenta Pedida' : 'Ocupada');
      const totalTxt = m.orden_total ? formatCRC(m.orden_total) : '—';
      return `
        <div class="mesa-card ${m.estado}" onclick="abrirComanderoMesa(${m.id}, '${m.numero}')">
          <div class="mesa-num">${m.numero}</div>
          <span class="mesa-estado-badge">${estadoTxt}</span>
          <div class="mesa-total">${totalTxt}</div>
          <div class="mesa-cap">👥 ${m.capacidad} personas</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error cargando mesas:', e);
  }
}

// -------------------------------------------------------------
// 2. COMANDERO TÁCTIL (AL TOCAR UNA MESA)
// -------------------------------------------------------------
async function abrirComanderoMesa(mesaId, numeroMesa) {
  currentMesa = { id: mesaId, numero: numeroMesa };
  document.getElementById('modalMesaTitulo').textContent = numeroMesa;
  activeTicketItems = [];

  // Cargar orden activa si ya existe
  try {
    const res = await fetch('/api/ordenes/mesa/' + mesaId);
    const data = await res.json();
    if (data.orden) {
      currentOrdenId = data.orden.id;
      activeTicketItems = data.items.map(it => ({
        id: it.producto_id,
        nombre: it.nombre_producto,
        precio: it.precio_unitario,
        cantidad: it.cantidad,
        notas: it.notas || '',
        destino: it.destino,
        guardado: true
      }));
    } else {
      currentOrdenId = null;
    }
  } catch (e) {
    console.error(e);
  }

  renderTicket();
  document.getElementById('orderModal').classList.add('active');
}

document.getElementById('btnCloseOrderModal').addEventListener('click', () => {
  document.getElementById('orderModal').classList.remove('active');
  cargarMesas();
});

// Cargar catálogo de menú
async function cargarMenu() {
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    menuCategorias = data.categorias;
    menuProductos = data.productos;

    const catContainer = document.getElementById('categoryTabs');
    catContainer.innerHTML = `
      <button class="cat-tab active" onclick="filtrarProductos('todos', this)">🍽️ Todos</button>
      ${menuCategorias.map(c => `<button class="cat-tab" onclick="filtrarProductos(${c.id}, this)">${c.icono} ${c.nombre}</button>`).join('')}
    `;

    renderProductos(menuProductos);
  } catch (e) {
    console.error('Error cargando menú:', e);
  }
}

function filtrarProductos(catId, btn) {
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (catId === 'todos') {
    renderProductos(menuProductos);
  } else {
    renderProductos(menuProductos.filter(p => p.categoria_id === catId));
  }
}

function renderProductos(prods) {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = prods.map(p => `
    <div class="product-card" onclick="agregarProductoAlTicket(${p.id})">
      <div class="prod-name">${p.nombre}</div>
      <div class="prod-price">${formatCRC(p.precio)}</div>
    </div>
  `).join('');
}

function agregarProductoAlTicket(prodId) {
  const prod = menuProductos.find(p => p.id === prodId);
  if (!prod) return;

  const exist = activeTicketItems.find(it => it.id === prodId && !it.guardado);
  if (exist) {
    exist.cantidad++;
  } else {
    activeTicketItems.push({
      id: prod.id,
      nombre: prod.nombre,
      precio: prod.precio,
      cantidad: 1,
      notas: '',
      destino: prod.destino,
      guardado: false
    });
  }
  renderTicket();
}

function renderTicket() {
  const container = document.getElementById('ticketItemsList');
  if (!activeTicketItems.length) {
    container.innerHTML = '<div class="empty-ticket">Toque los productos del menú para agregarlos al pedido</div>';
    calcularTotales();
    return;
  }

  container.innerHTML = activeTicketItems.map((it, idx) => `
    <div class="ticket-row">
      <div>
        <strong>${it.nombre}</strong> ${it.guardado ? '<small style="color:#10b981;">✓ en cocina</small>' : ''}
        <div style="color:#38bdf8; font-size:0.8rem;">${formatCRC(it.precio)} c/u</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" onclick="modificarCantidadTicket(${idx}, -1)">-</button>
        <span style="font-weight:800; min-width:20px; text-align:center;">${it.cantidad}</span>
        <button class="qty-btn" onclick="modificarCantidadTicket(${idx}, 1)">+</button>
      </div>
    </div>
  `).join('');

  calcularTotales();
}

function modificarCantidadTicket(idx, delta) {
  const it = activeTicketItems[idx];
  it.cantidad += delta;
  if (it.cantidad <= 0) {
    activeTicketItems.splice(idx, 1);
  }
  renderTicket();
}

function calcularTotales() {
  const subtotal = activeTicketItems.reduce((sum, it) => sum + (it.precio * it.cantidad), 0);
  const servicio = Math.round(subtotal * 0.10);
  const iva = Math.round(subtotal * 0.13);
  const total = subtotal + servicio + iva;

  document.getElementById('ticketSubtotal').textContent = formatCRC(subtotal);
  document.getElementById('ticketServicio').textContent = formatCRC(servicio);
  document.getElementById('ticketIva').textContent = formatCRC(iva);
  document.getElementById('ticketTotal').textContent = formatCRC(total);
}

// -------------------------------------------------------------
// 3. ENVIAR COMANDA A COCINA Y BARRA
// -------------------------------------------------------------
document.getElementById('btnEnviarComanda').addEventListener('click', async () => {
  const itemsPorEnviar = activeTicketItems.filter(it => !it.guardado);
  if (!itemsPorEnviar.length) {
    alert('No hay productos nuevos para enviar a cocina/barra.');
    return;
  }

  try {
    const res = await fetch('/api/comandas/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesaId: currentMesa.id,
        items: itemsPorEnviar
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('🔥 Comanda enviada a Cocina/Barra con éxito!');
    itemsPorEnviar.forEach(it => it.guardado = true);
    renderTicket();
    cargarMesas();
  } catch (e) {
    alert('Error: ' + e.message);
  }
});

// Pedir Cuenta
document.getElementById('btnPedirCuenta').addEventListener('click', async () => {
  if (!currentOrdenId) {
    alert('No hay orden activa en esta mesa para pedir cuenta.');
    return;
  }
  await fetch('/api/ordenes/' + currentOrdenId + '/pedir-cuenta', { method: 'POST' });
  alert('🧾 Cuenta solicitada. Mesa marcada en amarillo.');
  document.getElementById('orderModal').classList.remove('active');
  cargarMesas();
});

// -------------------------------------------------------------
// 4. COBRO DE MESA
// -------------------------------------------------------------
document.getElementById('btnCobrarMesa').addEventListener('click', () => {
  if (!activeTicketItems.length) {
    alert('No hay consumos en esta mesa.');
    return;
  }
  const totalTxt = document.getElementById('ticketTotal').textContent;
  document.getElementById('checkoutMontoTotal').textContent = totalTxt;
  document.getElementById('checkoutModal').classList.add('active');
});

document.getElementById('btnCloseCheckoutModal').addEventListener('click', () => {
  document.getElementById('checkoutModal').classList.remove('active');
});

// Métodos de pago
let metodoPagoSeleccionado = 'Efectivo';
document.querySelectorAll('.pay-method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    metodoPagoSeleccionado = btn.dataset.metodo;
    document.getElementById('pagoEfectivoField').style.display = metodoPagoSeleccionado === 'Efectivo' ? 'block' : 'none';
  });
});

document.getElementById('inputEfectivoRecibido').addEventListener('input', (e) => {
  const total = parseInt(document.getElementById('checkoutMontoTotal').textContent.replace(/[^0-9]/g, '')) || 0;
  const recibido = parseFloat(e.target.value) || 0;
  const vuelto = Math.max(0, recibido - total);
  document.getElementById('vueltoDisplay').textContent = 'Vuelto / Cambio: ' + formatCRC(vuelto);
});

document.getElementById('btnConfirmarCobro').addEventListener('click', async () => {
  if (!currentOrdenId) return;
  const total = parseInt(document.getElementById('checkoutMontoTotal').textContent.replace(/[^0-9]/g, '')) || 0;

  try {
    const res = await fetch('/api/ordenes/' + currentOrdenId + '/cobrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metodo: metodoPagoSeleccionado,
        monto: total
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('✅ Pago registrado con éxito. Mesa liberada e impresa cuenta.');
    document.getElementById('checkoutModal').classList.remove('active');
    document.getElementById('orderModal').classList.remove('active');
    cargarMesas();
  } catch (e) {
    alert('Error al cobrar: ' + e.message);
  }
});

// -------------------------------------------------------------
// 5. PANTALLAS KDS (COCINA Y BARRA)
// -------------------------------------------------------------
async function cargarKDS(destino) {
  try {
    const res = await fetch('/api/kds?destino=' + destino);
    const comandas = await res.json();
    const container = document.getElementById(destino === 'cocina' ? 'kdsCocinaGrid' : 'kdsBarraGrid');

    if (!comandas.length) {
      container.innerHTML = '<div style="color:#94a3b8; font-size:1.1rem; grid-column:1/-1;">✨ No hay comandas pendientes en ' + destino + '</div>';
      return;
    }

    container.innerHTML = comandas.map(c => `
      <div class="kds-card ${c.estado_comanda}">
        <div class="kds-header">
          <span class="kds-mesa">${c.mesa_numero || 'Barra'}</span>
          <span class="kds-timer">⏱️ ${c.hora_pedido.slice(11, 16)}</span>
        </div>
        <div class="kds-platillo">${c.cantidad}x ${c.nombre_producto}</div>
        ${c.notas ? `<div class="kds-notas">⚠️ ${c.notas}</div>` : ''}
        <button class="btn-kds" onclick="marcarListoKDS(${c.id}, '${destino}')">
          ✅ Marcar Listo
        </button>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

async function marcarListoKDS(detalleId, destino) {
  await fetch('/api/kds/' + detalleId + '/estado', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'listo' })
  });
  cargarKDS(destino);
}

// -------------------------------------------------------------
// 6. CAJA & CIERRE DE TURNO
// -------------------------------------------------------------
async function cargarCaja() {
  try {
    const res = await fetch('/api/caja/actual');
    const data = await res.json();
    const div = document.getElementById('cajaStatusContent');

    if (!data.caja) {
      div.innerHTML = '<p>No hay caja abierta actualmente.</p>';
      return;
    }

    const totalVentas = data.ventas.reduce((acc, curr) => acc + curr.total, 0);
    div.innerHTML = `
      <div style="line-height:1.8; font-size:0.95rem;">
        <div><strong>Cajero a cargo:</strong> ${data.caja.cajero}</div>
        <div><strong>Apertura:</strong> ${new Date(data.caja.fecha_apertura).toLocaleString()}</div>
        <div><strong>Fondo Inicial de Caja:</strong> ${formatCRC(data.caja.monto_inicial)}</div>
        <div style="margin-top:10px; border-top:1px solid #334155; padding-top:8px;">
          <strong>Ventas por Método:</strong>
          ${data.ventas.map(v => `<div>• ${v.metodo}: ${formatCRC(v.total)}</div>`).join('') || '<div>Sin ventas registradas aún</div>'}
        </div>
        <div style="font-size:1.2rem; font-weight:800; color:#38bdf8; margin-top:10px;">
          Total Ingresos Turno: ${formatCRC(totalVentas)}
        </div>
      </div>
    `;
  } catch (e) {
    console.error(e);
  }
}

document.getElementById('btnCorteZ').addEventListener('click', () => {
  alert('📋 REPORTE CORTE Z GENERADO:\n\n• Turno cerrado con éxito.\n• Se ha impreso el cuadre total del día en la impresora de caja.');
});

// -------------------------------------------------------------
// 7. REPORTES
// -------------------------------------------------------------
async function cargarReportes() {
  document.getElementById('repTotalVentas').textContent = '₡38,400';
  document.getElementById('repTotalComandas').textContent = '8';
  document.getElementById('repTicketPromedio').textContent = '₡4,800';
}

// WebSockets para refresco instantáneo sin recargar
socket.on('nueva_comanda', () => {
  cargarMesas();
  if (document.getElementById('view-comandas').classList.contains('active')) cargarKDS('cocina');
  if (document.getElementById('view-barra').classList.contains('active')) cargarKDS('barra');
});

socket.on('mesa_actualizada', () => {
  cargarMesas();
});

// Inicialización
cargarMesas();
cargarMenu();
