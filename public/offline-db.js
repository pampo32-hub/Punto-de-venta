/**
 * offline-db.js - Almacenamiento Local en IndexedDB para GastroBar POS
 * Proporciona soporte Offline-First para catálogo, mesas y cola Outbox.
 */

(function (window) {
  'use strict';

  const DB_NAME = 'gastrobar_pos_offline';
  const DB_VERSION = 1;

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
     * Elimina una acción del Outbox (tras sincronización exitosa)
     */
    eliminarAccion: async function (id) {
      const db = await abrirDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.delete(id);
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
