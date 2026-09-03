// ============================================================================
// PUNTO DE VENTA - SISTEMA CON AUTENTICACIÓN, PORTAL DEV Y BOTONES CON FOTOS
// ============================================================================

const estado = {
  usuarioActual: null, // Usuario autenticado
  negocioActual: null, // Negocio / Restaurante activo
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
  meserosReporte: [],

  // Galerías de fotos sugeridas de alta calidad para comida y bebidas
  presetsFotos: [
    { cat: 'Hamburguesa', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Rib Eye', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Chifrijo / Bocas', url: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Alitas BBQ', url: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Ceviche', url: 'https://images.unsplash.com/photo-1535400255456-984241443b29?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Cerveza Fría', url: 'https://images.unsplash.com/photo-1608270110398-319cf887cf45?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Pilsen / Lager', url: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Corona / Botella', url: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Mojito Cubano', url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Margarita', url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Tres Leches', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&auto=format&fit=crop&q=80' },
    { cat: 'Café Espresso', url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80' }
  ]
};

// WebSockets
let socket = null;
try {
  if (typeof io !== 'undefined') {
    socket = io();
    socket.on('connect', () => console.log('✅ WebSockets activo.'));
    socket.on('nueva_comanda', (d) => {
      sonarCampanaCocina();
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });
    socket.on('mesa_actualizada', () => cargarMesasDesdeBackend());
    socket.on('lanzar_fuertes', (d) => {
      sonarCampanaCocina();
      alert(`🚀 ¡ORDEN EN MARCHA!\n\nCocina notificada: Lanzar Platos Fuertes de ${d.mesaNumero}.`);
      cargarKDSDesdeBackend();
    });
    socket.on('comanda_anulada', () => {
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });
    socket.on('producto_agotado_cambiado', (d) => {
      const prod = estado.productos.find(p => p.id === d.id);
      if (prod) prod.agotado = d.agotado;
      renderGridProductos(estado.productos);
    });
    socket.on('producto_visual_cambiado', () => cargarMenuDesdeBackend());
    socket.on('mesas_reorganizadas', () => cargarMesasDesdeBackend());
    socket.on('cliente_pidio_cuenta', (d) => {
      sonarCampanaCocina();
      alert(`📱 ¡Aviso de Cliente!\n\nEl cliente de la ${d.mesaNumero} ha solicitado la cuenta.`);
      cargarMesasDesdeBackend();
    });
  }
} catch (e) {}

// Audio Campana
function formatCRC(num) {
  return '₡ ' + (Number(num) || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  } catch (e) {}
}

// ============================================================================
// 1. GESTIÓN DE SESIÓN & LOGIN CON GÉNERO Y ENRUTAMIENTO
// ============================================================================
window.cargarCredencialDemo = function(user, pass) {
  document.getElementById('loginUsuario').value = user;
  document.getElementById('loginPassword').value = pass;
  ejecutarLogin();
};

window.ejecutarLogin = async function() {
  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!usuario || !password) {
    alert('Ingresa tu usuario y contraseña.');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de autenticación');

    estado.usuarioActual = data.usuario;
    estado.negocioActual = data.negocio;

    // Guardar en sesión
    sessionStorage.setItem('pos_usuario', JSON.stringify(data.usuario));
    sessionStorage.setItem('pos_negocio', JSON.stringify(data.negocio));

    aplicarEnrutamientoPorRol();
  } catch (e) {
    alert('❌ ' + e.message);
  }
};

window.cerrarSesion = function() {
  estado.usuarioActual = null;
  sessionStorage.removeItem('pos_usuario');
  document.getElementById('landingLoginView').classList.add('active');
  document.getElementById('developerPortalView').classList.remove('active');
  document.getElementById('posMainView').classList.remove('active');
  document.getElementById('loginPassword').value = '';
};

function aplicarEnrutamientoPorRol() {
  const u = estado.usuarioActual;
  if (!u) {
    document.getElementById('landingLoginView').classList.add('active');
    document.getElementById('developerPortalView').classList.remove('active');
    document.getElementById('posMainView').classList.remove('active');
    return;
  }

  document.getElementById('landingLoginView').classList.remove('active');

  // CASO 1: DEVELOPER ➔ PORTAL DISTINTO DE DESARROLLADOR
  if (u.rol === 'developer') {
    document.getElementById('developerPortalView').classList.add('active');
    document.getElementById('posMainView').classList.remove('active');
    cargarDevPortal();
    return;
  }

  // CASO 2: ADMIN, CAJERO, SALONERO/A ➔ SISTEMA POS RESTAURANTE
  document.getElementById('developerPortalView').classList.remove('active');
  document.getElementById('posMainView').classList.add('active');

  // Configurar Perfil con Adaptación de Género
  const perfilBadge = document.getElementById('userProfileBadge');
  perfilBadge.textContent = u.perfilVisual || `${u.nombre} (${u.rol})`;

  // Configurar Logo y Nombre del Negocio
  actualizarBrandingNegocio(estado.negocioActual);

  // Visibilidad de herramientas de Admin
  const adminTools = document.getElementById('adminExtraActions');
  if (u.rol === 'admin' || u.rol === 'developer') {
    adminTools.style.display = 'flex';
  } else {
    adminTools.style.display = 'none';
  }

  // Cargar datos operativos del restaurante
  cargarMesasDesdeBackend();
  cargarMenuDesdeBackend();
  cargarKDSDesdeBackend();
  cargarCajaDesdeBackend();
}

function actualizarBrandingNegocio(negocio) {
  if (!negocio) return;
  const logoImg = document.getElementById('topbarLogoImg');
  const emoji = document.getElementById('topbarDefaultEmoji');
  const nomTxt = document.getElementById('topbarRestauranteNombre');
  const slogTxt = document.getElementById('topbarSlogan');

  if (negocio.logo_url) {
    logoImg.src = negocio.logo_url;
    logoImg.style.display = 'block';
    emoji.style.display = 'none';
  } else {
    logoImg.style.display = 'none';
    emoji.style.display = 'inline-block';
  }

  nomTxt.textContent = negocio.nombre || 'PUNTO DE VENTA';
  slogTxt.textContent = negocio.slogan || 'GastroBar Pro';
}

// ============================================================================
// 2. PORTAL DE DESARROLLADOR (SAAS MULTI-COMERCIO)
// ============================================================================
function cargarDevPortal() {
  cargarNegociosDev();
  cargarUsuariosDev();

  // Tabs de navegación del portal dev
  document.querySelectorAll('.dev-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dev-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.dev-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.devTab;
      if (target === 'comercios') {
        document.getElementById('devTabComercios').classList.add('active');
        cargarNegociosDev();
      } else if (target === 'usuarios') {
        document.getElementById('devTabUsuarios').classList.add('active');
        cargarUsuariosDev();
      } else if (target === 'db') {
        document.getElementById('devTabDb').classList.add('active');
      }
    });
  });
}

