const net = require('net');
const cp = require('child_process');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const fs = require('fs');
const DB_MAIN_PATH = path.join(__dirname, '../../pos.db');
const DB_PATH = path.join(__dirname, '../../pos.test.db');

// Create isolated test db copy from main db
try {
  if (fs.existsSync(DB_MAIN_PATH)) {
    fs.copyFileSync(DB_MAIN_PATH, DB_PATH);
  }
} catch (_) {}

function cleanupTestDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  } catch (_) {}
}

process.on('exit', () => {
  cleanupTestDb();
});


/**
 * Finds an available TCP port on localhost.
 * @returns {Promise<number>}
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Executes a SQLite query returning all rows.
 */
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

/**
 * Executes a SQLite query returning a single row.
 */
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

/**
 * Executes a SQLite query modifying data.
 */
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

/**
 * Creates and starts an ephemeral test server instance.
 */
async function startTestServer() {
  const port = await getFreePort();
  const serverPath = path.join(__dirname, '../../server.js');

  const child = cp.spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      POS_DB_PATH: DB_PATH,
      SUPERVISOR_PIN: '1234'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Wait for server to listen
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Test server timed out after 6000ms on port ${port}`));
    }, 6000);

    const onData = (data) => {
      const msg = data.toString();
      if (msg.includes(`Puerto: ${port}`) || msg.includes('PUNTO DE VENTA')) {
        clearTimeout(timeout);
        child.stdout.removeListener('data', onData);
        resolve();
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', (errData) => {
      // Ignore warnings
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server process exited prematurely with code ${code}`));
      }
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * HTTP helper around global fetch.
   */
  async function request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
    const opts = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    if (options.body) {
      opts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetch(url, opts);
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => null);
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data
    };
  }

  /**
   * Open database connection for test setup/assertions.
   */
  function getDb() {
    return new sqlite3.Database(DB_PATH);
  }

  /**
   * Resets test state in SQLite database.
   */
  async function resetDb() {
    const db = getDb();
    try {
      await dbRun(db, 'DELETE FROM Pagos');
      await dbRun(db, 'DELETE FROM DetalleOrden');
      await dbRun(db, 'DELETE FROM Ordenes');
      await dbRun(db, 'DELETE FROM Anulaciones');
      await dbRun(db, 'DELETE FROM IdempotencyLog').catch(() => {});
      await dbRun(db, "UPDATE Mesas SET estado = 'libre', mesero = NULL");
      // Check if unida_a_mesa_id exists and reset
      try {
        await dbRun(db, 'UPDATE Mesas SET unida_a_mesa_id = NULL');
      } catch (_) {}
      // Reset happy_hour flags if altered
      try {
        await dbRun(db, "UPDATE Productos SET happy_hour = 1 WHERE codigo IN ('BEB01', 'BEB02', 'BEB03', 'COC01', 'COC02')");
        await dbRun(db, "UPDATE Productos SET happy_hour = 0 WHERE destino = 'cocina' OR codigo IN ('BEB04', 'BEB05')");
      } catch (_) {}
    } finally {
      await new Promise((r) => db.close(r));
    }
  }

  /**
   * Stops the ephemeral server instance.
   */
  async function stop() {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((r) => {
        const killTimeout = setTimeout(() => {
          child.kill('SIGKILL');
          r();
        }, 1500);
        child.on('exit', () => {
          clearTimeout(killTimeout);
          r();
        });
      });
    }
  }

  return {
    port,
    baseUrl,
    request,
    resetDb,
    getDb,
    dbAll: (sql, params) => {
      const db = getDb();
      return dbAll(db, sql, params).finally(() => db.close());
    },
    dbGet: (sql, params) => {
      const db = getDb();
      return dbGet(db, sql, params).finally(() => db.close());
    },
    dbRun: (sql, params) => {
      const db = getDb();
      return dbRun(db, sql, params).finally(() => db.close());
    },
    stop
  };
}

/**
 * Domain specification helpers derived from ORIGINAL_REQUEST.md & PROJECT.md
 */

/**
 * R1 Contract: Evaluates dynamic comanda button state based on unsent kitchen items.
 * "El botón solo debe mostrar '🔥 Enviar a Cocina' si existen ítems nuevos de alimentos/cocina no enviados aún a preparación.
 * Si en una mesa ya enviada solo se agregan bebidas u otros productos que no van a cocina, el botón debe decir '💾 Guardar'."
 */
function evaluarBotonComanda(items = []) {
  if (!items || !items.length) {
    return {
      text: '💾 Guardar',
      className: 'btn-btn-cmd guardar',
      tieneNuevosCocina: false
    };
  }

  const tieneNuevosCocina = items.some(
    (it) =>
      !it.enviado &&
      !it.id_detalle_existente &&
      (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
  );

  return {
    text: tieneNuevosCocina ? '🔥 Enviar a Cocina' : '💾 Guardar',
    className: tieneNuevosCocina ? 'btn-btn-cmd cocina' : 'btn-btn-cmd guardar',
    tieneNuevosCocina
  };
}

/**
 * R2 Contract: Evaluates table status from kitchen orders.
 * If all kitchen items are ready -> 'activa' (Blue)
 * If some are ready and some pending -> 'esperando_parcial'
 * If none ready and some pending -> 'esperando'
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
  const fechaPedido = new Date(primeraComandaHora);
  const diffMs = Math.max(0, ahora.getTime() - fechaPedido.getTime());
  const minutos = Math.floor(diffMs / 60000);

  const titulo = `⏱️ Esperando hace ${minutos} min`;
  const itemsList = itemsPendientes.map((it) => (typeof it === 'string' ? it : it.nombre_producto));

  return {
    minutos,
    titulo,
    items: itemsList,
    tooltipText: `${titulo}\n${itemsList.map((i) => `• ${i}`).join('\n')}`
  };
}

/**
 * R3 Contract: Happy Hour 2x1 pricing calculation.
 * For every 2 units of a participating product (happy_hour = 1), 1 is free.
 */
function calcularTotalesHappyHour(items = [], happyHourActivo = false) {
  let subtotal = 0;
  let descuentoHH = 0;

  for (const it of items) {
    const lineTotal = it.precio * it.cantidad;
    subtotal += lineTotal;

    if (happyHourActivo && (it.happy_hour === 1 || it.happyHour === true)) {
      const pares = Math.floor(it.cantidad / 2);
      descuentoHH += pares * it.precio;
    }
  }

  const subNeto = subtotal - descuentoHH;
  const servicio = Math.round(subNeto * 0.10);
  const iva = Math.round(subNeto * 0.13);
  const total = subNeto + servicio + iva;

  return {
    subtotal,
    descuentoHH,
    subNeto,
    servicio,
    iva,
    total
  };
}

/**
 * R4 Contract: Formats item name with origin table tag when merged.
 * e.g. "[Mesa 1] Hamburguesa"
 */
function formatearNombreItemConOrigen(item, mesaActualNumero) {
  if (item.origen_mesa_numero && String(item.origen_mesa_numero) !== String(mesaActualNumero)) {
    return `[Mesa ${item.origen_mesa_numero}] ${item.nombre_producto || item.nombre}`;
  }
  return item.nombre_producto || item.nombre;
}

module.exports = {
  startTestServer,
  getFreePort,
  cleanupTestDb,
  restoreOriginalDb: cleanupTestDb,
  evaluarBotonComanda,
  evaluarEstadoMesaKDS,
  formatearTooltipEspera,
  calcularTotalesHappyHour,
  formatearNombreItemConOrigen
};

