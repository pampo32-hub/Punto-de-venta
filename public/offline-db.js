/**
 * offline-db.js - Almacenamiento Local en IndexedDB para GastroBar POS
 * Proporciona soporte Offline-First para catálogo, mesas, órdenes activas y cola Outbox.
 */

(function (window) {
  'use strict';

  const DB_NAME = 'gastrobar_pos_offline';
  const DB_VERSION = 2;

  let dbInstance = null;

  function abrirDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Almacén de catálogo de productos
        if (!db.objectStoreNames.contains('catalogo')) {
          db.createObjectStore('catalogo', { keyPath: 'id' });
        }

        // 2. Almacén de estado de mesas
        if (!db.objectStoreNames.contains('mesas')) {
          db.createObjectStore('mesas', { keyPath: 'id' });
        }

        // 3. Cola de salida (Outbox) para peticiones en cola sin conexión
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
          outboxStore.createIndex('estado', 'estado', { unique: false });
          outboxStore.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
          outboxStore.createIndex('creadoEn', 'creadoEn', { unique: false });
        }

        // 4. Metadatos de sincronización
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'clave' });
        }

        // 5. Órdenes y comandas activas locales por mesa
        if (!db.objectStoreNames.contains('ordenes')) {
          db.createObjectStore('ordenes', { keyPath: 'mesaId' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error('[OfflineDB] Error abriendo IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  function generarUUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'idemp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  }

  const PosOfflineDB = {
    init: abrirDB,

    /**
     * Guarda la lista de productos en IndexedDB
     */
    guardarCatalogo: async function (productos) {
      if (!Array.isArray(productos)) return;
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('catalogo', 'readwrite');
        const store = tx.objectStore('catalogo');
        store.clear();
        productos.forEach((p) => store.put(p));
        tx.oncomplete = () => {
          PosOfflineDB.guardarMeta('ultimo_catalogo_cache', new Date().toISOString());
          resolve(true);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Obtiene el catálogo cacheado
     */
    obtenerCatalogo: async function () {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('catalogo', 'readonly');
        const store = tx.objectStore('catalogo');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Guarda el estado de las mesas
     */
    guardarMesas: async function (mesas) {
      if (!Array.isArray(mesas)) return;
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('mesas', 'readwrite');
        const store = tx.objectStore('mesas');
        store.clear();
        mesas.forEach((m) => store.put(m));
        tx.oncomplete = () => {
          PosOfflineDB.guardarMeta('ultimas_mesas_cache', new Date().toISOString());
          resolve(true);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Obtiene las mesas cacheadas
     */
    obtenerMesas: async function () {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('mesas', 'readonly');
        const store = tx.objectStore('mesas');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Guarda o actualiza la orden y sus platillos para una mesa específica
     */
    guardarOrdenMesa: async function (mesaId, orden, items) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('ordenes', 'readwrite');
        const store = tx.objectStore('ordenes');
        store.put({
          mesaId: Number(mesaId),
          orden: orden || null,
          items: Array.isArray(items) ? items : [],
          actualizado: new Date().toISOString()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Guarda o actualiza los ítems de una mesa (alias seguro)
     */
    guardarItemsMesa: async function (mesaId, items, total) {
      return PosOfflineDB.guardarOrdenMesa(mesaId, { total }, items);
    },

    /**
     * Obtiene la orden guardada de una mesa
     */
    obtenerOrdenMesa: async function (mesaId) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('ordenes', 'readonly');
        const store = tx.objectStore('ordenes');
        const req = store.get(Number(mesaId));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Limpia la orden de una mesa (al pagar o liberar)
     */
    limpiarOrdenMesa: async function (mesaId) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('ordenes', 'readwrite');
        const store = tx.objectStore('ordenes');
        const req = store.delete(Number(mesaId));
        req.onsuccess = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Encola una acción en el Outbox para su posterior sincronización
     */
    encolarAccion: async function ({ tipo, endpoint, metodo = 'POST', payload = {}, descripcion = '' }) {
      const db = await abrirDB();
      const idempotencyKey = generarUUID();
      const registro = {
        idempotencyKey,
        tipo,
        endpoint,
        metodo,
        payload,
        descripcion: descripcion || `${tipo} - ${new Date().toLocaleTimeString()}`,
        creadoEn: new Date().toISOString(),
        intentos: 0,
        estado: 'pendiente'
      };

      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.add(registro);
        req.onsuccess = () => {
          registro.id = req.result;
          resolve(registro);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Obtiene todas las acciones pendientes en el Outbox
     */
    obtenerAccionesPendientes: async function () {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const store = tx.objectStore('outbox');
        const req = store.getAll();
        req.onsuccess = () => {
          const pendientes = (req.result || []).filter((r) => r.estado === 'pendiente' || r.estado === 'procesando');
          // Orden cronológico
          pendientes.sort((a, b) => (a.id > b.id ? 1 : -1));
          resolve(pendientes);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Obtiene la comanda completa de una mesa combinando el caché previo
     * y los pedidos que estén acumulados en la cola Outbox sin conexión.
     */
    obtenerComandaLocalMesa: async function (mesaId) {
      const numMesaId = Number(mesaId);
      const guardada = await PosOfflineDB.obtenerOrdenMesa(numMesaId).catch(() => null);
      const pendientes = await PosOfflineDB.obtenerAccionesPendientes().catch(() => []);

      let orden = guardada ? guardada.orden : null;
      let items = guardada && guardada.items ? [...guardada.items] : [];

      // Buscar acciones de enviar comanda pendientes para esta mesa
      const comandaAcciones = pendientes.filter(
        (a) =>
          (a.tipo === 'ENVIAR_COMANDA' || (a.endpoint && a.endpoint.includes('/comandas/enviar'))) &&
          Number(a.payload?.mesaId || a.payload?.mesa_id) === numMesaId
      );

      for (const accion of comandaAcciones) {
        const payloadItems = accion.payload?.items || [];
        for (const it of payloadItems) {
          const prodId = it.producto_id || it.id;
          const nombreProd = it.nombre_producto || it.nombre;
          const precioProd = Number(it.precio_unitario != null ? it.precio_unitario : it.precio) || 0;
          const cantidadProd = Number(it.cantidad) || 1;

          // Si ya existía un ítem offline igual, se actualiza cantidad
          const existente = items.find(
            (ex) => (ex.id === prodId || ex.producto_id === prodId) && ex.nombre === nombreProd && ex.offlinePendiente
          );

          if (existente) {
            existente.cantidad += cantidadProd;
          } else {
            items.push({
              id_detalle_existente: null,
              id: prodId,
              producto_id: prodId,
              nombre: nombreProd,
              nombre_producto: nombreProd,
              precio: precioProd,
              precio_unitario: precioProd,
              cantidad: cantidadProd,
              notas: it.notas || '',
              curso: it.curso || 2,
              destino: it.destino || 'cocina',
              origen_mesa_numero: it.origen_mesa_numero || null,
              enviado: true,
              offlinePendiente: true
            });
          }
        }
      }

      if (items.length > 0 && !orden) {
        const total = items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
        const subtotal = Math.round(total / 1.23);
        const servicio = Math.round(subtotal * 0.10);
        const iva = total - subtotal - servicio;

        orden = {
          id: 'offline_' + numMesaId,
          numero_orden: 'OFFLINE-' + numMesaId,
          mesa_id: numMesaId,
          subtotal,
          servicio_10: servicio,
          iva_13: iva,
          total,
          estado: 'esperando',
          offline: true
        };
      } else if (orden && items.length > 0) {
        const total = items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
        const subtotal = Math.round(total / 1.23);
        const servicio = Math.round(subtotal * 0.10);
        const iva = total - subtotal - servicio;
        orden.subtotal = subtotal;
        orden.servicio_10 = servicio;
        orden.iva_13 = iva;
        orden.total = total;
      }

      return { orden, items, tienePendientes: comandaAcciones.length > 0 };
    },

    /**
     * Elimina una acción del Outbox (tras sincronización exitosa)
     */
    eliminarAccion: async function (id) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const numId = Number(id);
        const req = store.delete(!isNaN(numId) && String(numId) === String(id) ? numId : id);
        req.onsuccess = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Limpia completamente la cola Outbox
     */
    limpiarOutbox: async function () {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Cuenta el número de acciones pendientes en el Outbox
     */
    contarAccionesPendientes: async function () {
      const pendientes = await PosOfflineDB.obtenerAccionesPendientes();
      return pendientes.length;
    },

    /**
     * Guarda metadatos clave-valor
     */
    guardarMeta: async function (clave, valor) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        store.put({ clave, valor, actualizado: new Date().toISOString() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Obtiene metadatos por clave
     */
    obtenerMeta: async function (clave) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const req = store.get(clave);
        req.onsuccess = () => resolve(req.result ? req.result.valor : null);
        req.onerror = (e) => reject(e.target.error);
      });
    }
  };

  window.PosOfflineDB = PosOfflineDB;
})(typeof window !== 'undefined' ? window : this);