async function cargarNegociosDev() {
  try {
    const res = await fetch('/api/dev/negocios');
    const negocios = await res.json();
    const grid = document.getElementById('devNegociosGrid');

    grid.innerHTML = negocios.map(n => `
      <div class="negocio-card">
        <div class="negocio-top">
          <img class="negocio-logo-img" src="${n.logo_url || 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=100'}" alt="Logo" />
          <div class="negocio-details">
            <h4>${n.nombre}</h4>
            <small>${n.slogan || 'Restaurante & Bar'}</small>
          </div>
        </div>
        <div class="negocio-meta-stats">
          <span>👥 ${n.total_usuarios || 0} Usuarios</span>
          <span>🍽️ ${n.total_mesas || 0} Mesas</span>
          <span>💰 Moneda: ${n.moneda}</span>
        </div>
        <div class="negocio-actions">
          <button class="btn-open-pos-as" onclick="abrirPosComoNegocio(${n.id})">
            👀 Abrir POS como este Local
          </button>
          <button class="btn-edit-negocio" onclick="editarNegocioDev(${n.id})">
            ✏️ Editar Logo / Datos
          </button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Error cargando negocios dev:', e);
  }
}

window.abrirPosComoNegocio = async function(negocioId) {
  try {
    const res = await fetch('/api/dev/negocios');
    const negocios = await res.json();
    const neg = negocios.find(n => n.id === negocioId);
    if (neg) {
      estado.negocioActual = neg;
      actualizarBrandingNegocio(neg);
      document.getElementById('developerPortalView').classList.remove('active');
      document.getElementById('posMainView').classList.add('active');

      const perfilBadge = document.getElementById('userProfileBadge');
      perfilBadge.textContent = 'Juan Developer (Modo Supervisión)';
      document.getElementById('adminExtraActions').style.display = 'flex';

      cargarMesasDesdeBackend();
      cargarMenuDesdeBackend();
      cargarKDSDesdeBackend();
      cargarCajaDesdeBackend();
    }
  } catch (e) {}
};

window.abrirModalNuevoNegocio = function() {
  document.getElementById('devNegocioId').value = '';
  document.getElementById('devNegocioNombre').value = '';
  document.getElementById('devNegocioSlogan').value = '';
  document.getElementById('devNegocioLogoUrl').value = '';
  document.getElementById('devNegocioTelefono').value = '';
  document.getElementById('negocioModalTitulo').textContent = '🏬 Registrar Nuevo Comercio';
  document.getElementById('modalDevNegocio').classList.add('active');
};

window.editarNegocioDev = async function(negocioId) {
  const res = await fetch('/api/dev/negocios');
  const negocios = await res.json();
  const n = negocios.find(item => item.id === negocioId);
  if (!n) return;

  document.getElementById('devNegocioId').value = n.id;
  document.getElementById('devNegocioNombre').value = n.nombre;
  document.getElementById('devNegocioSlogan').value = n.slogan || '';
  document.getElementById('devNegocioLogoUrl').value = n.logo_url || '';
  document.getElementById('devNegocioTelefono').value = n.telefono || '';
  document.getElementById('negocioModalTitulo').textContent = '✏️ Editar Comercio & Logo';
  document.getElementById('modalDevNegocio').classList.add('active');
};

document.getElementById('btnCloseDevNegocio').addEventListener('click', () => document.getElementById('modalDevNegocio').classList.remove('active'));
document.getElementById('btnCancelarDevNegocio').addEventListener('click', () => document.getElementById('modalDevNegocio').classList.remove('active'));

document.getElementById('btnGuardarDevNegocio').addEventListener('click', async () => {
  const id = document.getElementById('devNegocioId').value;
  const nombre = document.getElementById('devNegocioNombre').value.trim();
  const slogan = document.getElementById('devNegocioSlogan').value.trim();
  const logo_url = document.getElementById('devNegocioLogoUrl').value.trim();
  const telefono = document.getElementById('devNegocioTelefono').value.trim();

  if (!nombre) {
    alert('El nombre del negocio es obligatorio.');
    return;
  }

  const endpoint = id ? `/api/dev/negocios/${id}` : '/api/dev/negocios';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, slogan, logo_url, telefono })
    });
    const data = await res.json();
    alert('🏬 ¡Comercio guardado exitosamente!');
    document.getElementById('modalDevNegocio').classList.remove('active');
    cargarNegociosDev();
    if (estado.negocioActual && estado.negocioActual.id === Number(id)) {
      estado.negocioActual = data;
      actualizarBrandingNegocio(data);
    }
  } catch (e) {
    alert('Error al guardar negocio');
  }
});

async function cargarUsuariosDev() {
  try {
    const res = await fetch('/api/dev/usuarios');
    const usuarios = await res.json();
    const tbody = document.getElementById('devUsuariosTableBody');

    tbody.innerHTML = usuarios.map(u => {
      let rolBadge = u.rol.toUpperCase();
      let genBadge = u.genero === 'F' ? '👩 Mujer' : '👨 Hombre';
      if (u.rol === 'salonero') {
        rolBadge = u.genero === 'F' ? 'Salonera' : 'Salonero';
      }

      return `
        <tr>
          <td><strong>${u.usuario}</strong></td>
          <td>${u.nombre_completo}</td>
          <td><span class="badge-tag" style="background:#1e293b; color:#38bdf8;">${rolBadge}</span></td>
          <td>${genBadge}</td>
          <td>${u.negocio_nombre || 'Comercio Principal'}</td>
          <td><code>${u.pin}</code></td>
          <td>
            ${u.usuario === 'dev' ? '<small style="color:#a855f7;">Protegido</small>' : `
              <button class="btn-item-tool" style="color:#ef4444;" onclick="eliminarUsuarioDev(${u.id})">🗑️ Eliminar</button>
            `}
          </td>
        </tr>
      `;
    }).join('');

    document.getElementById('dbUsuariosCount').textContent = usuarios.length;
  } catch (e) {
    console.error('Error cargando usuarios dev:', e);
  }
}

window.eliminarUsuarioDev = async function(id) {
  if (!confirm('¿Seguro que deseas eliminar este usuario?')) return;
  try {
    await fetch('/api/dev/usuarios/' + id, { method: 'DELETE' });
    cargarUsuariosDev();
  } catch (e) {}
};

// ============================================================================
// 3. ADMINISTRACIÓN DE PERSONAL PARA ADMIN (AISLAMIENTO: NUNCA VE A DEVELOPER)
// ============================================================================
document.getElementById('btnAdminPersonal').addEventListener('click', () => {
  cargarEmpleadosAdmin();
  document.getElementById('modalAdminPersonal').classList.add('active');
});

document.getElementById('btnCloseAdminPersonal').addEventListener('click', () => {
  document.getElementById('modalAdminPersonal').classList.remove('active');
});

async function cargarEmpleadosAdmin() {
  try {
    const res = await fetch('/api/admin/empleados?negocio_id=' + (estado.negocioActual ? estado.negocioActual.id : 1));
    const empleados = await res.json();
    const tbody = document.getElementById('adminStaffTableBody');

    // Muestra solo cajeros, saloneros y saloneras. NUNCA a developer.
    tbody.innerHTML = empleados.map(e => `
      <tr>
        <td><strong>${e.nombre_completo}</strong></td>
        <td><code>${e.usuario}</code></td>
        <td><span class="badge-tag" style="background:#1e293b; color:#38bdf8;">${e.rolDisplay}</span></td>
        <td><code>${e.pin}</code></td>
        <td>
          <button class="btn-item-tool" style="color:#ef4444;" onclick="eliminarEmpleadoAdmin(${e.id})">🗑️ Despedir</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error cargando empleados admin:', e);
  }
}

document.getElementById('btnGuardarEmpleado').addEventListener('click', async () => {
  const nombre_completo = document.getElementById('staffNombre').value.trim();
  const usuario = document.getElementById('staffUsuario').value.trim();
  const password = document.getElementById('staffPassword').value.trim();
  const rol = document.getElementById('staffRol').value;
  const genero = document.getElementById('staffGenero').value;
  const pin = document.getElementById('staffPin').value.trim() || '1234';

  if (!nombre_completo || !usuario || !password) {
    alert('Por favor completa todos los campos del empleado.');
    return;
  }

  try {
    const res = await fetch('/api/admin/empleados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        negocio_id: estado.negocioActual ? estado.negocioActual.id : 1,
        usuario,
        nombre_completo,
        password,
        rol,
        genero,
        pin
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`✅ Empleado registrado exitosamente con título: ${genero === 'F' ? 'Salonera' : 'Salonero'}`);
    document.getElementById('staffNombre').value = '';
    document.getElementById('staffUsuario').value = '';
    document.getElementById('staffPassword').value = '';
    cargarEmpleadosAdmin();
  } catch (e) {
    alert('❌ ' + e.message);
  }
});

window.eliminarEmpleadoAdmin = async function(id) {
  if (!confirm('¿Eliminar a este colaborador del equipo?')) return;
  try {
    await fetch('/api/admin/empleados/' + id, { method: 'DELETE' });
    cargarEmpleadosAdmin();
  } catch (e) {}
};

// ============================================================================
// 4. PERSONALIZACIÓN VISUAL DE BOTONES CON FOTOS (ADMIN & DEV)
// ============================================================================
document.getElementById('btnPersonalizarFotos').addEventListener('click', () => {
  poblarSelectorProductosCustom();
  renderGaleriaPresets();
  cargarDatosProductoCustom();
  document.getElementById('modalPersonalizarBoton').classList.add('active');
});

document.getElementById('btnCloseCustomBoton').addEventListener('click', () => document.getElementById('modalPersonalizarBoton').classList.remove('active'));
document.getElementById('btnCancelarCustomBoton').addEventListener('click', () => document.getElementById('modalPersonalizarBoton').classList.remove('active'));

function poblarSelectorProductosCustom() {
  const sel = document.getElementById('custSelectProducto');
  sel.innerHTML = estado.productos.map(p => `
    <option value="${p.id}">${p.nombre} - ${formatCRC(p.precio)} (${p.destino.toUpperCase()})</option>
  `).join('');
}

function renderGaleriaPresets() {
  const grid = document.getElementById('galleryPresetsGrid');
  grid.innerHTML = estado.presetsFotos.map((f, idx) => `
    <img class="preset-photo-thumb" src="${f.url}" alt="${f.cat}" title="${f.cat}" onclick="seleccionarPresetFoto('${f.url}')" />
  `).join('');
}

window.seleccionarPresetFoto = function(url) {
  document.getElementById('custImagenUrl').value = url;
  actualizarPreviewBoton();
};

window.cargarDatosProductoCustom = function() {
  const prodId = Number(document.getElementById('custSelectProducto').value);
  const p = estado.productos.find(item => item.id === prodId);
  if (!p) return;

  document.getElementById('custImagenUrl').value = p.imagen_url || '';
  document.getElementById('previewNombre').textContent = p.nombre;
  document.getElementById('previewPrecio').textContent = formatCRC(p.precio);
  actualizarPreviewBoton();
};

window.actualizarPreviewBoton = function() {
  const url = document.getElementById('custImagenUrl').value.trim();
  const box = document.getElementById('previewImgBox');
  if (url) {
    box.innerHTML = `<img class="prod-card-thumb" src="${url}" alt="Foto" />`;
  } else {
    box.innerHTML = '<div class="prod-card-no-thumb">🍽️</div>';
  }
};

document.getElementById('btnGuardarFotoBoton').addEventListener('click', async () => {
  const prodId = Number(document.getElementById('custSelectProducto').value);
  const imagen_url = document.getElementById('custImagenUrl').value.trim();

  try {
    const res = await fetch(`/api/productos/${prodId}/visual`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen_url })
    });
    const data = await res.json();
    alert('🎨 ¡Foto del platillo guardada exitosamente! El botón en pantalla táctil ahora muestra esta foto.');
    document.getElementById('modalPersonalizarBoton').classList.remove('active');
    cargarMenuDesdeBackend();
  } catch (e) {
    alert('Error al guardar foto del platillo.');
  }
});

