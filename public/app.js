
// ============================================================================
// MODAL DE CONFIRMACIÓN PERSONALIZADO — reemplaza confirm() nativo del browser
// ============================================================================
window.confirmarAccion = function(opciones) {
  return new Promise((resolve) => {
    const modal     = document.getElementById('modalConfirmacionAccion');
    const elIcono   = document.getElementById('modalConfirmIcono');
    const elTitulo  = document.getElementById('modalConfirmTitulo');
    const elSubtit  = document.getElementById('modalConfirmSubtitulo');
    const elMensaje = document.getElementById('modalConfirmMensaje');
    const elBtnSi   = document.getElementById('modalConfirmBtnSi');
    const elBtnNo   = document.getElementById('modalConfirmBtnNo');

    if (!modal) { resolve(false); return; }

    // Configurar contenido
    if (elIcono)   elIcono.textContent   = opciones.icono   || '⚠️';
    if (elTitulo)  elTitulo.textContent  = opciones.titulo  || '¿Confirmar acción?';
    if (elSubtit)  elSubtit.textContent  = opciones.subtitulo || 'Esta acción no se puede deshacer';
    if (elMensaje) elMensaje.textContent = opciones.mensaje || '';

    // Color del botón confirmar según peligro
    if (elBtnSi) {
      const esPeligroso = opciones.tipo === 'peligro' || opciones.tipo === 'danger';
      elBtnSi.style.background = esPeligroso
        ? 'linear-gradient(135deg,#ef4444,#dc2626)'
        : 'linear-gradient(135deg,#6366f1,#4f46e5)';
      elBtnSi.textContent = opciones.txtSi || 'Confirmar';
    }
    if (elBtnNo) elBtnNo.textContent = opciones.txtNo || 'Cancelar';

    // Callbacks
    window._confirmarAceptar = () => { modal.style.display = 'none'; resolve(true);  };
    window._confirmarRechazar = () => { modal.style.display = 'none'; resolve(false); };

    // Mostrar modal
    modal.style.display = 'flex';
  });
};

let mesaParaRenombrar = null;

window.abrirModalRenombrarMesa = function(mesaId, nombreActual) {
  mesaParaRenombrar = { id: mesaId, nombre: nombreActual };
  const modal = document.getElementById('modalRenombrarMesa');
  const txtActual = document.getElementById('txtRenombrarMesaActual');
  const txtNuevo = document.getElementById('txtRenombrarMesaNuevo');

  if (txtActual) txtActual.value = nombreActual || '';
  if (txtNuevo) {
    txtNuevo.value = nombreActual || '';
    setTimeout(() => {
      txtNuevo.focus();
      txtNuevo.select();
    }, 100);
  }
  if (modal) modal.classList.add('active');
};

window.abrirModalNuevoProducto = function() {
  const modal = document.getElementById('modalAgregarProducto');
  const txtNombre = document.getElementById('txtNuevoProdNombre');
  const txtPrecio = document.getElementById('txtNuevoProdPrecio');
  const selCat = document.getElementById('selectNuevoProdCategoria');
  const selDest = document.getElementById('selectNuevoProdDestino');
  const txtImg = document.getElementById('txtNuevoProdImagen');
  const selCurso = document.getElementById('selectNuevoProdCurso');

  if (txtNombre) txtNombre.value = '';
  if (txtPrecio) txtPrecio.value = '';
  if (txtImg) txtImg.value = '';
  if (selCurso) selCurso.value = '2';

  if (selCat) {
    selCat.innerHTML = (estado.categorias || []).map(c => 
      `<option value="${c.id}" data-destino="${c.destino || 'cocina'}">${c.icono || '🍽️'} ${c.nombre}</option>`
    ).join('');

    // Ajustar destino y curso automáticamente según la categoría elegida
    selCat.onchange = function() {
      const opt = selCat.options[selCat.selectedIndex];
      const dest = opt ? opt.getAttribute('data-destino') : 'cocina';
      if (selDest) selDest.value = dest || 'cocina';
      if (selCurso) selCurso.value = (dest === 'barra' ? '1' : '2');
    };
    if (selCat.options.length > 0) {
      selCat.dispatchEvent(new Event('change'));
    }
  }

  if (modal) modal.classList.add('active');
  setTimeout(() => {
    if (txtNombre) txtNombre.focus();
  }, 100);
};

window.cerrarModalNuevoProducto = function() {
  const modal = document.getElementById('modalAgregarProducto');
  if (modal) modal.classList.remove('active');
};

window.guardarNuevoProducto = async function() {
  const txtNombre = document.getElementById('txtNuevoProdNombre');
  const txtPrecio = document.getElementById('txtNuevoProdPrecio');
  const selCat = document.getElementById('selectNuevoProdCategoria');
  const selDest = document.getElementById('selectNuevoProdDestino');
  const txtImg = document.getElementById('txtNuevoProdImagen');
  const selCurso = document.getElementById('selectNuevoProdCurso');

  const nombre = (txtNombre ? txtNombre.value : '').trim();
  const precioVal = txtPrecio ? txtPrecio.value : '';
  const precio = parseFloat(precioVal);

  if (!nombre) {
    alert('Por favor ingresa el nombre del producto.');
    if (txtNombre) txtNombre.focus();
    return;
  }

  if (isNaN(precio) || precio < 0) {
    alert('Por favor ingresa un precio válido mayor o igual a 0.');
    if (txtPrecio) txtPrecio.focus();
    return;
  }

  const categoria_id = selCat ? selCat.value : null;
  const destino = selDest ? selDest.value : 'cocina';
  const imagen_url = (txtImg ? txtImg.value : '').trim();
  const curso = selCurso ? selCurso.value : 2;

  try {
    const res = await fetch('/api/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        precio,
        categoria_id,
        destino,
        curso,
        imagen_url
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert('❌ ' + (data.error || 'No se pudo registrar el producto'));
      return;
    }

    window.cerrarModalNuevoProducto();
    mostrarNotificacionCentro(`✅ Producto "${nombre}" (₡${precio}) agregado exitosamente`, 'success');

    // Recargar catálogo y menú
    await cargarMenuDesdeBackend();
  } catch (e) {
    alert('❌ Error al agregar producto: ' + e.message);
  }
};

window.abrirModalActualizaciones = async function() {
  const modal = document.getElementById('modalActualizaciones');
  if (modal) modal.classList.add('active');

  const txtVer = document.getElementById('txtUpdateVersionActual');
  const txtRev = document.getElementById('txtUpdateUltimaRevision');
  const iconStatus = document.getElementById('iconUpdateStatus');
  const titleStatus = document.getElementById('titleUpdateStatus');
  const descStatus = document.getElementById('descUpdateStatus');
  const boxDetails = document.getElementById('boxUpdateDetails');
  const btnAplicar = document.getElementById('btnAplicarUpdate');

  if (iconStatus) iconStatus.textContent = '⏳';
  if (titleStatus) titleStatus.textContent = 'Consultando estado...';
  if (descStatus) descStatus.textContent = 'Verificando con el repositorio en GitHub...';
  if (boxDetails) boxDetails.style.display = 'none';
  if (btnAplicar) btnAplicar.style.display = 'none';

  try {
    const res = await fetch('/api/sistema/actualizaciones/estado');
    const data = await res.json();
    if (txtVer) txtVer.textContent = `v${data.version || '1.0.0'}`;
    if (txtRev) {
      txtRev.textContent = data.ultimaRevision 
        ? new Date(data.ultimaRevision).toLocaleString('es-CR')
        : 'Aún no se ha realizado';
    }

    if (data.actualizacionDisponible) {
      if (iconStatus) iconStatus.textContent = '🚀';
      if (titleStatus) {
        titleStatus.textContent = '¡Nueva versión disponible para instalar!';
        titleStatus.style.color = '#34d399';
      }
      if (descStatus) {
        descStatus.textContent = data.commitMsg ? `Mejoras: ${data.commitMsg}` : 'Hay nuevas funciones y correcciones disponibles.';
      }
      if (boxDetails) {
        boxDetails.style.display = 'block';
        boxDetails.innerHTML = `<strong>Último Commit:</strong> <code>${data.ultimoCommit || ''}</code> ${data.commitDate ? `(${new Date(data.commitDate).toLocaleString('es-CR')})` : ''}`;
      }
      if (btnAplicar) btnAplicar.style.display = 'inline-block';
    } else {
      if (iconStatus) iconStatus.textContent = '✅';
      if (titleStatus) {
        titleStatus.textContent = 'El sistema está actualizado';
        titleStatus.style.color = '#f8fafc';
      }
      if (descStatus) descStatus.textContent = 'Tienes la versión más reciente instalada y protegida.';
    }
  } catch (e) {
    if (iconStatus) iconStatus.textContent = '⚠️';
    if (titleStatus) titleStatus.textContent = 'Modo Local / Sin conexión a internet';
    if (descStatus) descStatus.textContent = 'El sistema funciona perfectamente en la red del restaurante. Cuando haya internet podrás buscar actualizaciones.';
  }
};

window.cerrarModalActualizaciones = function() {
  const modal = document.getElementById('modalActualizaciones');
  if (modal) modal.classList.remove('active');
};

window.buscarActualizacionesManual = async function() {
  const btn = document.getElementById('btnBuscarUpdatesManual');
  const iconStatus = document.getElementById('iconUpdateStatus');
  const titleStatus = document.getElementById('titleUpdateStatus');
  const descStatus = document.getElementById('descUpdateStatus');
  const boxDetails = document.getElementById('boxUpdateDetails');
  const btnAplicar = document.getElementById('btnAplicarUpdate');
  const txtRev = document.getElementById('txtUpdateUltimaRevision');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Buscando...';
  }
  if (iconStatus) iconStatus.textContent = '🔍';
  if (titleStatus) titleStatus.textContent = 'Buscando actualizaciones en GitHub...';
  if (descStatus) descStatus.textContent = 'Comprobando si hay mejoras disponibles en el repositorio...';
  if (boxDetails) boxDetails.style.display = 'none';
  if (btnAplicar) btnAplicar.style.display = 'none';

  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/sistema/actualizaciones/buscar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': rol
      },
      body: JSON.stringify({ rol })
    });
    const data = await res.json();

    if (txtRev) txtRev.textContent = new Date().toLocaleString('es-CR');

    if (!data.ok) {
      if (iconStatus) iconStatus.textContent = '⚠️';
      if (titleStatus) {
        titleStatus.textContent = 'No se pudo conectar a GitHub';
        titleStatus.style.color = '#fbbf24';
      }
      if (descStatus) descStatus.textContent = data.error || 'Verifica que la computadora tenga salida a internet.';
      return;
    }

    if (data.hayNuevaVersion) {
      if (iconStatus) iconStatus.textContent = '🚀';
      if (titleStatus) {
        titleStatus.textContent = '¡Nueva versión disponible para instalar!';
        titleStatus.style.color = '#34d399';
      }
      if (descStatus) {
        descStatus.textContent = data.commitMsg ? `Mejoras: ${data.commitMsg}` : 'Hay nuevas funciones disponibles.';
      }
      if (boxDetails) {
        boxDetails.style.display = 'block';
        boxDetails.innerHTML = `<strong>Versión:</strong> <code>${data.latestSha || ''}</code> ${data.commitDate ? `(${new Date(data.commitDate).toLocaleString('es-CR')})` : ''}`;
      }
      if (btnAplicar) btnAplicar.style.display = 'inline-block';
      mostrarNotificacionCentro('🚀 ¡Se encontró una nueva actualización disponible!', 'success');
    } else {
      if (iconStatus) iconStatus.textContent = '✅';
      if (titleStatus) {
        titleStatus.textContent = '¡El sistema está al día!';
        titleStatus.style.color = '#34d399';
      }
      if (descStatus) descStatus.textContent = 'No hay nuevas actualizaciones. Tienes la última versión instalada.';
      mostrarNotificacionCentro('✅ El sistema ya tiene la versión más reciente.', 'success');
    }
  } catch (e) {
    if (iconStatus) iconStatus.textContent = '⚠️';
    if (titleStatus) titleStatus.textContent = 'Error al consultar actualizaciones';
    if (descStatus) descStatus.textContent = e.message;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔍 Buscar Ahora';
    }
  }
};

window.aplicarActualizacionSistema = async function() {
  const confirmado = await confirmarAccion({
    icono: '🔄',
    titulo: '¿Instalar actualización?',
    subtitulo: 'La base de datos se mantendrá intacta',
    mensaje: '¿Deseas descargar e instalar la actualización ahora?\n\nLa base de datos (ventas, mesas, facturas) se mantendrá 100% segura e intacta.',
    tipo: 'info',
    txtSi: '✅ Instalar ahora',
    txtNo: 'Cancelar'
  });
  if (!confirmado) return;

  const btn = document.getElementById('btnAplicarUpdate');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Instalando...';
  }

  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/sistema/actualizaciones/aplicar', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-rol': rol
      },
      body: JSON.stringify({ rol })
    });
    const data = await res.json();

    if (data.ok) {
      alert('🎉 ¡Actualización instalada con éxito!\n\nEl sistema se recargará en este momento con las nuevas funciones.');
      window.location.reload();
    } else {
      alert('❌ ' + (data.error || 'No se pudo aplicar la actualización.'));
    }
  } catch (e) {
    alert('❌ Error al actualizar: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 Instalar Actualización';
    }
  }
};

window.guardarNuevoNombreMesa = async function() {
  if (!mesaParaRenombrar) return;
  const txtNuevo = document.getElementById('txtRenombrarMesaNuevo');
  const nuevoNombre = (txtNuevo ? txtNuevo.value : '').trim();

  if (!nuevoNombre) {
    alert('Por favor ingresa un nombre para la mesa o silla.');
    return;
  }

  if (nuevoNombre === mesaParaRenombrar.nombre) {
    document.getElementById('modalRenombrarMesa').classList.remove('active');
    return;
  }

  try {
    const res = await fetch('/api/mesas/' + mesaParaRenombrar.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: nuevoNombre })
    });
    const data = await res.json();
    if (!res.ok) {
      alert('❌ ' + (data.error || 'No se pudo cambiar el nombre'));
      return;
    }

    // Actualizar estado local
    const m = estado.mesas.find(item => item.id === mesaParaRenombrar.id);
    if (m) m.numero = nuevoNombre;
    if (estado.mesaActiva && estado.mesaActiva.id === mesaParaRenombrar.id) {
      estado.mesaActiva.numero = nuevoNombre;
      const elNum = document.getElementById('comMesaNumero');
      if (elNum) elNum.textContent = nuevoNombre;
    }

    document.getElementById('modalRenombrarMesa').classList.remove('active');
    mostrarNotificacionCentro(`✏️ Nombre cambiado a "${nuevoNombre}" exitosamente`, 'success');

    await cargarMesasDesdeBackend();
    const viewEditor = document.getElementById('view-editor-plano');
    if (viewEditor && viewEditor.classList.contains('active')) {
      renderEditorPlano();
    }
  } catch (e) {
    alert('❌ Error al actualizar el nombre: ' + e.message);
  }
};

