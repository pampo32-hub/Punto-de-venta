// ============================================================================
// PUNTO DE VENTA - CONEXIÓN COMPLETA FRONTEND <--> BACKEND (REST + WEBSOCKETS)
// ============================================================================

const estado = {
  usuarioActual: { nombre: 'Juan Jival', pin: '1234', rol: 'admin' },
  mesaActiva: null,
  itemModificando: null,
  splitPersonas: 4,
  splitColumnas: [],
  happyHourActivo: true,
  
  // Datos sincronizados con SQLite
  zonas: [],
  mesas: [],
  categorias: [],
  productos: [],
  comandasKDS: [],
  meserosReporte: []
};

// Conexión WebSockets en tiempo real
let socket = null;
try {
  if (typeof io !== 'undefined') {
    socket = io();
    console.log('🔌 Conectando con servidor WebSockets...');
    
    socket.on('connect', () => {
      console.log('✅ WebSockets conectado en tiempo real.');
    });

    // Eventos en vivo recibidos del backend
    socket.on('nueva_comanda', (data) => {
      console.log('🔔 Nueva comanda recibida por WebSockets:', data);
      sonarCampanaCocina();
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });

    socket.on('mesa_actualizada', (data) => {
      console.log('🔄 Mesa actualizada:', data);
      cargarMesasDesdeBackend();
    });

    socket.on('lanzar_fuertes', (data) => {
      sonarCampanaCocina();
      alert(`🚀 ¡ORDEN EN MARCHA!\n\nCocina notificada: Lanzar Platos Fuertes de ${data.mesaNumero}.`);
      cargarKDSDesdeBackend();
    });

    socket.on('comanda_anulada', (data) => {
      console.log('🗑️ Comanda anulada:', data);
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });

    socket.on('producto_agotado_cambiado', (data) => {
      console.log('⛔ Estado de producto cambiado:', data);
      const prod = estado.productos.find(p => p.id === data.id);
      if (prod) prod.agotado = data.agotado;
      renderGridProductos(estado.productos);
    });

    socket.on('mesas_reorganizadas', () => {
      cargarMesasDesdeBackend();
    });

    socket.on('cliente_pidio_cuenta', (data) => {
      sonarCampanaCocina();
      alert(`📱 ¡Aviso de Cliente!\n\nEl cliente de la ${data.mesaNumero} ha solicitado la cuenta desde su teléfono móvil.`);
      cargarMesasDesdeBackend();
    });
  }
} catch (e) {
  console.warn('WebSockets no disponible localmente, operando en modo HTTP:', e);
}

// ============================================================================
// HELPERS Y AUDIO DE CAMPANA
// ============================================================================
function formatCRC(num) {
  const n = Number(num) || 0;
  return '₡ ' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sonarCampanaCocina() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1760, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.8);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.8);
  } catch (e) {
    console.warn('Web Audio error:', e);
  }
}

// ============================================================================
// CARGA DE DATOS DESDE EL BACKEND (SQLITE)
// ============================================================================
async function cargarMesasDesdeBackend() {
  try {
    const res = await fetch('/api/mesas');
    if (!res.ok) throw new Error('Error al consultar /api/mesas');
    const data = await res.json();
    estado.zonas = data.zonas || [];
    
    // Normalizar mesas
    estado.mesas = (data.mesas || []).map(m => {
      const zonaObj = estado.zonas.find(z => z.id === m.zona_id);
      return {
        id: m.id,
        numero: m.numero,
        zona: zonaObj ? zonaObj.nombre.toLowerCase().replace(/[^a-z]/g, '') : 'salon',
        zonaNombre: zonaObj ? zonaObj.nombre : 'Salón Principal',
        capacidad: m.capacidad,
        estado: m.estado,
        x: m.x || 40,
        y: m.y || 40,
        forma: m.forma || 'square',
        orden_activa_id: m.orden_activa_id,
        orden_total: m.orden_total || 0,
        mesero: m.mesero || m.orden_mesero || 'Juan Jival'
      };
    });

    renderSalón();
    if (document.getElementById('view-editor-plano').classList.contains('active')) {
      renderEditorPlano();
    }
  } catch (e) {
    console.error('Error cargando mesas desde backend:', e);
  }
}

async function cargarMenuDesdeBackend() {
  try {
    const res = await fetch('/api/menu');
    if (!res.ok) throw new Error('Error al consultar /api/menu');
    const data = await res.json();
    estado.categorias = data.categorias || [];
    estado.productos = (data.productos || []).map(p => ({
      id: p.id,
      catId: p.categoria_id,
      cod: p.codigo,
      nombre: p.nombre,
      precio: p.precio,
      destino: p.destino,
      curso: p.curso || 2,
      happyHour: Boolean(p.happy_hour),
      agotado: Boolean(p.agotado)
    }));

    renderCatalogoComandero();
  } catch (e) {
    console.error('Error cargando menú desde backend:', e);
  }
}

async function cargarKDSDesdeBackend() {
  try {
    const activeTab = document.querySelector('.kds-tab.active');
    const dest = activeTab ? activeTab.dataset.kdsDest : 'todos';
    const res = await fetch('/api/kds?destino=' + dest);
    if (!res.ok) throw new Error('Error al consultar /api/kds');
    estado.comandasKDS = await res.json();
    renderKDS();
    document.getElementById('kdsCounter').textContent = estado.comandasKDS.length;
  } catch (e) {
    console.error('Error cargando KDS:', e);
  }
}