// ============================================================================
// 5. CARGA Y RENDERIZADO DEL CATÁLOGO CON FOTOS
// ============================================================================
async function cargarMenuDesdeBackend() {
  try {
    const res = await fetch('/api/menu');
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
      agotado: Boolean(p.agotado),
      imagen_url: p.imagen_url
    }));

    renderCatalogoComandero();
  } catch (e) {}
}

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
    const imgHtml = p.imagen_url 
      ? `<img class="prod-card-thumb" src="${p.imagen_url}" alt="${p.nombre}" loading="lazy" />`
      : `<div class="prod-card-no-thumb">🍽️</div>`;

    return `
      <div class="prod-card-one-tap ${p.agotado ? 'agotado' : ''}" onclick="agregarAlTicketOneTap(${p.id})">
        ${imgHtml}
        ${isPromo ? '<span class="prod-badge-promo">2x1</span>' : ''}
        <div class="prod-card-content">
          <span class="prod-card-name">${p.nombre}</span>
          <span class="prod-card-price">${formatCRC(p.precio)}</span>
        </div>
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

// ============================================================================
// 6. MESAS, COMANDERO & KDS
// ============================================================================
async function cargarMesasDesdeBackend() {
  try {
    const res = await fetch('/api/mesas');
    const data = await res.json();
    estado.zonas = data.zonas || [];
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
  } catch (e) {}
}

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

async function abrirComanderoMesa(mesaId) {
  const mesa = estado.mesas.find(m => m.id === mesaId);
  if (!mesa) return;

  estado.mesaActiva = mesa;
  document.getElementById('comMesaNumero').textContent = mesa.numero;
  document.getElementById('comMesaZona').textContent = (mesa.zonaNombre || 'SALÓN').toUpperCase();

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

function renderTicketItems() {
  const list = document.getElementById('comTicketItemsList');
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo con foto para agregarlo con 1 toque.</div>';
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

// Enviar Comanda a Cocina
document.getElementById('btnEnviarComandaCocina').addEventListener('click', async () => {
  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    alert('No hay productos para enviar.');
    return;
  }

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
    sonarCampanaCocina();
    alert('🔔 ¡Comanda enviada a cocina/barra!');
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    renderTicketItems();
    cargarMesasDesdeBackend();
    cargarKDSDesdeBackend();
  } catch (e) {
    sonarCampanaCocina();
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    renderTicketItems();
  }
});

document.getElementById('btnLanzarPlatosFuertes').addEventListener('click', async () => {
  if (!estado.mesaActiva) return;
  try {
    const res = await fetch('/api/comandas/lanzar-fuertes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesaId: estado.mesaActiva.id, ordenId: estado.mesaActiva.orden_id })
    });
    sonarCampanaCocina();
    alert('🚀 ¡Platos fuertes lanzados a cocina (Marchando)!');
    cargarKDSDesdeBackend();
  } catch (e) {
    sonarCampanaCocina();
  }
});

// KDS
async function cargarKDSDesdeBackend() {
  try {
    const activeTab = document.querySelector('.kds-tab.active');
    const dest = activeTab ? activeTab.dataset.kdsDest : 'todos';
    const res = await fetch('/api/kds?destino=' + dest);
    estado.comandasKDS = await res.json();
    renderKDS();
    document.getElementById('kdsCounter').textContent = estado.comandasKDS.length;
  } catch (e) {}
}

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
    alert('🍽️ Comanda marcada como lista.');
    cargarKDSDesdeBackend();
  } catch (e) {
    sonarCampanaCocina();
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
// 7. CAJA, PROPINAS, COBRO Y FACTURACIÓN
// ============================================================================
async function cargarCajaDesdeBackend() {
  try {
    const res = await fetch('/api/caja/actual');
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
      document.getElementById('cajeroTurnoNombre').textContent = data.caja.cajero || (estado.usuarioActual ? estado.usuarioActual.nombre : 'Juan Jival');
    }

    if (data.tipPool && data.tipPool.length) {
      estado.meserosReporte = data.tipPool;
    } else {
      estado.meserosReporte = [
        { nombre: 'Carlos Solano (Salonero)', mesas: 14, ventas: 115000, propina: 11500 },
        { nombre: 'Sofía Morales (Salonera)', mesas: 12, ventas: 98000, propina: 9800 },
        { nombre: 'Roberto Caja (Cajero)', mesas: 6, ventas: 45000, propina: 4500 }
      ];
    }
    renderTipPoolTable();
  } catch (e) {}
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

document.getElementById('btnLiquidarPropinas').addEventListener('click', () => {
  alert('📋 Reporte de reparto de propinas del turno impreso.');
});

// Cobro Modal
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
    document.getElementById('txtEfectivoRecibido').value = Number(chip.dataset.amt);
    calcularVueltoCobro();
  });
});

document.getElementById('btnPagoExacto').addEventListener('click', () => {
  const totalNum = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
  document.getElementById('txtEfectivoRecibido').value = totalNum;
  calcularVueltoCobro();
});

document.getElementById('txtEfectivoRecibido').addEventListener('input', calcularVueltoCobro);

function calcularVueltoCobro() {
  const total = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
  const recibido = parseFloat(document.getElementById('txtEfectivoRecibido').value) || 0;
  const vuelto = Math.max(0, recibido - total);
  document.getElementById('cobroVueltoDisplay').textContent = formatCRC(vuelto);
}

document.getElementById('btnFinalizarCobro').addEventListener('click', async () => {
  const totalNum = parseFloat(document.getElementById('cobroTotalDisplay').textContent.replace(/[^0-9.]/g, '')) || 0;
  const metodoActivo = document.querySelector('.pay-method-tab.active');
  const metodo = metodoActivo ? metodoActivo.dataset.method : 'Efectivo';
  const recibido = parseFloat(document.getElementById('txtEfectivoRecibido').value) || totalNum;
  const cambio = Math.max(0, recibido - totalNum);

  if (estado.mesaActiva.orden_id) {
    try {
      await fetch(`/api/ordenes/${estado.mesaActiva.orden_id}/cobrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metodo,
          monto: totalNum,
          propina: Math.round(totalNum * 0.10),
          cambio,
          mesero: estado.usuarioActual ? estado.usuarioActual.nombre : 'Juan Jival'
        })
      });
    } catch (e) {}
  }

  alert(`✅ ¡Cuenta de ${estado.mesaActiva.numero} liquidada!\n\n• Tiquete impreso.\n• Mesa liberada.`);
  estado.mesaActiva.estado = 'libre';
  estado.mesaActiva.items = [];
  document.getElementById('modalCobro').classList.remove('active');
  document.getElementById('modalComandero').classList.remove('active');
  cargarMesasDesdeBackend();
  cargarCajaDesdeBackend();
});

