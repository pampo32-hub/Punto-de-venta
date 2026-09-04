/**
 * offline-sync.js - Gestor de Conectividad, Cola Outbox y Sincronización Automática
 * Detecta caídas de red, encola acciones sin conexión y las sincroniza en lote al reconectar.
 */

(function (window) {
  'use strict';

  const PING_INTERVAL_MS = 15000;
  let isOnline = navigator.onLine;
  let isSyncing = false;
  let pingTimer = null;

  const PosOfflineSync = {
    get isOnline() {
      return isOnline;
    },

    get isSyncing() {
      return isSyncing;
    },

    init: function () {
      // 1. Inicializar IndexedDB
      if (window.PosOfflineDB) {
        window.PosOfflineDB.init().catch((err) => {
          console.error('[OfflineSync] Error inicializando DB:', err);
        });
      }

      // 2. Escuchar eventos del navegador
      window.addEventListener('online', () => {
        PosOfflineSync.verificarConexion(true);
      });

      window.addEventListener('offline', () => {
        isOnline = false;
        PosOfflineSync.actualizarUI();
      });

      // 3. Heartbeat periódico con /api/ping
      pingTimer = setInterval(() => {
        PosOfflineSync.verificarConexion(false);
      }, PING_INTERVAL_MS);

      // 4. Verificación inicial
      PosOfflineSync.verificarConexion(false);

      // 5. Vincular click en el badge de estado si existe
      document.addEventListener('click', (e) => {
        const badge = e.target.closest('#netStatusBadge');
        if (badge) {
          PosOfflineSync.mostrarModalDetalles();
        }
      });
    },

    /**
     * Verifica si el servidor backend responde activamente
     */
    verificarConexion: async function (forzarSincronizacion = false) {
      if (!navigator.onLine) {
        isOnline = false;
        PosOfflineSync.actualizarUI();
        return;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch('/api/ping?t=' + Date.now(), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const eraOffline = !isOnline;
        isOnline = res.ok;

        PosOfflineSync.actualizarUI();

        // Si volvimos de offline a online, o si se forzó la sincronización
        if ((eraOffline && isOnline) || (forzarSincronizacion && isOnline)) {
          PosOfflineSync.sincronizar();
        }
      } catch (e) {
        isOnline = false;
        PosOfflineSync.actualizarUI();
      }
    },

    /**
     * Actualiza el badge visual en la barra superior
     */
    actualizarUI: async function () {
      const badge = document.getElementById('netStatusBadge');
      if (!badge) return;

      let pendientes = 0;
      if (window.PosOfflineDB) {
        try {
          pendientes = await window.PosOfflineDB.contarAccionesPendientes();
        } catch (e) {}
      }

      badge.className = 'network-status-badge';

      if (isSyncing) {
        badge.classList.add('syncing');
        badge.innerHTML = `
          <span class="net-dot syncing"></span>
          <span class="net-text">Sincronizando...</span>
          ${pendientes > 0 ? `<span class="net-count">${pendientes}</span>` : ''}
        `;
        badge.title = 'Sincronizando pedidos locales con el servidor...';
      } else if (!isOnline) {
        badge.classList.add('offline');
        badge.innerHTML = `
          <span class="net-dot offline"></span>
          <span class="net-text">Offline</span>
          ${pendientes > 0 ? `<span class="net-count">${pendientes}</span>` : ''}
        `;
        badge.title = `Sin conexión. ${pendientes} acción(es) pendiente(s) guardadas localmente. Clic para ver.`;
      } else {
        badge.classList.add('online');
        if (pendientes > 0) {
          badge.innerHTML = `
            <span class="net-dot warning"></span>
            <span class="net-text">En línea (${pendientes} pend.)</span>
          `;
          badge.title = `Conectado, pero quedan ${pendientes} operaciones por subir. Clic para sincronizar.`;
        } else {
          badge.innerHTML = `
            <span class="net-dot online"></span>
            <span class="net-text">En línea</span>
          `;
          badge.title = 'Conexión con el servidor activa y sincronizada';
        }
      }
    },

    /**
     * Ejecuta una petición. Si no hay conexión o falla la red, la encola en IndexedDB
     * y ejecuta optimistaFn para que el usuario no se detenga.
     */
    ejecutarConRespaldo: async function ({ tipo, endpoint, metodo = 'POST', payload = {}, descripcion = '', optimistaFn }) {
      // Si creemos que estamos online, intentamos la llamada
      if (navigator.onLine && isOnline) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const res = await fetch(endpoint, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json().catch(() => ({ ok: true }));
            return { exito: true, datos: data, offline: false };
          }

          // Si es error 502, 503, 504 o caída del proxy, tratamos como offline
          if (res.status >= 500) {
            console.warn('[OfflineSync] Error del servidor ' + res.status + ', guardando en cola offline.');
            return await PosOfflineSync.encolarOffline({ tipo, endpoint, metodo, payload, descripcion, optimistaFn });
          }

          // Si es 400 u otro error de validación de negocio, devolvemos el error sin encolar
          const errData = await res.json().catch(() => ({ error: 'Error del servidor' }));
          return { exito: false, error: errData.error || 'Error en la petición', status: res.status };
        } catch (netErr) {
          console.warn('[OfflineSync] Fallo de red detectado, encolando offline:', netErr.message);
          isOnline = false;
          PosOfflineSync.actualizarUI();
          return await PosOfflineSync.encolarOffline({ tipo, endpoint, metodo, payload, descripcion, optimistaFn });
        }
      } else {
        // Modo offline directo
        return await PosOfflineSync.encolarOffline({ tipo, endpoint, metodo, payload, descripcion, optimistaFn });
      }
    },

    /**
     * Encola la acción en IndexedDB y corre la función optimista
     */
    encolarOffline: async function ({ tipo, endpoint, metodo, payload, descripcion, optimistaFn }) {
      if (!window.PosOfflineDB) {
        throw new Error('IndexedDB no está disponible en este dispositivo');
      }

      const registro = await window.PosOfflineDB.encolarAccion({
        tipo,
        endpoint,
        metodo,
        payload,
        descripcion
      });

      // Ejecutar lógica optimista si se proporcionó
      if (typeof optimistaFn === 'function') {
        try {
          optimistaFn(registro);
        } catch (e) {
          console.error('[OfflineSync] Error en optimistaFn:', e);
        }
      }

      PosOfflineSync.actualizarUI();

      PosOfflineSync.mostrarNotificacion(
        `🟡 Guardado localmente (Offline): ${descripcion || tipo}. Se sincronizará automáticamente al volver la conexión.`,
        'warning'
      );

      return { exito: true, offlineQueued: true, registro };
    },

    /**
     * Sincroniza todas las acciones pendientes con el backend
     */
    sincronizar: async function () {
      if (isSyncing) return;
      if (!window.PosOfflineDB) return;

      const pendientes = await window.PosOfflineDB.obtenerAccionesPendientes();
      if (!pendientes || pendientes.length === 0) {
        PosOfflineSync.actualizarUI();
        return;
      }

      isSyncing = true;
      PosOfflineSync.actualizarUI();

      try {
        const payload = {
          acciones: pendientes.map((p) => ({
            id: p.id,
            idempotencyKey: p.idempotencyKey,
            tipo: p.tipo,
            endpoint: p.endpoint,
            metodo: p.metodo,
            payload: p.payload,
            creadoEn: p.creadoEn
          }))
        };

        const res = await fetch('/api/sync/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error('El servidor respondió con código ' + res.status);
        }

        const data = await res.json();
        const procesadas = data.procesadas || [];
        const duplicadas = data.duplicadas || [];
        const exitosasIds = [...procesadas, ...duplicadas];

        // Eliminar del outbox local las que fueron procesadas o ya existían (idempotentes)
        for (const item of pendientes) {
          if (exitosasIds.includes(item.idempotencyKey) || exitosasIds.includes(item.id)) {
            await window.PosOfflineDB.eliminarAccion(item.id);
          }
        }

        const totalSincronizadas = exitosasIds.length;
        if (totalSincronizadas > 0) {
          PosOfflineSync.mostrarNotificacion(
            `✅ Sincronización exitosa: ${totalSincronizadas} operación(es) enviadas al servidor.`,
            'success'
          );

          // Disparar evento para refrescar interfaces de mesas y pedidos
          window.dispatchEvent(new CustomEvent('pos:sincronizado', { detail: data }));
          if (typeof window.cargarMesas === 'function') {
            window.cargarMesas();
          }
        }
      } catch (err) {
        console.warn('[OfflineSync] Error durante sincronización:', err.message);
      } finally {
        isSyncing = false;
        PosOfflineSync.actualizarUI();
      }
    },

    /**
     * Muestra notificación visual no intrusiva
     */
    mostrarNotificacion: function (mensaje, tipo = 'info') {
      if (window.mostrarToast) {
        window.mostrarToast(mensaje, tipo);
        return;
      }

      let cont = document.getElementById('notificacionesOffline');
      if (!cont) {
        cont = document.createElement('div');
        cont.id = 'notificacionesOffline';
        cont.style.position = 'fixed';
        cont.style.bottom = '20px';
        cont.style.left = '50%';
        cont.style.transform = 'translateX(-50%)';
        cont.style.zIndex = '999999';
        cont.style.display = 'flex';
        cont.style.flexDirection = 'column';
        cont.style.gap = '8px';
        cont.style.pointerEvents = 'none';
        document.body.appendChild(cont);
      }

      const toast = document.createElement('div');
      toast.style.background = tipo === 'warning' ? '#d97706' : tipo === 'success' ? '#059669' : '#1e293b';
      toast.style.color = '#ffffff';
      toast.style.padding = '10px 18px';
      toast.style.borderRadius = '8px';
      toast.style.fontSize = '0.9rem';
      toast.style.fontWeight = '500';
      toast.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
      toast.style.pointerEvents = 'auto';
      toast.style.transition = 'opacity 0.3s ease';
      toast.textContent = mensaje;

      cont.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, 5000);
    },

    /**
     * Muestra modal con detalles de conexión y cola pendiente
     */
    mostrarModalDetalles: async function () {
      let modal = document.getElementById('modalEstadoRed');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalEstadoRed';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
          <div class="modal-card" style="max-width: 520px; width: 90%;">
            <div class="modal-header">
              <h3>📡 Estado de Conexión & Sincronización</h3>
              <button class="btn-close-modal" id="btnCerrarModalRed">&times;</button>
            </div>
            <div class="modal-body" id="modalRedBody" style="padding: 16px 20px;">
              <!-- Dinámico -->
            </div>
            <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--border-color, #e2e8f0);">
              <button class="btn btn-secondary" id="btnProbarPing">🔄 Probar Conexión</button>
              <button class="btn btn-primary" id="btnForzarSync">⚡ Sincronizar Ahora</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#btnCerrarModalRed').addEventListener('click', () => {
          modal.style.display = 'none';
        });
        modal.querySelector('#btnProbarPing').addEventListener('click', () => {
          PosOfflineSync.verificarConexion(false).then(() => PosOfflineSync.mostrarModalDetalles());
        });
        modal.querySelector('#btnForzarSync').addEventListener('click', () => {
          PosOfflineSync.sincronizar().then(() => PosOfflineSync.mostrarModalDetalles());
        });
      }

      let pendientes = [];
      if (window.PosOfflineDB) {
        try {
          pendientes = await window.PosOfflineDB.obtenerAccionesPendientes();
        } catch (e) {}
      }

      const body = modal.querySelector('#modalRedBody');
      const estadoHtml = isOnline
        ? '<div style="display: flex; align-items: center; gap: 8px; color: #10b981; font-weight: bold; font-size: 1.05rem;">🟢 En línea (Conexión activa con el servidor)</div>'
        : '<div style="display: flex; align-items: center; gap: 8px; color: #f59e0b; font-weight: bold; font-size: 1.05rem;">🟡 Modo Offline (Sin conexión a internet)</div>';

      let listaItems = '';
      if (pendientes.length === 0) {
        listaItems = '<p style="color: var(--text-muted, #94a3b8); margin-top: 12px; font-size: 0.9rem;">No hay operaciones pendientes. Todo está sincronizado con la base de datos central.</p>';
      } else {
        listaItems = `
          <div style="margin-top: 16px;">
            <strong style="font-size: 0.95rem;">Operaciones pendientes (${pendientes.length}):</strong>
            <ul style="max-height: 220px; overflow-y: auto; margin-top: 8px; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px;">
              ${pendientes
                .map(
                  (p) => `
                <li style="padding: 8px 12px; background: var(--bg-hover, rgba(0,0,0,0.05)); border-radius: 6px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <span style="font-weight: 600;">${p.descripcion || p.tipo}</span>
                    <div style="color: var(--text-muted, #64748b); font-size: 0.75rem;">${new Date(p.creadoEn).toLocaleTimeString()}</div>
                  </div>
                  <span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: bold;">En cola</span>
                </li>
              `
                )
                .join('')}
            </ul>
          </div>
        `;
      }

      body.innerHTML = `
        ${estadoHtml}
        <p style="font-size: 0.85rem; color: var(--text-muted, #64748b); margin-top: 6px;">
          GastroBar POS funciona con arquitectura Offline-First. Si el internet cae, los pedidos y comandas siguen funcionando con total normalidad y se guardan en este dispositivo.
        </p>
        ${listaItems}
      `;

      modal.style.display = 'flex';
    }
  };

  window.PosOfflineSync = PosOfflineSync;

  // Iniciar automáticamente cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PosOfflineSync.init());
  } else {
    PosOfflineSync.init();
  }
})(typeof window !== 'undefined' ? window : this);