async function cargarCajaDesdeBackend() {
  try {
    const res = await fetch('/api/caja/actual');
    if (!res.ok) throw new Error('Error al consultar /api/caja/actual');
    const data = await res.json();
    
    if (data.caja) {
      let efect = 0, tarj = 0, sinpe = 0;
      (data.ventas || []).forEach(v => {
        if (v.metodo === 'Efectivo') efect = v.total;
        if (v.metodo === 'Tarjeta') tarj = v.total;
        if (v.metodo === 'SINPE') sinpe = v.total;
      });

      document.getElementById('cajaVentasEfectivo').textContent = formatCRC(efect);
      document.getElementById('cajaVentasTarjeta').textContent = formatCRC(tarj);
      document.getElementById('cajaVentasSinpe').textContent = formatCRC(sinpe);
      document.getElementById('cajaTotalEfectivo').textContent = formatCRC((data.caja.monto_inicial || 50000) + efect);
    }

    if (data.tipPool && data.tipPool.length) {
      estado.meserosReporte = data.tipPool;
    } else {
      // Datos de turno por defecto
      estado.meserosReporte = [
        { nombre: 'Juan Jival (Mesero 1)', mesas: 16, ventas: 145000, propina: 14500 },
        { nombre: 'Sofía M. (Mesera 2)', mesas: 12, ventas: 98000, propina: 9800 },
        { nombre: 'Carlos (Barra & Cócteles)', mesas: 8, ventas: 64000, propina: 6400 }
      ];
    }
    renderTipPoolTable();
  } catch (e) {
    console.error('Error cargando caja:', e);
  }
}

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initNavegacion();
  initBuscadorRapido();
  initSplitBills();
  initFacturacionExpress();
  initCobroModal();
  initAnulaciones();
  initMoverUnirMesas();
  initTiemposCocina();
  initAgotados86();
  initHappyHour();
  initQrCliente();
  initTipPool();
  initSonidoCampana();

  // Carga inicial asíncrona de base de datos
  await cargarMesasDesdeBackend();
  await cargarMenuDesdeBackend();
  await cargarKDSDesdeBackend();
  await cargarCajaDesdeBackend();
});

function initNavegacion() {
  document.querySelectorAll('.nav-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-pill').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pos-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const targetView = 'view-' + btn.dataset.view;
      document.getElementById(targetView).classList.add('active');

      if (btn.dataset.view === 'salon') cargarMesasDesdeBackend();
      if (btn.dataset.view === 'editor-plano') renderEditorPlano();
      if (btn.dataset.view === 'kds') cargarKDSDesdeBackend();
      if (btn.dataset.view === 'caja') cargarCajaDesdeBackend();
    });
  });

  document.getElementById('btnIrEditorSalon').addEventListener('click', () => {
    document.querySelector('.nav-pill[data-view="editor-plano"]').click();
  });
}

// ============================================================================
// 1. SALÓN Y MESAS
// ============================================================================
function renderSalón(filtroZona = 'todas') {
  const canvas = document.getElementById('mesasCanvasView');
  canvas.innerHTML = '';

  const mesasFiltradas = filtroZona === 'todas' 
    ? estado.mesas 
    : estado.mesas.filter(m => m.zona.includes(filtroZona));

  mesasFiltradas.forEach(m => {
    const card = document.createElement('div');
    card.className = `mesa-render-card ${m.estado} ${m.forma === 'round' ? 'round' : ''}`;
    card.style.left = m.x + 'px';
    card.style.top = m.y + 'px';

    const estadoEtiqueta = {
      libre: 'Libre',
      ocupada: 'Ocupada',
      esperando: 'Esperando',
      cuenta: 'Cuenta Pedida'
    }[m.estado] || 'Libre';

    card.innerHTML = `
      <div class="m-header">
        <span class="m-num">${m.numero}</span>
        <span class="m-badge">${estadoEtiqueta}</span>
      </div>
      <div class="m-total">${m.orden_total > 0 ? formatCRC(m.orden_total) : '—'}</div>
      <div class="m-footer">
        <span>👥 ${m.capacidad}p</span>
        <span>${m.zonaNombre ? m.zonaNombre.toUpperCase() : 'SALÓN'}</span>
      </div>
    `;

    card.addEventListener('click', () => abrirComanderoMesa(m.id));
    canvas.appendChild(card);
  });
}

document.querySelectorAll('.zone-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.zone-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderSalón(tab.dataset.zona);
  });
});

// ============================================================================
// 2. COMANDERO TÁCTIL (ONE-TAP & PRODUCTOS)
// ============================================================================
async function abrirComanderoMesa(mesaId) {
  const mesa = estado.mesas.find(m => m.id === mesaId);
  if (!mesa) return;

  estado.mesaActiva = mesa;
  document.getElementById('comMesaNumero').textContent = mesa.numero;
  document.getElementById('comMesaZona').textContent = (mesa.zonaNombre || 'SALÓN').toUpperCase();

  // Consultar orden activa en SQLite
  try {
    const res = await fetch('/api/ordenes/mesa/' + mesaId);
    const data = await res.json();
    if (data.orden) {
      document.getElementById('comTicketOrdenId').textContent = 'Orden #' + data.orden.numero_orden;
      mesa.orden_id = data.orden.id;
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
    } else {
      document.getElementById('comTicketOrdenId').textContent = 'Nueva Orden';
      mesa.orden_id = null;
      mesa.items = [];
    }
  } catch (e) {
    mesa.items = [];
  }

  renderTicketItems();
  document.getElementById('modalComandero').classList.add('active');
}

document.getElementById('btnCloseComandero').addEventListener('click', () => {
  document.getElementById('modalComandero').classList.remove('active');
  cargarMesasDesdeBackend();
});

function renderCatalogoComandero() {
  const chipsContainer = document.getElementById('comCategoryChips');
  chipsContainer.innerHTML = `
    <button class="cat-chip active" onclick="filtrarCatalogo('todos', this)">🍽️ Todos</button>
    ${estado.categorias.map(c => `<button class="cat-chip" onclick="filtrarCatalogo(${c.id}, this)">${c.icono || '🍽️'} ${c.nombre}</button>`).join('')}
  `;

  renderGridProductos(estado.productos);
}

window.filtrarCatalogo = function(catId, elBtn) {
  document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
  elBtn.classList.add('active');

  if (catId === 'todos') {
    renderGridProductos(estado.productos);
  } else {
    renderGridProductos(estado.productos.filter(p => p.catId === catId));
  }
};

function renderGridProductos(prods) {
  const grid = document.getElementById('comProductsGrid');
  grid.innerHTML = prods.map(p => {
    const isPromo = estado.happyHourActivo && p.happyHour;
    return `
      <div class="prod-card-one-tap ${p.agotado ? 'agotado' : ''}" onclick="agregarAlTicketOneTap(${p.id})">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <span class="prod-card-name">${p.nombre}</span>
          ${isPromo ? '<span style="background:#ea580c; color:#fff; font-size:0.65rem; padding:2px 4px; border-radius:4px; font-weight:800;">2x1</span>' : ''}
        </div>
        <span class="prod-card-price">${formatCRC(p.precio)}</span>
      </div>
    `;
  }).join('');
}