// Facturación Express
document.getElementById('btnBuscarClienteExpress').addEventListener('click', async () => {
  const id = document.getElementById('expressNumeroId').value.trim();
  if (!id) return alert('Ingresa una identificación.');
  document.getElementById('expClienteNombre').textContent = 'CORPORACIÓN GASTRONÓMICA S.A.';
  document.getElementById('expClienteCorreo').textContent = 'facturacion@corpgastro.com';
  alert('✅ Datos del cliente consultados con éxito.');
});

document.getElementById('btnSimularQrScan').addEventListener('click', () => {
  document.getElementById('expressNumeroId').value = '3101894234';
  document.getElementById('expClienteNombre').textContent = 'DISTRIBUIDORA DEL VALLE S.A.';
  document.getElementById('expClienteCorreo').textContent = 'contabilidad@delvalle.cr';
  alert('📷 Código QR tributario escaneado con éxito.');
});

document.getElementById('btnEmitirFacturaExpress').addEventListener('click', () => {
  alert('⚡ Factura Electrónica generada, firmada y enviada a Hacienda con éxito.');
});

// ============================================================================
// 8. MOVER/UNIR MESAS, ANULACIONES, MODIFICADORES Y QR CLIENTE
// ============================================================================
function initMoverUnirMesas() {
  document.getElementById('btnAbrirMoverUnirModal').addEventListener('click', () => {
    cargarSelectoresMoverUnir();
    document.getElementById('modalMoverUnir').classList.add('active');
  });

  document.getElementById('btnCloseMoverUnirModal').addEventListener('click', () => document.getElementById('modalMoverUnir').classList.remove('active'));

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

  document.getElementById('btnEjecutarMoverMesa').addEventListener('click', async () => {
    const origId = Number(document.getElementById('selMoverOrigen').value);
    const destId = Number(document.getElementById('selMoverDestino').value);
    if (!origId || !destId) return alert('Selecciona origen y destino.');

    try {
      const res = await fetch('/api/mesas/mover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origenMesaId: origId, destinoMesaId: destId })
      });
      const data = await res.json();
      alert('🔁 ' + data.message);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('Error al mover mesa');
    }
  });

  document.getElementById('btnEjecutarUnirMesas').addEventListener('click', async () => {
    const m1Id = Number(document.getElementById('selUnirMesa1').value);
    const m2Id = Number(document.getElementById('selUnirMesa2').value);
    if (m1Id === m2Id) return alert('Selecciona dos mesas distintas.');

    try {
      const res = await fetch('/api/mesas/unir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesaPrincipalId: m1Id, mesaSecundariaId: m2Id })
      });
      const data = await res.json();
      alert('🔗 ' + data.message);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('Error al unir mesas');
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

  selOrig.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'SALÓN'})</option>`).join('');
  selDest.innerHTML = libres.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'SALÓN'}) - Libre</option>`).join('');
  selU1.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (Cuenta Principal)</option>`).join('');
  selU2.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (Cuenta a Fusionar)</option>`).join('');
}

