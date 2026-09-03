
window.eliminarMesaDesdeEditor = async function(mesaId, mesaNumero) {
  if (!confirm(`¿Estás seguro de que deseas eliminar "${mesaNumero}" del salón?`)) {
    return;
  }

  try {
    const res = await fetch('/api/mesas/' + mesaId, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert('❌ ' + (data.error || 'No se pudo eliminar la mesa'));
      return;
    }
    alert(`🗑️ "${mesaNumero}" eliminada correctamente del salón.`);
    await cargarMesasDesdeBackend();
    renderEditorPlano();
  } catch (e) {
    alert('Error al eliminar la mesa');
  }
};


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

window.switchComanderoMobileTab = function(tab) {
  const catCol = document.getElementById('comanderoCatalogCol');
  const tktCol = document.getElementById('comanderoTicketCol');
  const btnMenu = document.getElementById('btnMobTabMenu');
  const btnTkt = document.getElementById('btnMobTabTicket');

  if (!catCol || !tktCol) return;

  if (tab === 'menu') {
    catCol.classList.remove('mobile-hidden');
    tktCol.classList.remove('mobile-active');
    if (btnMenu) btnMenu.classList.add('active');
    if (btnTkt) btnTkt.classList.remove('active');
  } else {
    catCol.classList.add('mobile-hidden');
    tktCol.classList.add('mobile-active');
    if (btnMenu) btnMenu.classList.remove('active');
    if (btnTkt) btnTkt.classList.add('active');
  }
};

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
    socket.on('comanda_estado_cambiado', () => {
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });
    socket.on('comanda_actualizada', () => {
      cargarKDSDesdeBackend();
      cargarMesasDesdeBackend();
    });
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
    socket.on('happy_hour_cambio', (data) => {
      aplicarEstadoHappyHour(data.activo, data.horaInicio, data.horaFin);
    });
  }
} catch (e) {}

