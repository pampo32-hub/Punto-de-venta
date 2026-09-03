// ============================================================================
// PUNTO DE VENTA - ESTADO EN MEMORIA (FRONTEND REACTIVO COMPLETO)
// ============================================================================

const estado = {
  usuarioActual: { nombre: 'Juan (Cajero/Mesero)', pin: '1234', rol: 'admin' },
  mesaActiva: null,
  itemModificando: null,
  splitPersonas: 4,
  splitColumnas: [],
  
  // Catálogo completo de Menú con modificadores recomendados
  categorias: [
    { id: 1, nombre: 'Bebidas & Cervezas', icono: '🍺', destino: 'barra' },
    { id: 2, nombre: 'Coctelería & Tragos', icono: '🍸', destino: 'barra' },
    { id: 3, nombre: 'Bocas & Entradas', icono: '🍤', destino: 'cocina' },
    { id: 4, nombre: 'Platos Fuertes', icono: '🥩', destino: 'cocina' },
    { id: 5, nombre: 'Hamburguesas & Snacks', icono: '🍔', destino: 'cocina' },
    { id: 6, nombre: 'Postres & Cafetería', icono: '☕', destino: 'cocina' }
  ],

  productos: [
    { id: 101, catId: 1, cod: 'BEB01', nombre: 'Imperial Regular', precio: 1800, destino: 'barra' },
    { id: 102, catId: 1, cod: 'BEB02', nombre: 'Pilsen', precio: 1800, destino: 'barra' },
    { id: 103, catId: 1, cod: 'BEB03', nombre: 'Corona Extra', precio: 2500, destino: 'barra' },
    { id: 104, catId: 1, cod: 'BEB04', nombre: 'Refresco Natural en Agua', precio: 1600, destino: 'barra' },
    { id: 201, catId: 2, cod: 'COC01', nombre: 'Mojito Clásico Cubano', precio: 3800, destino: 'barra' },
    { id: 202, catId: 2, cod: 'COC02', nombre: 'Margarita Tradicional', precio: 4200, destino: 'barra' },
    { id: 203, catId: 2, cod: 'COC03', nombre: 'Gin Tonic Flor de Caña', precio: 4500, destino: 'barra' },
    { id: 301, catId: 3, cod: 'ENT01', nombre: 'Chifrijo Tradicional', precio: 4500, destino: 'cocina' },
    { id: 302, catId: 3, cod: 'ENT02', nombre: 'Alitas BBQ / Búfalo (8 uds)', precio: 4900, destino: 'cocina' },
    { id: 303, catId: 3, cod: 'ENT03', nombre: 'Patacones con Carne Mechada', precio: 4200, destino: 'cocina' },
    { id: 304, catId: 3, cod: 'ENT04', nombre: 'Ceviche Mixto con Aguacate', precio: 4800, destino: 'cocina' },
    { id: 401, catId: 4, cod: 'PLA01', nombre: 'Corte Rib Eye 350g', precio: 12500, destino: 'cocina' },
    { id: 402, catId: 4, cod: 'PLA02', nombre: 'Arroz con Mariscos a la Tica', precio: 7500, destino: 'cocina' },
    { id: 501, catId: 5, cod: 'HAM01', nombre: 'Hamburguesa Doble Bacon-Cheddar', precio: 5500, destino: 'cocina' },
    { id: 502, catId: 5, cod: 'HAM02', nombre: 'Sandwich de Pollo Crispy', precio: 4800, destino: 'cocina' },
    { id: 601, catId: 6, cod: 'POS01', nombre: 'Tres Leches Artesanal', precio: 2800, destino: 'cocina' },
    { id: 602, catId: 6, cod: 'POS02', nombre: 'Café Espresso Doble', precio: 1400, destino: 'cocina' }
  ],

  // Mesas del local con posiciones en el lienzo (X / Y)
  mesas: [
    { id: 1, numero: 'Mesa 1', zona: 'salon', capacidad: 4, estado: 'libre', x: 40, y: 40, forma: 'square', orden: null },
    { id: 2, numero: 'Mesa 2', zona: 'salon', capacidad: 4, estado: 'ocupada', x: 220, y: 40, forma: 'square', orden: {
      items: [
        { id: 101, nombre: 'Imperial Regular', precio: 1800, cantidad: 2, notas: 'Bien frías', enviado: true },
        { id: 301, nombre: 'Chifrijo Tradicional', precio: 4500, cantidad: 1, notas: 'Sin cebolla, extra picante', enviado: true }
      ]
    }},
    { id: 3, numero: 'Mesa 3', zona: 'salon', capacidad: 6, estado: 'esperando', x: 400, y: 40, forma: 'round', orden: {
      items: [
        { id: 401, nombre: 'Corte Rib Eye 350g', precio: 12500, cantidad: 1, notas: 'Término medio, salsa por separado', enviado: true },
        { id: 201, nombre: 'Mojito Clásico Cubano', precio: 3800, cantidad: 2, notas: 'Poco hielo', enviado: true }
      ]
    }},
    { id: 4, numero: 'Mesa 4', zona: 'salon', capacidad: 2, estado: 'cuenta', x: 40, y: 220, forma: 'square', orden: {
      items: [
        { id: 501, nombre: 'Hamburguesa Doble Bacon-Cheddar', precio: 5500, cantidad: 2, notas: 'Sin cebolla, extra queso', enviado: true },
        { id: 103, nombre: 'Corona Extra', precio: 2500, cantidad: 2, notas: '', enviado: true }
      ]
    }},
    { id: 5, numero: 'Barra 1', zona: 'barra', capacidad: 1, estado: 'libre', x: 620, y: 40, forma: 'round', orden: null },
    { id: 6, numero: 'Barra 2', zona: 'barra', capacidad: 1, estado: 'ocupada', x: 620, y: 190, forma: 'round', orden: {
      items: [{ id: 203, nombre: 'Gin Tonic Flor de Caña', precio: 4500, cantidad: 1, notas: '', enviado: true }]
    }},
    { id: 7, numero: 'Terraza 1', zona: 'terraza', capacidad: 4, estado: 'libre', x: 220, y: 220, forma: 'square', orden: null },
    { id: 8, numero: 'Mesa VIP', zona: 'vip', capacidad: 8, estado: 'libre', x: 400, y: 220, forma: 'square', orden: null }
  ],

  // Comandas activas en KDS (Cocina y Barra)
  comandasKDS: [
    { id: 1, mesa: 'Mesa 2', platillo: 'Chifrijo Tradicional', cantidad: 1, notas: 'Sin cebolla, extra picante', destino: 'cocina', hora: '12:05 PM', estado: 'preparando' },
    { id: 2, mesa: 'Mesa 3', platillo: 'Corte Rib Eye 350g', cantidad: 1, notas: 'Término medio, salsa por separado', destino: 'cocina', hora: '12:12 PM', estado: 'pendiente' },
    { id: 3, mesa: 'Mesa 3', platillo: 'Mojito Clásico Cubano', cantidad: 2, notas: 'Poco hielo', destino: 'barra', hora: '12:14 PM', estado: 'pendiente' }
  ]
};