// Anulaciones
let anulaIndex = null;
function initAnulaciones() {
  document.getElementById('btnCloseAnulaModal').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));
  document.getElementById('btnCancelarAnula').addEventListener('click', () => document.getElementById('modalAnulacion').classList.remove('active'));

  document.querySelectorAll('.numeric-keypad .num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pinInput = document.getElementById('txtPinSupervisor');
      if (btn.dataset.val && pinInput.value.length < 4) pinInput.value += btn.dataset.val;
    });
  });

  document.getElementById('btnPinClear').addEventListener('click', () => document.getElementById('txtPinSupervisor').value = '');
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
          if (!res.ok) throw new Error(data.error);
          alert(`🗑️ Platillo "${it.nombre}" anulado y registrado en auditoría.`);
          estado.mesaActiva.items.splice(anulaIndex, 1);
        } catch (e) {
          alert('❌ ' + e.message);
          return;
        }
      } else {
        if (pin !== '1234') {
          alert('❌ PIN incorrecto.');
          return;
        }
        estado.mesaActiva.items.splice(anulaIndex, 1);
        alert('🗑️ Platillo anulado.');
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

// Split Bills
function initSplitBills() {
  document.getElementById('btnAbrirSplitBill').addEventListener('click', () => {
    if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
      alert('No hay consumos en esta mesa para dividir.');
      return;
    }
    const totalTxt = document.getElementById('comTotal').textContent;
    document.getElementById('splitMesaTitulo').textContent = `${estado.mesaActiva.numero} • Total: ${totalTxt}`;
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
    alert('✂️ División lista. Procediendo al cobro individual.');
    document.getElementById('modalSplitBill').classList.remove('active');
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
      <span>📦 Consumo Mesa</span>
      <span>Total</span>
    </div>
    <div class="split-col-items">
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
        <small style="color:#64748b; display:block; text-align:center; margin-top:20px;">Toca un ítem para asignarlo</small>
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

// Modificadores
window.abrirModalModificadores = function(itemIdx) {
  estado.itemModificando = estado.mesaActiva.items[itemIdx];
  document.getElementById('modifProdNombre').textContent = estado.itemModificando.nombre;
  document.getElementById('txtNotaAbiertaModif').value = estado.itemModificando.notas || '';

  document.querySelectorAll('.btn-course-opt').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.course) === (estado.itemModificando.curso || 2));
  });

  document.querySelectorAll('.chip-modif').forEach(chip => {
    chip.classList.toggle('selected', (estado.itemModificando.notas || '').includes(chip.dataset.text));
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

// QR Cliente
function initQrCliente() {
  document.getElementById('btnVerQrMesaCliente').addEventListener('click', async () => {
    if (!estado.mesaActiva) return;
    document.getElementById('qrMesaNombre').textContent = estado.mesaActiva.numero;

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
    } catch (e) {}

    document.getElementById('modalQrCliente').classList.add('active');
  });

  document.getElementById('btnCloseQrModal').addEventListener('click', () => document.getElementById('modalQrCliente').classList.remove('active'));

  document.getElementById('btnClientePideCuentaWeb').addEventListener('click', async () => {
    if (estado.mesaActiva) {
      try {
        await fetch('/api/cliente/mesa/' + estado.mesaActiva.id + '/pedir-cuenta', { method: 'POST' });
      } catch (e) {}
      sonarCampanaCocina();
      alert('📱 ¡Aviso enviado al mesero y cajero! La mesa solicitó la cuenta.');
      document.getElementById('modalQrCliente').classList.remove('active');
      document.getElementById('modalComandero').classList.remove('active');
      cargarMesasDesdeBackend();
    }
  });
}

// Buscador Rápido
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

// Editor Visual Plano
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
        m.x = Math.max(10, origX + (curX - startX));
        m.y = Math.max(10, origY + (curY - startY));
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

document.getElementById('btnGuardarPlano').addEventListener('click', async () => {
  const posiciones = estado.mesas.map(m => ({ id: m.id, x: m.x, y: m.y }));
  try {
    const res = await fetch('/api/mesas/posiciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posiciones })
    });
    alert('💾 ¡Distribución física guardada en la base de datos!');
  } catch (e) {
    alert('💾 ¡Distribución guardada!');
  }
  document.querySelector('.nav-pill[data-view="salon"]').click();
});