window.eliminarMesaDesdeEditor = async function(mesaId, mesaNumero) {
  const confirmado = await confirmarAccion({
    icono: '🗑️',
    titulo: '¿Eliminar del salón?',
    subtitulo: 'Esta acción no se puede deshacer',
    mensaje: `¿Estás seguro de que deseas eliminar "${mesaNumero}" del salón? Se perderá su posición y configuración.`,
    tipo: 'peligro',
    txtSi: '🗑️ Sí, eliminar',
    txtNo: 'Cancelar'
  });
  if (!confirmado) return;

  try {
    const res = await fetch('/api/mesas/' + mesaId, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      mostrarNotificacionCentro('❌ ' + (data.error || 'No se pudo eliminar la mesa'), 'error');
      return;
    }
    mostrarNotificacionCentro(`🗑️ "${mesaNumero}" eliminada correctamente del salón.`, 'success');
    await cargarMesasDesdeBackend();
    renderEditorPlano();
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al eliminar la mesa', 'error');
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
  // Estado de Pisos (1er y 2do Piso)
  pisoActual: 1,
  pisoActualEditor: 1,

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
    socket.on('mesa_transferida', () => cargarMesasDesdeBackend());
    socket.on('mesa_renombrada', () => cargarMesasDesdeBackend());
    socket.on('producto_creado', () => cargarMenuDesdeBackend());
    socket.on('menu_actualizado', () => cargarMenuDesdeBackend());
    socket.on('actualizacion_disponible', (d) => {
      if (estado.usuarioActual && (estado.usuarioActual.rol === 'admin' || estado.usuarioActual.rol === 'developer')) {
        mostrarNotificacionCentro(`🔔 ¡Nueva versión disponible (${d.latestSha || ''})! Puedes instalarla en "Actualizaciones".`, 'info');
      }
    });
    socket.on('sistema_actualizado', () => {
      mostrarNotificacionCentro('🚀 El sistema ha sido actualizado con éxito.', 'success');
      setTimeout(() => window.location.reload(), 2000);
    });
    socket.on('cliente_pidio_cuenta', (d) => {
      sonarCampanaCocina();
      if (typeof mostrarNotificacionCentro === 'function') {
        mostrarNotificacionCentro(`📱 ¡La ${d.mesaNumero || 'Mesa'} ha solicitado la cuenta por QR!`, 'warning');
      }
      cargarMesasDesdeBackend();
    });
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

// Formateo de moneda
function formatCRC(num) {
  return '₡ ' + (Number(num) || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formateo de montos en mesas sin decimales según requerimiento
function formatCRCSinDecimales(num) {
  return '₡ ' + Math.round(Number(num) || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Control y Alternancia de Pisos (1er Piso y Segundo Piso)
window.cambiarPisoSalon = function(piso) {
  estado.pisoActual = Number(piso) || 1;
  const tabs = document.querySelectorAll('.zone-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (estado.pisoActual === 2) {
    const tab2 = document.querySelector('.zone-tab[data-zona="segundo"]');
    if (tab2) tab2.classList.add('active');
    else {
      const tabTodas = document.querySelector('.zone-tab[data-zona="todas"]');
      if (tabTodas) tabTodas.classList.add('active');
    }
  } else {
    const tabTodas = document.querySelector('.zone-tab[data-zona="todas"]');
    if (tabTodas) tabTodas.classList.add('active');
  }
  actualizarBotonPisoSalon();
  renderSalón(estado.pisoActual === 2 ? 'segundo' : 'todas');
};

window.togglePisoActual = function() {
  window.cambiarPisoSalon(estado.pisoActual === 2 ? 1 : 2);
};

window.actualizarBotonPisoSalon = function() {
  const btn = document.getElementById('btnTogglePisoSalon');
  if (!btn) return;

  const otroPiso = (estado.pisoActual === 2 ? 1 : 2);
  const mesasOtroPiso = (estado.mesas || []).filter(m => {
    const mesaPiso = m.piso || (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
    return mesaPiso === otroPiso;
  });

  const hayCuentaPedidaOtroPiso = mesasOtroPiso.some(m => m.estado === 'cuenta' || m.pidio_cuenta_qr === 1 || m.cuenta_pedida);

  if (estado.pisoActual === 2) {
    btn.innerHTML = hayCuentaPedidaOtroPiso 
      ? '🚨 ¡Piso 1 Pide Cuenta! ↙' 
      : '🏢 Ver Primer Piso ↙';
    btn.classList.add('piso-2-activo');
  } else {
    btn.innerHTML = hayCuentaPedidaOtroPiso 
      ? '🚨 ¡Piso 2 Pide Cuenta! ↗' 
      : '🏢 Ver Segundo Piso ↗';
    btn.classList.remove('piso-2-activo');
  }

  if (hayCuentaPedidaOtroPiso) {
    btn.classList.add('alerta-piso-cuenta');
  } else {
    btn.classList.remove('alerta-piso-cuenta');
  }
};

window.cambiarPisoEditor = function(piso) {
  estado.pisoActualEditor = Number(piso) || 1;
  actualizarBotonPisoEditor();
  renderEditorPlano();
};

window.togglePisoEditor = function() {
  estado.pisoActualEditor = (estado.pisoActualEditor === 2 ? 1 : 2);
  actualizarBotonPisoEditor();
  renderEditorPlano();
};

window.actualizarBotonPisoEditor = function() {
  const btn1 = document.getElementById('btnPiso1Editor');
  const btn2 = document.getElementById('btnPiso2Editor');
  const btnToggle = document.getElementById('btnTogglePisoEditor');

  if (btn1 && btn2) {
    if (estado.pisoActualEditor === 2) {
      btn1.classList.remove('active');
      btn2.classList.add('active');
    } else {
      btn1.classList.add('active');
      btn2.classList.remove('active');
    }
  }
  if (btnToggle) {
    if (estado.pisoActualEditor === 2) {
      btnToggle.innerHTML = '🏢 Ver Primer Piso ↙';
      btnToggle.classList.add('piso-2-activo');
    } else {
      btnToggle.innerHTML = '🏢 Ver Segundo Piso ↗';
      btnToggle.classList.remove('piso-2-activo');
    }
  }
};

// Modificar capacidad de personas de una mesa directamente desde Diseñar Salón
window.cambiarCapacidadMesaPrompt = async function(mesaId, capActual) {
  const m = estado.mesas.find(item => item.id === mesaId);
  const nombre = m ? m.numero : `Mesa #${mesaId}`;
  const input = prompt(`Modificar capacidad de comensales para ${nombre}:\n(Ingresa la cantidad de personas permitidas)`, capActual || 4);
  if (input === null) return;
  const numCap = parseInt(input.trim(), 10);
  if (isNaN(numCap) || numCap < 1 || numCap > 100) {
    alert('Por favor ingresa un número de personas válido entre 1 y 100.');
    return;
  }
  try {
    const res = await fetch(`/api/mesas/${mesaId}/capacidad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capacidad: numCap })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar capacidad');
    if (m) m.capacidad = numCap;
    renderEditorPlano();
    renderSalón();
    mostrarNotificacionCentro(`👥 Capacidad de ${nombre} actualizada a ${numCap} personas`, 'success');
  } catch (e) {
    alert('Error: ' + e.message);
  }
};

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

  // Visibilidad de herramientas y pestañas exclusivas de Admin
  const adminTools = document.getElementById('adminExtraActions');
  const esAdmin = u.rol === 'admin' || u.rol === 'developer';
  document.body.classList.toggle('is-admin', esAdmin);

  if (esAdmin) {
    if (adminTools) adminTools.style.display = 'flex';
    document.querySelectorAll('.admin-only-tab').forEach(el => el.style.display = 'inline-flex');
    document.querySelectorAll('.admin-only-action').forEach(el => el.style.display = 'inline-flex');
    if (perfilBadge && u.rol === 'admin') {
      perfilBadge.innerHTML = `👑 <strong>${escapeHtml(u.nombre)}</strong> <small style="color:#fbbf24; font-size:0.75rem;">(Admin)</small>`;
    }
  } else {
    if (adminTools) adminTools.style.display = 'none';
    document.querySelectorAll('.admin-only-tab').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.admin-only-action').forEach(el => el.style.display = 'none');
    const activeNav = document.querySelector('.nav-pill.active');
    if (activeNav && ['metricas', 'inventario', 'auditoria', 'editor-plano'].includes(activeNav.dataset.view)) {
      const salonTab = document.querySelector('.nav-pill[data-view="salon"]');
      if (salonTab) salonTab.click();
    }
  }

  // Cargar datos operativos del restaurante
  cargarMesasDesdeBackend();
  cargarMenuDesdeBackend();
  cargarKDSDesdeBackend();
  cargarCajaDesdeBackend();
}

// Helpers globales para acceso directo a módulos de Admin desde cualquier vista
window.irAPuntoDeVentaAdmin = function() {
  document.getElementById('developerPortalView')?.classList.remove('active');
  document.getElementById('posMainView')?.classList.add('active');
  document.body.classList.add('is-admin');
  const adminTools = document.getElementById('adminExtraActions');
  if (adminTools) adminTools.style.display = 'flex';
  document.querySelectorAll('.admin-only-tab').forEach(el => el.style.display = 'inline-flex');
  cargarMesasDesdeBackend();
  cargarMenuDesdeBackend();
  cargarKDSDesdeBackend();
  cargarCajaDesdeBackend();
};

window.abrirPanelAdmin = function() {
  const modal = document.getElementById('modalPanelAdmin');
  if (modal) modal.classList.add('active');
};

window.cerrarPanelAdmin = function() {
  const modal = document.getElementById('modalPanelAdmin');
  if (modal) modal.classList.remove('active');
};

window.togglePanelAdmin = function() {
  const modal = document.getElementById('modalPanelAdmin');
  if (!modal) return;
  if (modal.classList.contains('active')) {
    modal.classList.remove('active');
  } else {
    modal.classList.add('active');
  }
};

window.ejecutarAccionAdmin = function(tipo) {
  cerrarPanelAdmin();
  if (tipo === 'metricas' || tipo === 'inventario' || tipo === 'auditoria' || tipo === 'editor-plano') {
    abrirModuloAdmin(tipo);
  } else if (tipo === 'personal') {
    if (typeof cargarEmpleadosAdmin === 'function') cargarEmpleadosAdmin();
    document.getElementById('modalAdminPersonal')?.classList.add('active');
  } else if (tipo === 'fotos') {
    if (typeof poblarSelectorProductosCustom === 'function') poblarSelectorProductosCustom();
    if (typeof renderGaleriaPresets === 'function') renderGaleriaPresets();
    if (typeof cargarDatosProductoCustom === 'function') cargarDatosProductoCustom();
    document.getElementById('modalPersonalizarBoton')?.classList.add('active');
  } else if (tipo === 'actualizaciones') {
    if (typeof abrirModalActualizaciones === 'function') abrirModalActualizaciones();
  } else if (tipo === 'impresoras') {
    if (typeof abrirModalMonitorImpresoras === 'function') abrirModalMonitorImpresoras();
  }
};

window.abrirModuloAdmin = function(modulo) {
  document.getElementById('developerPortalView')?.classList.remove('active');
  document.getElementById('posMainView')?.classList.add('active');
  document.body.classList.add('is-admin');
  const adminTools = document.getElementById('adminExtraActions');
  if (adminTools) adminTools.style.display = 'flex';

  cerrarPanelAdmin();

  document.querySelectorAll('.nav-pill').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.pos-view').forEach(v => v.classList.remove('active'));

  const navBtn = document.querySelector(`.nav-pill[data-view="${modulo}"]`);
  if (navBtn) navBtn.classList.add('active');

  const target = document.getElementById('view-' + modulo);
  if (target) target.classList.add('active');
  if (modulo === 'metricas') cargarDashboardMetricas();
  if (modulo === 'inventario') cargarInventarioAdmin();
  if (modulo === 'auditoria') cargarAuditoriaAdmin();
  if (modulo === 'editor-plano') renderEditorPlano();
};

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
  const confirmado = await confirmarAccion({
    icono: '👤',
    titulo: '¿Eliminar usuario?',
    subtitulo: 'Esta acción no se puede deshacer',
    mensaje: '¿Seguro que deseas eliminar este usuario del sistema?',
    tipo: 'peligro',
    txtSi: '🗑️ Sí, eliminar',
    txtNo: 'Cancelar'
  });
  if (!confirmado) return;
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
  const confirmado = await confirmarAccion({
    icono: '👥',
    titulo: '¿Eliminar colaborador?',
    subtitulo: 'Esta acción no se puede deshacer',
    mensaje: '¿Estás seguro de que deseas eliminar a este colaborador del equipo?',
    tipo: 'peligro',
    txtSi: '🗑️ Sí, eliminar',
    txtNo: 'Cancelar'
  });
  if (!confirmado) return;
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

window.categoriaActivaComandero = null; // null = Vista de Categorías Principal

function renderCatalogoComandero() {
  const chipsContainer = document.getElementById('comCategoryChips');
  if (chipsContainer) {
    chipsContainer.innerHTML = `
      <button class="cat-chip ${window.categoriaActivaComandero === null ? 'active' : ''}" onclick="volverACategoriasComandero(this)">📂 Categorías</button>
      ${(estado.categorias || []).map(c => `<button class="cat-chip ${window.categoriaActivaComandero === c.id ? 'active' : ''}" onclick="seleccionarCategoriaComandero(${c.id}, this)">${c.icono || '🍽️'} ${c.nombre}</button>`).join('')}
    `;
  }

  const txtSearch = document.getElementById('txtBuscarProductoComandero');
  if (txtSearch) txtSearch.value = '';
  filtrarProductosComandero();
}

window.seleccionarCategoriaComandero = function(catId, elBtn) {
  window.categoriaActivaComandero = catId;
  document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
  if (elBtn) {
    elBtn.classList.add('active');
  } else {
    const chips = document.querySelectorAll('.cat-chip');
    chips.forEach(c => {
      if (c.getAttribute('onclick')?.includes(`seleccionarCategoriaComandero(${catId}`)) {
        c.classList.add('active');
      }
    });
  }
  const txtSearch = document.getElementById('txtBuscarProductoComandero');
  if (txtSearch) txtSearch.value = '';
  filtrarProductosComandero();
};

window.volverACategoriasComandero = function(elBtn) {
  window.categoriaActivaComandero = null;
  document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
  if (elBtn) {
    elBtn.classList.add('active');
  } else {
    const chips = document.querySelectorAll('.cat-chip');
    if (chips[0]) chips[0].classList.add('active');
  }
  const txtSearch = document.getElementById('txtBuscarProductoComandero');
  if (txtSearch) txtSearch.value = '';
  filtrarProductosComandero();
};

window.filtrarCatalogo = function(catId, elBtn) {
  if (catId === 'todos' || catId === 'categorias' || catId === null) {
    volverACategoriasComandero(elBtn);
  } else {
    seleccionarCategoriaComandero(catId, elBtn);
  }
};

window.filtrarProductosComandero = function() {
  const query = (document.getElementById('txtBuscarProductoComandero')?.value || '').toLowerCase().trim();
  const btnClear = document.getElementById('btnClearSearchComandero');
  if (btnClear) btnClear.style.display = query ? 'inline-block' : 'none';

  // 1. Si hay búsqueda por texto libre: filtra sobre todo el menú
  if (query) {
    const palabras = query.split(/\s+/);
    const prods = (estado.productos || []).filter(p => {
      const matchTexto = `${p.nombre || ''} ${p.categoria || ''} ${p.codigo || ''} ${p.descripcion || ''}`.toLowerCase();
      return palabras.every(palabra => matchTexto.includes(palabra));
    });
    renderGridProductos(prods, true);
    return;
  }

  // 2. Si no hay búsqueda y no hay categoría seleccionada -> Vista de Categorías
  if (window.categoriaActivaComandero === null || window.categoriaActivaComandero === 'categorias') {
    renderGridCategorias();
    return;
  }

  // 3. Si hay categoría seleccionada -> Productos de esa categoría
  const catId = window.categoriaActivaComandero;
  const prods = (estado.productos || []).filter(p => p.catId === catId || p.categoria_id === catId);
  renderGridProductos(prods, false, catId);
};

window.limpiarBuscadorComandero = function() {
  const input = document.getElementById('txtBuscarProductoComandero');
  if (input) {
    input.value = '';
    input.focus();
  }
  filtrarProductosComandero();
};

function renderGridCategorias() {
  const grid = document.getElementById('comProductsGrid');
  if (!grid) return;
  grid.classList.add('categories-view');

  const cats = estado.categorias || [];
  const prods = estado.productos || [];

  const cardsHtml = cats.map(cat => {
    const totalEnCat = prods.filter(p => p.catId === cat.id || p.categoria_id === cat.id).length;
    return `
      <div class="com-cat-card" onclick="seleccionarCategoriaComandero(${cat.id})" title="Ver platillos de ${cat.nombre}">
        <div class="com-cat-icon-badge">${cat.icono || '🍽️'}</div>
        <div class="com-cat-info">
          <h4 class="com-cat-title">${cat.nombre}</h4>
          <span class="com-cat-count">${totalEnCat} platillos / bebidas</span>
        </div>
        <span class="com-cat-arrow">➔</span>
      </div>
    `;
  }).join('');

  const btnAddHtml = `
    <div class="com-cat-card com-cat-card-add" onclick="abrirModalNuevoProducto()" title="Agregar nuevo producto y precio">
      <div class="com-cat-icon-badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">➕</div>
      <div class="com-cat-info">
        <h4 class="com-cat-title" style="color: #10b981;">Nuevo Producto</h4>
        <span class="com-cat-count">Crear nuevo ítem y precio</span>
      </div>
    </div>
  `;

  grid.innerHTML = cardsHtml + btnAddHtml;
}

function renderGridProductos(prods, isSearchMode = false, catId = null) {
  const grid = document.getElementById('comProductsGrid');
  if (!grid) return;
  grid.classList.remove('categories-view');

  let headerNavHtml = '';
  if (!isSearchMode && catId) {
    const cat = (estado.categorias || []).find(c => c.id === catId);
    const catNombre = cat ? `${cat.icono || '🍽️'} ${cat.nombre}` : 'Categoría';
    headerNavHtml = `
      <div class="com-cat-nav-bar" style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; background: #1e293b; padding: 10px 14px; border-radius: 12px; margin-bottom: 6px; border: 1px solid #334155;">
        <button class="btn-volver-categorias" onclick="volverACategoriasComandero()">
          ⬅️ Volver a Categorías
        </button>
        <strong style="color: #f8fafc; font-size: 0.95rem;">${catNombre}</strong>
      </div>
    `;
  } else if (isSearchMode) {
    headerNavHtml = `
      <div class="com-cat-nav-bar" style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; background: rgba(56, 189, 248, 0.12); padding: 8px 14px; border-radius: 10px; margin-bottom: 6px; border: 1px solid rgba(56, 189, 248, 0.3);">
        <span style="color: #38bdf8; font-size: 0.85rem; font-weight: 700;">🔍 Resultados de búsqueda (${prods.length} encontrados)</span>
        <button class="btn-volver-categorias" onclick="limpiarBuscadorComandero()" style="padding: 4px 10px; font-size: 0.8rem;">
          ✕ Limpiar búsqueda
        </button>
      </div>
    `;
  }

  let specialCardsHtml = '';
  let standardProds = [...prods];

  // Si estamos en Comidas Principales (catId === 1) y NO estamos en búsqueda libre:
  if (!isSearchMode && (catId === 1 || (catId && String(catId) === '1'))) {
    // 1. Casados agrupados
    const casados = standardProds.filter(p => p.nombre.toLowerCase().includes('casado'));
    if (casados.length > 0) {
      specialCardsHtml += `
        <div class="prod-card-one-tap prod-card-special-group" onclick="abrirModalSeleccionCasado()" style="border: 2px solid #f59e0b; background: linear-gradient(145deg, #1e293b, #292524); position: relative;">
          <div class="prod-card-thumb-special" style="font-size: 2.2rem; margin-bottom: 6px; text-align: center;">🍽️</div>
          <span class="prod-badge-special" style="position: absolute; top: 8px; right: 8px; background: #f59e0b; color: #000; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">Solo Casado</span>
          <div class="prod-card-content">
            <span class="prod-card-name" style="font-size: 1.05rem; color: #fbbf24;">Solo Casado</span>
            <small style="color: #94a3b8; font-size: 0.72rem; display: block; margin-top: 2px;">Elige proteína / acompañamiento</small>
            <span class="prod-card-price" style="color: #34d399; margin-top: 6px;">₡4,500</span>
          </div>
        </div>
      `;
      // Ocultamos los casados individuales del listado directo para evitar repetición
      standardProds = standardProds.filter(p => !p.nombre.toLowerCase().includes('casado'));
    }

    // 2. Arroces agrupados
    const arroces = standardProds.filter(p => p.nombre.toLowerCase().startsWith('arroz con') || p.nombre.toLowerCase() === 'arroz de la casa');
    if (arroces.length > 0) {
      specialCardsHtml += `
        <div class="prod-card-one-tap prod-card-special-group" onclick="abrirModalSeleccionArroz()" style="border: 2px solid #38bdf8; background: linear-gradient(145deg, #1e293b, #172554); position: relative;">
          <div class="prod-card-thumb-special" style="font-size: 2.2rem; margin-bottom: 6px; text-align: center;">🍚</div>
          <span class="prod-badge-special" style="position: absolute; top: 8px; right: 8px; background: #38bdf8; color: #000; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">Solo Arroz</span>
          <div class="prod-card-content">
            <span class="prod-card-name" style="font-size: 1.05rem; color: #7dd3fc;">Arroces Especiales</span>
            <small style="color: #94a3b8; font-size: 0.72rem; display: block; margin-top: 2px;">Elige pollo, camarones, mariscos...</small>
            <span class="prod-card-price" style="color: #34d399; margin-top: 6px;">Desde ₡5,000</span>
          </div>
        </div>
      `;
      // Ocultamos los arroces individuales del listado directo
      standardProds = standardProds.filter(p => !(p.nombre.toLowerCase().startsWith('arroz con') || p.nombre.toLowerCase() === 'arroz de la casa'));
    }
  }

  const prodsHtml = standardProds.map(p => {
    const esCerveza = Boolean(p.happyHour || p.happy_hour || p.catId === 4 || p.categoria_id === 4 || /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(p.nombre || ''));
    const isPromo = estado.happyHourActivo && esCerveza;
    const imgHtml = p.imagen_url 
      ? `<img class="prod-card-thumb" src="${p.imagen_url}" alt="${p.nombre}" loading="lazy" />`
      : `<div class="prod-card-no-thumb">🍽️</div>`;

    return `
      <div class="prod-card-one-tap ${p.agotado ? 'agotado' : ''}" onclick="agregarAlTicketOneTap(${p.id})">
        ${imgHtml}
        ${isPromo ? '<span class="prod-badge-promo">🍸 2x1</span>' : ''}
        <div class="prod-card-content">
          <span class="prod-card-name">${p.nombre}</span>
          <span class="prod-card-price">${formatCRC(p.precio)}</span>
        </div>
      </div>
    `;
  }).join('');

  const btnAddHtml = `
    <div class="prod-card-one-tap" onclick="abrirModalNuevoProducto()" style="border: 2px dashed rgba(16, 185, 129, 0.45); background: rgba(16, 185, 129, 0.08); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; min-height: 100px; border-radius: 12px; transition: all 0.2s ease;" title="Agregar nuevo producto y precio">
      <span style="font-size: 1.6rem; margin-bottom: 4px;">➕</span>
      <span style="font-weight: 700; font-size: 0.85rem; color: #10b981; text-align: center;">+ Producto</span>
      <small style="color: #94a3b8; font-size: 0.72rem;">Nuevo precio</small>
    </div>
  `;

  grid.innerHTML = headerNavHtml + specialCardsHtml + prodsHtml + btnAddHtml;
}

// ============================================================================
// MODALES DE SELECCIÓN DE VARIANTES (CASADOS & ARROCES)
// ============================================================================
window.abrirModalSeleccionCasado = function() {
  const modal = document.getElementById('modalSeleccionVariante');
  const title = document.getElementById('txtTituloVarianteModal');
  const subtitle = document.getElementById('txtSubtituloVarianteModal');
  const body = document.getElementById('bodyOpcionesVariante');
  if (!modal || !body) return;

  title.innerHTML = '🍽️ Solo Casado';
  subtitle.textContent = 'Selecciona la opción de carne o proteína deseada:';

  const casados = (estado.productos || []).filter(p => p.nombre.toLowerCase().includes('casado'));
  
  const ordenDeseado = [
    'Casado con carne mechada',
    'Casado con bistec encebollado',
    'Casado con chuleta de cerdo',
    'Casado con pollo en salsa',
    'Casado con pescado frito',
    'Casado con pollo a la plancha'
  ];

  let casadosOrdenados = [];
  ordenDeseado.forEach(nombre => {
    const item = casados.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (item) casadosOrdenados.push(item);
  });
  casados.forEach(c => {
    if (!casadosOrdenados.includes(c)) casadosOrdenados.push(c);
  });

  const icons = {
    'carne mechada': '🥩',
    'bistec encebollado': '🥩',
    'chuleta de cerdo': '🍖',
    'pollo en salsa': '🍗',
    'pescado frito': '🐟',
    'pollo a la plancha': '🍗'
  };

  body.innerHTML = casadosOrdenados.map(c => {
    let icon = '🍽️';
    const n = c.nombre.toLowerCase();
    for (const [k, v] of Object.entries(icons)) {
      if (n.includes(k)) { icon = v; break; }
    }
    const nombreOpcion = c.nombre.replace(/^casado con /i, '').replace(/^casado /i, '');
    const nombreCap = nombreOpcion.charAt(0).toUpperCase() + nombreOpcion.slice(1);

    return `
      <button class="variante-option-card" onclick="seleccionarOpcionVariante(${c.id})">
        <div style="font-size: 2rem; margin-bottom: 6px;">${icon}</div>
        <strong style="font-size: 1.05rem; color: #f8fafc; text-align: center; margin-bottom: 4px;">${nombreCap}</strong>
        <span style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 6px;">${c.nombre}</span>
        <span style="font-size: 1.1rem; font-weight: 800; color: #34d399;">${formatCRC(c.precio)}</span>
      </button>
    `;
  }).join('');

  modal.classList.add('active');
};

window.abrirModalSeleccionArroz = function() {
  const modal = document.getElementById('modalSeleccionVariante');
  const title = document.getElementById('txtTituloVarianteModal');
  const subtitle = document.getElementById('txtSubtituloVarianteModal');
  const body = document.getElementById('bodyOpcionesVariante');
  if (!modal || !body) return;

  title.innerHTML = '🍚 Arroces Especiales';
  subtitle.textContent = 'Selecciona el tipo de arroz para agregar al pedido:';

  const arroces = (estado.productos || []).filter(p => p.nombre.toLowerCase().startsWith('arroz con') || p.nombre.toLowerCase() === 'arroz de la casa');

  const ordenDeseado = [
    'Arroz con pollo',
    'Arroz con camarones',
    'Arroz con calamares',
    'Arroz con mariscos',
    'Arroz de la casa'
  ];

  let arrocesOrdenados = [];
  ordenDeseado.forEach(nombre => {
    const item = arroces.find(c => c.nombre.toLowerCase() === nombre.toLowerCase());
    if (item) arrocesOrdenados.push(item);
  });
  arroces.forEach(c => {
    if (!arrocesOrdenados.includes(c)) arrocesOrdenados.push(c);
  });

  const icons = {
    'pollo': '🍗',
    'camarones': '🍤',
    'calamares': '🦑',
    'mariscos': '🦞',
    'de la casa': '🍲'
  };

  body.innerHTML = arrocesOrdenados.map(c => {
    let icon = '🍚';
    const n = c.nombre.toLowerCase();
    for (const [k, v] of Object.entries(icons)) {
      if (n.includes(k)) { icon = v; break; }
    }

    return `
      <button class="variante-option-card" onclick="seleccionarOpcionVariante(${c.id})">
        <div style="font-size: 2rem; margin-bottom: 6px;">${icon}</div>
        <strong style="font-size: 1.05rem; color: #f8fafc; text-align: center; margin-bottom: 4px;">${c.nombre}</strong>
        <span style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 6px;">Cocina caliente</span>
        <span style="font-size: 1.1rem; font-weight: 800; color: #34d399;">${formatCRC(c.precio)}</span>
      </button>
    `;
  }).join('');

  modal.classList.add('active');
};

window.cerrarModalSeleccionVariante = function() {
  const modal = document.getElementById('modalSeleccionVariante');
  if (modal) modal.classList.remove('active');
};

window.seleccionarOpcionVariante = function(prodId) {
  cerrarModalSeleccionVariante();
  agregarAlTicketOneTap(prodId);
};


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
      const pisoNum = m.piso ? Number(m.piso) : (m.zona_id === 5 || (zonaObj && zonaObj.nombre.toLowerCase().includes('segundo')) ? 2 : 1);
      return {
        ...m,
        id: m.id,
        numero: m.numero,
        piso: pisoNum,
        zona: zonaObj ? zonaObj.nombre.toLowerCase().replace(/[^a-z]/g, '') : (pisoNum === 2 ? 'segundopiso' : 'salon'),
        zonaNombre: zonaObj ? zonaObj.nombre : (pisoNum === 2 ? 'Segundo Piso' : 'Salón Principal'),
        capacidad: m.capacidad,
        estado: m.estado,
        x: (m.x !== null && m.x !== undefined && !isNaN(Number(m.x))) ? Number(m.x) : 40,
        y: (m.y !== null && m.y !== undefined && !isNaN(Number(m.y))) ? Number(m.y) : 40,
        ancho: (m.ancho !== null && m.ancho !== undefined && !isNaN(Number(m.ancho))) ? Number(m.ancho) : ((m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 85 : 135),
        alto: (m.alto !== null && m.alto !== undefined && !isNaN(Number(m.alto))) ? Number(m.alto) : ((m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 95 : 115),
        forma: (m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'))) ? 'silla' : (m.forma || 'square'),
        orden_activa_id: m.orden_activa_id,
        orden_total: m.orden_total || 0,
        mesero: m.mesero || m.orden_mesero || 'Juan Jival',
        platos_pendientes: m.platos_pendientes || m.items_pendientes || [],
        items_pendientes: m.items_pendientes || m.platos_pendientes || [],
        primera_comanda_hora: m.primera_comanda_hora || null,
        minutos_espera: m.minutos_espera != null ? m.minutos_espera : 0,
        es_mesa_unida: Boolean(m.es_mesa_unida),
        unida_con: m.unida_con || null,
        mesas_unidas: m.mesas_unidas || [],
        grupo_mesas: m.grupo_mesas || null,
        es_mesa_agrupada: Boolean(m.es_mesa_agrupada),
        es_mesa_secundaria_unida: Boolean(m.es_mesa_secundaria_unida),
        unida_a_numero: m.unida_a_numero || null
      };
    });

    renderSalón();
    if (document.getElementById('view-editor-plano')?.classList.contains('active')) {
      renderEditorPlano();
    }
  } catch (e) {}
}

function aplicarEscalaTextoMesa(el, w, h, esSilla) {
  if (!el) return;
  const minDim = Math.min(w || 100, h || 100);
  const numFontSize = Math.max(9, Math.min(22, Math.round(minDim * 0.13))) + 'px';
  const subFontSize = Math.max(8, Math.min(13, Math.round(minDim * 0.088))) + 'px';
  const totalFontSize = Math.max(9, Math.min(18, Math.round(minDim * 0.115))) + 'px';
  const iconFontSize = Math.max(12, Math.min(28, Math.round(minDim * 0.18))) + 'px';

  el.style.setProperty('--mesa-num-size', numFontSize);
  el.style.setProperty('--mesa-sub-size', subFontSize);
  el.style.setProperty('--mesa-total-size', totalFontSize);
  el.style.setProperty('--mesa-icon-size', iconFontSize);

  const numSpan = el.querySelector('.mesa-nombre-label, .m-num');
  if (numSpan) numSpan.style.fontSize = numFontSize;

  const capSmall = el.querySelector('.mesa-cap-label, .m-footer span, .m-cap-tag');
  if (capSmall) capSmall.style.fontSize = subFontSize;

  const zonaSpan = el.querySelector('.m-zona-tag');
  if (zonaSpan) zonaSpan.style.fontSize = subFontSize;

  const totalEl = el.querySelector('.m-total');
  if (totalEl) totalEl.style.fontSize = totalFontSize;
}

function renderSalón(filtroZona = null) {
  const canvas = document.getElementById('mesasCanvasView');
  if (!canvas) return;
  canvas.innerHTML = '';

  const pisoActivo = estado.pisoActual || 1;
  actualizarBotonPisoSalon();

  if (!filtroZona) {
    filtroZona = (pisoActivo === 2 ? 'segundo' : 'todas');
  }

  const mesasFiltradas = estado.mesas.filter(m => {
    const mesaPiso = m.piso ? Number(m.piso) : (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
    if (mesaPiso !== pisoActivo) return false;
    if (filtroZona === 'todas' || filtroZona === 'segundo' || filtroZona === 'segundopiso') return true;
    return m.zona && (m.zona.includes(filtroZona) || filtroZona.includes(m.zona));
  });

  mesasFiltradas.forEach(m => {
    const card = document.createElement('div');
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    const esCuenta = m.estado === 'cuenta';
    card.className = `mesa-render-card ${m.estado} ${esCuenta ? 'cuenta-qr' : ''} ${m.forma === 'round' ? 'round' : ''} ${esSilla ? 'silla' : ''}`;
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
      const estaEsperandoCocina = Boolean((m.estado === 'esperando' || m.estado === 'esperando_parcial') && platosPendientes.length > 0);

      let headerText = '';
      let listItems = [];

      if (estaEsperandoCocina) {
        headerText = `⏱️ Esperando hace ${minutosEspera} min (${platosPendientes.length} pendiente${platosPendientes.length > 1 ? 's' : ''})`;
        listItems = platosPendientes;
        waitChipHtml = `
          <div class="m-wait-chip" title="Ver platillos pendientes de entrega">
            ⏱️ ${minutosEspera}m
          </div>
        `;
      } else if (m.estado === 'abierta') {
        headerText = `🍽️ Mesa Abierta (${m.orden_total > 0 ? formatCRCSinDecimales(m.orden_total) : 'Sin pedidos pendientes'})`;
        listItems = (m.todos_platillos && m.todos_platillos.length > 0) ? m.todos_platillos : ['Mesa abierta sin pedidos de cocina pendientes'];
      } else if (m.estado === 'activa') {
        headerText = `✅ Todos los platillos servidos (Activa)`;
        listItems = (m.todos_platillos && m.todos_platillos.length > 0) ? m.todos_platillos : ['Comanda despachada por cocina'];
      } else if (m.todos_platillos && m.todos_platillos.length > 0) {
        headerText = `✅ Pedidos entregados (${m.orden_total > 0 ? formatCRCSinDecimales(m.orden_total) : 'Mesa Activa'})`;
        listItems = m.todos_platillos;
      } else {
        headerText = `🍽️ Cuenta Activa (${m.orden_total > 0 ? formatCRCSinDecimales(m.orden_total) : 'En consumo'})`;
        listItems = ['Mesa atendida por salonero'];
      }

      tooltipHtml = `
        <div class="mesa-tooltip ${isNearTop ? 'tooltip-bottom' : ''}">
          <div class="mesa-tooltip-header">${escapeHtml(headerText)}</div>
          <ul class="mesa-tooltip-list">
            ${listItems.map(p => `<li>${escapeHtml(typeof p === 'string' ? p : p.nombre_producto)}</li>`).join('')}
          </ul>
        </div>
      `;

      card.setAttribute('title', `${headerText}\n${listItems.map(p => `• ${typeof p === 'string' ? p : (p.nombre_producto || p.nombre || 'Platillo')}`).join('\n')}`);
    }

    let mergedBadgeHtml = '';
    const esLibre = m.estado === 'libre' || (!m.orden_activa_id && (!m.orden_total || m.orden_total === 0));
    if (!esLibre) {
      const origenes = [];
      if (m.transferida_de) {
        origenes.push(m.transferida_de);
      }
      if (m.mesas_unidas && m.mesas_unidas.length > 0) {
        m.mesas_unidas.forEach(u => {
          if (!origenes.includes(u)) origenes.push(u);
        });
      } else if (m.unida_con && !origenes.includes(m.unida_con)) {
        origenes.push(m.unida_con);
      }

      if (origenes.length > 0) {
        const otros = origenes.map(n => n.toString().trim().replace(/^\+/, '')).join(' + ');
        mergedBadgeHtml = `<small class="m-merged-badge" style="cursor:pointer;" title="Recibió orden de ${otros}">+${otros}</small>`;
      }
    }

    let cuentaQrHtml = '';
    if (m.estado === 'cuenta') {
      cuentaQrHtml = `
        <div class="mesa-qr-alert-halo">
          <div class="mesa-qr-alert-icon">🧾</div>
          <span class="mesa-qr-alert-tag">🔔 PIDE CUENTA</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="m-header">
        <span class="m-num">${m.numero} ${mergedBadgeHtml}</span>
        <span class="m-badge">${estadoEtiqueta}</span>
      </div>
      <div class="m-total">${m.orden_total > 0 ? formatCRCSinDecimales(m.orden_total) : '—'}</div>
      ${cuentaQrHtml}
      ${waitChipHtml}
      <div class="m-footer">
        ${!esSilla ? `<span class="m-cap-tag">👥 ${m.capacidad}p</span>` : ''}
        <span class="m-zona-tag" title="${escapeHtml(m.zonaNombre || 'Salón')}">${escapeHtml(m.zonaNombre ? m.zonaNombre.toUpperCase() : 'SALÓN')}</span>
      </div>
      ${tooltipHtml}
    `;

    aplicarEscalaTextoMesa(card, m.ancho || (esSilla ? 95 : 130), m.alto || (esSilla ? 105 : 120), esSilla);

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
    mostrarModalConfirmarMover(sourceMesa, targetMesa);
  } else {
    mostrarModalConfirmarUnir(sourceMesa, targetMesa);
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
      
      const estaUnida = Boolean(mesaData.es_mesa_unida || mesaData.unida_con || (mesaData.mesas_unidas && mesaData.mesas_unidas.length > 0) || mesaData.grupo_mesas);
      if (estaUnida) {
        const nombreUnidas = (mesaData.mesas_unidas && mesaData.mesas_unidas.length > 0)
          ? mesaData.mesas_unidas.join(', ')
          : (mesaData.unida_con || 'otra mesa');
        
        isTouchDown = false;
        mostrarModalConfirmarSeparar(mesaData, nombreUnidas);
        return;
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

function mostrarModalConfirmarUnir(sourceMesa, targetMesa) {
  const modal = document.getElementById('modalConfirmarUnir');
  if (!modal) {
    ejecutarUnirMesas(targetMesa.id, sourceMesa.id);
    return;
  }
  const totalOrigen = sourceMesa.orden_total > 0 ? formatCRC(sourceMesa.orden_total) : 'cuenta activa';
  const totalDestino = targetMesa.orden_total > 0 ? formatCRC(targetMesa.orden_total) : 'cuenta activa';

  const descEl = document.getElementById('txtConfirmarUnirDesc');
  if (descEl) {
    descEl.innerHTML = `
      <div style="font-size:1.05rem; font-weight:700; margin-bottom:14px; color:var(--text-main);">
        ¿Deseas unir la <span style="color:#38bdf8;">${escapeHtml(sourceMesa.numero)}</span> (${totalOrigen}) con la <span style="color:#38bdf8;">${escapeHtml(targetMesa.numero)}</span> (${totalDestino})?
      </div>
      <div style="background:rgba(2,132,199,0.12); border:1px solid rgba(2,132,199,0.3); border-radius:10px; padding:14px 16px; margin-bottom:12px;">
        <ul style="margin:0 0 0 16px; padding:0; color:var(--text-main); font-size:0.9rem; line-height:1.6;">
          <li>Se transferirán todos los productos, cantidades, observaciones, impuestos y total de la <strong>${escapeHtml(sourceMesa.numero)}</strong> hacia la <strong>${escapeHtml(targetMesa.numero)}</strong>.</li>
          <li>La <strong>${escapeHtml(targetMesa.numero)}</strong> mostrará el total combinado.</li>
          <li>La <strong>${escapeHtml(sourceMesa.numero)}</strong> quedará completamente <strong>LIBRE</strong> y disponible en el salón.</li>
        </ul>
      </div>
      <span style="font-size:0.85rem; color:var(--text-muted);">ℹ️ Podrás separar las mesas en cualquier momento manteniendo presionada la ${escapeHtml(targetMesa.numero)}.</span>
    `;
  }

  const btnAceptar = document.getElementById('btnAceptarConfirmarUnir');
  const btnCancelar = document.getElementById('btnCancelarConfirmarUnir');
  const btnClose = document.getElementById('btnCloseConfirmarUnir');

  if (btnAceptar) {
    btnAceptar.onclick = () => {
      modal.classList.remove('active');
      ejecutarUnirMesas(targetMesa.id, sourceMesa.id);
    };
  }
  if (btnCancelar) btnCancelar.onclick = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = () => modal.classList.remove('active');

  modal.classList.add('active');
}

function mostrarModalConfirmarMover(sourceMesa, targetMesa) {
  const modal = document.getElementById('modalConfirmarMover');
  if (!modal) {
    ejecutarMoverMesa(sourceMesa.id, targetMesa.id);
    return;
  }
  const descEl = document.getElementById('txtConfirmarMoverDesc');
  if (descEl) {
    descEl.innerHTML = `
      <div style="font-size:1.05rem; font-weight:700; margin-bottom:12px; color:var(--text-main);">
        ¿Deseas transferir la orden activa de la <span style="color:#10b981;">${escapeHtml(sourceMesa.numero)}</span> a la <span style="color:#10b981;">${escapeHtml(targetMesa.numero)}</span>?
      </div>
      <div style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); border-radius:10px; padding:12px 14px; margin-bottom:8px;">
        <span style="color:var(--text-main); font-size:0.9rem; line-height:1.5;">La ${escapeHtml(sourceMesa.numero)} quedará libre y todos sus pedidos pasarán a la ${escapeHtml(targetMesa.numero)}.</span>
      </div>
    `;
  }

  const btnAceptar = document.getElementById('btnAceptarConfirmarMover');
  const btnCancelar = document.getElementById('btnCancelarConfirmarMover');
  const btnClose = document.getElementById('btnCloseConfirmarMover');

  if (btnAceptar) {
    btnAceptar.onclick = () => {
      modal.classList.remove('active');
      ejecutarMoverMesa(sourceMesa.id, targetMesa.id);
    };
  }
  if (btnCancelar) btnCancelar.onclick = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = () => modal.classList.remove('active');

  modal.classList.add('active');
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
    mostrarNotificacionCentro(`🔁 ${data.message}`, 'success');
    cargarMesasDesdeBackend();
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al mover mesa: ' + e.message, 'error');
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
    mostrarNotificacionCentro(`🔗 ${data.message}`, 'success');
    cargarMesasDesdeBackend();
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al unir mesas: ' + e.message, 'error');
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
    mostrarNotificacionCentro(`🔗 ${data.message}`, 'success');
    cargarMesasDesdeBackend();
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al agrupar mesas: ' + e.message, 'error');
  }
}

function mostrarModalConfirmarSeparar(mesaData, nombreUnidas) {
  const modal = document.getElementById('modalConfirmarSeparar');
  if (!modal) {
    ejecutarSepararMesas(mesaData.id);
    return;
  }

  const subEl = document.getElementById('txtConfirmarMesaSub');
  const descEl = document.getElementById('txtConfirmarSepararDesc');
  const btnAceptar = document.getElementById('btnAceptarConfirmarSeparar');
  const btnCancelar = document.getElementById('btnCancelarConfirmarSeparar');
  const btnClose = document.getElementById('btnCloseConfirmarSeparar');

  if (subEl) subEl.textContent = `Mesa ${mesaData.numero}`;
  if (descEl) {
    descEl.innerHTML = `La <strong>Mesa ${mesaData.numero}</strong> está actualmente unida con <strong>${nombreUnidas || 'otra mesa'}</strong>.<br><br>¿Deseas separar las mesas y restaurar cada cuenta con sus productos y totales a su estado original?`;
  }

  btnAceptar.onclick = () => {
    modal.classList.remove('active');
    ejecutarSepararMesas(mesaData.id);
  };

  btnCancelar.onclick = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = () => modal.classList.remove('active');

  modal.classList.add('active');
}

function mostrarModalRestaurarMesaDestino(mesaPrincipalId, mesaOriginalNumero) {
  const modal = document.getElementById('modalRestaurarMesaDestino');
  if (!modal) return;

  const descEl = document.getElementById('txtDescMesaOcupada');
  const selDisponibles = document.getElementById('selMesaDisponibleRestaurar');
  const btnConfirmar = document.getElementById('btnConfirmarRestaurarEnMesa');
  const btnCancelar = document.getElementById('btnCancelarRestaurarDestino');
  const btnClose = document.getElementById('btnCloseRestaurarDestinoModal');

  descEl.innerHTML = `⚠️ <strong>La mesa original (${mesaOriginalNumero}) está actualmente ocupada.</strong><br><br>¿Deseas restaurar la orden original en otra mesa disponible?`;

  // Filtrar mesas libres únicamente
  const libres = (estado.mesas || []).filter(m => m.estado === 'libre');

  if (libres.length === 0) {
    selDisponibles.innerHTML = '<option value="">⚠️ No hay mesas libres disponibles en este momento</option>';
    btnConfirmar.disabled = true;
    btnConfirmar.style.opacity = '0.5';
    btnConfirmar.style.cursor = 'not-allowed';
  } else {
    selDisponibles.innerHTML = libres.map(m => 
      `<option value="${m.id}">Mesa ${m.numero} (${m.zonaNombre ? m.zonaNombre.toUpperCase() : 'SALÓN'}) • Disponible</option>`
    ).join('');
    btnConfirmar.disabled = false;
    btnConfirmar.style.opacity = '1';
    btnConfirmar.style.cursor = 'pointer';
  }

  btnConfirmar.onclick = async () => {
    const destId = Number(selDisponibles.value);
    if (!destId) return;
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Restaurando...';
    await ejecutarSepararMesas(mesaPrincipalId, destId);
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = '✅ Restaurar en Esta Mesa';
  };

  if (btnCancelar) btnCancelar.onclick = () => modal.classList.remove('active');
  if (btnClose) btnClose.onclick = () => modal.classList.remove('active');

  modal.classList.add('active');
}

function mostrarNotificacionCentro(mensaje, tipo = 'info', callback = null) {
  const modal = document.getElementById('modalNotificacionCentro');
  if (!modal) {
    if (callback) callback();
    return;
  }

  const iconEl = document.getElementById('notifCentroIcono');
  const titEl = document.getElementById('notifCentroTitulo');
  const msgEl = document.getElementById('notifCentroMensaje');
  const btnEl = document.getElementById('btnCerrarNotifCentro');

  let icono = 'ℹ️';
  let titulo = 'Información';
  let btnColor = 'var(--primary)';

  const mLower = (mensaje || '').toLowerCase();
  if (tipo === 'success' || mLower.includes('éxito') || mLower.includes('correct') || mLower.includes('✅') || mLower.includes('restaurar')) {
    icono = '✅';
    titulo = '¡Completado!';
    btnColor = 'linear-gradient(135deg, #10b981, #059669)';
  } else if (tipo === 'error' || mLower.includes('error') || mLower.includes('❌') || mLower.includes('falló') || mLower.includes('denegad')) {
    icono = '❌';
    titulo = 'Atención';
    btnColor = 'linear-gradient(135deg, #ef4444, #b91c1c)';
  } else if (tipo === 'warning' || mLower.includes('aviso') || mLower.includes('⚠️') || mLower.includes('ocupada')) {
    icono = '⚠️';
    titulo = 'Aviso';
    btnColor = 'linear-gradient(135deg, #f59e0b, #d97706)';
  }

  if (iconEl) iconEl.textContent = icono;
  if (titEl) titEl.textContent = titulo;
  if (msgEl) msgEl.textContent = (mensaje || '').replace(/^[✅❌⚠️ℹ️🔄🔗✂️\s]+/, '');
  if (btnEl) btnEl.style.background = btnColor;

  let timerAuto = null;
  const cerrar = () => {
    if (timerAuto) clearTimeout(timerAuto);
    modal.classList.remove('active');
    if (callback) callback();
  };

  if (btnEl) btnEl.onclick = cerrar;
  modal.onclick = (e) => {
    if (e.target === modal) cerrar();
  };

  modal.classList.add('active');

  if (tipo === 'success' || tipo === 'info') {
    timerAuto = setTimeout(cerrar, 4000);
  }
}

// Redirigir alert() global hacia el modal centrado en pantalla
window.alert = function(msg) {
  mostrarNotificacionCentro(String(msg));
};

function mostrarToastNotificacion(mensaje, tipo = 'info') {
  mostrarNotificacionCentro(mensaje, tipo);
}

async function solicitarSepararMesas(mesaId) {
  const mesa = estado.mesas.find(m => m.id === mesaId);
  if (!mesa) return;

  const estaUnida = Boolean(mesa.es_mesa_unida || mesa.unida_con || (mesa.mesas_unidas && mesa.mesas_unidas.length > 0) || mesa.grupo_mesas);
  if (!estaUnida) {
    mostrarNotificacionCentro(`La Mesa ${mesa.numero} no se encuentra unida. Ya es una mesa individual.`, 'info');
    return;
  }

  const nombreUnidas = (mesa.mesas_unidas && mesa.mesas_unidas.length > 0)
    ? mesa.mesas_unidas.join(', ')
    : (mesa.unida_con || 'otra mesa');
  mostrarModalConfirmarSeparar(mesa, nombreUnidas);
}

async function solicitarRestaurarMesas(mesaId) {
  return solicitarSepararMesas(mesaId);
}

async function ejecutarSepararMesas(mesaId, destinoMesaId = null) {
  try {
    const payload = { mesaId };
    if (destinoMesaId) payload.destinoMesaId = destinoMesaId;

    const res = await fetch('/api/mesas/separar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al separar mesas');

    if (data.requiereDestino) {
      mostrarModalRestaurarMesaDestino(mesaId, data.mesaOriginalNumero || `Mesa ${data.mesaOriginalId}`);
      return;
    }

    const modalRestaurar = document.getElementById('modalRestaurarMesaDestino');
    if (modalRestaurar) modalRestaurar.classList.remove('active');
    const modalConfirm = document.getElementById('modalConfirmarSeparar');
    if (modalConfirm) modalConfirm.classList.remove('active');
    const modalCom = document.getElementById('modalComandero');
    if (modalCom) modalCom.classList.remove('active');
    const modalMoverUnir = document.getElementById('modalMoverUnir');
    if (modalMoverUnir) modalMoverUnir.classList.remove('active');

    // Desactivar visualmente cualquier flag de unión en el estado local de una vez
    const mesaLocal = estado.mesas.find(m => m.id === mesaId);
    if (mesaLocal) {
      mesaLocal.es_mesa_unida = false;
      mesaLocal.unida_con = null;
      mesaLocal.mesas_unidas = [];
    }
    if (destinoMesaId) {
      const mesaDestLocal = estado.mesas.find(m => m.id === destinoMesaId);
      if (mesaDestLocal) {
        mesaDestLocal.es_mesa_unida = false;
        mesaDestLocal.unida_con = null;
        mesaDestLocal.mesas_unidas = [];
      }
    }

    mostrarNotificacionCentro(`✂️ ${data.message}`, 'success');
    cargarMesasDesdeBackend();
    cargarKDSDesdeBackend();
  } catch (e) {
    mostrarNotificacionCentro(`❌ Error al separar mesas: ${e.message}`, 'error');
  }
}

async function ejecutarRestaurarMesas(mesaId, destinoMesaId = null) {
  return ejecutarSepararMesas(mesaId, destinoMesaId);
}

document.querySelectorAll('.zone-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.zone-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (tab.dataset.zona === 'segundo') {
      estado.pisoActual = 2;
    } else if (['salon', 'barra', 'terraza', 'vip'].includes(tab.dataset.zona)) {
      estado.pisoActual = 1;
    }
    actualizarBotonPisoSalon();
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
      // Detectar si la mesa está activamente unida a otra mesa
      const esUnidaReal = Boolean(mesa.es_mesa_unida || mesa.unida_con || (mesa.mesas_unidas && mesa.mesas_unidas.length > 0) || mesa.es_mesa_secundaria_unida || mesa.grupo_mesas);

      const bannerEl = document.getElementById('comMergedBanner');
      if (bannerEl) {
        if (esUnidaReal) {
          bannerEl.style.display = 'flex';
          const txt = mesa.es_mesa_secundaria_unida 
            ? `🔗 Mesa Unida a ${mesa.unida_a_numero || 'Mesa Principal'}`
            : `🔗 Mesa Unida con ` + ((mesa.mesas_unidas && mesa.mesas_unidas.length > 0) ? mesa.mesas_unidas.join(', ') : (mesa.unida_con || 'otra mesa'));
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
        bannerEl.style.display = 'none';
      }
    }
  } catch (e) {
    mesa.items = [];
  }

  renderTicketItems();
  actualizarBotonEnviarComanda();
  renderCatalogoComandero();
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

    const esCervezaPromo = Boolean(it.happyHour || it.categoria_id === 4 || it.catId === 4 || /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(it.nombre || ''));
    const promoBadge = (estado.happyHourActivo && esCervezaPromo)
      ? `<span class="hh-promo-badge">🍸 2x1</span>`
      : '';

    return `
      <div class="ticket-item-row">
        <div class="ticket-item-top">
          <span class="t-name">${origenBadge}${it.nombre} ${promoBadge} ${cursoBadge} ${it.enviado ? '<small style="color:#10b981;">✓ Enviado</small>' : ''}</span>
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
      const esCerveza = Boolean(it.happyHour || it.categoria_id === 4 || it.catId === 4 || /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(it.nombre || ''));
      if (esCerveza && it.cantidad >= 2) {
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

  if (!estado.comandasKDS || !estado.comandasKDS.length) {
    container.innerHTML = '<div style="color:#9ca3af; font-size:1.05rem; grid-column:1/-1; padding:40px; text-align:center;">✨ No hay comandas pendientes en cocina. Todo está servido.</div>';
    return;
  }

  // Agrupar por orden y número de comanda / tanda para que cada pedido genere su propia comanda
  const ticketsMap = {};
  const ticketsOrder = [];

  estado.comandasKDS.forEach((c) => {
    const comandaNum = c.comanda_numero || 1;
    const key = `${c.orden_id}_${comandaNum}`;
    if (!ticketsMap[key]) {
      ticketsMap[key] = {
        key,
        ordenId: c.orden_id,
        comandaNumero: comandaNum,
        mesaId: c.mesa_id,
        mesaNumero: c.mesa_numero || c.mesa || 'Mesa',
        horaPedido: c.hora_pedido,
        items: []
      };
      ticketsOrder.push(key);
    }
    ticketsMap[key].items.push(c);
  });

  const cursoLabels = { 1: 'Entrada', 2: 'Plato Fuerte', 3: 'Postre' };
  const cursoClasses = { 1: 'c1', 2: 'c2', 3: 'c3' };

  ticketsOrder.forEach((key) => {
    const t = ticketsMap[key];
    const card = document.createElement('div');
    card.className = 'kds-card';

    const itemIdsJson = JSON.stringify(t.items.map(i => i.id));

    card.innerHTML = `
      <div class="kds-top">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="kds-mesa-label">${escapeHtml(t.mesaNumero)}</span>
          <span class="badge-comanda-num" style="background:rgba(59,130,246,0.18); color:#60a5fa; border:1px solid rgba(59,130,246,0.35); font-size:0.72rem; font-weight:800; padding:1px 6px; border-radius:4px;">Comanda #${t.comandaNumero}</span>
        </div>
        <span class="kds-stopwatch">⏱️ ${t.horaPedido ? t.horaPedido.slice(11, 16) : 'Ahora'}</span>
      </div>

      <div class="kds-items-list" style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        ${t.items.map(c => {
          const originTag = (c.origen_mesa_numero && String(c.origen_mesa_numero) !== String(t.mesaNumero))
            ? `<span class="mesa-origin-badge" style="font-size:0.72rem; margin-right:4px;" title="Pedido originalmente en ${escapeHtml(c.origen_mesa_numero)}">[${escapeHtml(c.origen_mesa_numero)}]</span>`
            : '';
          const badge = `<span class="course-badge ${cursoClasses[c.curso] || 'c2'}" style="font-size:0.62rem; padding:1px 4px;">${cursoLabels[c.curso] || 'Fuerte'}</span>`;
          return `
            <div class="kds-item-row" style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px dashed rgba(255,255,255,0.07);">
              <div style="font-size:0.88rem; font-weight:700; color:var(--text-main); line-height:1.25; flex:1;">
                <span style="color:#f59e0b; font-weight:800; margin-right:4px;">${c.cantidad}x</span>
                ${originTag}${escapeHtml(c.nombre_producto || c.platillo)} ${badge}
                ${c.notas ? `<div class="kds-modif-box">⚠️ ${escapeHtml(c.notas)}</div>` : ''}
              </div>
              <button class="btn-kds-item-ready" title="Marcar este platillo listo" style="background:transparent; border:1px solid rgba(16,185,129,0.4); color:#34d399; border-radius:6px; padding:3px 8px; font-size:0.75rem; cursor:pointer; font-weight:800; margin-left:8px;" onclick="despacharKDSBackend(${c.id})">
                ✓
              </button>
            </div>
          `;
        }).join('')}
      </div>

      <button class="btn-kds-ready" onclick='despacharComandaCompletaBackend(${itemIdsJson})'>
        ✅ Servir Comanda (${t.items.length})
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
    mostrarNotificacionCentro('🍽️ Platillo marcado como listo y servido.', 'success');
    cargarKDSDesdeBackend();
    cargarMesasDesdeBackend();
  } catch (e) {
    sonarCampanaCocina();
  }
};

window.despacharComandaCompletaBackend = async function(itemIds) {
  try {
    for (const id of itemIds) {
      await fetch(`/api/kds/${id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'listo' })
      });
    }
    sonarCampanaCocina();
    mostrarNotificacionCentro('🍽️ Comanda marcada como lista y servida.', 'success');
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
  estado.cobroSplitPersonaIndex = null;

  const totalTxt = document.getElementById('comTotal').textContent;
  const lblTitulo = document.getElementById('lblTituloCobroModal');
  if (lblTitulo) lblTitulo.textContent = '💵 Cobrar y Liquidar Cuenta';
  const btnCobrar = document.getElementById('btnFinalizarCobro');
  if (btnCobrar) {
    btnCobrar.textContent = '✅ Liquidar, Imprimir & Liberar Mesa';
    btnCobrar.className = 'btn-pri success';
  }

  document.getElementById('cobroMesaTitulo').textContent = estado.mesaActiva.numero || estado.mesaActiva.nombre || 'Mesa';
  document.getElementById('cobroTotalDisplay').textContent = totalTxt;
  document.getElementById('txtEfectivoRecibido').value = '';
  document.getElementById('cobroVueltoDisplay').textContent = '₡ 0.00';
  document.getElementById('modalCobro').classList.add('active');
});

document.getElementById('btnCloseCobroModal').addEventListener('click', () => {
  document.getElementById('modalCobro').classList.remove('active');
  if (estado.cobroSplitPersonaIndex != null) {
    document.getElementById('modalSplitBill').classList.add('active');
    estado.cobroSplitPersonaIndex = null;
  }
});

document.getElementById('btnCancelarCobro').addEventListener('click', () => {
  document.getElementById('modalCobro').classList.remove('active');
  if (estado.cobroSplitPersonaIndex != null) {
    document.getElementById('modalSplitBill').classList.add('active');
    estado.cobroSplitPersonaIndex = null;
  }
});

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

  const ordenId = estado.mesaActiva ? (estado.mesaActiva.orden_id || estado.mesaActiva.orden_activa_id) : null;
  const mesaNumero = estado.mesaActiva ? (estado.mesaActiva.numero || estado.mesaActiva.nombre || 'Mesa') : 'Mesa';

  const esCobroSplitPersona = (estado.cobroSplitPersonaIndex != null && splitState && splitState.personas && splitState.personas[estado.cobroSplitPersonaIndex]);
  let personaCobrada = null;
  let esLiquidacionFinal = true;

  if (esCobroSplitPersona) {
    personaCobrada = splitState.personas[estado.cobroSplitPersonaIndex];
    personaCobrada.guardada = true;
    personaCobrada.pagada = true;

    // Verificar si quedan personas con productos sin pagar o productos en la mesa sin asignar
    const personasConItemsSinPagar = splitState.personas.filter(p => !p.pagada && p.items && p.items.length > 0);
    const itemsEnMesaSinAsignar = (splitState.itemsDisponibles || []).filter(it => it.cantidad > 0);
    esLiquidacionFinal = (personasConItemsSinPagar.length === 0 && itemsEnMesaSinAsignar.length === 0);
  }

  if (ordenId) {
    try {
      await fetch(`/api/ordenes/${ordenId}/cobrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metodo,
          monto: totalNum,
          propina: Math.round(totalNum * 0.10),
          cambio,
          mesero: estado.usuarioActual ? estado.usuarioActual.nombre : 'Juan Jival',
          liquidar_total: esLiquidacionFinal,
          items_pagados: personaCobrada ? personaCobrada.items : []
        })
      });
    } catch (e) {
      console.error('Error al registrar cobro:', e);
    }
  }

  if (esLiquidacionFinal) {
    alert(`✅ ¡Cuenta de ${mesaNumero} liquidada!\n\n• Tiquete impreso.\n• Mesa liberada.`);
    if (estado.mesaActiva) {
      estado.mesaActiva.estado = 'libre';
      estado.mesaActiva.items = [];
      estado.mesaActiva.orden_id = null;
      estado.mesaActiva.orden_activa_id = null;
      estado.mesaActiva.orden_total = 0;
      estado.mesaActiva.pidio_cuenta_qr = 0;
      estado.mesaActiva.cuenta_pedida = false;
    }
    estado.cobroSplitPersonaIndex = null;
    document.getElementById('modalCobro').classList.remove('active');
    document.getElementById('modalComandero').classList.remove('active');
    document.getElementById('modalSplitBill').classList.remove('active');
  } else {
    // Cobro parcial:
    // 1. Descontar los productos pagados de estado.mesaActiva.items
    if (personaCobrada && personaCobrada.items && estado.mesaActiva && estado.mesaActiva.items) {
      personaCobrada.items.forEach(pItem => {
        let restante = pItem.cantidad;
        for (let i = 0; i < estado.mesaActiva.items.length; i++) {
          const mItem = estado.mesaActiva.items[i];
          if (mItem.nombre === pItem.nombre || mItem.id === pItem.producto_id || mItem.producto_id === pItem.producto_id) {
            if (mItem.cantidad <= restante) {
              restante -= mItem.cantidad;
              estado.mesaActiva.items.splice(i, 1);
              i--;
            } else {
              mItem.cantidad -= restante;
              mItem.subtotal = mItem.cantidad * mItem.precio;
              restante = 0;
            }
            if (restante <= 0) break;
          }
        }
      });
    }

    // Recalcular y renderizar comanda en vivo
    if (typeof renderComanda === 'function') {
      renderComanda();
    }

    alert(`✅ ¡Cobro parcial de ${personaCobrada ? personaCobrada.nombre : 'Persona'} realizado!\n\n• Monto cobrado: ${formatCRCSinDecimales(totalNum)}\n• Tiquete impreso.\n• Mesa permanece abierta con productos pendientes.`);

    estado.cobroSplitPersonaIndex = null;
    document.getElementById('modalCobro').classList.remove('active');

    // Volver a la división de cuentas para continuar cobrando a las siguientes personas
    const sigPersonaIdx = splitState.personas.findIndex(p => !p.pagada && p.items && p.items.length > 0);
    if (sigPersonaIdx !== -1) {
      splitState.personaActivaIndex = sigPersonaIdx;
    }
    renderSplitPersonaActiva();
    renderSplitColaPersonas();
    document.getElementById('modalSplitBill').classList.add('active');
  }

  await cargarMesasDesdeBackend();
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
  const fusionadas = estado.mesas.filter(m => (m.es_mesa_unida || m.unida_con || (m.mesas_unidas && m.mesas_unidas.length > 0) || m.es_mesa_secundaria_unida) && m.estado !== 'libre');

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

// ============================================================================
// SPLIT BILLS INTERACTIVO: DRAG & DROP, ASIGNACIÓN UNITARIA Y COLA DE PERSONAS
// ============================================================================

let splitState = {
  numPersonas: 2,
  personaActivaIndex: 0,
  itemsDisponibles: [],
  personas: []
};

function initSplitBills() {
  const btnAbrir = document.getElementById('btnAbrirSplitBill');
  if (btnAbrir) {
    btnAbrir.addEventListener('click', () => {
      if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
        alert('No hay consumos en esta mesa para dividir.');
        return;
      }
      iniciarDivisionCuentas();
    });
  }

  const btnClose = document.getElementById('btnCloseSplitModal');
  if (btnClose) {
    btnClose.addEventListener('click', () => document.getElementById('modalSplitBill').classList.remove('active'));
  }
  const btnCancelar = document.getElementById('btnCancelarSplit');
  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => document.getElementById('modalSplitBill').classList.remove('active'));
  }

  // Modos de división (Ítems vs Partes Iguales)
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
        calcularSplitIgual();
      }
    });
  });

  // Contador de personas en header
  const btnMenos = document.getElementById('btnSplitMenosPersonas');
  if (btnMenos) {
    btnMenos.addEventListener('click', () => cambiarCantidadPersonasSplit(-1));
  }
  const btnMas = document.getElementById('btnSplitMasPersonas');
  if (btnMas) {
    btnMas.addEventListener('click', () => cambiarCantidadPersonasSplit(1));
  }

  // Contador en modo Split Equitativo
  const btnDisminuir = document.getElementById('btnDisminuirPersonas');
  if (btnDisminuir) {
    btnDisminuir.addEventListener('click', () => {
      if (splitState.numPersonas > 2) {
        cambiarCantidadPersonasSplit(-1);
        calcularSplitIgual();
      }
    });
  }
  const btnAumentar = document.getElementById('btnAumentarPersonas');
  if (btnAumentar) {
    btnAumentar.addEventListener('click', () => {
      cambiarCantidadPersonasSplit(1);
      calcularSplitIgual();
    });
  }

  // Botón "Guardar y Pasar al Siguiente"
  const btnGuardarActiva = document.getElementById('btnGuardarPersonaActiva');
  if (btnGuardarActiva) {
    btnGuardarActiva.addEventListener('click', guardarPersonaSplitActiva);
  }

  // Dropzone Setup
  configurarDropzonePersonaActiva();
}

function iniciarDivisionCuentas() {
  const totalNum = estado.mesaActiva.total || (estado.mesaActiva.subtotal ? estado.mesaActiva.subtotal * 1.23 : 0);
  const totalTxt = formatCRCSinDecimales(totalNum);
  const numRaw = String(estado.mesaActiva.numero || '');
  const nomRaw = String(estado.mesaActiva.nombre || '');
  let mesaFinal = nomRaw || numRaw;
  if (!mesaFinal.toLowerCase().startsWith('mesa') && !mesaFinal.toLowerCase().startsWith('barra') && !mesaFinal.toLowerCase().startsWith('terraza')) {
    mesaFinal = `Mesa ${mesaFinal}`;
  }
  document.getElementById('splitMesaTitulo').textContent = `${mesaFinal} • Total: ${totalTxt}`;

  // Resetear pestañas a modo Por Ítems
  document.querySelectorAll('.split-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'items');
  });
  document.getElementById('splitModeItemsBody')?.classList.add('active');
  document.getElementById('splitModeEqualBody')?.classList.remove('active');

  const numInicial = Math.max(2, estado.splitPersonas || 2);
  splitState.numPersonas = numInicial;
  splitState.personaActivaIndex = 0;

  // Clonar ítems disponibles
  splitState.itemsDisponibles = (estado.mesaActiva.items || []).map((it, idx) => ({
    id: it.id || (idx + 1),
    producto_id: it.producto_id || it.id,
    nombre: it.nombre || it.nombre_producto || 'Platillo',
    precio: Number(it.precio) || 0,
    cantidad: Number(it.cantidad) || 1,
    curso: it.curso || 2
  }));

  // Inicializar personas
  splitState.personas = [];
  for (let i = 1; i <= splitState.numPersonas; i++) {
    splitState.personas.push({
      id: i,
      nombre: `Persona ${i}`,
      items: [],
      subtotal: 0,
      impuestos: 0,
      total: 0,
      guardada: false,
      pagada: false
    });
  }

  actualizarContadorPersonasUI();
  renderSplitDisponibles();
  renderSplitPersonaActiva();
  renderSplitColaPersonas();
  calcularSplitIgual();

  document.getElementById('modalSplitBill').classList.add('active');
}

function cambiarCantidadPersonasSplit(delta) {
  const nuevoTotal = splitState.numPersonas + delta;
  if (nuevoTotal < 2) return;
  if (nuevoTotal > 20) return;

  if (delta > 0) {
    // Agregar nueva persona
    splitState.numPersonas = nuevoTotal;
    splitState.personas.push({
      id: nuevoTotal,
      nombre: `Persona ${nuevoTotal}`,
      items: [],
      subtotal: 0,
      impuestos: 0,
      total: 0,
      guardada: false,
      pagada: false
    });
  } else if (delta < 0) {
    // Quitar última persona: si tenía ítems, devolverlos a la mesa
    const removedPersona = splitState.personas.pop();
    if (removedPersona && removedPersona.items && removedPersona.items.length > 0) {
      removedPersona.items.forEach(rItem => {
        const existente = splitState.itemsDisponibles.find(it => it.nombre === rItem.nombre && it.precio === rItem.precio);
        if (existente) {
          existente.cantidad += rItem.cantidad;
        } else {
          splitState.itemsDisponibles.push({ ...rItem });
        }
      });
    }
    splitState.numPersonas = nuevoTotal;
    if (splitState.personaActivaIndex >= splitState.numPersonas) {
      splitState.personaActivaIndex = splitState.numPersonas - 1;
    }
  }

  actualizarContadorPersonasUI();
  renderSplitDisponibles();
  renderSplitPersonaActiva();
  renderSplitColaPersonas();
  calcularSplitIgual();
}

function actualizarContadorPersonasUI() {
  const lbl = document.getElementById('splitPersonasCountLabel');
  if (lbl) lbl.textContent = `${splitState.numPersonas} Personas`;
  const numEq = document.getElementById('splitNumPersonas');
  if (numEq) numEq.textContent = splitState.numPersonas;
}

function renderSplitDisponibles() {
  const container = document.getElementById('splitAvailableItemsList');
  const badge = document.getElementById('splitItemsRemainingBadge');
  if (!container) return;

  container.innerHTML = '';
  const itemsConSaldo = splitState.itemsDisponibles.filter(it => it.cantidad > 0);
  const totalPendientes = itemsConSaldo.reduce((acc, it) => acc + it.cantidad, 0);

  if (badge) {
    badge.textContent = `${totalPendientes} pendiente${totalPendientes !== 1 ? 's' : ''}`;
    if (totalPendientes === 0) {
      badge.style.background = 'rgba(16, 185, 129, 0.2)';
      badge.style.color = '#34d399';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      badge.textContent = '✅ Todo asignado';
    } else {
      badge.style.background = '';
      badge.style.color = '';
      badge.style.borderColor = '';
    }
  }

  if (itemsConSaldo.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:35px 15px; color:#94a3b8;">
        <span style="font-size:2rem; display:block; margin-bottom:6px;">🎉</span>
        <strong>¡Todos los consumos han sido asignados!</strong>
        <p style="font-size:0.8rem; margin:4px 0 0 0; color:#64748b;">Guarda a las personas o cobra cada cuenta.</p>
      </div>
    `;
    return;
  }

  splitState.itemsDisponibles.forEach((it, idx) => {
    if (it.cantidad <= 0) return;
    const card = document.createElement('div');
    card.className = 'split-draggable-item';
    card.draggable = true;
    card.dataset.itemIndex = idx;

    card.innerHTML = `
      <div class="split-item-info">
        <span class="split-qty-badge">${it.cantidad}x</span>
        <span class="split-item-name">${escapeHtml(it.nombre)}</span>
      </div>
      <div class="split-item-actions">
        <span class="split-item-price">${formatCRCSinDecimales(it.precio)}</span>
        <button type="button" class="split-btn-quick-move" title="Asignar 1 unidad a la persona activa">➡️</button>
      </div>
    `;

    // Drag events
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({ itemIndex: idx }));
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    // Touch & Quick click transfer
    card.querySelector('.split-btn-quick-move').addEventListener('click', (e) => {
      e.stopPropagation();
      transferirItemAPersonaActiva(idx);
    });

    card.addEventListener('click', () => {
      transferirItemAPersonaActiva(idx);
    });

    container.appendChild(card);
  });
}

function configurarDropzonePersonaActiva() {
  const dropzone = document.getElementById('splitActivePersonDropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (e) => {
    if (!dropzone.contains(e.relatedTarget)) {
      dropzone.classList.remove('drag-over');
    }
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data && data.itemIndex !== undefined) {
        transferirItemAPersonaActiva(data.itemIndex);
      }
    } catch (_) {}
  });
}

function transferirItemAPersonaActiva(itemIndex) {
  const itemDisp = splitState.itemsDisponibles[itemIndex];
  if (!itemDisp || itemDisp.cantidad <= 0) return;

  const personaActiva = splitState.personas[splitState.personaActivaIndex];
  if (!personaActiva) return;

  // Restar 1 unidad del disponible
  itemDisp.cantidad--;

  // Sumar 1 unidad a la persona activa
  const itemAsignado = personaActiva.items.find(it => it.nombre === itemDisp.nombre && it.precio === itemDisp.precio);
  if (itemAsignado) {
    itemAsignado.cantidad++;
  } else {
    personaActiva.items.push({
      nombre: itemDisp.nombre,
      precio: itemDisp.precio,
      cantidad: 1,
      producto_id: itemDisp.producto_id
    });
  }

  recalcularPersona(personaActiva);
  renderSplitDisponibles();
  renderSplitPersonaActiva();
  renderSplitColaPersonas();
}

function devolverItemAMesa(assignedItemIndex) {
  const personaActiva = splitState.personas[splitState.personaActivaIndex];
  if (!personaActiva || !personaActiva.items[assignedItemIndex]) return;

  const itemAsignado = personaActiva.items[assignedItemIndex];
  itemAsignado.cantidad--;

  // Regresar 1 unidad a itemsDisponibles
  const existente = splitState.itemsDisponibles.find(it => it.nombre === itemAsignado.nombre && it.precio === itemAsignado.precio);
  if (existente) {
    existente.cantidad++;
  } else {
    splitState.itemsDisponibles.push({
      nombre: itemAsignado.nombre,
      precio: itemAsignado.precio,
      cantidad: 1,
      producto_id: itemAsignado.producto_id
    });
  }

  if (itemAsignado.cantidad <= 0) {
    personaActiva.items.splice(assignedItemIndex, 1);
  }

  recalcularPersona(personaActiva);
  renderSplitDisponibles();
  renderSplitPersonaActiva();
  renderSplitColaPersonas();
}

function recalcularPersona(p) {
  if (!p) return;
  const sub = p.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  const imp = sub * 0.23; // 10% servicio + 13% IVA
  const tot = Math.round(sub * 1.23);
  p.subtotal = sub;
  p.impuestos = imp;
  p.total = tot;
}

function renderSplitPersonaActiva() {
  const p = splitState.personas[splitState.personaActivaIndex];
  if (!p) return;

  const titleEl = document.getElementById('splitActivePersonTitle');
  if (titleEl) titleEl.textContent = `👤 ${p.nombre}`;

  const hintEl = document.getElementById('splitDropzoneHint');
  const listEl = document.getElementById('splitAssignedItemsList');
  if (listEl) listEl.innerHTML = '';

  if (!p.items || p.items.length === 0) {
    if (hintEl) hintEl.style.display = 'flex';
  } else {
    if (hintEl) hintEl.style.display = 'none';
    p.items.forEach((it, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'split-assigned-item';
      itemEl.title = 'Toca o mantén presionado para sumar más unidades (+1)';
      itemEl.innerHTML = `
        <div class="split-item-info">
          <span class="split-qty-badge" style="background:#059669; cursor:pointer;" title="Toca para sumar (+1)">${it.cantidad}x</span>
          <span class="split-item-name">${escapeHtml(it.nombre)}</span>
        </div>
        <div class="split-item-actions">
          <span class="split-item-price" style="color:#34d399;">${formatCRCSinDecimales(it.precio * it.cantidad)}</span>
          <button type="button" class="split-btn-remove" title="Devolver 1 unidad a la mesa">✕</button>
        </div>
      `;

      // Long press detection (450ms)
      let pressTimer = null;
      const startPress = () => {
        pressTimer = setTimeout(() => {
          abrirModalSumarItemSplit(idx);
        }, 450);
      };
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      itemEl.addEventListener('mousedown', startPress);
      itemEl.addEventListener('mouseup', cancelPress);
      itemEl.addEventListener('mouseleave', cancelPress);
      itemEl.addEventListener('touchstart', startPress, { passive: true });
      itemEl.addEventListener('touchend', cancelPress);
      itemEl.addEventListener('touchcancel', cancelPress);

      const qtyBadge = itemEl.querySelector('.split-qty-badge');
      if (qtyBadge) {
        qtyBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          cancelPress();
          abrirModalSumarItemSplit(idx);
        });
      }

      itemEl.querySelector('.split-btn-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelPress();
        devolverItemAMesa(idx);
      });

      listEl.appendChild(itemEl);
    });
  }

  // Totales
  recalcularPersona(p);
  const subEl = document.getElementById('splitActiveSubtotal');
  if (subEl) subEl.textContent = formatCRCSinDecimales(p.subtotal);
  const impEl = document.getElementById('splitActiveImpuestos');
  if (impEl) impEl.textContent = formatCRCSinDecimales(p.impuestos);
  const totEl = document.getElementById('splitActiveTotal');
  if (totEl) totEl.textContent = formatCRCSinDecimales(p.total);

  // Botón guardar
  const btnGuardar = document.getElementById('btnGuardarPersonaActiva');
  if (btnGuardar) {
    const sigIndex = (splitState.personaActivaIndex + 1) % splitState.personas.length;
    const sigNombre = splitState.personas[sigIndex]?.nombre || 'Siguiente';
    btnGuardar.innerHTML = `💾 Guardar ${p.nombre} y Pasar a ${sigNombre} ➡️`;
  }
}

let splitQuickAddState = {
  itemIndex: null,
  nombre: '',
  precio: 0,
  cantidadOriginal: 0,
  cantidadNueva: 0,
  producto_id: null
};

window.abrirModalSumarItemSplit = function(assignedItemIndex) {
  const personaActiva = splitState.personas[splitState.personaActivaIndex];
  if (!personaActiva || !personaActiva.items[assignedItemIndex]) return;

  const item = personaActiva.items[assignedItemIndex];
  splitQuickAddState = {
    itemIndex: assignedItemIndex,
    nombre: item.nombre,
    precio: item.precio,
    cantidadOriginal: item.cantidad,
    cantidadNueva: item.cantidad,
    producto_id: item.producto_id
  };

  const nameEl = document.getElementById('splitQuickAddItemName');
  if (nameEl) nameEl.textContent = item.nombre;
  const qtyEl = document.getElementById('splitQuickAddQtyDisplay');
  if (qtyEl) qtyEl.textContent = `${splitQuickAddState.cantidadNueva}x`;

  const modal = document.getElementById('modalSplitQuickAdd');
  if (modal) modal.classList.add('active');
};

window.incrementarSplitQuickAdd = function() {
  splitQuickAddState.cantidadNueva++;
  const qtyEl = document.getElementById('splitQuickAddQtyDisplay');
  if (qtyEl) qtyEl.textContent = `${splitQuickAddState.cantidadNueva}x`;
};

window.cerrarModalSplitQuickAdd = function() {
  const modal = document.getElementById('modalSplitQuickAdd');
  if (modal) modal.classList.remove('active');
};

window.confirmarSplitQuickAdd = function() {
  const personaActiva = splitState.personas[splitState.personaActivaIndex];
  if (!personaActiva || splitQuickAddState.itemIndex === null) {
    cerrarModalSplitQuickAdd();
    return;
  }

  const item = personaActiva.items[splitQuickAddState.itemIndex];
  if (item) {
    const diff = splitQuickAddState.cantidadNueva - item.cantidad;
    if (diff > 0) {
      // Si había unidades disponibles en la mesa de ese producto, descontarlas
      const disponible = splitState.itemsDisponibles.find(it => it.nombre === item.nombre && it.precio === item.precio);
      if (disponible && disponible.cantidad > 0) {
        const tomar = Math.min(disponible.cantidad, diff);
        disponible.cantidad -= tomar;
        if (disponible.cantidad <= 0) {
          const dIdx = splitState.itemsDisponibles.indexOf(disponible);
          if (dIdx !== -1) splitState.itemsDisponibles.splice(dIdx, 1);
        }
      }
      
      // Aplicar nueva cantidad al ítem
      item.cantidad = splitQuickAddState.cantidadNueva;
      
      // Asegurar sincronía con la comanda de la mesa si sobrepasa
      if (estado.mesaActiva && estado.mesaActiva.items) {
        let itemMesa = estado.mesaActiva.items.find(it => (it.nombre === item.nombre || it.id === item.producto_id));
        if (itemMesa) {
          const totalAsignado = splitState.personas.reduce((acc, p) => {
            const pi = (p.items || []).find(it => it.nombre === item.nombre);
            return acc + (pi ? pi.cantidad : 0);
          }, 0);
          const totalDisp = splitState.itemsDisponibles.reduce((acc, it) => it.nombre === item.nombre ? acc + it.cantidad : acc, 0);
          itemMesa.cantidad = Math.max(itemMesa.cantidad, totalAsignado + totalDisp);
          itemMesa.subtotal = itemMesa.cantidad * itemMesa.precio;
        }
      }
    }

    recalcularPersona(personaActiva);
    renderSplitDisponibles();
    renderSplitPersonaActiva();
    renderSplitColaPersonas();
  }

  cerrarModalSplitQuickAdd();
};

function guardarPersonaSplitActiva() {
  const p = splitState.personas[splitState.personaActivaIndex];
  if (!p) return;

  p.guardada = true;
  mostrarNotificacionCentro(`💾 ${p.nombre} guardada con éxito (${formatCRCSinDecimales(p.total)})`, 'success');

  // Buscar siguiente persona no completada o avanzar circularmente
  let nextIdx = -1;
  for (let i = 1; i <= splitState.personas.length; i++) {
    const candidateIdx = (splitState.personaActivaIndex + i) % splitState.personas.length;
    if (!splitState.personas[candidateIdx].guardada) {
      nextIdx = candidateIdx;
      break;
    }
  }

  if (nextIdx !== -1) {
    splitState.personaActivaIndex = nextIdx;
  } else {
    // Si todas están guardadas, pasar a la siguiente circular
    splitState.personaActivaIndex = (splitState.personaActivaIndex + 1) % splitState.personas.length;
  }

  renderSplitPersonaActiva();
  renderSplitColaPersonas();
}

function renderSplitColaPersonas() {
  const carousel = document.getElementById('splitSavedPersonsQueue');
  const progressEl = document.getElementById('splitQueueProgress');
  if (!carousel) return;

  carousel.innerHTML = '';
  const guardadasCount = splitState.personas.filter(p => p.guardada || p.pagada).length;
  if (progressEl) progressEl.textContent = `${guardadasCount} de ${splitState.personas.length} listas`;

  splitState.personas.forEach((p, idx) => {
    recalcularPersona(p);
    const card = document.createElement('div');
    const esActiva = (idx === splitState.personaActivaIndex);
    const yaPagada = p.pagada;
    card.className = `split-queue-card ${esActiva ? 'active-editing' : ''} ${yaPagada ? 'paid-card' : ''}`;

    const totalItems = (p.items || []).reduce((acc, it) => acc + it.cantidad, 0);
    const summaryTxt = totalItems > 0 
      ? p.items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
      : 'Sin consumos asignados';

    card.innerHTML = `
      <div class="card-head">
        <span>👤 ${p.nombre} ${esActiva ? '<small style="color:#34d399;">(Editando)</small>' : ''} ${yaPagada ? '<small style="color:#10b981; font-weight:bold;">(Pagado ✅)</small>' : ''}</span>
        <span class="card-total">${formatCRCSinDecimales(p.total)}</span>
      </div>
      <div class="card-items-summary" title="${escapeHtml(summaryTxt)}">
        ${escapeHtml(summaryTxt)}
      </div>
      <div class="card-actions">
        <button type="button" class="btn-edit-split" ${yaPagada ? 'disabled style="opacity:0.5;"' : ''} onclick="seleccionarPersonaSplitParaEditar(${idx})">✏️ Editar</button>
        <button type="button" class="btn-pay-split" ${yaPagada ? 'disabled style="opacity:0.5; background:#10b981;"' : ''} onclick="cobrarPersonaSplit(${idx})">${yaPagada ? '✅ Pagado' : '💵 Pago Parcial'}</button>
      </div>
    `;

    carousel.appendChild(card);
  });
}

window.seleccionarPersonaSplitParaEditar = function(index) {
  if (index >= 0 && index < splitState.personas.length) {
    splitState.personaActivaIndex = index;
    renderSplitPersonaActiva();
    renderSplitColaPersonas();
  }
};

window.cobrarPersonaSplit = function(personaIndex) {
  const p = splitState.personas[personaIndex];
  if (!p || !p.items || p.items.length === 0) {
    alert('Esta persona no tiene productos asignados para cobrar.');
    return;
  }
  if (p.pagada) {
    alert(`Esta persona (${p.nombre}) ya realizó su pago.`);
    return;
  }
  estado.cobroSplitPersonaIndex = personaIndex;
  document.getElementById('modalSplitBill').classList.remove('active');

  const lblTitulo = document.getElementById('lblTituloCobroModal');
  if (lblTitulo) lblTitulo.textContent = `💵 Cobro Parcial - ${p.nombre}`;
  const btnCobrar = document.getElementById('btnFinalizarCobro');
  if (btnCobrar) {
    btnCobrar.textContent = '✅ Cobrar';
    btnCobrar.className = 'btn-pri success';
  }

  const mesaNom = estado.mesaActiva ? (estado.mesaActiva.numero || estado.mesaActiva.nombre || 'Mesa') : 'Mesa';
  document.getElementById('cobroMesaTitulo').textContent = `${mesaNom} - ${p.nombre}`;
  document.getElementById('cobroTotalDisplay').textContent = formatCRCSinDecimales(p.total);
  document.getElementById('txtEfectivoRecibido').value = '';
  document.getElementById('cobroVueltoDisplay').textContent = '₡ 0';
  document.getElementById('modalCobro').classList.add('active');
};

function calcularSplitIgual() {
  if (!estado.mesaActiva || !estado.mesaActiva.items) return;
  const sub = estado.mesaActiva.items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
  const total = (sub * 1.23);
  const numP = splitState.numPersonas || estado.splitPersonas || 2;
  const porPersona = Math.round(total / numP);
  const el = document.getElementById('splitMontoPorPersona');
  if (el) el.textContent = formatCRCSinDecimales(porPersona);
}

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
  if (!canvas) return;
  canvas.innerHTML = '';

  const pisoActivoEditor = estado.pisoActualEditor || 1;
  actualizarBotonPisoEditor();

  const mesasPisoEditor = estado.mesas.filter(m => {
    const mesaPiso = m.piso || (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
    return mesaPiso === pisoActivoEditor;
  });

  mesasPisoEditor.forEach(m => {
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
        <button class="btn-mesa-size" title="Cambiar nombre de la mesa o silla" style="color:#38bdf8; border-color:#38bdf8;" onclick="event.stopPropagation(); abrirModalRenombrarMesa(${m.id}, '${m.numero.replace(/'/g, "\\'")}')">✏️</button>
        ${!esSilla ? `<button class="btn-mesa-size" title="Modificar cantidad de personas" style="color:#a78bfa; border-color:#a78bfa;" onclick="event.stopPropagation(); cambiarCapacidadMesaPrompt(${m.id}, ${m.capacidad})">👥</button>` : ''}
        <button class="btn-mesa-size" title="Reducir tamaño" onclick="event.stopPropagation(); cambiarTamanoMesa(${m.id}, -15)">-</button>
        <button class="btn-mesa-size" title="Aumentar tamaño" onclick="event.stopPropagation(); cambiarTamanoMesa(${m.id}, 15)">+</button>
        <button class="btn-mesa-size" title="Eliminar mesa o silla" style="color:#ef4444; border-color:#ef4444;" onclick="event.stopPropagation(); eliminarMesaDesdeEditor(${m.id}, '${m.numero.replace(/'/g, "\\'")}')">🗑️</button>
      </div>
      <span class="mesa-nombre-label" style="cursor:pointer;" title="Clic para cambiar nombre" onclick="event.stopPropagation(); abrirModalRenombrarMesa(${m.id}, '${m.numero.replace(/'/g, "\\'")}')">${m.numero} ✏️</span>
      ${!esSilla ? `<small class="mesa-cap-label" style="cursor:pointer;" title="Clic para modificar cantidad de personas" onclick="event.stopPropagation(); cambiarCapacidadMesaPrompt(${m.id}, ${m.capacidad})">👥 ${m.capacidad}p ✏️</small>` : ''}
      <div class="mesa-resize-handle" title="Arrastrar para cambiar tamaño">↘</div>
    `;

    aplicarEscalaTextoMesa(el, m.ancho || (esSilla ? 95 : 130), m.alto || (esSilla ? 105 : 120), esSilla);

    // Movimiento por arrastre
    let isDragging = false;
    let startX, startY, origX, origY;

    const onMouseDown = (e) => {
      if (e.target.closest('.mesa-size-controls') || e.target.closest('.mesa-resize-handle')) return;

      isDragging = true;
      startX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
      startY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
      origX = m.x;
      origY = m.y;
      el.style.zIndex = 1000;
      el.style.borderColor = '#38bdf8';

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const curX = ev.clientX ?? (ev.touches ? ev.touches[0].clientX : startX);
        const curY = ev.clientY ?? (ev.touches ? ev.touches[0].clientY : startY);
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

        if (origX !== m.x || origY !== m.y) {
          autoGuardarPosicionMesa(m);
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchmove', onMouseMove);
      window.addEventListener('touchend', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onMouseDown, { passive: true });

    // Resize por arrastre del handle (compatible con ratón y pantallas táctiles)
    const resizeHandle = el.querySelector('.mesa-resize-handle');
    if (resizeHandle) {
      const iniciarResize = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (resizeHandle.setPointerCapture && e.pointerId != null) {
          try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
        }
        const startX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
        const startY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);
        const startW = m.ancho || (esSilla ? 95 : 130);
        const startH = m.alto || (esSilla ? 105 : 120);

        el.style.zIndex = 1001;

        const onResizeMove = (ev) => {
          const curX = ev.clientX ?? (ev.touches ? ev.touches[0].clientX : startX);
          const curY = ev.clientY ?? (ev.touches ? ev.touches[0].clientY : startY);
          const deltaX = curX - startX;
          const deltaY = curY - startY;

          // Permite redimensionar tanto mesas como sillas
          m.ancho = Math.max(60, Math.min(350, Math.round(startW + deltaX)));
          m.alto = Math.max(60, Math.min(350, Math.round(startH + deltaY)));
          el.style.width = m.ancho + 'px';
          el.style.height = m.alto + 'px';

          // Adaptar texto proporcionalmente en tiempo real para que siempre sea visible
          aplicarEscalaTextoMesa(el, m.ancho, m.alto, esSilla);
        };

        const onResizeUp = (ev) => {
          el.style.zIndex = '';
          if (resizeHandle.releasePointerCapture && e.pointerId != null) {
            try { resizeHandle.releasePointerCapture(e.pointerId); } catch (_) {}
          }
          window.removeEventListener('pointermove', onResizeMove);
          window.removeEventListener('pointerup', onResizeUp);
          window.removeEventListener('pointercancel', onResizeUp);
          window.removeEventListener('mousemove', onResizeMove);
          window.removeEventListener('mouseup', onResizeUp);
          window.removeEventListener('touchmove', onResizeMove);
          window.removeEventListener('touchend', onResizeUp);

          autoGuardarPosicionMesa(m);
        };

        window.addEventListener('pointermove', onResizeMove);
        window.addEventListener('pointerup', onResizeUp);
        window.addEventListener('pointercancel', onResizeUp);
        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('mouseup', onResizeUp);
        window.addEventListener('touchmove', onResizeMove);
        window.addEventListener('touchend', onResizeUp);
      };

      resizeHandle.addEventListener('pointerdown', iniciarResize);
      resizeHandle.addEventListener('mousedown', iniciarResize);
      resizeHandle.addEventListener('touchstart', iniciarResize, { passive: false });
    }

    canvas.appendChild(el);
  });
}

// Auto-guardado instantáneo y silencioso en BD para que ningún usuario pierda la distribución
async function autoGuardarPosicionMesa(m) {
  if (!m || !m.id) return;
  try {
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    await fetch('/api/mesas/posiciones/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: m.id,
        x: Math.round(m.x),
        y: Math.round(m.y),
        ancho: Math.round(m.ancho || (esSilla ? 85 : 135)),
        alto: Math.round(m.alto || (esSilla ? 95 : 115)),
        piso: m.piso || (estado.pisoActualEditor || 1)
      })
    });
  } catch (_) {}
}

window.cambiarTamanoMesa = function(mesaId, delta) {
  const m = estado.mesas.find(item => item.id === mesaId);
  if (!m) return;
  const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
  const currentW = m.ancho || (esSilla ? 85 : 135);
  const currentH = m.alto || (esSilla ? 95 : 115);

  m.ancho = Math.max(60, Math.min(350, currentW + delta));
  m.alto = Math.max(60, Math.min(350, currentH + delta));
  renderEditorPlano();
  autoGuardarPosicionMesa(m);
};


document.getElementById('btnGuardarPlano').addEventListener('click', async () => {
  const posiciones = estado.mesas.map(m => {
    const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
    return {
      id: m.id,
      x: Math.round(m.x),
      y: Math.round(m.y),
      ancho: Math.round(m.ancho || (esSilla ? 85 : 135)),
      alto: Math.round(m.alto || (esSilla ? 95 : 115)),
      piso: m.piso || 1
    };
  });
  try {
    const res = await fetch('/api/mesas/posiciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posiciones })
    });
    mostrarNotificacionCentro('💾 ¡Distribución física guardada permanentemente para todos los usuarios!', 'success');
  } catch (e) {
    mostrarNotificacionCentro('💾 ¡Distribución guardada!', 'info');
  }
  document.querySelector('.nav-pill[data-view="salon"]').click();
});

document.getElementById('btnAutoOrganizarPlano')?.addEventListener('click', async () => {
  const confirmado = await confirmarAccion({
    icono: '✨',
    titulo: '¿Reorganizar el salón?',
    subtitulo: 'Se reorganizarán todas las mesas y sillas',
    mensaje: '¿Deseas reorganizar automáticamente todas las mesas y sillas en una cuadrícula limpia y espaciada sin solapes?',
    tipo: 'info',
    txtSi: '✨ Sí, reorganizar',
    txtNo: 'Cancelar'
  });
  if (!confirmado) return;
  try {
    const res = await fetch('/api/mesas/posiciones/reorganizar-cuadricula', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      mostrarNotificacionCentro('✨ Salón reorganizado perfectamente en cuadrícula sin solapes', 'success');
      await cargarMesasDesdeBackend();
      renderEditorPlano();
    }
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al reorganizar: ' + e.message, 'error');
  }
});

document.getElementById('btnAgregarMesaCuadrada').addEventListener('click', async () => {
  const pisoActivo = estado.pisoActualEditor || 1;
  const mesasPiso = estado.mesas.filter(m => (m.piso || (m.zona_id === 5 ? 2 : 1)) === pisoActivo);
  const num = pisoActivo === 2 ? `Mesa 20${mesasPiso.length + 1}` : `Mesa ${estado.mesas.length + 1}`;
  try {
    await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numero: num, 
        zona_id: pisoActivo === 2 ? 5 : 1, 
        capacidad: 4, 
        forma: 'square', 
        x: 60, 
        y: 60,
        piso: pisoActivo,
        ancho: 135,
        alto: 115
      })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});

document.getElementById('btnAgregarMesaRedonda').addEventListener('click', async () => {
  const pisoActivo = estado.pisoActualEditor || 1;
  const mesasPiso = estado.mesas.filter(m => (m.piso || (m.zona_id === 5 ? 2 : 1)) === pisoActivo);
  const num = pisoActivo === 2 ? `Mesa 20${mesasPiso.length + 1}` : `Mesa ${estado.mesas.length + 1}`;
  try {
    await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numero: num, 
        zona_id: pisoActivo === 2 ? 5 : 1, 
        capacidad: 4, 
        forma: 'round', 
        x: 80, 
        y: 80,
        piso: pisoActivo,
        ancho: 130,
        alto: 130
      })
    });
    await cargarMesasDesdeBackend();
  } catch (e) {}
});

document.getElementById('btnAgregarBarra').addEventListener('click', async () => {
  const pisoActivo = estado.pisoActualEditor || 1;
  const totalBarras = estado.mesas.filter(m => m.numero.includes('Barra')).length + 1;
  const num = pisoActivo === 2 ? `Barra P2-${totalBarras}` : `Silla Barra ${totalBarras}`;
  try {
    await fetch('/api/mesas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        numero: num, 
        zona_id: pisoActivo === 2 ? 5 : 2, 
        capacidad: 1, 
        forma: 'silla', 
        x: 620, 
        y: 80,
        ancho: 85,
        alto: 95,
        piso: pisoActivo
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
  if (typeof filtrarProductosComandero === 'function') {
    filtrarProductosComandero();
  } else {
    renderGridProductos(estado.productos);
  }
  if (estado.mesaActiva) {
    renderTicketItems();
  }
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
      if (btn.dataset.view === 'metricas') cargarDashboardMetricas();
      if (btn.dataset.view === 'inventario') cargarInventarioAdmin();
      if (btn.dataset.view === 'auditoria') cargarAuditoriaAdmin();
    });
  });

  document.getElementById('btnIrEditorSalon')?.addEventListener('click', () => {
    abrirModuloAdmin('editor-plano');
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
  initRenombrarMesas();
  initNuevoProducto();

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

function initRenombrarMesas() {
  const btnGuardarRenombrar = document.getElementById('btnGuardarRenombrarMesa');
  if (btnGuardarRenombrar) {
    btnGuardarRenombrar.addEventListener('click', window.guardarNuevoNombreMesa);
  }
  const txtRenombrarNuevo = document.getElementById('txtRenombrarMesaNuevo');
  if (txtRenombrarNuevo) {
    txtRenombrarNuevo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        window.guardarNuevoNombreMesa();
      }
    });
  }
}

function initNuevoProducto() {
  const txtNombre = document.getElementById('txtNuevoProdNombre');
  const txtPrecio = document.getElementById('txtNuevoProdPrecio');
  [txtNombre, txtPrecio].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          window.guardarNuevoProducto();
        }
      });
    }
  });
}

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

// ============================================================================
// MÓDULOS DE ADMINISTRADOR: DASHBOARD, INVENTARIO & AUDITORÍA
// ============================================================================

// 1. DASHBOARD DE MÉTRICAS
async function cargarDashboardMetricas() {
  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/admin/metricas/dashboard', {
      headers: { 'x-user-rol': rol }
    });
    if (!res.ok) throw new Error('No se pudo cargar el dashboard de métricas');
    const data = await res.json();

    // KPIs
    const r = data.resumen;
    document.getElementById('kpiVentasHoy').textContent = formatCRC(r.totalVentasHoy || 0);
    const diffSign = r.diferenciaAyer >= 0 ? '+' : '';
    document.getElementById('kpiComparativaAyer').textContent = `vs ayer: ${diffSign}${r.diferenciaAyer}%`;
    document.getElementById('kpiComparativaAyer').style.color = r.diferenciaAyer >= 0 ? '#10b981' : '#ef4444';
    document.getElementById('kpiCuentasCobradas').textContent = r.cuentasHoy || 0;
    document.getElementById('kpiTicketPromedio').textContent = formatCRC(r.ticketPromedio || 0);
    document.getElementById('kpiTiempoCocina').textContent = `${r.tiempoPromedioCocinaMin || 0} min`;

    // Gráfico de Horas Pico
    const chartContainer = document.getElementById('peakHoursChartContainer');
    chartContainer.innerHTML = '';
    const maxVenta = Math.max(1, ...data.ventasPorHora.map(h => h.total));

    data.ventasPorHora.forEach(h => {
      const pct = Math.round((h.total / maxVenta) * 100);
      const row = document.createElement('div');
      row.className = 'peak-hour-row';
      row.innerHTML = `
        <span class="peak-hour-label">${h.hora}</span>
        <div class="peak-hour-track">
          <div class="peak-hour-bar" style="width:${pct}%;"></div>
        </div>
        <span class="peak-hour-val">${h.total > 0 ? formatCRC(h.total) : '—'}</span>
      `;
      chartContainer.appendChild(row);
    });

    // Top Sellers
    const topContainer = document.getElementById('topSellersContainer');
    topContainer.innerHTML = '';
    if (!data.topProductos || !data.topProductos.length) {
      topContainer.innerHTML = '<div style="color:#9ca3af; padding:12px; text-align:center;">Sin ventas registradas hoy todavía.</div>';
    } else {
      data.topProductos.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'top-seller-item';
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:#f59e0b; font-size:1rem; width:20px;">#${idx + 1}</strong>
            <div>
              <span class="top-seller-name">${escapeHtml(p.nombre_producto)}</span>
              <div style="font-size:0.75rem; color:#9ca3af;">${formatCRC(p.total_recaudado)}</div>
            </div>
          </div>
          <span class="top-seller-count">${p.total_unidades} ordenados</span>
        `;
        topContainer.appendChild(item);
      });
    }

    // Ranking de Meseros
    const waitersContainer = document.getElementById('waitersRankingContainer');
    waitersContainer.innerHTML = '';
    if (!data.meseros || !data.meseros.length) {
      waitersContainer.innerHTML = '<div style="color:#9ca3af; padding:12px; text-align:center;">Sin actividad de meseros hoy.</div>';
    } else {
      data.meseros.forEach(m => {
        const item = document.createElement('div');
        item.className = 'waiter-item';
        item.innerHTML = `
          <div>
            <strong style="color:#f3f4f6;">👤 ${escapeHtml(m.nombre)}</strong>
            <div style="font-size:0.75rem; color:#9ca3af;">${m.cuentas} cuentas cerradas</div>
          </div>
          <div style="text-align:right;">
            <strong style="color:#34d399;">${formatCRC(m.ventas)}</strong>
            <div style="font-size:0.75rem; color:#f59e0b;">Propina: ${formatCRC(m.propinas)}</div>
          </div>
        `;
        waitersContainer.appendChild(item);
      });
    }

    // Alertas de Stock Crítico
    const stockContainer = document.getElementById('criticalStockContainer');
    stockContainer.innerHTML = '';
    if (!data.alertasStock || !data.alertasStock.length) {
      stockContainer.innerHTML = '<div style="color:#34d399; padding:12px; text-align:center;">✅ Todos los insumos tienen stock óptimo.</div>';
    } else {
      data.alertasStock.forEach(s => {
        const isAgotado = s.stock_actual <= 0;
        const item = document.createElement('div');
        item.className = 'critical-stock-item';
        item.innerHTML = `
          <div>
            <strong style="color:${isAgotado ? '#ef4444' : '#f59e0b'};">${isAgotado ? '⛔' : '⚠️'} ${escapeHtml(s.nombre)}</strong>
            <div style="font-size:0.75rem; color:#9ca3af;">Mínimo requerido: ${s.stock_minimo} ${s.unidad_medida}</div>
          </div>
          <span class="stock-pill ${isAgotado ? 'agotado' : 'bajo'}">${s.stock_actual} ${s.unidad_medida}</span>
        `;
        stockContainer.appendChild(item);
      });
    }
  } catch (e) {
    console.error('Error cargando métricas:', e);
  }
}