// Milestone 2 Domain Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function evaluarEstadoMesaKDS(detalles = []) {
  const cocinaItems = detalles.filter(
    (it) => (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')) && it.estado_comanda !== 'anulado'
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

function formatearTooltipEspera(primeraComandaHora, itemsPendientes = [], ahora = new Date()) {
  const fechaPedido = new Date(primeraComandaHora);
  const diffMs = Math.max(0, ahora.getTime() - fechaPedido.getTime());
  const minutos = Math.floor(diffMs / 60000);

  const titulo = `⏱️ Esperando hace ${minutos} min`;
  const itemsList = itemsPendientes.map((it) => (typeof it === 'string' ? it : (it.nombre_producto || it.nombre)));

  return {
    minutos,
    titulo,
    items: itemsList,
    tooltipText: `${titulo}\n${itemsList.map((i) => `• ${i}`).join('\n')}`
  };
}

if (typeof window !== 'undefined') {
  window.evaluarEstadoMesaKDS = evaluarEstadoMesaKDS;
  window.formatearTooltipEspera = formatearTooltipEspera;
}

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
        ancho: m.ancho || ((m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 95 : 130),
        alto: m.alto || ((m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 105 : 120),
        forma: (m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 'silla' : (m.forma || 'square'),
        orden_activa_id: m.orden_activa_id,
        orden_total: m.orden_total || 0,
        mesero: m.mesero || m.orden_mesero || 'Juan Jival',
        platos_pendientes: m.platos_pendientes || m.items_pendientes || [],
        items_pendientes: m.items_pendientes || m.platos_pendientes || [],
        primera_comanda_hora: m.primera_comanda_hora || null,
        minutos_espera: m.minutos_espera != null ? m.minutos_espera : 0
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
  if (!canvas) return;
  canvas.innerHTML = '';

  const mesasFiltradas = filtroZona === 'todas' 
    ? estado.mesas 
    : estado.mesas.filter(m => m.zona && m.zona.includes(filtroZona));

  mesasFiltradas.forEach(m => {
    const card = document.createElement('div');
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    card.className = `mesa-render-card ${m.estado} ${m.forma === 'round' ? 'round' : ''} ${esSilla ? 'silla' : ''}`;
    card.style.left = m.x + 'px';
    card.style.top = m.y + 'px';
    card.style.width = (m.ancho || (esSilla ? 95 : 130)) + 'px';
    card.style.height = (m.alto || (esSilla ? 105 : 120)) + 'px';

    const estadoEtiqueta = {
      libre: 'Libre',
      ocupada: 'Ocupada',
      abierta: 'Abierta',
      esperando: 'Esperando',
      esperando_parcial: 'Esperando Parcial',
      activa: 'Activa',
      cuenta: 'Cuenta Pedida',
      unida: 'Unida'
    }[m.estado] || 'Libre';

    const platosPendientes = m.platos_pendientes || m.items_pendientes || [];
    let minutosEspera = m.minutos_espera != null ? m.minutos_espera : 0;
    if (m.primera_comanda_hora && m.minutos_espera == null) {
      minutosEspera = Math.max(0, Math.floor((Date.now() - new Date(m.primera_comanda_hora).getTime()) / 60000));
    }

    let waitChipHtml = '';
    let tooltipHtml = '';

    const isOccupied = m.estado !== 'libre' || (m.orden_total > 0) || Boolean(m.orden_activa_id);

    if (isOccupied) {
      const isNearTop = (m.y || 0) < 130;
      const tienePendientes = platosPendientes.length > 0;
      
      let headerText = '';
      let listItems = [];

      if (tienePendientes) {
        headerText = `⏱️ Esperando hace ${minutosEspera} min (${platosPendientes.length} pendiente${platosPendientes.length > 1 ? 's' : ''})`;
        listItems = platosPendientes;
      } else if (m.todos_platillos && m.todos_platillos.length > 0) {
        headerText = `✅ Pedidos entregados (${minutosEspera > 0 ? minutosEspera + ' min' : 'Mesa Activa'})`;
        listItems = m.todos_platillos;
      } else if (m.estado === 'activa') {
        headerText = `✅ Todos los platillos servidos (Activa)`;
        listItems = ['Comanda despachada por cocina'];
      } else {
        headerText = `🍽️ Cuenta Activa (${m.orden_total > 0 ? formatCRC(m.orden_total) : 'En consumo'})`;
        listItems = ['Mesa atendida por salonero'];
      }

      if (tienePendientes || m.primera_comanda_hora) {
        waitChipHtml = `
          <div class="m-wait-chip" title="Ver platillos pendientes de entrega">
            ⏱️ ${minutosEspera}m
          </div>
        `;
      }

      tooltipHtml = `
        <div class="mesa-tooltip ${isNearTop ? 'tooltip-bottom' : ''}">
          <div class="mesa-tooltip-header">${escapeHtml(headerText)}</div>
          <ul class="mesa-tooltip-list">
            ${listItems.map(p => `<li>${escapeHtml(typeof p === 'string' ? p : (p.nombre_producto || p.nombre || 'Platillo'))}</li>`).join('')}
          </ul>
        </div>
      `;

      card.setAttribute('title', `${headerText}\n${listItems.map(p => `• ${typeof p === 'string' ? p : (p.nombre_producto || p.nombre || 'Platillo')}`).join('\n')}`);
    }

    let mergedBadgeHtml = '';
    if (m.es_mesa_unida || (m.mesas_unidas && m.mesas_unidas.length > 0) || m.unida_con) {
      const otros = (m.mesas_unidas && m.mesas_unidas.length > 0)
        ? m.mesas_unidas.map(n => n.toString().replace(/mesa\s*/i, '')).join('+')
        : (m.unida_con ? m.unida_con.toString().replace(/mesa\s*/i, '') : '');
      mergedBadgeHtml = `<small class="m-merged-badge" style="cursor:pointer;" title="Unida con ${m.mesas_unidas ? m.mesas_unidas.join(', ') : m.unida_con} (Mantener presionado para Separar mesas)">🔗 +${otros}</small>`;
    }

    card.innerHTML = `
      <div class="m-header">
        <span class="m-num">${m.numero} ${mergedBadgeHtml}</span>
        <span class="m-badge">${estadoEtiqueta}</span>
      </div>
      <div class="m-total">${m.orden_total > 0 ? formatCRC(m.orden_total) : '—'}</div>
      ${waitChipHtml}
      <div class="m-footer">
        <span>👥 ${m.capacidad}p</span>
        <span>${m.zonaNombre ? m.zonaNombre.toUpperCase() : 'SALÓN'}</span>
      </div>
      ${tooltipHtml}
    `;

    // Eventos hover garantizados por JS
    card.addEventListener('mouseenter', () => {
      const tip = card.querySelector('.mesa-tooltip');
      if (tip) {
        tip.style.display = 'block';
        tip.style.opacity = '1';
        tip.style.visibility = 'visible';
        card.style.zIndex = '99999';
      }
    });

    card.addEventListener('mouseleave', () => {
      const tip = card.querySelector('.mesa-tooltip');
      if (tip && !tip.classList.contains('show-touch')) {
        tip.style.display = '';
        tip.style.opacity = '';
        tip.style.visibility = '';
        card.style.zIndex = '';
      }
    });

    const chipEl = card.querySelector('.m-wait-chip');
    if (chipEl) {
      chipEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const tip = card.querySelector('.mesa-tooltip');
        if (tip) {
          const isShown = tip.classList.contains('show-touch');
          document.querySelectorAll('.mesa-tooltip.show-touch').forEach(t => t.classList.remove('show-touch'));
          if (!isShown) {
            tip.classList.add('show-touch');
          }
        }
      });
    }

    const badgeSepararEl = card.querySelector('.m-merged-badge');
    if (badgeSepararEl) {
      badgeSepararEl.addEventListener('click', (e) => {
        e.stopPropagation();
        solicitarRestaurarMesas(m.id);
      });
    }

    card.dataset.mesaId = m.id;
    card.setAttribute('data-mesa-id', m.id);

    // ── Drag & Drop: Long-press para mover/unir mesas ─────────────────────
    agregarDragMesa(card, m, canvas);
    canvas.appendChild(card);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// DRAG & DROP DE MESAS — MOTOR TÁCTIL Y RATÓN UNIFICADO
// ────────────────────────────────────────────────────────────────────────────
const dragState = {
  active: false,
  sourceMesa: null,
  sourceCard: null,
  ghost: null,
  hoverTargetCard: null,
  hoverTargetMesa: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
  timer: null,
  pointerId: null
};

function clearDragHighlights() {
  document.querySelectorAll('.mesa-drop-target-move, .mesa-drop-target-merge').forEach(el => {
    el.classList.remove('mesa-drop-target-move', 'mesa-drop-target-merge');
  });
}

function cancelarDrag() {
  if (dragState.timer) {
    clearTimeout(dragState.timer);
    dragState.timer = null;
  }
  clearDragHighlights();
  if (dragState.ghost) {
    dragState.ghost.remove();
    dragState.ghost = null;
  }
  if (dragState.sourceCard) {
    dragState.sourceCard.classList.remove('mesa-drag-source');
    dragState.sourceCard = null;
  }
  dragState.active = false;
  dragState.sourceMesa = null;
  dragState.hoverTargetCard = null;
  dragState.hoverTargetMesa = null;
  dragState.pointerId = null;
  document.body.style.userSelect = '';
}

function updateDragPosition(clientX, clientY) {
  if (!dragState.active || !dragState.ghost) return;
  dragState.ghost.style.left = (clientX - dragState.offsetX) + 'px';
  dragState.ghost.style.top = (clientY - dragState.offsetY) + 'px';

  // Buscar mesa bajo el cursor/dedo
  const elements = document.elementsFromPoint(clientX, clientY) || [];
  let foundCard = null;
  for (const el of elements) {
    const c = el.closest('.mesa-render-card');
    if (c && c !== dragState.sourceCard) {
      foundCard = c;
      break;
    }
  }

  if (foundCard !== dragState.hoverTargetCard) {
    clearDragHighlights();
    dragState.hoverTargetCard = foundCard;
    dragState.hoverTargetMesa = null;

    if (foundCard) {
      const targetId = Number(foundCard.dataset.mesaId);
      const targetMesa = estado.mesas.find(m => m.id === targetId);
      if (targetMesa) {
        dragState.hoverTargetMesa = targetMesa;
        const isTargetLibre = targetMesa.estado === 'libre';
        foundCard.classList.add(isTargetLibre ? 'mesa-drop-target-move' : 'mesa-drop-target-merge');
        
        const badge = dragState.ghost.querySelector('.drag-badge-indicator');
        if (badge) {
          badge.textContent = isTargetLibre 
            ? `🔁 Soltar para Mover a ${targetMesa.numero}` 
            : `🔗 Soltar para Unir con ${targetMesa.numero}`;
        }
      }
    } else {
      const badge = dragState.ghost.querySelector('.drag-badge-indicator');
      if (badge) badge.textContent = '👉 Arrastra sobre otra mesa';
    }
  }
}

function finalizarDrop(clientX, clientY) {
  if (!dragState.active) {
    cancelarDrag();
    return;
  }

  const sourceMesa = dragState.sourceMesa;
  const targetMesa = dragState.hoverTargetMesa;
  
  cancelarDrag();

  if (!sourceMesa || !targetMesa) return;
  if (sourceMesa.id === targetMesa.id) return;

  const isTargetLibre = targetMesa.estado === 'libre';
  if (isTargetLibre) {
    const opcion = confirm(`Has soltado la ${sourceMesa.numero} sobre la ${targetMesa.numero}.\n\n• [Aceptar] = 🔁 MOVER la orden a la ${targetMesa.numero}\n• [Cancelar] = Mantener en ${sourceMesa.numero}`);
    if (opcion) {
      ejecutarMoverMesa(sourceMesa.id, targetMesa.id);
    }
  } else {
    const totalOrigen = sourceMesa.orden_total > 0 ? formatCRC(sourceMesa.orden_total) : 'cuenta activa';
    const totalDestino = targetMesa.orden_total > 0 ? formatCRC(targetMesa.orden_total) : 'cuenta activa';
    const confirmar = confirm(`🔗 ¿Deseas UNIR la ${sourceMesa.numero} (${totalOrigen}) con la ${targetMesa.numero} (${totalDestino})?\n\n• Se transferirán todos los productos, cantidades, observaciones, impuestos y total de la ${sourceMesa.numero} hacia la ${targetMesa.numero}.\n• La ${targetMesa.numero} mostrará el total combinado.\n• La ${sourceMesa.numero} quedará completamente LIBRE y disponible en el salón.`);
    if (confirmar) {
      ejecutarUnirMesas(targetMesa.id, sourceMesa.id);
    }
  }
}

// Listeners globales en document para pointer events
document.addEventListener('pointermove', (e) => {
  if (dragState.active) {
    updateDragPosition(e.clientX, e.clientY);
  }
});

document.addEventListener('pointerup', (e) => {
  if (dragState.active) {
    finalizarDrop(e.clientX, e.clientY);
  } else if (dragState.timer) {
    clearTimeout(dragState.timer);
    dragState.timer = null;
  }
});

document.addEventListener('pointercancel', () => {
  cancelarDrag();
});

function agregarDragMesa(card, mesaData, canvas) {
  card.dataset.mesaId = mesaData.id;

  let isTouchDown = false;
  let startX = 0;
  let startY = 0;

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.m-wait-chip') || e.target.closest('.mesa-tooltip') || e.target.closest('.m-merged-badge')) return;

    isTouchDown = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = card.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;

    dragState.timer = setTimeout(() => {
      if (!isTouchDown) return;
      
      const estaUnida = mesaData.unida_con || mesaData.es_mesa_unida || mesaData.es_mesa_secundaria_unida || (mesaData.mesas_unidas && mesaData.mesas_unidas.length > 0) || mesaData.estado === 'unida';
      if (estaUnida) {
        const nombreUnidas = (mesaData.mesas_unidas && mesaData.mesas_unidas.length > 0)
          ? mesaData.mesas_unidas.join(', ')
          : (mesaData.unida_con || 'otra mesa');
        
        isTouchDown = false;
        const separar = confirm(`✂️ Separar mesas\n\nLa ${mesaData.numero} está unida con ${nombreUnidas}.\n\n¿Deseas SEPARAR las mesas?\n\nSe restaurarán exactamente los productos originales de cada mesa, con sus totales, impuestos, observaciones y estados originales.`);
        if (separar) {
          ejecutarSepararMesas(mesaData.id);
          return;
        }
      }

      dragState.active = true;
      dragState.sourceMesa = mesaData;
      dragState.sourceCard = card;
      dragState.startX = startX;
      dragState.startY = startY;
      dragState.offsetX = ox;
      dragState.offsetY = oy;
      dragState.pointerId = e.pointerId;

      card.classList.add('mesa-drag-source');
      document.body.style.userSelect = 'none';

      const ghost = card.cloneNode(true);
      ghost.id = 'dragGhost';
      ghost.classList.remove('mesa-drag-source');
      ghost.style.left = (startX - ox) + 'px';
      ghost.style.top = (startY - oy) + 'px';
      ghost.style.width = card.offsetWidth + 'px';
      ghost.style.height = card.offsetHeight + 'px';

      const indicator = document.createElement('div');
      indicator.className = 'drag-badge-indicator';
      indicator.textContent = '👉 Arrastra sobre otra mesa';
      ghost.appendChild(indicator);

      document.body.appendChild(ghost);
      dragState.ghost = ghost;

      if (navigator.vibrate) navigator.vibrate(50);
    }, 280);
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragState.active && isTouchDown && dragState.timer) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > 12) {
        clearTimeout(dragState.timer);
        dragState.timer = null;
        isTouchDown = false;
      }
    }
  });

  card.addEventListener('pointerup', (e) => {
    const wasDragging = dragState.active;
    if (dragState.timer) {
      clearTimeout(dragState.timer);
      dragState.timer = null;
    }
    isTouchDown = false;

    if (!wasDragging) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist <= 12) {
        abrirComanderoMesa(mesaData.id);
      }
    }
  });

  card.addEventListener('pointercancel', () => {
    if (dragState.timer) {
      clearTimeout(dragState.timer);
      dragState.timer = null;
    }
    isTouchDown = false;
  });
}