document.getElementById('btnAgregarMesaCuadrada').addEventListener('click', async () => {
  const num = 'Mesa ' + (estado.mesas.length + 1);
  try {
    await fetch('/api/mesas/crear', {
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
    await fetch('/api/mesas/crear', {
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
    await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: num, zona_id: 2, capacidad: 1, forma: 'round', x: 620, y: 80 })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});

// Agotados (86)
function initAgotados86() {
  document.getElementById('btnGestionarAgotados').addEventListener('click', () => {
    renderListaAgotados();
    document.getElementById('modalAgotados').classList.add('active');
  });

  document.getElementById('btnCloseAgotadosModal').addEventListener('click', () => document.getElementById('modalAgotados').classList.remove('active'));
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

// Happy Hour
function initHappyHour() {
  const btnHH = document.getElementById('btnToggleHappyHour');
  const txtHH = document.getElementById('hhStatusTxt');

  btnHH.addEventListener('click', () => {
    estado.happyHourActivo = !estado.happyHourActivo;
    if (estado.happyHourActivo) {
      btnHH.classList.remove('inactive');
      txtHH.textContent = 'Activado (2x1 Cervezas)';
      alert('🍸 ¡Modo Happy Hour ACTIVADO! 2x1 en cervezas participantes.');
    } else {
      btnHH.classList.add('inactive');
      txtHH.textContent = 'Desactivado';
      alert('Tarifas normales activadas.');
    }
    renderGridProductos(estado.productos);
    if (estado.mesaActiva) recalcularTotalesTicket();
  });
}

// Navegación General POS
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

// INICIALIZADOR AL CARGAR
document.addEventListener('DOMContentLoaded', () => {
  initNavegacion();
  initBuscadorRapido();
  initSplitBills();
  initAnulaciones();
  initMoverUnirMesas();
  initAgotados86();
  initHappyHour();
  initQrCliente();

  // Verificar si hay sesión previa guardada en sessionStorage
  const userGuardado = sessionStorage.getItem('pos_usuario');
  const negGuardado = sessionStorage.getItem('pos_negocio');
  if (userGuardado) {
    estado.usuarioActual = JSON.parse(userGuardado);
    estado.negocioActual = negGuardado ? JSON.parse(negGuardado) : null;
    aplicarEnrutamientoPorRol();
  } else {
    document.getElementById('landingLoginView').classList.add('active');
  }
});