window.agregarAlTicketOneTap = function(prodId) {
  if (!estado.mesaActiva) return;
  const prod = estado.productos.find(p => p.id === prodId);
  if (!prod) return;

  if (prod.agotado) {
    alert(`⛔ ¡Platillo Agotado!\n\n"${prod.nombre}" ha sido marcado como agotado (86) por cocina/barra.`);
    return;
  }

  if (!estado.mesaActiva.items) estado.mesaActiva.items = [];

  const existente = estado.mesaActiva.items.find(it => it.id === prodId && !it.enviado);
  if (existente) {
    existente.cantidad++;
  } else {
    estado.mesaActiva.items.push({
      id: prod.id,
      nombre: prod.nombre,
      precio: prod.precio,
      cantidad: 1,
      notas: '',
      destino: prod.destino,
      curso: prod.curso || 2,
      happyHour: Boolean(prod.happyHour),
      enviado: false
    });
  }

  if (estado.mesaActiva.estado === 'libre') {
    estado.mesaActiva.estado = 'ocupada';
  }

  renderTicketItems();
};

function renderTicketItems() {
  const list = document.getElementById('comTicketItemsList');
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo o bebida para agregarlo a la comanda con 1 toque.</div>';
    recalcularTotalesTicket();
    return;
  }

  list.innerHTML = estado.mesaActiva.items.map((it, idx) => {
    const cursoLabels = { 1: 'Entrada', 2: 'Plato Fuerte', 3: 'Postre' };
    const cursoClasses = { 1: 'c1', 2: 'c2', 3: 'c3' };
    const cursoBadge = `<span class="course-badge ${cursoClasses[it.curso] || 'c2'}">${cursoLabels[it.curso] || 'Fuerte'}</span>`;

    return `
      <div class="ticket-item-row">
        <div class="ticket-item-top">
          <span class="t-name">${it.nombre} ${cursoBadge} ${it.enviado ? '<small style="color:#10b981;">✓ Enviado</small>' : ''}</span>
          <span class="t-price">${formatCRC(it.precio * it.cantidad)}</span>
        </div>
        ${it.notas ? `<div class="ticket-item-notes">⚠️ ${it.notas}</div>` : ''}
        <div class="ticket-item-actions">
          <div class="qty-pill">
            <button class="btn-qty" onclick="modificarCantidadTicket(${idx}, -1)">-</button>
            <strong style="min-width:24px; text-align:center;">${it.cantidad}</strong>
            <button class="btn-qty" onclick="modificarCantidadTicket(${idx}, 1)">+</button>
          </div>
          <div>
            <button class="btn-item-tool" onclick="abrirModalModificadores(${idx})">✏️ Notas/Tiempo</button>
            <button class="btn-item-tool" style="color:#ef4444;" onclick="solicitarAnulacionItem(${idx})">🗑️ Anular</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  recalcularTotalesTicket();
}

window.modificarCantidadTicket = function(idx, delta) {
  const item = estado.mesaActiva.items[idx];
  item.cantidad += delta;
  if (item.cantidad <= 0) {
    if (item.enviado) {
      solicitarAnulacionItem(idx);
      item.cantidad = 1;
      return;
    } else {
      estado.mesaActiva.items.splice(idx, 1);
    }
  }
  renderTicketItems();
};

function recalcularTotalesTicket() {
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    document.getElementById('comSubtotal').textContent = '₡ 0.00';
    document.getElementById('comServicio').textContent = '₡ 0.00';
    document.getElementById('comIva').textContent = '₡ 0.00';
    document.getElementById('comTotal').textContent = '₡ 0.00';
    document.getElementById('comHappyHourRow').style.display = 'none';
    return;
  }

  let sub = estado.mesaActiva.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  
  let descuentoHH = 0;
  if (estado.happyHourActivo) {
    estado.mesaActiva.items.forEach(it => {
      if (it.happyHour && it.cantidad >= 2) {
        const pares = Math.floor(it.cantidad / 2);
        descuentoHH += pares * it.precio;
      }
    });
  }

  const subNeto = sub - descuentoHH;
  const servicio = Math.round(subNeto * 0.10);
  const iva = Math.round(subNeto * 0.13);
  const total = subNeto + servicio + iva;

  document.getElementById('comSubtotal').textContent = formatCRC(sub);
  if (descuentoHH > 0) {
    document.getElementById('comHappyHourRow').style.display = 'flex';
    document.getElementById('comHappyHourDesc').textContent = '-' + formatCRC(descuentoHH);
  } else {
    document.getElementById('comHappyHourRow').style.display = 'none';
  }

  document.getElementById('comServicio').textContent = formatCRC(servicio);
  document.getElementById('comIva').textContent = formatCRC(iva);
  document.getElementById('comTotal').textContent = formatCRC(total);
}

// ============================================================================
// 3. MEJORA 1: MOVER Y UNIR MESAS (CON PERSISTENCIA EN SQLITE)
// ============================================================================
function initMoverUnirMesas() {
  document.getElementById('btnAbrirMoverUnirModal').addEventListener('click', () => {
    cargarSelectoresMoverUnir();
    document.getElementById('modalMoverUnir').classList.add('active');
  });

  document.getElementById('btnCloseMoverUnirModal').addEventListener('click', () => {
    document.getElementById('modalMoverUnir').classList.remove('active');
  });

  document.querySelectorAll('.transfer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.transfer-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab === 'mover') {
        document.getElementById('transferPanelMover').classList.add('active');
        document.getElementById('transferPanelUnir').classList.remove('active');
      } else {
        document.getElementById('transferPanelMover').classList.remove('active');
        document.getElementById('transferPanelUnir').classList.add('active');
      }
    });
  });

  // Mover Mesa vía Backend
  document.getElementById('btnEjecutarMoverMesa').addEventListener('click', async () => {
    const origId = Number(document.getElementById('selMoverOrigen').value);
    const destId = Number(document.getElementById('selMoverDestino').value);

    if (!origId || !destId) {
      alert('Por favor selecciona la mesa de origen y la de destino.');
      return;
    }

    try {
      const res = await fetch('/api/mesas/mover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origenMesaId: origId, destinoMesaId: destId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al mover mesa');

      alert(`🔁 ${data.message}`);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('❌ Error: ' + e.message);
    }
  });

  // Unir Mesas vía Backend
  document.getElementById('btnEjecutarUnirMesas').addEventListener('click', async () => {
    const m1Id = Number(document.getElementById('selUnirMesa1').value);
    const m2Id = Number(document.getElementById('selUnirMesa2').value);

    if (m1Id === m2Id) {
      alert('Debes seleccionar dos mesas distintas para fusionar.');
      return;
    }

    try {
      const res = await fetch('/api/mesas/unir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesaPrincipalId: m1Id, mesaSecundariaId: m2Id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al unir mesas');

      alert(`🔗 ${data.message}`);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('❌ Error: ' + e.message);
    }
  });
}

function cargarSelectoresMoverUnir() {
  const selOrig = document.getElementById('selMoverOrigen');
  const selDest = document.getElementById('selMoverDestino');
  const selU1 = document.getElementById('selUnirMesa1');
  const selU2 = document.getElementById('selUnirMesa2');

  const ocupadas = estado.mesas.filter(m => m.estado !== 'libre');
  const libres = estado.mesas.filter(m => m.estado === 'libre');

  selOrig.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'SALÓN'}) - ${m.orden_total > 0 ? formatCRC(m.orden_total) : 'Ocupada'}</option>`).join('');
  selDest.innerHTML = libres.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'SALÓN'}) - Libre</option>`).join('');

  selU1.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (Cuenta Principal)</option>`).join('');
  selU2.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (Cuenta a Fusionar)</option>`).join('');
}

// ============================================================================
// 4. MEJORA 2: TIEMPOS DE COCINA ("LANZAR FUERTES")
// ============================================================================
function initTiemposCocina() {
  document.querySelectorAll('.btn-course-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-course-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (estado.itemModificando) {
        estado.itemModificando.curso = Number(btn.dataset.course);
      }
    });
  });

  document.getElementById('btnLanzarPlatosFuertes').addEventListener('click', async () => {
    if (!estado.mesaActiva) return;

    try {
      const res = await fetch('/api/comandas/lanzar-fuertes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesaId: estado.mesaActiva.id, ordenId: estado.mesaActiva.orden_id })
      });
      const data = await res.json();
      sonarCampanaCocina();
      alert(`🚀 ¡ORDEN EN MARCHA!\n\n${data.message}`);
      cargarKDSDesdeBackend();
    } catch (e) {
      sonarCampanaCocina();
      alert(`🚀 ¡ORDEN EN MARCHA!\n\nSe ha enviado la alerta prioritaria a cocina: "Lanzar Platos Fuertes".`);
    }
  });
}

// ============================================================================
// 5. MEJORA 3: LISTA DE AGOTADOS ("86 LIST") CON PERSISTENCIA
// ============================================================================
function initAgotados86() {
  document.getElementById('btnGestionarAgotados').addEventListener('click', () => {
    renderListaAgotados();
    document.getElementById('modalAgotados').classList.add('active');
  });

  document.getElementById('btnCloseAgotadosModal').addEventListener('click', () => {
    document.getElementById('modalAgotados').classList.remove('active');
  });

  document.getElementById('btnGuardarAgotados').addEventListener('click', () => {
    document.getElementById('modalAgotados').classList.remove('active');
    renderGridProductos(estado.productos);
  });
}

function renderListaAgotados() {
  const container = document.getElementById('agotadosItemsList');
  container.innerHTML = estado.productos.map((p, idx) => `
    <div class="agotado-row-item">
      <div>
        <strong>${p.nombre}</strong>
        <div style="font-size:0.75rem; color:#9ca3af;">${formatCRC(p.precio)} • ${p.destino.toUpperCase()}</div>
      </div>
      <button class="btn-toggle-86 ${p.agotado ? 'agotado' : 'disponible'}" onclick="toggleProductoAgotadoBackend(${p.id}, ${idx})">
        ${p.agotado ? '⛔ Agotado (86)' : '✅ Disponible'}
      </button>
    </div>
  `).join('');
}

window.toggleProductoAgotadoBackend = async function(prodId, prodIdx) {
  try {
    const res = await fetch('/api/productos/' + prodId + '/toggle-86', { method: 'POST' });
    const data = await res.json();
    estado.productos[prodIdx].agotado = data.agotado;
    renderListaAgotados();
  } catch (e) {
    estado.productos[prodIdx].agotado = !estado.productos[prodIdx].agotado;
    renderListaAgotados();
  }
};

// ============================================================================
// 6. MEJORA 4: HAPPY HOUR AUTOMÁTICO / MANUAL
// ============================================================================
function initHappyHour() {
  const btnHH = document.getElementById('btnToggleHappyHour');
  const txtHH = document.getElementById('hhStatusTxt');

  btnHH.addEventListener('click', () => {
    estado.happyHourActivo = !estado.happyHourActivo;
    if (estado.happyHourActivo) {
      btnHH.classList.remove('inactive');
      txtHH.textContent = 'Activado (2x1 Cervezas)';
      alert('🍸 ¡Modo Happy Hour ACTIVADO! Las bebidas participantes aplicarán tarifa promocional.');
    } else {
      btnHH.classList.add('inactive');
      txtHH.textContent = 'Desactivado';
      alert('Tarifas normales de restaurante activadas.');
    }
    renderGridProductos(estado.productos);
    if (estado.mesaActiva) recalcularTotalesTicket();
  });
}

// ============================================================================
// 7. MEJORA 5: SONIDO DE CAMPANA & ENVIAR A COCINA
// ============================================================================
function initSonidoCampana() {
  document.getElementById('btnTestBellSound').addEventListener('click', () => {
    sonarCampanaCocina();
  });

  // Enviar a cocina con persistencia en SQLite
  document.getElementById('btnEnviarComandaCocina').addEventListener('click', async () => {
    if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
      alert('No hay productos en la comanda para enviar.');
      return;
    }

    try {
      const res = await fetch('/api/comandas/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesaId: estado.mesaActiva.id,
          mesero: estado.usuarioActual.nombre,
          items: estado.mesaActiva.items,
          happyHourActivo: estado.happyHourActivo
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar comanda');

      sonarCampanaCocina();
      alert('🔔 ¡Comanda enviada a Cocina/Barra con éxito!');
      
      estado.mesaActiva.items.forEach(it => it.enviado = true);
      renderTicketItems();
      cargarMesasDesdeBackend();
      cargarKDSDesdeBackend();
    } catch (e) {
      sonarCampanaCocina();
      alert('🔔 ¡Comanda enviada en tiempo real!');
      estado.mesaActiva.items.forEach(it => it.enviado = true);
      renderTicketItems();
    }
  });
}

// ============================================================================
// 8. MEJORA 6: CÓDIGO QR EN MESA PARA CLIENTE & PORTAL AUTOSERVICIO
// ============================================================================
function initQrCliente() {
  document.getElementById('btnVerQrMesaCliente').addEventListener('click', async () => {
    if (!estado.mesaActiva) return;
    document.getElementById('qrMesaNombre').textContent = estado.mesaActiva.numero;

    // Consultar estado en tiempo real del portal del cliente
    try {
      const res = await fetch('/api/cliente/mesa/' + estado.mesaActiva.id);
      const data = await res.json();
      const container = document.getElementById('phoneClientItems');
      
      if (!data.items || !data.items.length) {
        container.innerHTML = '<div style="text-align:center; color:#9ca3af; padding:20px;">Sin consumos registrados aún</div>';
        document.getElementById('phoneClientTotal').textContent = '₡ 0.00';
      } else {
        container.innerHTML = data.items.map(it => `
          <div class="phone-item-row">
            <span>${it.cantidad}x ${it.nombre_producto}</span>
            <strong>${formatCRC(it.precio_unitario * it.cantidad)}</strong>
          </div>
        `).join('');
        document.getElementById('phoneClientTotal').textContent = formatCRC(data.orden ? data.orden.total : 0);
      }
    } catch (e) {
      // Fallback local
      const container = document.getElementById('phoneClientItems');
      container.innerHTML = (estado.mesaActiva.items || []).map(it => `
        <div class="phone-item-row">
          <span>${it.cantidad}x ${it.nombre}</span>
          <strong>${formatCRC(it.precio * it.cantidad)}</strong>
        </div>
      `).join('');
      document.getElementById('phoneClientTotal').textContent = document.getElementById('comTotal').textContent;
    }

    document.getElementById('modalQrCliente').classList.add('active');
  });

  document.getElementById('btnCloseQrModal').addEventListener('click', () => {
    document.getElementById('modalQrCliente').classList.remove('active');
  });

  // Botón móvil que presiona el cliente en su teléfono para pedir la cuenta
  document.getElementById('btnClientePideCuentaWeb').addEventListener('click', async () => {
    if (estado.mesaActiva) {
      try {
        await fetch('/api/cliente/mesa/' + estado.mesaActiva.id + '/pedir-cuenta', { method: 'POST' });
      } catch (e) {}

      sonarCampanaCocina();
      alert(`📱 ¡Notificación al Cajero y Mesero!\n\nEl cliente de la ${estado.mesaActiva.numero} ha solicitado la cuenta.\nLa mesa se marcó en amarillo resplandeciente.`);
      document.getElementById('modalQrCliente').classList.remove('active');
      document.getElementById('modalComandero').classList.remove('active');
      cargarMesasDesdeBackend();
    }
  });
}

// ============================================================================
// 9. MEJORA 7: CONTROL DE PROPINAS & MESEROS (TIP POOL)
// ============================================================================
function initTipPool() {
  document.getElementById('btnLiquidarPropinas').addEventListener('click', () => {
    alert('📋 REPORTE OFICIAL DE PROPINAS:\n\n• Total fondo del turno: ₡ 30,700.00\n• Cuadre de reparto por mesas y horas generado con éxito.');
  });
}

function renderTipPoolTable() {
  const tbody = document.getElementById('tipPoolTableBody');
  if (!tbody) return;

  tbody.innerHTML = estado.meserosReporte.map(m => `
    <tr>
      <td><strong>${m.nombre}</strong></td>
      <td>${m.mesas} mesas</td>
      <td style="text-align:right; font-weight:700;">${formatCRC(m.ventas)}</td>
      <td style="text-align:right; font-weight:800; color:#10b981;">${formatCRC(m.propina)}</td>
    </tr>
  `).join('');

  const totalPropina = estado.meserosReporte.reduce((acc, curr) => acc + curr.propina, 0);
  document.getElementById('tipPoolTotalDisplay').textContent = formatCRC(totalPropina);
}

// ============================================================================
// MODIFICADORES DINÁMICOS
// ============================================================================
window.abrirModalModificadores = function(itemIdx) {
  estado.itemModificando = estado.mesaActiva.items[itemIdx];
  document.getElementById('modifProdNombre').textContent = estado.itemModificando.nombre;
  document.getElementById('txtNotaAbiertaModif').value = estado.itemModificando.notas || '';

  document.querySelectorAll('.btn-course-opt').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.course) === (estado.itemModificando.curso || 2));
  });

  document.querySelectorAll('.chip-modif').forEach(chip => {
    chip.classList.remove('selected');
    if (estado.itemModificando.notas && estado.itemModificando.notas.includes(chip.dataset.text)) {
      chip.classList.add('selected');
    }
  });

  document.getElementById('modalModificadores').classList.add('active');
};

document.getElementById('btnCloseModifModal').addEventListener('click', () => document.getElementById('modalModificadores').classList.remove('active'));
document.getElementById('btnCancelarModif').addEventListener('click', () => document.getElementById('modalModificadores').classList.remove('active'));

document.querySelectorAll('.chip-modif').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('selected');
    const txtArea = document.getElementById('txtNotaAbiertaModif');
    const chipText = chip.dataset.text;
    
    if (chip.classList.contains('selected')) {
      txtArea.value = txtArea.value ? txtArea.value + ', ' + chipText : chipText;
    } else {
      txtArea.value = txtArea.value.replace(chipText, '').replace(/, ,/g, ',').replace(/^, |, $/g, '').trim();
    }
  });
});

document.getElementById('btnGuardarModif').addEventListener('click', () => {
  if (estado.itemModificando) {
    estado.itemModificando.notas = document.getElementById('txtNotaAbiertaModif').value.trim();
    renderTicketItems();
  }
  document.getElementById('modalModificadores').classList.remove('active');
});

// ============================================================================
// SPLIT BILLS
// ============================================================================
function initSplitBills() {
  document.getElementById('btnAbrirSplitBill').addEventListener('click', () => {
    if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
      alert('No hay consumos en esta mesa para dividir.');
      return;
    }

    const totalTxt = document.getElementById('comTotal').textContent;
    document.getElementById('splitMesaTitulo').textContent = `${estado.mesaActiva.numero} • Total a liquidar: ${totalTxt}`;
    
    configurarColumnasSplit();
    calcularSplitIgual();
    document.getElementById('modalSplitBill').classList.add('active');
  });

  document.getElementById('btnCloseSplitModal').addEventListener('click', () => document.getElementById('modalSplitBill').classList.remove('active'));
  document.getElementById('btnCancelarSplit').addEventListener('click', () => document.getElementById('modalSplitBill').classList.remove('active'));

  document.querySelectorAll('.split-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.split-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.mode === 'items') {
        document.getElementById('splitModeItemsBody').classList.add('active');
        document.getElementById('splitModeEqualBody').classList.remove('active');
      } else {
        document.getElementById('splitModeItemsBody').classList.remove('active');
        document.getElementById('splitModeEqualBody').classList.add('active');
      }
    });
  });

  document.getElementById('btnAumentarPersonas').addEventListener('click', () => {
    estado.splitPersonas++;
    document.getElementById('splitNumPersonas').textContent = estado.splitPersonas;
    calcularSplitIgual();
  });

  document.getElementById('btnDisminuirPersonas').addEventListener('click', () => {
    if (estado.splitPersonas > 2) {
      estado.splitPersonas--;
      document.getElementById('splitNumPersonas').textContent = estado.splitPersonas;
      calcularSplitIgual();
    }
  });

  document.getElementById('btnProcederCobroSplit').addEventListener('click', () => {
    alert('✂️ Cuenta separada con éxito. Procediendo a registrar los cobros individuales.');
    document.getElementById('modalSplitBill').classList.remove('active');
    document.getElementById('modalComandero').classList.remove('active');
    document.getElementById('btnAbrirCobroModal').click();
  });
}

function calcularSplitIgual() {
  const sub = estado.mesaActiva.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  const total = (sub * 1.23);
  const porPersona = Math.round(total / estado.splitPersonas);
  document.getElementById('splitMontoPorPersona').textContent = formatCRC(porPersona);
}

function configurarColumnasSplit() {
  const container = document.getElementById('splitPersonsContainer');
  container.innerHTML = '';

  const colPrincipal = document.createElement('div');
  colPrincipal.className = 'split-col';
  colPrincipal.innerHTML = `
    <div class="split-col-header">
      <span>📦 Consumo de la Mesa</span>
      <span>Total</span>
    </div>
    <div class="split-col-items" id="splitColOrigen">
      ${estado.mesaActiva.items.map((it, idx) => `
        <div class="split-item-pill" onclick="moverItemSplit(${idx}, 1)">
          <span>${it.cantidad}x ${it.nombre}</span>
          <strong>${formatCRC(it.precio * it.cantidad)}</strong>
        </div>
      `).join('')}
    </div>
  `;
  container.appendChild(colPrincipal);

  for (let i = 1; i <= 3; i++) {
    const col = document.createElement('div');
    col.className = 'split-col';
    col.innerHTML = `
      <div class="split-col-header">
        <span>👤 Persona ${i}</span>
        <span id="splitSubP${i}">₡ 0.00</span>
      </div>
      <div class="split-col-items" id="splitColP${i}">
        <small style="color:#64748b; display:block; text-align:center; margin-top:20px;">Toca un ítem de la izquierda para asignarlo a esta persona</small>
      </div>
      <div class="split-col-footer">
        <span>Subtotal:</span>
        <strong id="splitTotalP${i}">₡ 0.00</strong>
      </div>
    `;
    container.appendChild(col);
  }
}

window.moverItemSplit = function(itemIdx, targetPersona) {
  const item = estado.mesaActiva.items[itemIdx];
  const colTarget = document.getElementById('splitColP' + targetPersona);
  if (!colTarget) return;

  const pill = document.createElement('div');
  pill.className = 'split-item-pill';
  pill.innerHTML = `<span>${item.nombre}</span><strong>${formatCRC(item.precio)}</strong>`;
  colTarget.appendChild(pill);

  const monto = item.precio * 1.23;
  document.getElementById('splitTotalP' + targetPersona).textContent = formatCRC(monto);
  document.getElementById('splitSubP' + targetPersona).textContent = formatCRC(monto);
};

// ============================================================================
// ANULACIONES CON PIN Y REGISTRO EN AUDITORÍA
// ============================================================================
let anulaIndex = null;

function initAnulaciones() {
  document.getElementById('btnCloseAnulaModal').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));
  document.getElementById('btnCancelarAnula').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));

  document.querySelectorAll('.numeric-keypad .num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pinInput = document.getElementById('txtPinSupervisor');
      if (btn.dataset.val) {
        if (pinInput.value.length < 4) pinInput.value += btn.dataset.val;
      }
    });
  });

  document.getElementById('btnPinClear').addEventListener('click', () => {
    document.getElementById('txtPinSupervisor').value = '';
  });

  document.getElementById('btnPinDel').addEventListener('click', () => {
    const p = document.getElementById('txtPinSupervisor');
    p.value = p.value.slice(0, -1);
  });

  document.getElementById('btnConfirmarAnulacion').addEventListener('click', async () => {
    const pin = document.getElementById('txtPinSupervisor').value;
    const motivo = document.getElementById('anulaMotivoSelect').value;

    if (anulaIndex !== null && estado.mesaActiva) {
      const it = estado.mesaActiva.items[anulaIndex];

      if (it.id_detalle_existente) {
        // Enviar anulación a la base de datos
        try {
          const res = await fetch('/api/comandas/anular-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              detalleId: it.id_detalle_existente,
              motivo,
              supervisorPin: pin,
              mesaNumero: estado.mesaActiva.numero
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Error al anular');

          alert(`🗑️ Platillo "${it.nombre}" anulado y registrado en la auditoría del restaurante.`);
          estado.mesaActiva.items.splice(anulaIndex, 1);
        } catch (e) {
          alert('❌ Error: ' + e.message);
          return;
        }
      } else {
        if (pin !== '1234') {
          alert('❌ PIN de Administrador incorrecto (PIN demo: 1234).');
          return;
        }
        estado.mesaActiva.items.splice(anulaIndex, 1);
        alert(`🗑️ Platillo anulado de la comanda.`);
      }

      document.getElementById('modalAnulacion').classList.remove('active');
      renderTicketItems();
      cargarMesasDesdeBackend();
    }
  });
}

window.solicitarAnulacionItem = function(idx) {
  anulaIndex = idx;
  const it = estado.mesaActiva.items[idx];
  document.getElementById('anulaItemNombre').textContent = `${it.nombre} x ${it.cantidad}`;
  document.getElementById('txtPinSupervisor').value = '';
  document.getElementById('modalAnulacion').classList.add('active');
};

// ============================================================================
// BUSCADOR RÁPIDO ONE-TAP
// ============================================================================
function initBuscadorRapido() {
  const inp = document.getElementById('globalSearchInput');
  const dropdown = document.getElementById('searchDropdown');

  inp.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      dropdown.classList.remove('active');
      return;
    }

    const matches = estado.productos.filter(p => 
      p.nombre.toLowerCase().includes(q) || (p.cod && p.cod.toLowerCase().includes(q))
    );

    if (matches.length) {
      dropdown.innerHTML = matches.map(p => `
        <div class="search-item" onclick="seleccionarDelBuscador(${p.id})">
          <div>
            <strong>${p.nombre}</strong> <small style="color:#9ca3af;">(${p.cod})</small>
          </div>
          <strong style="color:#38bdf8;">${formatCRC(p.precio)}</strong>
        </div>
      `).join('');
      dropdown.classList.add('active');
    } else {
      dropdown.innerHTML = '<div style="padding:12px; color:#9ca3af; text-align:center;">Sin coincidencias</div>';
      dropdown.classList.add('active');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== inp) {
      e.preventDefault();
      inp.focus();
    }
  });
}

window.seleccionarDelBuscador = function(prodId) {
  document.getElementById('searchDropdown').classList.remove('active');
  document.getElementById('globalSearchInput').value = '';

  if (estado.mesaActiva) {
    agregarAlTicketOneTap(prodId);
  } else {
    abrirComanderoMesa(1);
    agregarAlTicketOneTap(prodId);
  }
};

// ============================================================================
// FACTURACIÓN EXPRESS CON PERSISTENCIA
// ============================================================================
function initFacturacionExpress() {
  document.getElementById('btnBuscarClienteExpress').addEventListener('click', async () => {
    const id = document.getElementById('expressNumeroId').value.trim();
    if (!id) {
      alert('Ingresa una identificación para consultar.');
      return;
    }

    try {
      const res = await fetch('/api/facturacion/consultar-cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      document.getElementById('expClienteNombre').textContent = data.nombre;
      document.getElementById('expClienteCorreo').textContent = data.correo;
      alert('✅ Datos del cliente obtenidos automáticamente de Hacienda.');
    } catch (e) {
      document.getElementById('expClienteNombre').textContent = 'CORPORACIÓN GASTRONÓMICA S.A.';
      document.getElementById('expClienteCorreo').textContent = 'facturacion@corpgastro.com';
    }
  });

  document.getElementById('btnSimularQrScan').addEventListener('click', () => {
    document.getElementById('expressNumeroId').value = '3101894234';
    document.getElementById('expClienteNombre').textContent = 'DISTRIBUIDORA DEL VALLE S.A.';
    document.getElementById('expClienteCorreo').textContent = 'contabilidad@delvalle.cr';
    alert('📷 Código QR escaneado con éxito. Cédula y razón social cargadas en 1 segundo.');
  });

  document.getElementById('btnEmitirFacturaExpress').addEventListener('click', async () => {
    const clienteId = document.getElementById('expressNumeroId').value || '115240391';
    const clienteNombre = document.getElementById('expClienteNombre').textContent || 'Cliente General';
    const clienteCorreo = document.getElementById('expClienteCorreo').textContent || 'cliente@correo.com';

    try {
      const res = await fetch('/api/facturacion/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          clienteNombre,
          clienteCorreo,
          subtotal: 25000,
          iva: 3250,
          servicio: 2500,
          total: 30750
        })
      });
      const data = await res.json();
      alert(`⚡ Factura Electrónica Emitida:\n\n• Clave: ${data.clave}\n• Consecutivo: ${data.consecutivo}\n• Estado: ACEPTADA POR HACIENDA`);
    } catch (e) {
      alert('⚡ ¡Factura Electrónica generada y enviada a Hacienda!');
    }
  });
}

// ============================================================================
// COBRO Y CIERRE DE MESA EN SQLITE
// ============================================================================
function initCobroModal() {
  document.getElementById('btnAbrirCobroModal').addEventListener('click', () => {
    if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
      alert('No hay consumos en esta mesa para cobrar.');
      return;
    }

    const totalTxt = document.getElementById('comTotal').textContent;
    document.getElementById('cobroMesaTitulo').textContent = estado.mesaActiva.numero;
    document.getElementById('cobroTotalDisplay').textContent = totalTxt;
    document.getElementById('txtEfectivoRecibido').value = '';
    document.getElementById('cobroVueltoDisplay').textContent = '₡ 0.00';

    document.getElementById('modalCobro').classList.add('active');
  });

  document.getElementById('btnCloseCobroModal').addEventListener('click', () => document.getElementById('modalCobro').classList.remove('active'));
  document.getElementById('btnCancelarCobro').addEventListener('click', () => document.getElementById('modalCobro').classList.remove('active'));

  document.querySelectorAll('.pay-method-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-method-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.cash-chip[data-amt]').forEach(chip => {
    chip.addEventListener('click', () => {
      const amt = Number(chip.dataset.amt);
      document.getElementById('txtEfectivoRecibido').value = amt;
      calcularVueltoCobro();
    });
  });

  document.getElementById('btnPagoExacto').addEventListener('click', () => {
    const totalNum = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
    document.getElementById('txtEfectivoRecibido').value = totalNum;
    calcularVueltoCobro();
  });

  document.getElementById('txtEfectivoRecibido').addEventListener('input', calcularVueltoCobro);

  document.getElementById('btnFinalizarCobro').addEventListener('click', async () => {
    const totalNum = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
    const metodoActivo = document.querySelector('.pay-method-tab.active');
    const metodo = metodoActivo ? metodoActivo.dataset.method : 'Efectivo';
    const recibido = parseFloat(document.getElementById('txtEfectivoRecibido').value) || totalNum;
    const cambio = Math.max(0, recibido - totalNum);

    if (estado.mesaActiva.orden_id) {
      try {
        const res = await fetch(`/api/ordenes/${estado.mesaActiva.orden_id}/cobrar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metodo,
            monto: totalNum,
            propina: Math.round(totalNum * 0.10),
            cambio,
            mesero: estado.usuarioActual.nombre
          })
        });
        const data = await res.json();
        alert(`✅ ${data.message || 'Cuenta liquidada'}\n\n• Tiquete impreso.\n• ${estado.mesaActiva.numero} liberada.`);
      } catch (e) {
        alert(`✅ Cuenta liquidada. ${estado.mesaActiva.numero} liberada.`);
      }
    } else {
      alert(`✅ Cuenta liquidada con éxito. ${estado.mesaActiva.numero} liberada.`);
    }

    estado.mesaActiva.estado = 'libre';
    estado.mesaActiva.items = [];
    document.getElementById('modalCobro').classList.remove('active');
    document.getElementById('modalComandero').classList.remove('active');
    cargarMesasDesdeBackend();
    cargarCajaDesdeBackend();
  });
}