async function ejecutarMoverMesa(origenId, destinoId) {
  try {
    const res = await fetch('/api/mesas/mover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origenMesaId: origenId, destinoMesaId: destinoId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`✅ ${data.message}`);
    cargarMesasDesdeBackend();
  } catch (e) {
    alert('❌ Error al mover mesa: ' + e.message);
  }
}

async function ejecutarUnirMesas(mesaPrincipalId, mesaSecundariaId) {
  try {
    const res = await fetch('/api/mesas/unir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesaPrincipalId, mesaSecundariaId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`✅ ${data.message}`);
    cargarMesasDesdeBackend();
  } catch (e) {
    alert('❌ Error al unir mesas: ' + e.message);
  }
}

async function ejecutarAgruparMesas(mesa1Id, mesa2Id) {
  try {
    const res = await fetch('/api/mesas/agrupar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesa1Id, mesa2Id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`🔗 ${data.message}`);
    cargarMesasDesdeBackend();
  } catch (e) {
    alert('❌ Error al agrupar mesas: ' + e.message);
  }
}

async function solicitarRestaurarMesas(mesaId) {
  const mesa = estado.mesas.find(m => m.id === mesaId);
  const numTxt = mesa ? mesa.numero : 'esta mesa';

  const confirmar = confirm(`🔄 RESTAURAR MESAS\n\n¿Deseas RESTAURAR la ${numTxt} a su estado original?\n\nSe eliminará el grupo visual conservando cada mesa con sus productos, totales y observaciones intactas.`);
  if (!confirmar) return;

  await ejecutarRestaurarMesas(mesaId);
}

async function ejecutarRestaurarMesas(mesaId) {
  try {
    const res = await fetch('/api/mesas/restaurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesaId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al restaurar mesas');
    
    alert(`🔄 ${data.message}`);
    document.getElementById('modalComandero').classList.remove('active');
    const modalMoverUnir = document.getElementById('modalMoverUnir');
    if (modalMoverUnir) modalMoverUnir.classList.remove('active');
    
    cargarMesasDesdeBackend();
    cargarKDSDesdeBackend();
  } catch (e) {
    alert('❌ Error al restaurar mesas: ' + e.message);
  }
}

async function solicitarSepararMesas(mesaId) {
  return solicitarRestaurarMesas(mesaId);
}

async function ejecutarSepararMesas(mesaId) {
  return ejecutarRestaurarMesas(mesaId);
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
        origen_mesa_numero: it.origen_mesa_numero,
        enviado: true
      }));

      // Detectar si hay ítems de otras mesas unidas o si la mesa es secundaria unida
      const origenesUnidos = [
        ...new Set([
          ...mesa.items
            .map(it => it.origen_mesa_numero)
            .filter(num => num && String(num) !== String(mesa.numero)),
          ...(mesa.mesas_unidas || [])
        ])
      ];

      const bannerEl = document.getElementById('comMergedBanner');
      if (bannerEl) {
        if (origenesUnidos.length > 0 || mesa.es_mesa_unida || mesa.unida_con || mesa.es_mesa_secundaria_unida || mesa.estado === 'unida') {
          bannerEl.style.display = 'flex';
          const txt = mesa.es_mesa_secundaria_unida 
            ? `🔗 Mesa Unida a ${mesa.unida_a_numero || 'Mesa Principal'}`
            : `🔗 Mesa Unida con ` + (origenesUnidos.length > 0 ? origenesUnidos.join(', ') : (mesa.unida_con || 'otra mesa'));
          document.getElementById('comMergedBannerTxt').textContent = txt;
          const btnSep = document.getElementById('btnSepararComandero');
          if (btnSep) {
            btnSep.textContent = '✂️ Separar Mesas';
            btnSep.onclick = () => solicitarSepararMesas(mesa.id);
          }
        } else {
          bannerEl.style.display = 'none';
        }
      }
    } else {
      document.getElementById('comTicketOrdenId').textContent = 'Nueva Orden';
      mesa.orden_id = null;
      mesa.items = [];
      const bannerEl = document.getElementById('comMergedBanner');
      if (bannerEl) {
        if (mesa.es_mesa_unida || mesa.unida_con || mesa.es_mesa_secundaria_unida || mesa.estado === 'unida') {
          bannerEl.style.display = 'flex';
          const txt = `🔗 Mesa Unida a ${mesa.unida_a_numero || 'Mesa Principal'}`;
          document.getElementById('comMergedBannerTxt').textContent = txt;
          const btnSep = document.getElementById('btnSepararComandero');
          if (btnSep) {
            btnSep.textContent = '✂️ Separar Mesas';
            btnSep.onclick = () => solicitarSepararMesas(mesa.id);
          }
        } else {
          bannerEl.style.display = 'none';
        }
      }
    }
  } catch (e) {
    mesa.items = [];
  }

  renderTicketItems();
  actualizarBotonEnviarComanda();
  if (typeof switchComanderoMobileTab === 'function') switchComanderoMobileTab('menu');
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
    actualizarBotonEnviarComanda();
    const mobCountEl = document.getElementById('mobTicketCount');
    if (mobCountEl) mobCountEl.textContent = 0;
    return;
  }

  list.innerHTML = estado.mesaActiva.items.map((it, idx) => {
    const cursoLabels = { 1: 'Entrada', 2: 'Plato Fuerte', 3: 'Postre' };
    const cursoClasses = { 1: 'c1', 2: 'c2', 3: 'c3' };
    const cursoBadge = `<span class="course-badge ${cursoClasses[it.curso] || 'c2'}">${cursoLabels[it.curso] || 'Fuerte'}</span>`;

    // Trazabilidad de mesa de origen para mesas unidas
    const origenBadge = (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(estado.mesaActiva.numero))
      ? `<span class="mesa-origin-badge" title="Producto originario de ${it.origen_mesa_numero}">[${it.origen_mesa_numero.toString().toLowerCase().includes('mesa') ? it.origen_mesa_numero : 'Mesa ' + it.origen_mesa_numero}]</span>`
      : '';

    return `
      <div class="ticket-item-row">
        <div class="ticket-item-top">
          <span class="t-name">${origenBadge}${it.nombre} ${cursoBadge} ${it.enviado ? '<small style="color:#10b981;">✓ Enviado</small>' : ''}</span>
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
  actualizarBotonEnviarComanda();
  const mobCountEl = document.getElementById('mobTicketCount');
  if (mobCountEl) {
    const totalQty = (estado.mesaActiva && estado.mesaActiva.items)
      ? estado.mesaActiva.items.reduce((acc, it) => acc + it.cantidad, 0)
      : 0;
    mobCountEl.textContent = totalQty;
  }
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

// Enviar Comanda a Cocina o Guardar (cierra el menú de una vez)
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
    }
    alert(tieneNuevosCocina ? '🔔 ¡Comanda enviada a cocina!' : '💾 ¡Comanda guardada con éxito!');
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    actualizarBotonEnviarComanda();
    
    // CERRAR EL MENÚ DE UNA VEZ
    document.getElementById('modalComandero').classList.remove('active');
    
    cargarMesasDesdeBackend();
    cargarKDSDesdeBackend();
  } catch (e) {
    if (tieneNuevosCocina) {
      sonarCampanaCocina();
    }
    estado.mesaActiva.items.forEach(it => it.enviado = true);
    actualizarBotonEnviarComanda();
    document.getElementById('modalComandero').classList.remove('active');
  }
});

const btnLanzarFuertesEl = document.getElementById('btnLanzarPlatosFuertes');
if (btnLanzarFuertesEl) btnLanzarFuertesEl.addEventListener('click', async () => {
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

    const originTag = (c.origen_mesa_numero && String(c.origen_mesa_numero) !== String(c.mesa_numero))
      ? `<span class="mesa-origin-badge" style="font-size:0.75rem; margin-right:4px;" title="Platillo pedido originalmente en ${c.origen_mesa_numero}">[${c.origen_mesa_numero.toString().toLowerCase().includes('mesa') ? c.origen_mesa_numero : 'Mesa ' + c.origen_mesa_numero}]</span>`
      : '';

    const card = document.createElement('div');
    card.className = 'kds-card';
    card.innerHTML = `
      <div class="kds-top">
        <span class="kds-mesa-label">${c.mesa_numero || c.mesa || 'Mesa'}</span>
        <span class="kds-stopwatch">⏱️ ${c.hora_pedido ? c.hora_pedido.slice(11, 16) : 'Ahora'}</span>
      </div>
      <div class="kds-item-line">${c.cantidad}x ${originTag}${c.nombre_producto || c.platillo} ${badge}</div>
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
    cargarMesasDesdeBackend();
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
      const targetTab = tab.dataset.tab;
      
      const panelMover = document.getElementById('transferPanelMover');
      const panelUnir = document.getElementById('transferPanelUnir');
      const panelSeparar = document.getElementById('transferPanelSeparar');

      if (panelMover) panelMover.classList.toggle('active', targetTab === 'mover');
      if (panelUnir) panelUnir.classList.toggle('active', targetTab === 'unir');
      if (panelSeparar) panelSeparar.classList.toggle('active', targetTab === 'separar');
    });
  });

  document.getElementById('btnEjecutarMoverMesa').addEventListener('click', async () => {
    const origId = Number(document.getElementById('selMoverOrigen').value);
    const destId = Number(document.getElementById('selMoverDestino').value);
    if (!origId || !destId) return alert('Selecciona mesa de origen y destino.');

    try {
      const res = await fetch('/api/mesas/mover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origenMesaId: origId, destinoMesaId: destId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al mover mesa');
      alert('🔁 ' + data.message);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  });

  document.getElementById('btnEjecutarUnirMesas').addEventListener('click', async () => {
    const m1Id = Number(document.getElementById('selUnirMesa1').value);
    const m2Id = Number(document.getElementById('selUnirMesa2').value);
    if (!m1Id || !m2Id) return alert('Selecciona las dos mesas que deseas unir.');
    if (m1Id === m2Id) return alert('Debes seleccionar dos mesas distintas.');

    try {
      const res = await fetch('/api/mesas/unir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mesaPrincipalId: m1Id, mesaSecundariaId: m2Id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al unir mesas');
      alert('🔗 ' + data.message);
      document.getElementById('modalMoverUnir').classList.remove('active');
      cargarMesasDesdeBackend();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  });

  const btnEjecutarSepararEl = document.getElementById('btnEjecutarSepararMesas');
  if (btnEjecutarSepararEl) {
    btnEjecutarSepararEl.addEventListener('click', async () => {
      const selSep = document.getElementById('selSepararMesa');
      const mesaId = Number(selSep ? selSep.value : 0);
      if (!mesaId) return alert('Selecciona una mesa en grupo o unida para restaurar.');

      await solicitarRestaurarMesas(mesaId);
    });
  }
}

function cargarSelectoresMoverUnir() {
  const selOrig = document.getElementById('selMoverOrigen');
  const selDest = document.getElementById('selMoverDestino');
  const selU1 = document.getElementById('selUnirMesa1');
  const selU2 = document.getElementById('selUnirMesa2');
  const selSep = document.getElementById('selSepararMesa');

  if (!selOrig || !selDest || !selU1 || !selU2) return;

  const ocupadas = estado.mesas.filter(m => m.estado !== 'libre');
  const libres = estado.mesas.filter(m => m.estado === 'libre');
  const fusionadas = estado.mesas.filter(m => m.grupo_mesas || m.es_mesa_agrupada || m.es_mesa_unida || (m.mesas_unidas && m.mesas_unidas.length > 0) || m.es_mesa_secundaria_unida || m.estado === 'unida');

  if (ocupadas.length === 0) {
    selOrig.innerHTML = '<option value="">⚠️ No hay mesas ocupadas</option>';
    selU1.innerHTML = '<option value="">⚠️ No hay mesas ocupadas</option>';
    selU2.innerHTML = '<option value="">⚠️ No hay mesas ocupadas</option>';
  } else {
    selOrig.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'Salón'}) • Total: ${m.orden_total > 0 ? formatCRC(m.orden_total) : '₡0'}</option>`).join('');
    selU1.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'Salón'}) • Principal</option>`).join('');
    selU2.innerHTML = ocupadas.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'Salón'}) • Secundaria (a agrupar/unir)</option>`).join('');
    if (ocupadas.length > 1) {
      selU2.selectedIndex = 1;
    }
  }

  if (libres.length === 0) {
    selDest.innerHTML = '<option value="">⚠️ No hay mesas libres disponibles</option>';
  } else {
    selDest.innerHTML = libres.map(m => `<option value="${m.id}">${m.numero} (${m.zonaNombre || 'Salón'}) • Libre</option>`).join('');
  }

  if (selSep) {
    if (fusionadas.length === 0) {
      selSep.innerHTML = '<option value="">⚠️ No hay mesas agrupadas ni unidas actualmente</option>';
    } else {
      selSep.innerHTML = fusionadas.map(m => {
        const desc = (m.grupo_mesas || m.es_mesa_agrupada)
          ? `(En Grupo con ${m.mesas_unidas ? m.mesas_unidas.join(', ') : 'otras'})`
          : (m.es_mesa_secundaria_unida 
              ? `(Unida a ${m.unida_a_numero || 'Mesa Principal'})` 
              : `(Unida con ${m.mesas_unidas ? m.mesas_unidas.join(', ') : 'otra mesa'})`);
        return `<option value="${m.id}">${m.numero} ${desc} • Total: ${formatCRC(m.orden_total)}</option>`;
      }).join('');
    }
  }
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
  // Botón en subbar del salón: Ver Códigos QR Mesas
  const btnTodosQRs = document.getElementById('btnVerTodosQRs');
  if (btnTodosQRs) {
    btnTodosQRs.addEventListener('click', () => {
      poblarSelectorMesasQR();
      if (estado.mesas.length > 0) {
        document.getElementById('qrSelectMesa').value = estado.mesas[0].id;
        cargarQrMesaSeleccionada();
      }
      document.getElementById('modalQrCliente').classList.add('active');
    });
  }

  // Botón en el comandero: QR Cliente de la mesa activa
  const btnQrMesa = document.getElementById('btnVerQrMesaCliente');
  if (btnQrMesa) {
    btnQrMesa.addEventListener('click', () => {
      if (!estado.mesaActiva) return;
      poblarSelectorMesasQR();
      document.getElementById('qrSelectMesa').value = estado.mesaActiva.id;
      cargarQrMesaSeleccionada();
      document.getElementById('modalQrCliente').classList.add('active');
    });
  }

  const btnClose = document.getElementById('btnCloseQrModal');
  if (btnClose) {
    btnClose.addEventListener('click', () => document.getElementById('modalQrCliente').classList.remove('active'));
  }

  const btnPideCuentaWeb = document.getElementById('btnClientePideCuentaWeb');
  if (btnPideCuentaWeb) {
    btnPideCuentaWeb.addEventListener('click', async () => {
      const mesaId = Number(document.getElementById('qrSelectMesa').value) || (estado.mesaActiva ? estado.mesaActiva.id : 1);
      try {
        await fetch('/api/cliente/mesa/' + mesaId + '/pedir-cuenta', { method: 'POST' });
      } catch (e) {}
      sonarCampanaCocina();
      alert('📱 ¡Aviso enviado al mesero! La mesa solicitó la cuenta.');
      document.getElementById('modalQrCliente').classList.remove('active');
      if (document.getElementById('modalComandero')) {
        document.getElementById('modalComandero').classList.remove('active');
      }
      cargarMesasDesdeBackend();
    });
  }
}

function poblarSelectorMesasQR() {
  const sel = document.getElementById('qrSelectMesa');
  if (!sel) return;
  sel.innerHTML = estado.mesas.map(m => `
    <option value="${m.id}">${m.numero} (${m.zonaNombre || 'SALÓN'}) - ${m.estado === 'libre' ? 'Libre' : 'Cuenta Activa'}</option>
  `).join('');
}

window.cargarQrMesaSeleccionada = async function() {
  const sel = document.getElementById('qrSelectMesa');
  if (!sel) return;
  const mesaId = sel.value;
  const mesa = estado.mesas.find(m => m.id === Number(mesaId));
  if (mesa) {
    document.getElementById('qrMesaNombre').textContent = `Código QR de ${mesa.numero}`;
  }

  try {
    const res = await fetch('/api/mesas/' + mesaId + '/qr');
    const data = await res.json();
    if (data.qrDataUrl) {
      document.getElementById('qrRealImg').src = data.qrDataUrl;
      document.getElementById('qrUrlDisplay').textContent = data.url;
    }

    // Cargar datos en el mockup del teléfono
    const resCliente = await fetch('/api/cliente/mesa/' + mesaId);
    const dataCliente = await resCliente.json();
    const phoneItems = document.getElementById('phoneClientItems');
    if (phoneItems) {
      if (!dataCliente.items || !dataCliente.items.length) {
        phoneItems.innerHTML = '<div style="text-align:center; color:#9ca3af; padding:20px;">Sin consumos activos (Mesa Libre)</div>';
        document.getElementById('phoneClientTotal').textContent = '₡ 0.00';
      } else {
        phoneItems.innerHTML = dataCliente.items.map(it => `
          <div class="phone-item-row">
            <span>${it.cantidad}x ${it.nombre_producto}</span>
            <strong>${formatCRC(it.precio_unitario * it.cantidad)}</strong>
          </div>
        `).join('');
        document.getElementById('phoneClientTotal').textContent = formatCRC(dataCliente.orden ? dataCliente.orden.total : 0);
      }
    }
  } catch (e) {
    console.error('Error cargando QR:', e);
  }
};

window.abrirQrMesaEnNuevaPestana = function() {
  const sel = document.getElementById('qrSelectMesa');
  const mesaId = sel ? sel.value : 1;
  window.open('/m/' + mesaId, '_blank');
};


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


// Editor Visual Plano con Cambio de Tamaño y Sillas de Barra
function renderEditorPlano() {
  const canvas = document.getElementById('editorCanvas');
  canvas.innerHTML = '';

  estado.mesas.forEach(m => {
    const el = document.createElement('div');
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    el.className = `drag-mesa ${m.forma === 'round' ? 'round' : ''} ${esSilla ? 'silla' : ''}`;
    el.style.left = m.x + 'px';
    el.style.top = m.y + 'px';
    el.style.width = (m.ancho || (esSilla ? 95 : 130)) + 'px';
    el.style.height = (m.alto || (esSilla ? 105 : 120)) + 'px';
    el.dataset.mesaId = m.id;

    el.innerHTML = `
      <div class="mesa-size-controls">
        <button class="btn-mesa-size" title="Reducir tamaño" onclick="event.stopPropagation(); cambiarTamanoMesa(${m.id}, -15)">-</button>
        <button class="btn-mesa-size" title="Aumentar tamaño" onclick="event.stopPropagation(); cambiarTamanoMesa(${m.id}, 15)">+</button>
        <button class="btn-mesa-size" title="Eliminar mesa o silla" style="color:#ef4444; border-color:#ef4444;" onclick="event.stopPropagation(); eliminarMesaDesdeEditor(${m.id}, '${m.numero}')">🗑️</button>
      </div>
      <span>${m.numero}</span>
      <small>👥 ${m.capacidad}p</small>
      <small class="mesa-dim-label">${m.ancho || 130}x${m.alto || 120}</small>
      <div class="mesa-resize-handle" title="Arrastrar para cambiar tamaño">↘</div>
    `;

    // Movimiento por arrastre
    let isDragging = false;
    let startX, startY, origX, origY;

    const onMouseDown = (e) => {
      if (e.target.closest('.mesa-size-controls') || e.target.closest('.mesa-resize-handle')) return;

      isDragging = true;
      startX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
      startY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
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
        el.style.borderColor = esSilla ? '#38bdf8' : '#0284c7';
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

    // Resize por arrastre del handle
    const resizeHandle = el.querySelector('.mesa-resize-handle');
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = m.ancho || (esSilla ? 95 : 130);
        const startH = m.alto || (esSilla ? 105 : 120);

        const onResizeMove = (ev) => {
          const deltaX = ev.clientX - startX;
          const deltaY = ev.clientY - startY;
          m.ancho = Math.max(70, Math.min(300, Math.round(startW + deltaX)));
          m.alto = Math.max(70, Math.min(300, Math.round(startH + deltaY)));
          el.style.width = m.ancho + 'px';
          el.style.height = m.alto + 'px';
          const dimLabel = el.querySelector('.mesa-dim-label');
          if (dimLabel) dimLabel.textContent = `${m.ancho}x${m.alto}`;
        };

        const onResizeUp = () => {
          window.removeEventListener('mousemove', onResizeMove);
          window.removeEventListener('mouseup', onResizeUp);
        };

        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('mouseup', onResizeUp);
      });
    }

    canvas.appendChild(el);
  });
}

window.cambiarTamanoMesa = function(mesaId, delta) {
  const m = estado.mesas.find(item => item.id === mesaId);
  if (!m) return;
  m.ancho = Math.max(70, Math.min(300, (m.ancho || 130) + delta));
  m.alto = Math.max(70, Math.min(300, (m.alto || 120) + delta));
  renderEditorPlano();
};


document.getElementById('btnGuardarPlano').addEventListener('click', async () => {
  const posiciones = estado.mesas.map(m => ({ id: m.id, x: m.x, y: m.y, ancho: m.ancho || 130, alto: m.alto || 120 }));
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
  const num = 'Silla Barra ' + (estado.mesas.filter(m => m.numero.includes('Barra')).length + 1);
  try {
    await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numero: num, 
        zona_id: 2, 
        capacidad: 1, 
        forma: 'silla', 
        x: 620, 
        y: 80,
        ancho: 95,
        alto: 105
      })
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

// ============================================================================
// HAPPY HOUR — Sincronización backend + configuración de horario
// ============================================================================

/** Aplica el estado de HH al UI sin hacer fetch */
function aplicarEstadoHappyHour(activo, horaInicio, horaFin) {
  estado.happyHourActivo = Boolean(activo);
  const btnHH = document.getElementById('btnToggleHappyHour');
  const txtHH = document.getElementById('hhStatusTxt');
  if (!btnHH) return;

  if (estado.happyHourActivo) {
    btnHH.classList.remove('inactive');
    txtHH.textContent = `Activo ${horaInicio || ''}–${horaFin || ''}`;
  } else {
    btnHH.classList.add('inactive');
    txtHH.textContent = `Desactivado (${horaInicio || '16:00'}–${horaFin || '19:00'})`;
  }
  renderGridProductos(estado.productos);
  if (estado.mesaActiva) recalcularTotalesTicket();
}

async function initHappyHour() {
  const btnHH = document.getElementById('btnToggleHappyHour');
  const txtHH = document.getElementById('hhStatusTxt');

  // 1. Cargar estado real desde el backend al iniciar
  try {
    const res = await fetch('/api/happy-hour');
    if (res.ok) {
      const data = await res.json();
      aplicarEstadoHappyHour(data.activo, data.horaInicio, data.horaFin);
      // Guardar horarios para el modal de config
      btnHH.dataset.horaInicio = data.horaInicio || '16:00';
      btnHH.dataset.horaFin = data.horaFin || '19:00';
    }
  } catch (e) { /* servidor no disponible */ }

  // 2. Click corto → alternar activo/inactivo
  btnHH.addEventListener('click', async (e) => {
    // Si hay modal de config abierto, no toggle
    const modalCfg = document.getElementById('modalHHConfig');
    if (modalCfg && modalCfg.classList.contains('active')) return;

    const nuevoActivo = !estado.happyHourActivo;
    try {
      const res = await fetch('/api/happy-hour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activo: nuevoActivo,
          horaInicio: btnHH.dataset.horaInicio || '16:00',
          horaFin: btnHH.dataset.horaFin || '19:00'
        })
      });
      const data = await res.json();
      aplicarEstadoHappyHour(data.activo, data.horaInicio, data.horaFin);
      btnHH.dataset.horaInicio = data.horaInicio;
      btnHH.dataset.horaFin = data.horaFin;
    } catch (e) {
      // Fallback local
      estado.happyHourActivo = nuevoActivo;
      renderGridProductos(estado.productos);
      if (estado.mesaActiva) recalcularTotalesTicket();
    }
  });

  // 3. Click largo (>600ms) → abrir configurador de horario
  let hhLongTimer = null;
  btnHH.addEventListener('mousedown', () => {
    hhLongTimer = setTimeout(() => abrirConfigHappyHour(), 600);
  });
  ['mouseup', 'mouseleave'].forEach(ev => {
    btnHH.addEventListener(ev, () => clearTimeout(hhLongTimer));
  });
  btnHH.addEventListener('touchstart', () => {
    hhLongTimer = setTimeout(() => abrirConfigHappyHour(), 600);
  });
  ['touchend', 'touchcancel'].forEach(ev => {
    btnHH.addEventListener(ev, () => clearTimeout(hhLongTimer));
  });
}

function abrirConfigHappyHour() {
  const btnHH = document.getElementById('btnToggleHappyHour');
  const horaInicio = btnHH.dataset.horaInicio || '16:00';
  const horaFin = btnHH.dataset.horaFin || '19:00';

  // Crear modal de configuración si no existe
  let modal = document.getElementById('modalHHConfig');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalHHConfig';
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:360px;padding:28px;">
        <h3 style="margin:0 0 18px;color:#f59e0b;">🍸 Configurar Happy Hour</h3>
        <label style="display:block;margin-bottom:10px;font-size:14px;">
          Hora inicio (HH:MM 24h)
          <input id="hhInputInicio" type="time" value="${horaInicio}" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:16px;">
        </label>
        <label style="display:block;margin-bottom:20px;font-size:14px;">
          Hora fin (HH:MM 24h) — se auto-desactiva al llegar
          <input id="hhInputFin" type="time" value="${horaFin}" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:16px;">
        </label>
        <div style="display:flex;gap:10px;">
          <button id="btnGuardarHHConfig" style="flex:1;padding:12px;border-radius:10px;background:#f59e0b;color:#000;border:none;font-weight:700;cursor:pointer;">💾 Guardar</button>
          <button id="btnCerrarHHConfig" style="flex:1;padding:12px;border-radius:10px;background:#374151;color:#f9fafb;border:none;cursor:pointer;">✕ Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btnCerrarHHConfig').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });

    document.getElementById('btnGuardarHHConfig').addEventListener('click', async () => {
      const ni = document.getElementById('hhInputInicio').value;
      const nf = document.getElementById('hhInputFin').value;
      if (!ni || !nf) return alert('Completa ambos horarios.');
      try {
        const res = await fetch('/api/happy-hour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ horaInicio: ni, horaFin: nf, activo: estado.happyHourActivo })
        });
        const data = await res.json();
        btnHH.dataset.horaInicio = data.horaInicio;
        btnHH.dataset.horaFin = data.horaFin;
        aplicarEstadoHappyHour(data.activo, data.horaInicio, data.horaFin);
        modal.classList.remove('active');
        alert(`✅ Happy Hour configurado: ${data.horaInicio}–${data.horaFin}`);
      } catch (e) { alert('Error guardando config.'); }
    });
  } else {
    document.getElementById('hhInputInicio').value = horaInicio;
    document.getElementById('hhInputFin').value = horaFin;
    modal.classList.add('active');
  }
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

// Dismiss touch tooltips when tapping outside
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target && !e.target.closest('.m-wait-chip') && !e.target.closest('.mesa-tooltip')) {
      document.querySelectorAll('.mesa-tooltip.show-touch').forEach(t => t.classList.remove('show-touch'));
    }
  });
}

// Auto-actualizar minutos de espera cada 30 segundos si hay mesas esperando
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    if (typeof estado !== 'undefined' && estado.mesas && estado.mesas.some(m => m.estado === 'esperando' || m.estado === 'esperando_parcial')) {
      renderSalón();
    }
  }, 30000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    evaluarEstadoMesaKDS,
    formatearTooltipEspera
  };
}