// ============================================================================
// HELPERS
// ============================================================================
function formatCRC(num) {
  const n = Number(num) || 0;
  return '₡ ' + n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================================
// INICIALIZACIÓN Y NAVEGACIÓN
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavegacion();
  renderSalón();
  renderEditorPlano();
  renderKDS();
  renderCatalogoComandero();
  initBuscadorRapido();
  initSplitBills();
  initFacturacionExpress();
  initCobroModal();
  initAnulaciones();
});

function initNavegacion() {
  document.querySelectorAll('.nav-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-pill').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pos-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const targetView = 'view-' + btn.dataset.view;
      document.getElementById(targetView).classList.add('active');

      if (btn.dataset.view === 'salon') renderSalón();
      if (btn.dataset.view === 'editor-plano') renderEditorPlano();
      if (btn.dataset.view === 'kds') renderKDS();
    });
  });

  document.getElementById('btnIrEditorSalon').addEventListener('click', () => {
    document.querySelector('.nav-pill[data-view="editor-plano"]').click();
  });
}

// ============================================================================
// 1. SALÓN Y MAPEO DE MESAS
// ============================================================================
function renderSalón(filtroZona = 'todas') {
  const canvas = document.getElementById('mesasCanvasView');
  canvas.innerHTML = '';

  const mesasFiltradas = filtroZona === 'todas' 
    ? estado.mesas 
    : estado.mesas.filter(m => m.zona === filtroZona);

  mesasFiltradas.forEach(m => {
    const card = document.createElement('div');
    card.className = `mesa-render-card ${m.estado} ${m.forma === 'round' ? 'round' : ''}`;
    card.style.left = m.x + 'px';
    card.style.top = m.y + 'px';

    let totalOrden = 0;
    if (m.orden && m.orden.items) {
      totalOrden = m.orden.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0) * 1.23; // +23% servicio e iva
    }

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
      <div class="m-total">${totalOrden > 0 ? formatCRC(totalOrden) : '—'}</div>
      <div class="m-footer">
        <span>👥 ${m.capacidad}p</span>
        <span>${m.zona.toUpperCase()}</span>
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
// 2. EDITOR VISUAL DE SALÓN (DRAG & DROP)
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

    // Lógica Drag & Drop táctil y ratón
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

document.getElementById('btnGuardarPlano').addEventListener('click', () => {
  alert('💾 ¡Distribución de mesas guardada con éxito! Las posiciones físicas han sido actualizadas.');
  document.querySelector('.nav-pill[data-view="salon"]').click();
});

document.getElementById('btnAgregarMesaCuadrada').addEventListener('click', () => {
  const nuevaId = estado.mesas.length + 1;
  estado.mesas.push({
    id: nuevaId,
    numero: 'Mesa ' + nuevaId,
    zona: 'salon',
    capacidad: 4,
    estado: 'libre',
    x: 60,
    y: 60,
    forma: 'square',
    orden: null
  });
  renderEditorPlano();
});

document.getElementById('btnAgregarMesaRedonda').addEventListener('click', () => {
  const nuevaId = estado.mesas.length + 1;
  estado.mesas.push({
    id: nuevaId,
    numero: 'Mesa ' + nuevaId,
    zona: 'salon',
    capacidad: 4,
    estado: 'libre',
    x: 80,
    y: 80,
    forma: 'round',
    orden: null
  });
  renderEditorPlano();
});

// ============================================================================
// 3. COMANDERO TÁCTIL PRINCIPAL (ONE-TAP & PEDIDOS)
// ============================================================================
function abrirComanderoMesa(mesaId) {
  const mesa = estado.mesas.find(m => m.id === mesaId);
  if (!mesa) return;

  estado.mesaActiva = mesa;
  document.getElementById('comMesaNumero').textContent = mesa.numero;
  document.getElementById('comMesaZona').textContent = mesa.zona.toUpperCase();

  if (!mesa.orden) {
    mesa.orden = { items: [] };
  }

  renderTicketItems();
  document.getElementById('modalComandero').classList.add('active');
}

document.getElementById('btnCloseComandero').addEventListener('click', () => {
  document.getElementById('modalComandero').classList.remove('active');
  renderSalón();
});

function renderCatalogoComandero() {
  const chipsContainer = document.getElementById('comCategoryChips');
  chipsContainer.innerHTML = `
    <button class="cat-chip active" onclick="filtrarCatalogo('todos', this)">🍽️ Todos</button>
    ${estado.categorias.map(c => `<button class="cat-chip" onclick="filtrarCatalogo(${c.id}, this)">${c.icono} ${c.nombre}</button>`).join('')}
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
  grid.innerHTML = prods.map(p => `
    <div class="prod-card-one-tap" onclick="agregarAlTicketOneTap(${p.id})">
      <span class="prod-card-name">${p.nombre}</span>
      <span class="prod-card-price">${formatCRC(p.precio)}</span>
    </div>
  `).join('');
}

// ONE-TAP SELECTION: Tocar agrega directo
window.agregarAlTicketOneTap = function(prodId) {
  if (!estado.mesaActiva) return;
  const prod = estado.productos.find(p => p.id === prodId);
  if (!prod) return;

  const existente = estado.mesaActiva.orden.items.find(it => it.id === prodId && !it.enviado);
  if (existente) {
    existente.cantidad++;
  } else {
    estado.mesaActiva.orden.items.push({
      id: prod.id,
      nombre: prod.nombre,
      precio: prod.precio,
      cantidad: 1,
      notas: '',
      destino: prod.destino,
      enviado: false
    });
  }

  // Actualizar estado de la mesa a ocupada
  if (estado.mesaActiva.estado === 'libre') {
    estado.mesaActiva.estado = 'ocupada';
  }

  renderTicketItems();
};

function renderTicketItems() {
  const list = document.getElementById('comTicketItemsList');
  if (!estado.mesaActiva || !estado.mesaActiva.orden.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo o bebida para agregarlo a la comanda con 1 toque.</div>';
    recalcularTotalesTicket();
    return;
  }

  list.innerHTML = estado.mesaActiva.orden.items.map((it, idx) => `
    <div class="ticket-item-row">
      <div class="ticket-item-top">
        <span class="t-name">${it.nombre} ${it.enviado ? '<small style="color:#10b981;">✓ Enviado</small>' : ''}</span>
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
          <button class="btn-item-tool" onclick="abrirModalModificadores(${idx})">✏️ Modificadores</button>
          <button class="btn-item-tool" style="color:#ef4444;" onclick="solicitarAnulacionItem(${idx})">🗑️ Anular</button>
        </div>
      </div>
    </div>
  `).join('');

  recalcularTotalesTicket();
}

window.modificarCantidadTicket = function(idx, delta) {
  const item = estado.mesaActiva.orden.items[idx];
  item.cantidad += delta;
  if (item.cantidad <= 0) {
    if (item.enviado) {
      solicitarAnulacionItem(idx);
      item.cantidad = 1; // restaurar mientras valida pin
      return;
    } else {
      estado.mesaActiva.orden.items.splice(idx, 1);
    }
  }
  renderTicketItems();
};

function recalcularTotalesTicket() {
  if (!estado.mesaActiva || !estado.mesaActiva.orden.items.length) {
    document.getElementById('comSubtotal').textContent = '₡ 0.00';
    document.getElementById('comServicio').textContent = '₡ 0.00';
    document.getElementById('comIva').textContent = '₡ 0.00';
    document.getElementById('comTotal').textContent = '₡ 0.00';
    return;
  }

  const sub = estado.mesaActiva.orden.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  const servicio = Math.round(sub * 0.10);
  const iva = Math.round(sub * 0.13);
  const total = sub + servicio + iva;

  document.getElementById('comSubtotal').textContent = formatCRC(sub);
  document.getElementById('comServicio').textContent = formatCRC(servicio);
  document.getElementById('comIva').textContent = formatCRC(iva);
  document.getElementById('comTotal').textContent = formatCRC(total);
}

// Botón Enviar a Cocina
document.getElementById('btnEnviarComandaCocina').addEventListener('click', () => {
  const noEnviados = estado.mesaActiva.orden.items.filter(it => !it.enviado);
  if (!noEnviados.length) {
    alert('No hay productos nuevos pendientes de enviar.');
    return;
  }

  noEnviados.forEach(it => {
    it.enviado = true;
    estado.comandasKDS.push({
      id: Date.now() + Math.random(),
      mesa: estado.mesaActiva.numero,
      platillo: it.nombre,
      cantidad: it.cantidad,
      notas: it.notas,
      destino: it.destino,
      hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      estado: 'pendiente'
    });
  });

  estado.mesaActiva.estado = 'esperando';
  alert('🔥 ¡Comanda enviada en tiempo real a Cocina y Barra!');
  renderTicketItems();
  document.getElementById('kdsCounter').textContent = estado.comandasKDS.length;
});

// ============================================================================
// 4. MODIFICADORES DINÁMICOS Y NOTAS ABIERTAS
// ============================================================================
window.abrirModalModificadores = function(itemIdx) {
  estado.itemModificando = estado.mesaActiva.orden.items[itemIdx];
  document.getElementById('modifProdNombre').textContent = estado.itemModificando.nombre;
  document.getElementById('txtNotaAbiertaModif').value = estado.itemModificando.notas || '';

  // Limpiar chips
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

// Clic en chips de modificación rápida
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
// 5. SPLIT BILLS (SEPARACIÓN Y COMBINACIÓN DE CUENTAS)
// ============================================================================
function initSplitBills() {
  document.getElementById('btnAbrirSplitBill').addEventListener('click', () => {
    if (!estado.mesaActiva || !estado.mesaActiva.orden.items.length) {
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

  // Cambio de modo de división
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

  // Contador de personas para modo igual
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
  const sub = estado.mesaActiva.orden.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  const total = (sub * 1.23);
  const porPersona = Math.round(total / estado.splitPersonas);
  document.getElementById('splitMontoPorPersona').textContent = formatCRC(porPersona);
}

function configurarColumnasSplit() {
  const container = document.getElementById('splitPersonsContainer');
  container.innerHTML = '';

  // Columna Cuenta Principal
  const colPrincipal = document.createElement('div');
  colPrincipal.className = 'split-col';
  colPrincipal.innerHTML = `
    <div class="split-col-header">
      <span>📦 Consumo de la Mesa</span>
      <span>Total</span>
    </div>
    <div class="split-col-items" id="splitColOrigen">
      ${estado.mesaActiva.orden.items.map((it, idx) => `
        <div class="split-item-pill" onclick="moverItemSplit(${idx}, 1)">
          <span>${it.cantidad}x ${it.nombre}</span>
          <strong>${formatCRC(it.precio * it.cantidad)}</strong>
        </div>
      `).join('')}
    </div>
  `;
  container.appendChild(colPrincipal);

  // Columnas para 3 Personas divididas
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
  const item = estado.mesaActiva.orden.items[itemIdx];
  const colTarget = document.getElementById('splitColP' + targetPersona);
  if (!colTarget) return;

  const pill = document.createElement('div');
  pill.className = 'split-item-pill';
  pill.innerHTML = `<span>${item.nombre}</span><strong>${formatCRC(item.precio)}</strong>`;
  colTarget.appendChild(pill);

  // Actualizar totales de persona
  const monto = item.precio * 1.23;
  document.getElementById('splitTotalP' + targetPersona).textContent = formatCRC(monto);
  document.getElementById('splitSubP' + targetPersona).textContent = formatCRC(monto);
};

// ============================================================================
// 6. ANULACIONES Y CANCELACIONES CON PIN
// ============================================================================
let anulaIndex = null;

function initAnulaciones() {
  document.getElementById('btnCloseAnulaModal').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));
  document.getElementById('btnCancelarAnula').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));

  // Teclado numérico
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

  document.getElementById('btnConfirmarAnulacion').addEventListener('click', () => {
    const pin = document.getElementById('txtPinSupervisor').value;
    if (pin !== '1234') {
      alert('❌ PIN de Administrador incorrecto (El PIN demo es 1234).');
      document.getElementById('txtPinSupervisor').value = '';
      return;
    }

    if (anulaIndex !== null && estado.mesaActiva) {
      const itemBorrado = estado.mesaActiva.orden.items.splice(anulaIndex, 1)[0];
      alert(`🗑️ Platillo "${itemBorrado.nombre}" anulado de la comanda y notificado a cocina.`);
      document.getElementById('modalAnulacion').classList.remove('active');
      renderTicketItems();
    }
  });
}

window.solicitarAnulacionItem = function(idx) {
  anulaIndex = idx;
  const it = estado.mesaActiva.orden.items[idx];
  document.getElementById('anulaItemNombre').textContent = `${it.nombre} x ${it.cantidad}`;
  document.getElementById('txtPinSupervisor').value = '';
  document.getElementById('modalAnulacion').classList.add('active');
};

// ============================================================================
// 7. BUSCADOR RÁPIDO ONE-TAP
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
      p.nombre.toLowerCase().includes(q) || p.cod.toLowerCase().includes(q)
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
    // Si no hay mesa abierta, sugerir abrir Mesa 1
    abrirComanderoMesa(1);
    agregarAlTicketOneTap(prodId);
  }
};

// ============================================================================
// 8. FACTURACIÓN EXPRESS (QR Y CÉDULA)
// ============================================================================
function initFacturacionExpress() {
  document.getElementById('btnBuscarClienteExpress').addEventListener('click', () => {
    const id = document.getElementById('expressNumeroId').value.trim();
    if (!id) {
      alert('Ingresa una identificación para consultar.');
      return;
    }

    // Simulación de consulta al Registro / API Hacienda
    document.getElementById('expClienteNombre').textContent = 'CORPORACIÓN GASTRONÓMICA S.A.';
    document.getElementById('expClienteCorreo').textContent = 'facturacion@corpgastro.com';
    alert('✅ Datos del cliente obtenidos automáticamente de Hacienda.');
  });

  document.getElementById('btnSimularQrScan').addEventListener('click', () => {
    document.getElementById('expressNumeroId').value = '3101894234';
    document.getElementById('expClienteNombre').textContent = 'DISTRIBUIDORA DEL VALLE S.A.';
    document.getElementById('expClienteCorreo').textContent = 'contabilidad@delvalle.cr';
    alert('📷 Código QR escaneado con éxito. Cédula y razón social cargadas en 1 segundo.');
  });

  document.getElementById('btnEmitirFacturaExpress').addEventListener('click', () => {
    alert('⚡ ¡Factura Electrónica generada y firmada con llave criptográfica! Enviada a Hacienda y al correo del cliente.');
  });
}

// ============================================================================
// 9. COBRO Y LIQUIDACIÓN RÁPIDA
// ============================================================================
function initCobroModal() {
  document.getElementById('btnAbrirCobroModal').addEventListener('click', () => {
    if (!estado.mesaActiva || !estado.mesaActiva.orden.items.length) {
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

  // Métodos de pago tabs
  document.querySelectorAll('.pay-method-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-method-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Chips de efectivo rápido
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

  document.getElementById('btnFinalizarCobro').addEventListener('click', () => {
    alert(`✅ ¡Cuenta de ${estado.mesaActiva.numero} liquidada exitosamente!\n\n• Tiquete impreso en la impresora térmica.\n• ${estado.mesaActiva.numero} ha sido liberada para nuevos clientes.`);
    
    estado.mesaActiva.estado = 'libre';
    estado.mesaActiva.orden = null;
    
    document.getElementById('modalCobro').classList.remove('active');
    document.getElementById('modalComandero').classList.remove('active');
    renderSalón();
  });
}

function calcularVueltoCobro() {
  const total = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
  const recibido = parseFloat(document.getElementById('txtEfectivoRecibido').value) || 0;
  const vuelto = Math.max(0, recibido - total);
  document.getElementById('cobroVueltoDisplay').textContent = formatCRC(vuelto);
}

// ============================================================================
// 10. PANTALLAS KDS (COCINA Y BARRA)
// ============================================================================
function renderKDS(filtroDestino = 'todos') {
  const container = document.getElementById('kdsTicketsContainer');
  container.innerHTML = '';

  const comandas = filtroDestino === 'todos' 
    ? estado.comandasKDS 
    : estado.comandasKDS.filter(c => c.destino === filtroDestino);

  if (!comandas.length) {
    container.innerHTML = '<div style="color:#9ca3af; font-size:1.1rem; grid-column:1/-1; padding:40px; text-align:center;">✨ No hay comandas pendientes. Todo está despachado.</div>';
    return;
  }

  comandas.forEach((c, idx) => {
    const card = document.createElement('div');
    card.className = 'kds-card';
    card.innerHTML = `
      <div class="kds-top">
        <span class="kds-mesa-label">${c.mesa}</span>
        <span class="kds-stopwatch">⏱️ ${c.hora}</span>
      </div>
      <div class="kds-item-line">${c.cantidad}x ${c.platillo}</div>
      ${c.notas ? `<div class="kds-modif-box">⚠️ ${c.notas}</div>` : ''}
      <button class="btn-kds-ready" onclick="despacharKDS(${idx})">
        ✅ Marcar como Listo & Servir
      </button>
    `;
    container.appendChild(card);
  });
}

window.despacharKDS = function(idx) {
  const despachado = estado.comandasKDS.splice(idx, 1)[0];
  alert(`🍽️ Comanda de "${despachado.platillo}" lista para entregar en ${despachado.mesa}.`);
  renderKDS();
  document.getElementById('kdsCounter').textContent = estado.comandasKDS.length;
};

document.querySelectorAll('.kds-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.kds-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderKDS(tab.dataset.kdsDest);
  });
});