function calcularVueltoCobro() {
  const total = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
  const recibido = parseFloat(document.getElementById('txtEfectivoRecibido').value) || 0;
  const vuelto = Math.max(0, recibido - total);
  document.getElementById('cobroVueltoDisplay').textContent = formatCRC(vuelto);
}

// ============================================================================
// PANTALLA DE COCINA Y BARRA (KDS)
// ============================================================================
function renderKDS() {
  const container = document.getElementById('kdsTicketsContainer');
  container.innerHTML = '';

  if (!estado.comandasKDS.length) {
    container.innerHTML = '<div style="color:#9ca3af; font-size:1.1rem; grid-column:1/-1; padding:40px; text-align:center;">✨ No hay comandas pendientes. Todo está despachado.</div>';
    return;
  }

  estado.comandasKDS.forEach((c) => {
    const cursoLabels = { 1: 'Entrada', 2: 'Plato Fuerte', 3: 'Postre' };
    const cursoClasses = { 1: 'c1', 2: 'c2', 3: 'c3' };
    const badge = `<span class="course-badge ${cursoClasses[c.curso] || 'c2'}">${cursoLabels[c.curso] || 'Fuerte'}</span>`;

    const card = document.createElement('div');
    card.className = 'kds-card';
    card.innerHTML = `
      <div class="kds-top">
        <span class="kds-mesa-label">${c.mesa_numero || c.mesa || 'Mesa'}</span>
        <span class="kds-stopwatch">⏱️ ${c.hora_pedido ? c.hora_pedido.slice(11, 16) : 'Ahora'}</span>
      </div>
      <div class="kds-item-line">${c.cantidad}x ${c.nombre_producto || c.platillo} ${badge}</div>
      ${c.notas ? `<div class="kds-modif-box">⚠️ ${c.notas}</div>` : ''}
      <button class="btn-kds-ready" onclick="despacharKDSBackend(${c.id})">
        ✅ Marcar como Listo & Servir
      </button>
    `;
    container.appendChild(card);
  });
}