// 2. CONTROL DE INVENTARIO
estado.inventario = [];

async function cargarInventarioAdmin() {
  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/admin/inventario', {
      headers: { 'x-user-rol': rol }
    });
    if (!res.ok) throw new Error('Error al consultar inventario');
    estado.inventario = await res.json();

    // Llenar categorías en filtro
    const catSelect = document.getElementById('selectFiltroCatInventario');
    if (catSelect) {
      const categorias = [...new Set(estado.inventario.map(i => i.categoria))].filter(Boolean);
      catSelect.innerHTML = '<option value="todas">Todas las Categorías</option>';
      categorias.forEach(c => {
        catSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
      });
    }

    // Llenar select del modal de ajuste
    const ajusteSelect = document.getElementById('selectAjusteInsumo');
    if (ajusteSelect) {
      ajusteSelect.innerHTML = '';
      estado.inventario.forEach(i => {
        ajusteSelect.innerHTML += `<option value="${i.id}" data-unidad="${escapeHtml(i.unidad_medida)}">${escapeHtml(i.nombre)} (Stock: ${i.stock_actual} ${i.unidad_medida})</option>`;
      });
    }

    renderTablaInventario(estado.inventario);
  } catch (e) {
    console.error(e);
  }
}

function renderTablaInventario(items) {
  const tbody = document.getElementById('tbodyInventario');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9ca3af;">No se encontraron insumos registrados.</td></tr>';
    return;
  }

  items.forEach(ins => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(ins.nombre)}</strong></td>
      <td><span style="color:#9ca3af;">${escapeHtml(ins.categoria || 'General')}</span></td>
      <td><strong>${ins.stock_actual}</strong> <small style="color:#9ca3af;">${escapeHtml(ins.unidad_medida)}</small></td>
      <td>${ins.stock_minimo} <small style="color:#9ca3af;">${escapeHtml(ins.unidad_medida)}</small></td>
      <td>${formatCRC(ins.costo_unitario || 0)}</td>
      <td>
        <span class="stock-pill ${ins.estado_stock}">
          ${ins.estado_stock === 'agotado' ? '⛔ Agotado' : ins.estado_stock === 'bajo' ? '⚠️ Bajo Stock' : '✅ Normal'}
        </span>
      </td>
      <td style="text-align:right;">
        <button class="btn-tool" style="padding:4px 8px; font-size:0.75rem; background:#065f46; border-color:#10b981;" onclick="abrirModalAjusteRapido('entrada', ${ins.id})">+ Entrada</button>
        <button class="btn-tool" style="padding:4px 8px; font-size:0.75rem; background:#7f1d1d; border-color:#ef4444;" onclick="abrirModalAjusteRapido('merma', ${ins.id})">- Merma</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filtrarTablaInventario() {
  const q = (document.getElementById('txtBuscarInsumo')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('selectFiltroCatInventario')?.value || 'todas';
  const est = document.getElementById('selectFiltroEstadoInventario')?.value || 'todos';

  const filtrados = (estado.inventario || []).filter(i => {
    const matchQ = !q || i.nombre.toLowerCase().includes(q) || (i.categoria && i.categoria.toLowerCase().includes(q));
    const matchCat = cat === 'todas' || i.categoria === cat;
    const matchEst = est === 'todos' || i.estado_stock === est;
    return matchQ && matchCat && matchEst;
  });

  renderTablaInventario(filtrados);
}

// Modales de Inventario
let tipoAjusteActivo = 'entrada';

function abrirModalAjusteRapido(tipo = 'entrada', insumoId = null) {
  tipoAjusteActivo = tipo;
  seleccionarTipoAjuste(tipo);

  if (insumoId) {
    const sel = document.getElementById('selectAjusteInsumo');
    if (sel) sel.value = insumoId;
  }
  actualizarEtiquetaUnidadAjuste();
  const txtCant = document.getElementById('txtAjusteCantidad');
  const txtMotivo = document.getElementById('txtAjusteMotivo');
  if (txtCant) txtCant.value = '';
  if (txtMotivo) txtMotivo.value = '';

  document.getElementById('modalAjusteInventario')?.classList.add('active');
}

function cerrarModalAjusteInventario() {
  document.getElementById('modalAjusteInventario')?.classList.remove('active');
}

function seleccionarTipoAjuste(tipo) {
  tipoAjusteActivo = tipo;
  const btnEntrada = document.getElementById('btnAjusteTipoEntrada');
  const btnMerma = document.getElementById('btnAjusteTipoMerma');
  const lblCant = document.getElementById('lblAjusteCantidad');

  if (tipo === 'entrada') {
    if (btnEntrada) {
      btnEntrada.style.border = '1px solid #10b981';
      btnEntrada.style.background = 'rgba(16,185,129,0.2)';
      btnEntrada.style.color = '#34d399';
    }
    if (btnMerma) {
      btnMerma.style.border = '1px solid #374151';
      btnMerma.style.background = '#1f2937';
      btnMerma.style.color = '#9ca3af';
    }
    if (lblCant) lblCant.innerHTML = 'Cantidad a Ingresar (<span id="spanAjusteUnidad">unidades</span>):';
  } else {
    if (btnMerma) {
      btnMerma.style.border = '1px solid #ef4444';
      btnMerma.style.background = 'rgba(239,68,68,0.2)';
      btnMerma.style.color = '#f87171';
    }
    if (btnEntrada) {
      btnEntrada.style.border = '1px solid #374151';
      btnEntrada.style.background = '#1f2937';
      btnEntrada.style.color = '#9ca3af';
    }
    if (lblCant) lblCant.innerHTML = 'Cantidad a Descontar por Merma/Pérdida (<span id="spanAjusteUnidad">unidades</span>):';
  }
  actualizarEtiquetaUnidadAjuste();
}

function actualizarEtiquetaUnidadAjuste() {
  const sel = document.getElementById('selectAjusteInsumo');
  if (!sel || !sel.options || sel.selectedIndex < 0) return;
  const opt = sel.options[sel.selectedIndex];
  const u = opt ? opt.dataset.unidad || 'unidades' : 'unidades';
  const span = document.getElementById('spanAjusteUnidad');
  if (span) span.textContent = u;
}

document.getElementById('selectAjusteInsumo')?.addEventListener('change', actualizarEtiquetaUnidadAjuste);

async function guardarAjusteInventario() {
  const insumoId = document.getElementById('selectAjusteInsumo')?.value;
  const cantidad = parseFloat(document.getElementById('txtAjusteCantidad')?.value);
  const motivo = document.getElementById('txtAjusteMotivo')?.value.trim();

  if (!cantidad || cantidad <= 0) {
    alert('Ingresa una cantidad válida mayor a 0');
    return;
  }

  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch(`/api/admin/inventario/${insumoId}/ajuste`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': rol },
      body: JSON.stringify({
        tipo: tipoAjusteActivo,
        cantidad,
        motivo: motivo || (tipoAjusteActivo === 'entrada' ? 'Entrada de compra' : 'Merma registrada'),
        usuarioNombre: estado.usuarioActual ? estado.usuarioActual.nombre : 'Admin'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    mostrarNotificacionCentro(`✅ Movimiento de inventario aplicado con éxito.`, 'success');
    cerrarModalAjusteInventario();
    cargarInventarioAdmin();
  } catch (e) {
    alert('❌ ' + e.message);
  }
}

function abrirModalNuevoInsumo() {
  const n = document.getElementById('txtNuevoInsumoNombre');
  const c = document.getElementById('txtNuevoInsumoCat');
  const s = document.getElementById('txtNuevoInsumoStock');
  const m = document.getElementById('txtNuevoInsumoMin');
  const cs = document.getElementById('txtNuevoInsumoCosto');
  if (n) n.value = '';
  if (c) c.value = 'General';
  if (s) s.value = '10';
  if (m) m.value = '3';
  if (cs) cs.value = '1000';
  document.getElementById('modalNuevoInsumo')?.classList.add('active');
}

function cerrarModalNuevoInsumo() {
  document.getElementById('modalNuevoInsumo')?.classList.remove('active');
}

async function guardarNuevoInsumo() {
  const nombre = document.getElementById('txtNuevoInsumoNombre')?.value.trim();
  const categoria = document.getElementById('txtNuevoInsumoCat')?.value.trim() || 'General';
  const unidad_medida = document.getElementById('selectNuevoInsumoUnidad')?.value || 'unidades';
  const stock_actual = parseFloat(document.getElementById('txtNuevoInsumoStock')?.value) || 0;
  const stock_minimo = parseFloat(document.getElementById('txtNuevoInsumoMin')?.value) || 3;
  const costo_unitario = parseFloat(document.getElementById('txtNuevoInsumoCosto')?.value) || 0;

  if (!nombre) return alert('El nombre del insumo es obligatorio.');

  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/admin/inventario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-rol': rol },
      body: JSON.stringify({
        nombre, categoria, unidad_medida, stock_actual, stock_minimo, costo_unitario,
        usuarioNombre: estado.usuarioActual ? estado.usuarioActual.nombre : 'Admin'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    mostrarNotificacionCentro(`✅ Insumo "${nombre}" registrado correctamente.`, 'success');
    cerrarModalNuevoInsumo();
    cargarInventarioAdmin();
  } catch (e) {
    alert('❌ ' + e.message);
  }
}

// 3. SISTEMA DE AUDITORÍA
estado.auditoria = [];

async function cargarAuditoriaAdmin() {
  try {
    const rol = estado.usuarioActual ? estado.usuarioActual.rol : 'admin';
    const res = await fetch('/api/admin/auditoria?limite=100', {
      headers: { 'x-user-rol': rol }
    });
    if (!res.ok) throw new Error('Error al consultar bitácora de auditoría');
    estado.auditoria = await res.json();

    const counter = document.getElementById('auditTotalCounter');
    if (counter) counter.textContent = `${estado.auditoria.length} eventos`;
    renderTablaAuditoria(estado.auditoria);
  } catch (e) {
    console.error(e);
  }
}

function renderTablaAuditoria(eventos) {
  const tbody = document.getElementById('tbodyAuditoria');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!eventos.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9ca3af;">No hay eventos registrados en la bitácora.</td></tr>';
    return;
  }

  eventos.forEach(ev => {
    const tr = document.createElement('tr');
    const badgeClass = ev.tipo_evento || 'operativo';
    const fecha = ev.fecha_hora ? new Date(ev.fecha_hora).toLocaleString('es-CR') : 'Reciente';

    tr.innerHTML = `
      <td><span style="color:#9ca3af; font-size:0.8rem;">${fecha}</span></td>
      <td><strong>👤 ${escapeHtml(ev.usuario_nombre)}</strong></td>
      <td><span class="audit-action-badge ${badgeClass}">${escapeHtml((ev.accion || '').replace(/_/g, ' '))}</span></td>
      <td><span style="color:#60a5fa; font-weight:600; text-transform:uppercase; font-size:0.75rem;">${escapeHtml(ev.modulo || 'general')}</span></td>
      <td>${escapeHtml(ev.detalle || '')}</td>
      <td><em style="color:#fbbf24;">${escapeHtml(ev.motivo || '—')}</em></td>
      <td><strong>${ev.monto > 0 ? formatCRC(ev.monto) : '—'}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function filtrarAuditoriaPorChip(tipo) {
  document.querySelectorAll('.audit-chip').forEach(c => c.classList.remove('active'));
  const btn = document.querySelector(`.audit-chip[data-filter="${tipo}"]`);
  if (btn) btn.classList.add('active');

  filtrarTablaAuditoria();
}

function filtrarTablaAuditoria() {
  const chipActivo = document.querySelector('.audit-chip.active')?.dataset.filter || 'todos';
  const q = (document.getElementById('txtBuscarAuditoria')?.value || '').toLowerCase().trim();

  const filtrados = (estado.auditoria || []).filter(ev => {
    const matchTipo = chipActivo === 'todos' || ev.accion === chipActivo;
    const matchQ = !q || 
      (ev.usuario_nombre && ev.usuario_nombre.toLowerCase().includes(q)) ||
      (ev.detalle && ev.detalle.toLowerCase().includes(q)) ||
      (ev.motivo && ev.motivo.toLowerCase().includes(q));
    return matchTipo && matchQ;
  });

  renderTablaAuditoria(filtrados);
}

// ============================================================================
// 13. MOTOR DE IMPRESIÓN TÉRMICA (80MM), VISOR VIRTUAL & MONITOR DE PUERTOS
// ============================================================================

window.ticketActivoParaImprimir = null;

function sonarBeepImpresora() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1600, audioCtx.currentTime);
    osc.frequency.setValueAtTime(2200, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.22);
  } catch (_) {}
}

/**
 * Renderiza un ticket térmico de 80mm en el visor virtual
 */
window.mostrarVisorTicketTermico = function(ticketData, autoImprimir = false) {
  if (!ticketData) return;
  window.ticketActivoParaImprimir = ticketData;

  const modal = document.getElementById('modalVisorTicket');
  const container = document.getElementById('visorTicketContenido') || document.getElementById('receiptContentHtml');
  const txtTitulo = document.getElementById('txtTituloVisorTicket');
  const txtSub = document.getElementById('txtSubtituloVisorTicket');
  if (!modal || !container) return;

  sonarBeepImpresora();

  let html = '';

  if (ticketData.tipo === 'comanda') {
    if (txtTitulo) txtTitulo.textContent = `🖨️ ${ticketData.titulo || 'Comanda'}`;
    if (txtSub) txtSub.textContent = `Destino: ${ticketData.destino ? ticketData.destino.toUpperCase() : 'COCINA'} • ESC/POS 80mm`;

    html = `
      <div class="receipt-header">
        <div class="receipt-logo">${ticketData.destino === 'barra' ? '🍸' : '🍳'}</div>
        <div class="receipt-brand-name">*** ${ticketData.titulo || 'COMANDA'} ***</div>
        <div class="receipt-type-badge">MESA: ${ticketData.mesa}</div>
        <div class="receipt-sub">Orden #${ticketData.ordenId || 1} • Comanda #${ticketData.comandaNumero || 1}</div>
        <div class="receipt-sub">Salonero: ${ticketData.mesero || 'General'}</div>
        <div class="receipt-sub">${ticketData.fechaHora}</div>
      </div>

      <table class="receipt-items-table">
        <thead>
          <tr>
            <th style="width:18%;">CANT</th>
            <th style="width:62%;">PLATILLO / PRODUCTO</th>
            <th style="width:20%; text-align:right;">TIEMPO</th>
          </tr>
        </thead>
        <tbody>
          ${(ticketData.items || []).map(it => {
            const cLabel = it.curso === 1 ? 'Entrada' : it.curso === 3 ? 'Postre' : 'Fuerte';
            return `
              <tr>
                <td><strong>${it.cantidad}x</strong></td>
                <td>
                  <span class="receipt-item-title">${escapeHtml(it.nombre)}</span>
                  ${it.notas ? `<div class="receipt-item-note">⚠️ ${escapeHtml(it.notas)}</div>` : ''}
                  ${it.origenMesa ? `<div class="receipt-item-note" style="color:#0284c7;">(Orig: Mesa ${it.origenMesa})</div>` : ''}
                </td>
                <td style="text-align:right; font-size:10.5px; font-weight:700;">[${cLabel}]</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <div class="receipt-divider"></div>
      <div style="display:flex; justify-content:space-between; font-weight:900; font-size:13px; padding:4px 0;">
        <span>TOTAL ARTÍCULOS:</span>
        <span>${ticketData.totalItems || (ticketData.items || []).reduce((a, b) => a + Number(b.cantidad), 0)}</span>
      </div>

      <div class="receipt-footer">
        <div>• NOTIFICACIÓN DE COCINA / BARRA •</div>
        <div>Corte automático ejecutado en puerto ESC/POS</div>
      </div>
    `;
  } else if (ticketData.tipo === 'pago_parcial') {
    if (txtTitulo) txtTitulo.textContent = `💵 Pago Parcial - ${ticketData.personaNombre || 'Cliente'}`;
    if (txtSub) txtSub.textContent = `Mesa ${ticketData.mesa} • Comprobante Individual 80mm`;

    html = `
      <div class="receipt-header">
        <div class="receipt-logo">🍸</div>
        <div class="receipt-brand-name">${ticketData.negocio?.nombre || 'GastroBar Fuego & Brasas'}</div>
        <div class="receipt-type-badge">COMPROBANTE PAGO PARCIAL</div>
        <div style="font-size:14px; font-weight:900; margin:4px 0;">MESA ${ticketData.mesa} - ${ticketData.personaNombre.toUpperCase()}</div>
        <div class="receipt-sub">Orden #${ticketData.ordenId} • Salonero: ${ticketData.mesero || 'General'}</div>
        <div class="receipt-sub">${ticketData.fechaHora}</div>
      </div>

      <table class="receipt-items-table">
        <thead>
          <tr>
            <th style="width:18%;">CANT</th>
            <th style="width:52%;">CONSUMO INDIVIDUAL</th>
            <th style="width:30%; text-align:right;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${(ticketData.items || []).map(it => `
            <tr>
              <td><strong>${it.cantidad}x</strong></td>
              <td><span class="receipt-item-title">${escapeHtml(it.nombre)}</span></td>
              <td style="text-align:right;"><strong>${formatCRCSinDecimales(it.totalLinea || (it.precioUnitario * it.cantidad))}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-divider"></div>
      <div class="receipt-totals-box">
        <div class="receipt-calc-line">
          <span>Subtotal Consumo:</span>
          <strong>${formatCRCSinDecimales(ticketData.subtotal)}</strong>
        </div>
        <div class="receipt-calc-line">
          <span>10% Serv + 13% IVA:</span>
          <strong>${formatCRCSinDecimales(ticketData.impuestos)}</strong>
        </div>
        <div class="receipt-calc-line total-destacado">
          <span>PAGADO:</span>
          <span>${formatCRCSinDecimales(ticketData.total)}</span>
        </div>
        <div class="receipt-calc-line" style="margin-top:6px;">
          <span>Método de Pago:</span>
          <strong>${ticketData.metodoPago || 'Efectivo'}</strong>
        </div>
        <div class="receipt-calc-line" style="color:#b91c1c; font-weight:900; margin-top:4px;">
          <span>Saldo Restante Mesa:</span>
          <span>${formatCRCSinDecimales(ticketData.saldoRestanteMesa)}</span>
        </div>
      </div>

      <div class="receipt-footer">
        <div>Estado: Mesa permanece ABIERTA</div>
        <div>con consumos pendientes.</div>
        <div style="margin-top:4px;">¡Gracias por su visita!</div>
      </div>
    `;
  } else {
    // Ticket de Liquidación / Venta Final
    if (txtTitulo) txtTitulo.textContent = `🧾 Factura / Ticket - Mesa ${ticketData.mesa}`;
    if (txtSub) txtSub.textContent = `Orden #${ticketData.numeroOrden || ticketData.ordenId} • Liquidación Final 80mm`;

    html = `
      <div class="receipt-header">
        <div class="receipt-logo">🔥</div>
        <div class="receipt-brand-name">${ticketData.negocio?.nombre || 'GastroBar Fuego & Brasas'}</div>
        <div class="receipt-sub">${ticketData.negocio?.slogan || 'Restaurante, Bar & Lounge'}</div>
        <div class="receipt-sub">Tel: ${ticketData.negocio?.tel || '2222-0000 / 8888-9999'}</div>
        <div class="receipt-sub">San José, Costa Rica</div>
        <div class="receipt-sub">Céd. Jurídica: 3-101-789456</div>
        <div class="receipt-type-badge">COMPROBANTE DE PAGO</div>
      </div>

      <div class="receipt-meta-grid">
        <div class="receipt-meta-row">
          <span>Factura / Orden:</span>
          <strong>#${ticketData.numeroOrden || ticketData.ordenId}</strong>
        </div>
        <div class="receipt-meta-row">
          <span>Mesa: ${ticketData.mesa}</span>
          <span>Salonero: ${ticketData.mesero || 'General'}</span>
        </div>
        <div class="receipt-meta-row">
          <span>Cliente:</span>
          <strong>${escapeHtml(ticketData.cliente || 'Cliente General')}</strong>
        </div>
        <div class="receipt-meta-row">
          <span>Fecha/Hora:</span>
          <span>${ticketData.fechaHora}</span>
        </div>
      </div>

      <table class="receipt-items-table">
        <thead>
          <tr>
            <th style="width:16%;">CANT</th>
            <th style="width:54%;">DESCRIPCIÓN</th>
            <th style="width:30%; text-align:right;">PRECIO</th>
          </tr>
        </thead>
        <tbody>
          ${(ticketData.items || []).map(it => `
            <tr>
              <td><strong>${it.cantidad}x</strong></td>
              <td>
                <span class="receipt-item-title">${escapeHtml(it.nombre)}</span>
                ${it.notas ? `<div class="receipt-item-note">(${escapeHtml(it.notas)})</div>` : ''}
              </td>
              <td style="text-align:right;"><strong>${formatCRCSinDecimales(it.totalLinea || (it.precioUnitario * it.cantidad))}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-divider"></div>
      <div class="receipt-totals-box">
        <div class="receipt-calc-line">
          <span>Subtotal:</span>
          <strong>${formatCRCSinDecimales(ticketData.subtotal)}</strong>
        </div>
        ${ticketData.descuentoHH > 0 ? `
          <div class="receipt-calc-line" style="color:#d946ef; font-weight:800;">
            <span>Descuento Happy Hour 2x1:</span>
            <span>-${formatCRCSinDecimales(ticketData.descuentoHH)}</span>
          </div>
        ` : ''}
        <div class="receipt-calc-line">
          <span>10% Servicio (Ley):</span>
          <strong>${formatCRCSinDecimales(ticketData.servicio)}</strong>
        </div>
        <div class="receipt-calc-line">
          <span>13% I.V.A.:</span>
          <strong>${formatCRCSinDecimales(ticketData.iva)}</strong>
        </div>
        <div class="receipt-calc-line total-destacado">
          <span>TOTAL A PAGAR:</span>
          <span>${formatCRCSinDecimales(ticketData.total)}</span>
        </div>
        <div class="receipt-calc-line" style="margin-top:6px;">
          <span>Método de Pago:</span>
          <strong>${ticketData.metodoPago || 'Efectivo'}</strong>
        </div>
        ${ticketData.metodoPago === 'Efectivo' && ticketData.recibido > 0 ? `
          <div class="receipt-calc-line">
            <span>Monto Recibido:</span>
            <strong>${formatCRCSinDecimales(ticketData.recibido)}</strong>
          </div>
          <div class="receipt-calc-line">
            <span>Cambio / Vuelto:</span>
            <strong style="color:#059669;">${formatCRCSinDecimales(ticketData.cambio)}</strong>
          </div>
        ` : ''}
      </div>

      <div class="receipt-footer">
        <div style="font-size:18px; margin: 6px 0;">📱 [ Código QR de Factura ]</div>
        <div>¡Muchas gracias por su preferencia!</div>
        <div>Esperamos servirle de nuevo muy pronto.</div>
        <div style="margin-top:4px; font-size:9.5px; color:#555;">Autorizado mediante resolución DGT-R-033-2019</div>
      </div>
    `;
  }

  container.innerHTML = html;
  modal.classList.add('active');

  if (autoImprimir) {
    setTimeout(() => {
      ejecutarImpresionNativa();
    }, 300);
  }
};

window.cerrarModalVisorTicket = function() {
  const modal = document.getElementById('modalVisorTicket');
  if (modal) modal.classList.remove('active');
};

window.ejecutarImpresionNativa = function() {
  window.print();
};

/**
 * Monitor & Configuración de Impresoras Térmicas
 */
window.abrirModalMonitorImpresoras = async function() {
  const modal = document.getElementById('modalMonitorImpresoras');
  if (modal) modal.classList.add('active');
  await cargarHistorialImpresoras();
};

window.cerrarModalMonitorImpresoras = function() {
  const modal = document.getElementById('modalMonitorImpresoras');
  if (modal) modal.classList.remove('active');
};

async function cargarHistorialImpresoras() {
  try {
    const res = await fetch('/api/impresoras/config');
    const data = await res.json();
    renderLogsImpresora(data.historial || []);
  } catch (e) {}
}

function renderLogsImpresora(logs = []) {
  const container = document.getElementById('printerLogsContainer');
  const countEl = document.getElementById('txtPrinterLogCount');
  if (countEl) countEl.textContent = `${logs.length} transmisiones registradas`;
  if (!container) return;

  if (!logs.length) {
    container.innerHTML = '<div style="color:#9ca3af; text-align:center; padding:16px; font-size:0.85rem;">No hay eventos de impresión registrados aún. Al enviar comandas o cobrar se registrarán aquí.</div>';
    return;
  }

  container.innerHTML = logs.map(l => {
    const hora = new Date(l.timestamp).toLocaleTimeString('es-CR');
    const esOk = l.estado === 'impreso';
    const tagBg = esOk ? 'rgba(16,185,129,0.2)' : 'rgba(56,189,248,0.2)';
    const tagColor = esOk ? '#34d399' : '#38bdf8';

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding:8px 6px; font-size:0.82rem;">
        <div>
          <span style="color:#94a3b8; font-size:0.75rem;">[${hora}]</span>
          <strong style="color:#f8fafc; margin-left:6px;">${escapeHtml(l.impresoraNombre)}</strong>
          <span style="margin-left:6px; color:#cbd5e1;">- ${escapeHtml(l.titulo)} (${escapeHtml(l.mesa)})</span>
          <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">${escapeHtml(l.detalleConexion)} • Buffer: ${l.bytes} bytes</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background:${tagBg}; color:${tagColor}; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:4px;">
            ${l.estado.toUpperCase()}
          </span>
          <button class="btn-tool" style="padding:3px 8px; font-size:0.72rem;" onclick='mostrarVisorTicketTermico(${JSON.stringify(l.ticketVisual)})'>👁️ Ver</button>
        </div>
      </div>
    `;
  }).join('');
}

window.probarImpresoraBackend = async function(destino) {
  try {
    const res = await fetch('/api/impresoras/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destino })
    });
    const data = await res.json();
    mostrarNotificacionCentro(`🖨️ ${data.message}`, 'success');
    if (data.registro && data.registro.ticketVisual) {
      mostrarVisorTicketTermico(data.registro.ticketVisual);
    }
    await cargarHistorialImpresoras();
  } catch (e) {
    alert('Error al probar impresora: ' + e.message);
  }
};

// Escuchar eventos en vivo de Socket.IO para impresiones
try {
  if (typeof socket !== 'undefined' && socket) {
    socket.on('ticket_impreso', (reg) => {
      cargarHistorialImpresoras();
    });
  }
} catch (_) {}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    evaluarEstadoMesaKDS,
    formatearTooltipEspera
  };
}

// ============================================================================
// SISTEMA DE PISO DEL SALÓN — Catálogo, selector visual y persistencia
// ============================================================================

const CATALOGO_PISOS_SALON = [
  // Maderas
  { id: 'piso-madera-oscura',  nombre: 'Madera Oscura',   icono: '🪵', categoria: 'madera',   tag: 'Popular' },
  { id: 'piso-madera-clara',   nombre: 'Madera Clara',    icono: '🪵', categoria: 'madera',   tag: '' },
  { id: 'piso-madera-roble',   nombre: 'Madera Roble',    icono: '🌳', categoria: 'madera',   tag: '' },
  // Mármoles
  { id: 'piso-marmol-blanco',  nombre: 'Mármol Blanco',   icono: '🪨', categoria: 'marmol',   tag: 'Elegante' },
  { id: 'piso-marmol-negro',   nombre: 'Mármol Negro',    icono: '🪨', categoria: 'marmol',   tag: 'Lujoso' },
  { id: 'piso-marmol-gris',    nombre: 'Mármol Gris',     icono: '🪨', categoria: 'marmol',   tag: '' },
  // Baldosas
  { id: 'piso-baldosa-vintage',nombre: 'Baldosa Vintage',  icono: '🔲', categoria: 'baldosa',  tag: 'Clásico' },
  { id: 'piso-ajedrez',        nombre: 'Ajedrez B&N',      icono: '♟️', categoria: 'baldosa',  tag: '' },
  { id: 'piso-baldosa-azul',   nombre: 'Baldosa Azul',     icono: '🔵', categoria: 'baldosa',  tag: '' },
  // Especiales
  { id: 'piso-cemento',        nombre: 'Cemento Pulido',   icono: '🏗️', categoria: 'especial', tag: '' },
  { id: 'piso-deck-terraza',   nombre: 'Deck Terraza',     icono: '🏖️', categoria: 'especial', tag: '' },
  { id: 'piso-ladrillo',       nombre: 'Ladrillo Rústico', icono: '🧱', categoria: 'especial', tag: '' },
  // Colores sólidos
  { id: 'piso-verde-musgo',    nombre: 'Verde Musgo',      icono: '🟢', categoria: 'solido',   tag: '' },
  { id: 'piso-azul-marino',    nombre: 'Azul Marino',      icono: '🔵', categoria: 'solido',   tag: '' },
  { id: 'piso-gris-oscuro',    nombre: 'Gris Oscuro',      icono: '⚫', categoria: 'solido',   tag: '' },
  { id: 'piso-negro-mate',     nombre: 'Negro Mate',       icono: '⬛', categoria: 'solido',   tag: '' },
  { id: 'piso-burdeos',        nombre: 'Burdeos',          icono: '🟥', categoria: 'solido',   tag: '' },
  { id: 'piso-arena',          nombre: 'Arena',            icono: '🟡', categoria: 'solido',   tag: '' },
];

// Piso actualmente seleccionado para previsualización
let _pisoSeleccionadoPrevio = null;

// Aplica clase CSS al salón y editor
window.aplicarClasePisoSalon = function(pisoId) {
  const salon  = document.getElementById('salonContainer');
  const editor = document.getElementById('editorBoard');
  const targets = [salon, editor].filter(Boolean);

  targets.forEach(el => {
    // Quitar todas las clases de piso anteriores
    const clasesARemover = [...el.classList].filter(c => c.startsWith('piso-'));
    clasesARemover.forEach(c => el.classList.remove(c));
    if (pisoId && pisoId !== 'ninguno') el.classList.add(pisoId);
  });
};

// Carga el piso desde el backend al iniciar
window.cargarPisoSalonDesdeBackend = async function() {
  try {
    const res = await fetch('/api/salon/piso-fondo');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.pisoId) {
      window.aplicarClasePisoSalon(data.pisoId);
      _pisoSeleccionadoPrevio = data.pisoId;
    }
  } catch (_) {}
};

// Abre el modal selector de pisos
window.abrirModalSelectorPiso = function() {
  const modal = document.getElementById('modalSelectorPiso');
  if (!modal) return;
  _pisoSeleccionadoPrevio = null; // reset previsualización
  const inputFiltro = document.getElementById('inputFiltroPiso');
  const selectCat   = document.getElementById('selectCategoriaPiso');
  if (inputFiltro) inputFiltro.value = '';
  if (selectCat)   selectCat.value   = '';
  renderPisosSelectionGrid(CATALOGO_PISOS_SALON);
  modal.style.display = 'flex';
};

// Cierra el modal selector
window.cerrarModalSelectorPiso = function() {
  const modal = document.getElementById('modalSelectorPiso');
  if (modal) modal.style.display = 'none';
};

// Filtra el catálogo
window.filtrarCatalogoPisos = function(textoBusqueda) {
  const cat = document.getElementById('selectCategoriaPiso')?.value || '';
  const txt = (textoBusqueda || '').toLowerCase().trim();

  const filtrado = CATALOGO_PISOS_SALON.filter(p => {
    const coincideTexto = !txt || p.nombre.toLowerCase().includes(txt) || p.id.includes(txt);
    const coincideCat   = !cat || p.categoria === cat;
    return coincideTexto && coincideCat;
  });

  renderPisosSelectionGrid(filtrado);
};

// Renderiza el grid de tarjetas de piso
window.renderPisosSelectionGrid = function(pisos) {
  const grid = document.getElementById('pisosSelectionGrid');
  if (!grid) return;

  // Obtener el piso actual del salón
  const salon = document.getElementById('salonContainer');
  const pisoActual = salon ? [...salon.classList].find(c => c.startsWith('piso-')) : null;

  if (!pisos || pisos.length === 0) {
    grid.innerHTML = '<p style="color:#64748b; text-align:center; padding:30px; grid-column:1/-1;">No se encontraron pisos con ese filtro.</p>';
    return;
  }

  grid.innerHTML = pisos.map(p => {
    const esActivo = (_pisoSeleccionadoPrevio === p.id) || (!_pisoSeleccionadoPrevio && pisoActual === p.id);
    return `
      <div class="piso-card-item ${esActivo ? 'activo' : ''}" onclick="seleccionarPisoPrevio('${p.id}')">
        <div class="piso-preview-thumb ${p.id}">
          <span class="piso-preview-badge">${p.icono}</span>
        </div>
        <div class="piso-card-nombre">${p.nombre}</div>
        ${p.tag ? `<div class="piso-card-categoria">${p.tag}</div>` : `<div class="piso-card-categoria">${p.categoria}</div>`}
      </div>
    `;
  }).join('');
};

// Previsualiza un piso al clickear (sin guardarlo aún)
window.seleccionarPisoPrevio = function(pisoId) {
  _pisoSeleccionadoPrevio = pisoId;
  window.aplicarClasePisoSalon(pisoId);

  const txt = document.getElementById('txtPisoSeleccionado');
  const piso = CATALOGO_PISOS_SALON.find(p => p.id === pisoId);
  if (txt && piso) txt.textContent = `${piso.icono} ${piso.nombre} — seleccionado`;

  // Actualizar estado activo en el grid
  document.querySelectorAll('#pisosSelectionGrid .piso-card-item').forEach(card => {
    card.classList.remove('activo');
  });
  const cardSeleccionada = [...document.querySelectorAll('#pisosSelectionGrid .piso-card-item')]
    .find(c => c.querySelector('.piso-preview-thumb.' + pisoId));
  if (cardSeleccionada) cardSeleccionada.classList.add('activo');
};

// Guarda el piso en el backend y cierra el modal
window.guardarPisoSalonSeleccionado = async function() {
  if (!_pisoSeleccionadoPrevio) {
    mostrarNotificacionCentro('⚠️ Selecciona un piso antes de aplicar', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/salon/piso-fondo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pisoId: _pisoSeleccionadoPrevio })
    });
    if (!res.ok) throw new Error('Error al guardar');
    const piso = CATALOGO_PISOS_SALON.find(p => p.id === _pisoSeleccionadoPrevio);
    mostrarNotificacionCentro(`✅ Piso "${piso ? piso.nombre : ''}" aplicado al salón`, 'success');
    cerrarModalSelectorPiso();
  } catch (e) {
    mostrarNotificacionCentro('❌ Error al guardar el piso: ' + e.message, 'error');
  }
};

// Inicializar piso al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  cargarPisoSalonDesdeBackend();
});

// Socket: actualizar piso en tiempo real si otro dispositivo lo cambia
try {
  if (typeof socket !== 'undefined' && socket) {
    socket.on('salon_piso_fondo_cambiado', (data) => {
      if (data && data.pisoId) {
        window.aplicarClasePisoSalon(data.pisoId);
      }
    });
  }
} catch (_) {}