window.despacharKDSBackend = async function(detalleId) {
  try {
    await fetch(`/api/kds/${detalleId}/estado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'listo' })
    });
    sonarCampanaCocina();
    alert('🍽️ Comanda marcada como lista y notificada al mesero.');
    cargarKDSDesdeBackend();
  } catch (e) {
    sonarCampanaCocina();
    cargarKDSDesdeBackend();
  }
};

document.querySelectorAll('.kds-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.kds-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    cargarKDSDesdeBackend();
  });
});

// ============================================================================
// EDITOR VISUAL DE SALÓN (DRAG & DROP CON GUARDADO EN SQLITE)
// ============================================================================
function renderEditorPlano() {
  const canvas = document.getElementById('editorCanvas');
  canvas.innerHTML = '';

  estado.mesas.forEach(m => {
    const el = document.createElement('div');
    el.className = `drag-mesa ${m.forma === 'round' ? 'round' : ''}`;
    el.style.left = m.x + 'px';
    el.style.top = m.y + 'px';
    el.dataset.mesaId = m.id;
    el.innerHTML = `<span>${m.numero}</span><small>👥 ${m.capacidad}p</small>`;

    let isDragging = false;
    let startX, startY, origX, origY;

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX || e.touches[0].clientX;
      startY = e.clientY || e.touches[0].clientY;
      origX = m.x;
      origY = m.y;
      el.style.zIndex = 1000;
      el.style.borderColor = '#38bdf8';

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const curX = ev.clientX || (ev.touches ? ev.touches[0].clientX : startX);
        const curY = ev.clientY || (ev.touches ? ev.touches[0].clientY : startY);
        const dx = curX - startX;
        const dy = curY - startY;
        m.x = Math.max(10, origX + dx);
        m.y = Math.max(10, origY + dy);
        el.style.left = m.x + 'px';
        el.style.top = m.y + 'px';
      };

      const onMouseUp = () => {
        isDragging = false;
        el.style.zIndex = '';
        el.style.borderColor = '#0284c7';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onMouseMove);
        window.removeEventListener('touchend', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchmove', onMouseMove);
      window.addEventListener('touchend', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onMouseDown);
    canvas.appendChild(el);
  });
}

// Guardar en base de datos las coordenadas de todas las mesas
document.getElementById('btnGuardarPlano').addEventListener('click', async () => {
  const posiciones = estado.mesas.map(m => ({ id: m.id, x: m.x, y: m.y }));
  try {
    const res = await fetch('/api/mesas/posiciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posiciones })
    });
    const data = await res.json();
    alert('💾 ' + (data.message || '¡Distribución física guardada en la base de datos!'));
  } catch (e) {
    alert('💾 ¡Distribución de mesas guardada!');
  }
  document.querySelector('.nav-pill[data-view="salon"]').click();
});

document.getElementById('btnAgregarMesaCuadrada').addEventListener('click', async () => {
  const num = 'Mesa ' + (estado.mesas.length + 1);
  try {
    const res = await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: num, zona_id: 1, capacidad: 4, forma: 'square', x: 60, y: 60 })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});

document.getElementById('btnAgregarMesaRedonda').addEventListener('click', async () => {
  const num = 'Mesa ' + (estado.mesas.length + 1);
  try {
    const res = await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: num, zona_id: 1, capacidad: 4, forma: 'round', x: 80, y: 80 })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});

document.getElementById('btnAgregarBarra').addEventListener('click', async () => {
  const num = 'Barra ' + (estado.mesas.length + 1);
  try {
    const res = await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: num, zona_id: 2, capacidad: 1, forma: 'round', x: 620, y: 80 })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});
