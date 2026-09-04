const QRCode = require('qrcode');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const printerService = require('./printerService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 4000;
const SUPERVISOR_PIN = process.env.SUPERVISOR_PIN || '1234';

// ============================================================================
// ESTADO EN MEMORIA: HAPPY HOUR
// ============================================================================
let happyHourEstado = {
  activo: false,
  horaInicio: '16:00', // HH:MM (24h)
  horaFin: '19:00',    // HH:MM (24h)
};

// Cargar config HH desde la BD al iniciar
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ConfigNegocio (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`);
  // Insertar valores por defecto si no existen
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_activo', 'false')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_inicio', '16:00')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_fin', '19:00')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('app_version', '1.0.0')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_last_check', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_available', 'false')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_latest_commit', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_commit_msg', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_commit_date', '')");

  db.all("SELECT clave, valor FROM ConfigNegocio WHERE clave LIKE 'hh_%'", [], (err, rows) => {
    if (!err && rows) {
      rows.forEach(r => {
        if (r.clave === 'hh_activo') happyHourEstado.activo = r.valor === 'true';
        if (r.clave === 'hh_hora_inicio') happyHourEstado.horaInicio = r.valor;
        if (r.clave === 'hh_hora_fin') happyHourEstado.horaFin = r.valor;
      });
      console.log(`🍸 Happy Hour cargado: activo=${happyHourEstado.activo}, ${happyHourEstado.horaInicio}–${happyHourEstado.horaFin}`);
    }
  });

  // Migraciones automáticas para trazabilidad y unión/separación de mesas
  db.run("ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_numero TEXT", () => {});
  db.run("ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_id INTEGER", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN unida_a_mesa_id INTEGER", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN unida_con TEXT", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN grupo_mesas TEXT", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN transferida_de TEXT", () => {});
  db.run("ALTER TABLE Ordenes ADD COLUMN transferida_de TEXT", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN piso INTEGER DEFAULT 1", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN pidio_cuenta_qr INTEGER DEFAULT 0", () => {});
  db.run("ALTER TABLE Zonas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
  db.run("INSERT OR IGNORE INTO Zonas (id, nombre) VALUES (5, 'Segundo Piso')", () => {});
  db.run("UPDATE Productos SET happy_hour = 1 WHERE categoria_id = 4 OR LOWER(nombre) LIKE '%imperial%' OR LOWER(nombre) LIKE '%pilsen%' OR LOWER(nombre) LIKE '%bavaria%' OR LOWER(nombre) LIKE '%rock ice%' OR LOWER(nombre) LIKE '%corona%' OR LOWER(nombre) LIKE '%cerveza%'", () => {});

  db.run(`CREATE TABLE IF NOT EXISTS TableMerges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_principal_id INTEGER NOT NULL,
    mesa_secundaria_id INTEGER NOT NULL,
    orden_principal_id INTEGER,
    orden_secundaria_id INTEGER,
    snapshot_a TEXT,
    snapshot_b TEXT,
    items_transferidos_ids TEXT,
    creado_en TEXT,
    activo INTEGER DEFAULT 1
  )`);
});

// Auto-desactivar HH cuando llega la hora de fin (revisa cada minuto)
setInterval(() => {
  if (!happyHourEstado.activo) return;
  const ahora = new Date();
  const [hFin, mFin] = happyHourEstado.horaFin.split(':').map(Number);
  const finHoy = new Date();
  finHoy.setHours(hFin, mFin, 0, 0);
  if (ahora >= finHoy) {
    happyHourEstado.activo = false;
    db.run("UPDATE ConfigNegocio SET valor = 'false' WHERE clave = 'hh_activo'");
    console.log('🍸 Happy Hour AUTO-DESACTIVADO por horario programado.');
    io.emit('happy_hour_cambio', { activo: false, horaInicio: happyHourEstado.horaInicio, horaFin: happyHourEstado.horaFin });
  }
}, 60 * 1000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta amigable para escaneo de QR en mesa
app.get('/m/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
});


// WebSockets para tiempo real (KDS Cocina / Barra / Meseros / Admin)
io.on('connection', (socket) => {
  console.log('🔌 Terminal conectada (Socket ID):', socket.id);

  socket.on('disconnect', () => {
    console.log('🔌 Terminal desconectada:', socket.id);
  });
});

// Helpers para consultas Promise con SQLite
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

// ============================================================================
// HELPERS DE DOMINIO: ESTADOS KDS, TIEMPOS DE ESPERA Y TRAZABILIDAD
// ============================================================================
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

function formatearNombreItemConOrigen(item, mesaActualNumero) {
  if (item.origen_mesa_numero && String(item.origen_mesa_numero) !== String(mesaActualNumero)) {
    return `[Mesa ${item.origen_mesa_numero}] ${item.nombre_producto || item.nombre}`;
  }
  return item.nombre_producto || item.nombre;
}


// ============================================================================
// 1. AUTENTICACIÓN & LOGIN CON PERFIL DE GÉNERO
// ============================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const u = await dbGet('SELECT * FROM Usuarios WHERE usuario = ? AND password = ? AND activo = 1', [usuario.trim(), password.trim()]);
    if (!u) {
      return res.status(401).json({ error: 'Credenciales inválidas. Verifica tu usuario y contraseña.' });
    }

    const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [u.negocio_id || 1]);

    // Adaptación dinámica de género para el rol
    let rolEtiqueta = u.rol.toUpperCase();
    if (u.rol === 'salonero') {
      rolEtiqueta = u.genero === 'F' ? 'Salonera' : 'Salonero';
    } else if (u.rol === 'admin') {
      rolEtiqueta = 'Administrador';
    } else if (u.rol === 'cajero') {
      rolEtiqueta = 'Cajero';
    } else if (u.rol === 'developer') {
      rolEtiqueta = 'Desarrollador Global';
    }

    const perfilVisual = `${u.nombre_completo} (${rolEtiqueta})`;

    res.json({
      ok: true,
      usuario: {
        id: u.id,
        usuario: u.usuario,
        nombre: u.nombre_completo,
        rol: u.rol,
        genero: u.genero,
        rolEtiqueta,
        perfilVisual,
        pin: u.pin,
        permisos: JSON.parse(u.permisos || '{}'),
        negocio_id: u.negocio_id
      },
      negocio: negocio || {
        id: 1,
        nombre: 'GastroBar Fuego & Brasas',
        slogan: 'Restaurante, Bar & Lounge',
        logo_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 2. PORTAL DE DESARROLLADOR (SAAS MULTI-COMERCIO & CONTROL GLOBAL)
// ============================================================================
// Negocios (Comercios)
app.get('/api/dev/negocios', async (req, res) => {
  try {
    const negocios = await dbAll(`
      SELECT n.*, 
        (SELECT COUNT(*) FROM Usuarios u WHERE u.negocio_id = n.id AND u.activo = 1) as total_usuarios,
        (SELECT COUNT(*) FROM Mesas m WHERE m.negocio_id = n.id) as total_mesas
      FROM Negocios n
      ORDER BY n.id ASC
    `);
    res.json(negocios);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dev/negocios', async (req, res) => {
  try {
    const { nombre, slogan = '', logo_url = '', moneda = 'CRC', telefono = '', direccion = '' } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });

    const r = await dbRun(
      'INSERT INTO Negocios (nombre, slogan, logo_url, moneda, telefono, direccion) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, slogan, logo_url, moneda, telefono, direccion]
    );
    const nuevo = await dbGet('SELECT * FROM Negocios WHERE id = ?', [r.lastID]);
    io.emit('negocio_creado', nuevo);
    res.json(nuevo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/dev/negocios/:id', async (req, res) => {
  try {
    const { nombre, slogan, logo_url, moneda, telefono, direccion } = req.body;
    await dbRun(
      'UPDATE Negocios SET nombre = ?, slogan = ?, logo_url = ?, moneda = ?, telefono = ?, direccion = ? WHERE id = ?',
      [nombre, slogan, logo_url, moneda, telefono, direccion, req.params.id]
    );
    const actualizado = await dbGet('SELECT * FROM Negocios WHERE id = ?', [req.params.id]);
    io.emit('negocio_actualizado', actualizado);
    res.json(actualizado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Usuarios Globales (Developer ve todos los usuarios del sistema)
app.get('/api/dev/usuarios', async (req, res) => {
  try {
    const usuarios = await dbAll(`
      SELECT u.id, u.negocio_id, u.usuario, u.nombre_completo, u.rol, u.genero, u.pin, u.permisos, u.activo,
             n.nombre as negocio_nombre
      FROM Usuarios u
      LEFT JOIN Negocios n ON u.negocio_id = n.id
      ORDER BY u.id ASC
    `);
    res.json(usuarios);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dev/usuarios', async (req, res) => {
  try {
    const { negocio_id = 1, usuario, nombre_completo, password, rol = 'salonero', genero = 'M', pin = '1234', permisos = '{}' } = req.body;
    if (!usuario || !password || !nombre_completo) {
      return res.status(400).json({ error: 'Faltan datos obligatorios del usuario' });
    }

    const permisosStr = typeof permisos === 'string' ? permisos : JSON.stringify(permisos);

    const r = await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocio_id, usuario.trim(), nombre_completo.trim(), password.trim(), rol, genero, pin, permisosStr]
    );
    res.json({ message: 'Usuario creado exitosamente', id: r.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message.includes('UNIQUE') ? 'El nombre de usuario ya existe' : e.message });
  }
});

app.put('/api/dev/usuarios/:id', async (req, res) => {
  try {
    const { nombre_completo, password, rol, genero, pin, permisos, activo, negocio_id } = req.body;
    const permisosStr = typeof permisos === 'string' ? permisos : JSON.stringify(permisos || {});
    
    if (password) {
      await dbRun(
        `UPDATE Usuarios SET nombre_completo = ?, password = ?, rol = ?, genero = ?, pin = ?, permisos = ?, activo = ?, negocio_id = ?
         WHERE id = ?`,
        [nombre_completo, password, rol, genero, pin, permisosStr, activo !== undefined ? activo : 1, negocio_id, req.params.id]
      );
    } else {
      await dbRun(
        `UPDATE Usuarios SET nombre_completo = ?, rol = ?, genero = ?, pin = ?, permisos = ?, activo = ?, negocio_id = ?
         WHERE id = ?`,
        [nombre_completo, rol, genero, pin, permisosStr, activo !== undefined ? activo : 1, negocio_id, req.params.id]
      );
    }
    res.json({ message: 'Usuario actualizado exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/dev/usuarios/:id', async (req, res) => {
  try {
    const target = await dbGet('SELECT * FROM Usuarios WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.usuario === 'dev') return res.status(403).json({ error: 'No es posible eliminar al desarrollador principal' });

    await dbRun('DELETE FROM Usuarios WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 3. GESTIÓN DE PERSONAL PARA ADMIN (AISLAMIENTO ESTRICTO: NO VE AL DEVELOPER)
// ============================================================================
app.get('/api/admin/empleados', async (req, res) => {
  try {
    const negocioId = req.query.negocio_id || 1;
    // REGLA CRÍTICA: Nunca mostrar a usuarios con rol 'developer'
    const empleados = await dbAll(`
      SELECT id, negocio_id, usuario, nombre_completo, rol, genero, pin, activo
      FROM Usuarios
      WHERE negocio_id = ? AND rol != 'developer'
      ORDER BY id ASC
    `, [negocioId]);

    // Mapear etiquetas con género
    const listado = empleados.map(e => {
      let rolDisplay = e.rol;
      if (e.rol === 'salonero') rolDisplay = e.genero === 'F' ? 'Salonera' : 'Salonero';
      if (e.rol === 'cajero') rolDisplay = 'Cajero';
      if (e.rol === 'admin') rolDisplay = 'Administrador';
      return { ...e, rolDisplay };
    });

    res.json(listado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/empleados', async (req, res) => {
  try {
    const { negocio_id = 1, usuario, nombre_completo, password, rol = 'salonero', genero = 'M', pin = '1234' } = req.body;
    
    // Bloqueo estricto: el admin NO puede crear roles developer
    if (rol === 'developer') {
      return res.status(403).json({ error: 'Permiso denegado: El administrador no puede crear usuarios de desarrollador' });
    }

    const permisos = rol === 'cajero' 
      ? '{"salon":true,"caja":true,"facturacion":true}'
      : '{"salon":true,"kds":true}';

    const r = await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocio_id, usuario.trim(), nombre_completo.trim(), password.trim(), rol, genero, pin, permisos]
    );

    res.json({ message: 'Empleado registrado con éxito', id: r.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message.includes('UNIQUE') ? 'Ese nombre de usuario ya está en uso' : e.message });
  }
});

app.put('/api/admin/empleados/:id', async (req, res) => {
  try {
    const target = await dbGet('SELECT * FROM Usuarios WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Empleado no encontrado' });

    // Bloqueo estricto: Jamás permitir que un admin modifique a un developer
    if (target.rol === 'developer') {
      return res.status(403).json({ error: 'Acceso restringido: No tienes permisos para modificar este perfil' });
    }

    const { nombre_completo, password, rol, genero, pin } = req.body;
    if (rol === 'developer') return res.status(403).json({ error: 'No se puede elevar a developer' });

    if (password) {
      await dbRun(
        'UPDATE Usuarios SET nombre_completo = ?, password = ?, rol = ?, genero = ?, pin = ? WHERE id = ?',
        [nombre_completo, password, rol, genero, pin, req.params.id]
      );
    } else {
      await dbRun(
        'UPDATE Usuarios SET nombre_completo = ?, rol = ?, genero = ?, pin = ? WHERE id = ?',
        [nombre_completo, rol, genero, pin, req.params.id]
      );
    }

    res.json({ message: 'Empleado actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/empleados/:id', async (req, res) => {
  try {
    const target = await dbGet('SELECT * FROM Usuarios WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Empleado no encontrado' });
    if (target.rol === 'developer') return res.status(403).json({ error: 'Acción prohibida' });

    await dbRun('DELETE FROM Usuarios WHERE id = ?', [req.params.id]);
    res.json({ message: 'Empleado eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 4. PERSONALIZACIÓN VISUAL DE BOTONES (FOTOS/IMÁGENES DEL MENÚ)
// ============================================================================
app.put('/api/productos/:id/visual', async (req, res) => {
  try {
    const { imagen_url, nombre, precio, color_badge } = req.body;
    const prodId = req.params.id;

    await dbRun(
      'UPDATE Productos SET imagen_url = ?, nombre = COALESCE(?, nombre), precio = COALESCE(?, precio), color_badge = ? WHERE id = ?',
      [imagen_url || null, nombre || null, precio || null, color_badge || null, prodId]
    );

    const actualizado = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    io.emit('producto_visual_cambiado', actualizado);
    res.json({ message: 'Apariencia del botón actualizada con éxito', producto: actualizado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 5. MESAS & SALÓN (DRAG & DROP)
// ============================================================================
app.get('/api/mesas', async (req, res) => {
  try {
    const zonas = await dbAll('SELECT * FROM Zonas ORDER BY id ASC');
    const mesas = await dbAll(`
      SELECT m.*, z.nombre as zonaNombre,
             o.id as orden_activa_id, o.numero_orden, o.subtotal, o.descuento_happy_hour, 
             o.servicio_10, o.iva_13, o.total as orden_total, o.mesero as orden_mesero, o.cliente,
             o.transferida_de as orden_transferida_de
      FROM Mesas m
      LEFT JOIN Zonas z ON m.zona_id = z.id
      LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')
      ORDER BY m.id ASC
    `);

    // Sincronizar siempre con la distribución física maestra del admin guardada en ConfigNegocio
    try {
      const cfg = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'distribucion_mesas_admin'");
      if (cfg && cfg.valor) {
        const mapAdmin = JSON.parse(cfg.valor);
        const posById = Object.fromEntries(mapAdmin.map(p => [p.id, p]));
        for (const m of mesas) {
          if (posById[m.id]) {
            m.x = posById[m.id].x;
            m.y = posById[m.id].y;
            if (posById[m.id].ancho != null) m.ancho = posById[m.id].ancho;
            if (posById[m.id].alto != null) m.alto = posById[m.id].alto;
            if (posById[m.id].forma) m.forma = posById[m.id].forma;
            if (posById[m.id].piso != null) m.piso = posById[m.id].piso;
          }
          m.piso = m.piso || (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
        }
      } else {
        for (const m of mesas) {
          m.piso = m.piso || (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
        }
      }
    } catch (_) {
      for (const m of mesas) {
        m.piso = m.piso || (m.zona_id === 5 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
      }
    }

    const activeOrderIds = mesas.map(m => m.orden_activa_id).filter(Boolean);
    let itemsByOrder = {};
    if (activeOrderIds.length > 0) {
      const placeholders = activeOrderIds.map(() => '?').join(',');
      const allItems = await dbAll(
        `SELECT * FROM DetalleOrden WHERE orden_id IN (${placeholders}) AND estado_comanda != 'anulado' ORDER BY hora_pedido ASC, id ASC`,
        activeOrderIds
      );
      for (const it of allItems) {
        if (!itemsByOrder[it.orden_id]) itemsByOrder[it.orden_id] = [];
        itemsByOrder[it.orden_id].push(it);
      }
    }

    const ahora = Date.now();
    for (const m of mesas) {
      const items = itemsByOrder[m.orden_activa_id] || [];
      const cocinaItems = items.filter(
        it => it.destino === 'cocina' && it.destino !== 'barra' && it.estado_comanda !== 'anulado'
      );
      const pendientes = cocinaItems.filter(
        it => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando'
      );

      // Reconciliar estado real de la mesa con los pedidos para evitar estados huérfanos
      if (m.orden_activa_id && m.estado !== 'cuenta_pedida' && m.estado !== 'cuenta' && m.estado !== 'libre') {
        const estadoCalculado = evaluarEstadoMesaKDS(items);
        if (m.estado !== estadoCalculado) {
          m.estado = estadoCalculado;
          dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [estadoCalculado, m.id]).catch(() => {});
          dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [estadoCalculado, m.orden_activa_id]).catch(() => {});
        }
      } else if (!m.orden_activa_id) {
        if (m.estado !== 'libre' || m.pidio_cuenta_qr) {
          m.estado = 'libre';
          m.pidio_cuenta_qr = 0;
          dbRun("UPDATE Mesas SET estado = 'libre', pidio_cuenta_qr = 0, mesero = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL WHERE id = ?", [m.id]).catch(() => {});
        }
        m.transferida_de = null;
        m.unida_con = null;
        m.mesas_unidas = [];
        m.es_mesa_unida = false;
        m.orden_total = 0;
        m.orden_activa_id = null;
        m.platos_pendientes = [];
        m.items_pendientes = [];
        m.minutos_espera = 0;
      }

      let primeraComandaHora = null;
      if (pendientes.length > 0) {
        primeraComandaHora = pendientes[0].hora_pedido || pendientes[0].creado_en || null;
      }

      let minutosEspera = 0;
      if (pendientes.length > 0 && primeraComandaHora) {
        const diffMs = Math.max(0, ahora - new Date(primeraComandaHora).getTime());
        minutosEspera = Math.floor(diffMs / 60000);
      }

      const platosPendientes = pendientes.map(it => {
        if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(m.numero)) {
          return `[Mesa ${it.origen_mesa_numero.toString().replace(/mesa\s*/i, '')}] ${it.nombre_producto}`;
        }
        return it.nombre_producto;
      });

      const todosPlatillos = items.map(it => {
        if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(m.numero)) {
          return `[Mesa ${it.origen_mesa_numero.toString().replace(/mesa\s*/i, '')}] ${it.nombre_producto}`;
        }
        return it.nombre_producto;
      });

      // Detectar si la mesa tiene una fusión activa en TableMerges
      let activeMerges = [];
      try {
        await dbRun(`CREATE TABLE IF NOT EXISTS TableMerges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mesa_principal_id INTEGER NOT NULL,
          mesa_secundaria_id INTEGER NOT NULL,
          orden_principal_id INTEGER,
          orden_secundaria_id INTEGER,
          snapshot_a TEXT,
          snapshot_b TEXT,
          items_transferidos_ids TEXT,
          creado_en TEXT,
          activo INTEGER DEFAULT 1
        )`);
        activeMerges = await dbAll('SELECT * FROM TableMerges WHERE activo = 1');
      } catch (_) {}

      const mergeActivo = activeMerges.find(
        am => Number(am.mesa_principal_id) === Number(m.id) || Number(am.mesa_secundaria_id) === Number(m.id)
      );

      let todasUnidas = [];
      const transferOrigen = (m.orden_activa_id && m.estado !== 'libre') ? (m.transferida_de || m.orden_transferida_de || null) : null;
      m.transferida_de = transferOrigen;

      if (transferOrigen) {
        todasUnidas.push(transferOrigen);
      }
      if (m.unida_con && m.estado !== 'libre') {
        todasUnidas.push(m.unida_con);
      }
      if (mergeActivo && m.estado !== 'libre') {
        if (Number(m.id) === Number(mergeActivo.mesa_principal_id)) {
          try {
            const sA = JSON.parse(mergeActivo.snapshot_a);
            if (sA && sA.mesa_numero) todasUnidas.push(sA.mesa_numero);
          } catch (_) {}
        }
      }

      // Detectar mesas secundarias enlazadas físicamente a esta mesa principal
      const secundariasEnlazadas = (m.estado !== 'libre' && m.orden_activa_id)
        ? mesas.filter(sec => Number(sec.unida_a_mesa_id) === Number(m.id)).map(sec => sec.numero)
        : [];

      // Detectar mesas en el mismo grupo visual
      const mesasEnMismoGrupo = (m.grupo_mesas && m.estado !== 'libre' && m.orden_activa_id)
        ? mesas.filter(other => other.id !== m.id && other.grupo_mesas === m.grupo_mesas).map(other => other.numero)
        : [];

      todasUnidas = [...new Set([...todasUnidas, ...secundariasEnlazadas, ...mesasEnMismoGrupo])];

      if (m.unida_a_mesa_id && m.estado !== 'libre' && m.orden_activa_id) {
        const princMesa = mesas.find(pm => pm.id === m.unida_a_mesa_id);
        m.unida_a_numero = princMesa ? princMesa.numero : 'Mesa Principal';
        m.es_mesa_secundaria_unida = true;
      } else {
        m.es_mesa_secundaria_unida = false;
        m.unida_a_numero = null;
      }

      m.es_mesa_agrupada = Boolean(m.grupo_mesas && m.estado !== 'libre' && m.orden_activa_id);
      m.grupo_mesas_nombre = m.es_mesa_agrupada ? m.grupo_mesas : null;
      m.platos_pendientes = platosPendientes;
      m.items_pendientes = platosPendientes;
      m.todos_platillos = todosPlatillos;
      m.primera_comanda_hora = primeraComandaHora;
      m.minutos_espera = minutosEspera;
      m.mesas_unidas = (m.estado === 'libre' || !m.orden_activa_id) ? [] : todasUnidas;
      m.es_mesa_unida = m.mesas_unidas.length > 0;
      if (m.es_mesa_unida && !m.unida_con && todasUnidas.length > 0) {
        m.unida_con = todasUnidas[0];
      } else if (!m.es_mesa_unida) {
        m.unida_con = null;
      }
    }

    res.json({ zonas, mesas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/posiciones', async (req, res) => {
  try {
    const { posiciones } = req.body;
    if (Array.isArray(posiciones)) {
      for (const pos of posiciones) {
        await dbRun('UPDATE Mesas SET x = ?, y = ?, ancho = COALESCE(?, ancho), alto = COALESCE(?, alto), piso = COALESCE(?, piso) WHERE id = ?', [
          pos.x,
          pos.y,
          pos.ancho || null,
          pos.alto || null,
          pos.piso || null,
          pos.id
        ]);
      }
      // Guardar instantáneamente en ConfigNegocio como la distribución maestra oficial del admin
      await dbRun("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('distribucion_mesas_admin', ?)", [
        JSON.stringify(posiciones)
      ]);
    }
    io.emit('mesas_reorganizadas', { posiciones });
    res.json({ message: 'Distribución física del salón guardada exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auto-guardado instantáneo de una mesa al soltar o redimensionar
app.post('/api/mesas/posiciones/auto', async (req, res) => {
  try {
    const { id, x, y, ancho, alto, piso } = req.body;
    if (id != null && x != null && y != null) {
      await dbRun('UPDATE Mesas SET x = ?, y = ?, ancho = COALESCE(?, ancho), alto = COALESCE(?, alto), piso = COALESCE(?, piso) WHERE id = ?', [
        x,
        y,
        ancho || null,
        alto || null,
        piso || null,
        id
      ]);

      // Actualizar el snapshot maestro de mesas en ConfigNegocio
      const todas = await dbAll('SELECT id, x, y, ancho, alto, piso FROM Mesas');
      await dbRun("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('distribucion_mesas_admin', ?)", [
        JSON.stringify(todas)
      ]);

      io.emit('mesas_reorganizadas', { mesaId: id, x, y, ancho, alto, piso });
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Datos de posición incompletos' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reorganizar automáticamente en una cuadrícula limpia y espaciada (sin solapes)
app.post('/api/mesas/posiciones/reorganizar-cuadricula', async (req, res) => {
  try {
    const mesas = await dbAll('SELECT * FROM Mesas ORDER BY zona_id ASC, id ASC');
    let salonX = 25, salonY = 25;
    let barraX = 530, barraY = 25;
    let terrazaX = 25, terrazaY = 325;
    let vipX = 530, vipY = 165;
    let piso2X = 25, piso2Y = 25;
    const nuevasPos = [];

    for (const m of mesas) {
      const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
      const esPiso2 = m.piso === 2 || m.zona_id === 5;
      let x, y, w, h;

      if (esPiso2) {
        // Segundo Piso
        w = 135; h = 115;
        x = piso2X; y = piso2Y;
        piso2X += 165;
        if (piso2X > 550) {
          piso2X = 25;
          piso2Y += 145;
        }
      } else if (m.zona_id === 2 || esSilla) {
        // Barra
        w = 85; h = 95;
        x = barraX; y = barraY;
        barraX += 105;
      } else if (m.zona_id === 3 || (m.numero && m.numero.toLowerCase().includes('terraza'))) {
        // Terraza
        w = 140; h = 120;
        x = terrazaX; y = terrazaY;
        terrazaX += 170;
      } else if (m.zona_id === 4 || (m.numero && m.numero.toLowerCase().includes('vip'))) {
        // VIP
        w = 200; h = 130;
        x = vipX; y = vipY;
        vipX += 230;
      } else {
        // Salón Principal
        w = 135; h = 115;
        x = salonX; y = salonY;
        salonX += 160;
        if (salonX > 400) {
          salonX = 25;
          salonY += 145;
        }
      }

      await dbRun('UPDATE Mesas SET x = ?, y = ?, ancho = ?, alto = ? WHERE id = ?', [x, y, w, h, m.id]);
      nuevasPos.push({ id: m.id, x, y, ancho: w, alto: h });
    }

    await dbRun("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('distribucion_mesas_admin', ?)", [
      JSON.stringify(nuevasPos)
    ]);

    io.emit('mesas_reorganizadas', { posiciones: nuevasPos });
    res.json({ ok: true, message: 'Salón reorganizado perfectamente en cuadrícula sin solapes', posiciones: nuevasPos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Eliminar Mesa o Silla de Barra
app.delete('/api/mesas/:id', async (req, res) => {
  try {
    const mesaId = req.params.id;
    // Verificar si la mesa tiene orden activa con consumos
    const ordenActiva = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')", [mesaId]);
    if (ordenActiva) {
      return res.status(400).json({ error: 'No se puede eliminar la mesa porque tiene una cuenta activa pendiente de cobro.' });
    }
    await dbRun('DELETE FROM Mesas WHERE id = ?', [mesaId]);
    io.emit('mesa_eliminada', { id: Number(mesaId) });
    res.json({ message: 'Mesa o silla eliminada exitosamente', id: mesaId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generar Código QR Real para la Mesa
app.get('/api/mesas/:id/qr', async (req, res) => {
  try {
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [req.params.id]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    
    const host = req.get('host');
    const protocol = req.protocol;
    const url = `${protocol}://${host}/m/${mesa.id}`;
    
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: {
        dark: '#030712',
        light: '#ffffff'
      }
    });

    res.json({
      mesa,
      url,
      qrDataUrl
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/crear', async (req, res) => {
  try {
    const { numero, zona_id, capacidad = 4, forma = 'square', x = 100, y = 100, piso = 1, ancho, alto } = req.body;
    const numPiso = Number(piso) || 1;
    const resolvedZonaId = zona_id || (numPiso === 2 ? 5 : 1);
    const resolvedW = ancho || (forma === 'silla' ? 85 : 135);
    const resolvedH = alto || (forma === 'silla' ? 95 : 115);

    const r = await dbRun(
      'INSERT INTO Mesas (numero, zona_id, capacidad, forma, x, y, piso, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [numero, resolvedZonaId, capacidad, forma, x, y, numPiso, resolvedW, resolvedH]
    );
    const nuevaMesa = await dbGet(`
      SELECT m.*, z.nombre as zonaNombre 
      FROM Mesas m 
      LEFT JOIN Zonas z ON m.zona_id = z.id 
      WHERE m.id = ?
    `, [r.lastID]);
    if (nuevaMesa) {
      nuevaMesa.piso = nuevaMesa.piso || numPiso;
    }
    io.emit('nueva_mesa_creada', nuevaMesa);
    res.json(nuevaMesa);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar Capacidad de Comensales de una Mesa o Silla
app.put('/api/mesas/:id/capacidad', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const { capacidad } = req.body;
    const numCap = parseInt(capacidad, 10);
    if (!numCap || numCap < 1 || numCap > 100) {
      return res.status(400).json({ error: 'La capacidad debe ser un número entero entre 1 y 100.' });
    }

    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada.' });

    await dbRun('UPDATE Mesas SET capacidad = ? WHERE id = ?', [numCap, mesaId]);
    const mesaActualizada = await dbGet(`
      SELECT m.*, z.nombre as zonaNombre 
      FROM Mesas m 
      LEFT JOIN Zonas z ON m.zona_id = z.id 
      WHERE m.id = ?
    `, [mesaId]);

    io.emit('mesa_capacidad_cambiada', { id: Number(mesaId), capacidad: numCap });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), capacidad: numCap });

    res.json({ message: `Capacidad de ${mesa.numero} actualizada a ${numCap} personas`, mesa: mesaActualizada });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Renombrar Mesa o Silla de Barra
const handleRenombrarMesa = async (req, res) => {
  try {
    const mesaId = req.params.id;
    const { numero, nombre } = req.body;
    const nuevoNombre = (numero || nombre || '').trim();
    if (!nuevoNombre) {
      return res.status(400).json({ error: 'El nombre de la mesa o silla no puede estar vacío.' });
    }

    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa o silla no encontrada.' });

    // Validar que no exista otra mesa con el mismo nombre
    const duplicada = await dbGet('SELECT * FROM Mesas WHERE LOWER(numero) = LOWER(?) AND id != ?', [nuevoNombre, mesaId]);
    if (duplicada) {
      return res.status(400).json({ error: `Ya existe otra mesa o silla con el nombre "${nuevoNombre}".` });
    }

    await dbRun('UPDATE Mesas SET numero = ? WHERE id = ?', [nuevoNombre, mesaId]);
    const mesaActualizada = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);

    io.emit('mesa_renombrada', { id: Number(mesaId), numero: nuevoNombre });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), numero: nuevoNombre });

    res.json({ message: `Nombre actualizado exitosamente a "${nuevoNombre}"`, mesa: mesaActualizada });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

app.put('/api/mesas/:id', handleRenombrarMesa);
app.post('/api/mesas/:id/renombrar', handleRenombrarMesa);

app.post('/api/mesas/mover', async (req, res) => {
  try {
    const { origenMesaId, destinoMesaId } = req.body;
    const mesaOrig = await dbGet('SELECT * FROM Mesas WHERE id = ?', [origenMesaId]);
    const mesaDest = await dbGet('SELECT * FROM Mesas WHERE id = ?', [destinoMesaId]);
    if (!mesaOrig || !mesaDest) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')", [origenMesaId]);
    if (!orden) return res.status(400).json({ error: 'La mesa de origen no tiene una orden activa' });

    // Table B must display that it received the order from Table A (+A)
    const origenLabel = mesaOrig.numero;

    // 1. Transfer active order to Table B and record transfer origin
    await dbRun('UPDATE Ordenes SET mesa_id = ?, transferida_de = ? WHERE id = ?', [destinoMesaId, origenLabel, orden.id]);

    // 2. Table B inherits status, waiter, and stores transfer origin
    await dbRun(
      'UPDATE Mesas SET estado = ?, mesero = ?, transferida_de = ? WHERE id = ?',
      [mesaOrig.estado, mesaOrig.mesero, origenLabel, destinoMesaId]
    );

    // 3. Table A is emptied and returns to a normal empty state with no residual labels
    await dbRun(
      "UPDATE Mesas SET estado = 'libre', mesero = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0 WHERE id = ?",
      [origenMesaId]
    );

    // 4. Deactivate any prior table merges involving Table A
    await dbRun(
      'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
      [origenMesaId, origenMesaId]
    );

    io.emit('mesa_transferida', { origenMesaId, destinoMesaId, ordenId: orden.id, transferida_de: origenLabel });
    io.emit('mesa_actualizada', { mesaId: origenMesaId, estado: 'libre', total: 0, transferida_de: null, mesas_unidas: [] });
    io.emit('mesa_actualizada', { mesaId: destinoMesaId, estado: mesaOrig.estado, total: orden.total || 0, transferida_de: origenLabel, mesas_unidas: [origenLabel] });

    res.json({ message: `Orden transferida con éxito de ${mesaOrig.numero} a ${mesaDest.numero}`, transferida_de: origenLabel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/unir', async (req, res) => {
  try {
    const { mesaPrincipalId, mesaSecundariaId } = req.body;
    if (mesaPrincipalId === mesaSecundariaId) {
      return res.status(400).json({ error: 'Debes seleccionar dos mesas distintas' });
    }

    const mesaPrincipal = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaPrincipalId]);
    const mesaSecundaria = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaSecundariaId]);
    if (!mesaPrincipal || !mesaSecundaria) {
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }

    let orden1 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')", [mesaPrincipalId]);
    let orden2 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')", [mesaSecundariaId]);

    if (!orden1 || !orden2) {
      return res.status(400).json({ error: 'Ambas mesas deben tener órdenes activas' });
    }

    const meseroAsignado = mesaPrincipal.mesero || mesaSecundaria.mesero || 'Juan Jival';

    // Obtener ítems originales de ambas mesas para el snapshot de TableMerges
    const itemsA = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden2.id]);
    const itemsB = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden1.id]);

    const snapshotA = JSON.stringify({
      mesa_id: mesaSecundaria.id,
      mesa_numero: mesaSecundaria.numero,
      mesa_estado: mesaSecundaria.estado,
      mesa_mesero: mesaSecundaria.mesero,
      orden_id: orden2.id,
      numero_orden: orden2.numero_orden,
      cliente: orden2.cliente,
      subtotal: orden2.subtotal,
      descuento_happy_hour: orden2.descuento_happy_hour,
      servicio_10: orden2.servicio_10,
      iva_13: orden2.iva_13,
      total: orden2.total,
      estado: orden2.estado,
      items_ids: itemsA.map(i => i.id)
    });

    const snapshotB = JSON.stringify({
      mesa_id: mesaPrincipal.id,
      mesa_numero: mesaPrincipal.numero,
      mesa_estado: mesaPrincipal.estado,
      mesa_mesero: mesaPrincipal.mesero,
      orden_id: orden1.id,
      numero_orden: orden1.numero_orden,
      cliente: orden1.cliente,
      subtotal: orden1.subtotal,
      descuento_happy_hour: orden1.descuento_happy_hour,
      servicio_10: orden1.servicio_10,
      iva_13: orden1.iva_13,
      total: orden1.total,
      estado: orden1.estado,
      items_ids: itemsB.map(i => i.id)
    });

    await dbRun(`CREATE TABLE IF NOT EXISTS TableMerges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mesa_principal_id INTEGER NOT NULL,
      mesa_secundaria_id INTEGER NOT NULL,
      orden_principal_id INTEGER,
      orden_secundaria_id INTEGER,
      snapshot_a TEXT,
      snapshot_b TEXT,
      items_transferidos_ids TEXT,
      creado_en TEXT,
      activo INTEGER DEFAULT 1
    )`);

    await dbRun(`INSERT INTO TableMerges (
      mesa_principal_id, mesa_secundaria_id, orden_principal_id, orden_secundaria_id,
      snapshot_a, snapshot_b, items_transferidos_ids, creado_en, activo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
      mesaPrincipal.id, mesaSecundaria.id, orden1.id, orden2.id,
      snapshotA, snapshotB, JSON.stringify(itemsA.map(i => i.id)), new Date().toISOString()
    ]);

    // Transferir todos los productos, cantidades y observaciones hacia la orden de la Mesa Principal (B)
    await dbRun("UPDATE DetalleOrden SET origen_mesa_numero = COALESCE(origen_mesa_numero, ?), origen_mesa_id = COALESCE(origen_mesa_id, ?) WHERE orden_id = ?", [mesaSecundaria.numero, mesaSecundaria.id, orden2.id]);
    await dbRun("UPDATE DetalleOrden SET origen_mesa_numero = COALESCE(origen_mesa_numero, ?), origen_mesa_id = COALESCE(origen_mesa_id, ?) WHERE orden_id = ?", [mesaPrincipal.numero, mesaPrincipal.id, orden1.id]);
    await dbRun('UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?', [orden1.id, orden2.id]);
    await dbRun("UPDATE Ordenes SET estado = 'fusionada', total = 0 WHERE id = ?", [orden2.id]);

    const allMergedItems = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden1.id]);
    const subtotal = allMergedItems.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);
    const servicio = Math.round(subtotal * 0.10);
    const iva = Math.round(subtotal * 0.13);
    const total = subtotal + servicio + iva;

    const nuevoEstadoUnido = allMergedItems.length > 0 ? evaluarEstadoMesaKDS(allMergedItems) : 'abierta';

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?", [subtotal, servicio, iva, total, nuevoEstadoUnido, orden1.id]);

    // La Mesa A (secundaria) queda completamente libre y disponible en el salón
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL, unida_a_mesa_id = NULL, unida_con = NULL, grupo_mesas = NULL WHERE id = ?", [mesaSecundariaId]);
    // La Mesa B (principal) recibe el estado y total combinado y queda marcada con unida_con
    await dbRun("UPDATE Mesas SET estado = ?, unida_con = ?, mesero = ? WHERE id = ?", [nuevoEstadoUnido, mesaSecundaria.numero, meseroAsignado, mesaPrincipalId]);

    io.emit('mesas_unidas', { mesaPrincipalId, mesaSecundariaId, ordenPrincipalId: orden1.id });
    io.emit('mesa_actualizada', { mesaId: mesaPrincipalId, estado: nuevoEstadoUnido, total });
    io.emit('mesa_actualizada', { mesaId: mesaSecundariaId, estado: 'libre', total: 0 });

    res.json({ message: `Mesas unidas correctamente (${mesaPrincipal.numero} + ${mesaSecundaria.numero})`, ordenId: orden1.id, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agrupar mesas para unión visual conservando cada mesa intacta (sin mezclar permanentemente datos)
app.post('/api/mesas/agrupar', async (req, res) => {
  try {
    const { mesa1Id, mesa2Id } = req.body;
    if (!mesa1Id || !mesa2Id) {
      return res.status(400).json({ error: 'Debes especificar ambas mesas a agrupar' });
    }
    if (mesa1Id === mesa2Id) {
      return res.status(400).json({ error: 'Debes seleccionar dos mesas distintas' });
    }

    const mesa1 = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesa1Id]);
    const mesa2 = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesa2Id]);
    if (!mesa1 || !mesa2) {
      return res.status(404).json({ error: 'Mesa no encontrada' });
    }

    // Conservar datos y órdenes intactos: solo crear/asignar el grupo visual
    const grupoNombre = mesa1.grupo_mesas || mesa2.grupo_mesas || `Grupo ${mesa1.numero} + ${mesa2.numero}`;
    await dbRun('UPDATE Mesas SET grupo_mesas = ? WHERE id IN (?, ?)', [grupoNombre, mesa1Id, mesa2Id]);

    io.emit('mesas_agrupadas', { grupo: grupoNombre, mesas: [mesa1Id, mesa2Id] });
    io.emit('mesa_actualizada', { mesaId: mesa1Id });
    io.emit('mesa_actualizada', { mesaId: mesa2Id });

    res.json({ message: `Mesas agrupadas visualmente con éxito (${grupoNombre})`, grupo: grupoNombre });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Restaurar mesas: elimina solo el grupo y restaura cada mesa a su estado original sin recalcular ni repartir productos
app.post('/api/mesas/restaurar', async (req, res) => {
  try {
    const { mesaId } = req.body;
    if (!mesaId) return res.status(400).json({ error: 'ID de mesa requerido' });

    const mesaTarget = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesaTarget) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (mesaTarget.grupo_mesas) {
      const grupo = mesaTarget.grupo_mesas;
      const mesasEnGrupo = await dbAll('SELECT * FROM Mesas WHERE grupo_mesas = ?', [grupo]);
      await dbRun('UPDATE Mesas SET grupo_mesas = NULL WHERE grupo_mesas = ?', [grupo]);

      for (const m of mesasEnGrupo) {
        io.emit('mesa_actualizada', { mesaId: m.id });
      }
      io.emit('mesas_restauradas', { grupo, mesas: mesasEnGrupo.map(m => m.id) });
      io.emit('mesas_separadas', { grupo, mesaPrincipalId: mesaTarget.id });

      return res.json({
        message: 'Grupo de mesas eliminado. Cada mesa conservó sus productos, totales y observaciones intactas.',
        mesasRestauradas: mesasEnGrupo.map(m => ({ id: m.id, numero: m.numero }))
      });
    }

    return await separarMesasFusionadas(mesaTarget, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Separar mesas previamente unidas (deshacer fusión restaurando cuentas originales)
async function procesarSepararMesas(req, res) {
  try {
    const { mesaId, destinoMesaId } = req.body;
    if (!mesaId) return res.status(400).json({ error: 'ID de mesa requerido' });

    const mesaTarget = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesaTarget) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (mesaTarget.grupo_mesas) {
      const grupo = mesaTarget.grupo_mesas;
      const mesasEnGrupo = await dbAll('SELECT * FROM Mesas WHERE grupo_mesas = ?', [grupo]);
      await dbRun('UPDATE Mesas SET grupo_mesas = NULL WHERE grupo_mesas = ?', [grupo]);

      for (const m of mesasEnGrupo) {
        io.emit('mesa_actualizada', { mesaId: m.id });
      }
      io.emit('mesas_restauradas', { grupo, mesas: mesasEnGrupo.map(m => m.id) });
      io.emit('mesas_separadas', { grupo, mesaPrincipalId: mesaTarget.id });

      return res.json({
        message: 'Grupo de mesas eliminado. Cada mesa conservó sus productos, totales y observaciones intactas.',
        mesasRestauradas: mesasEnGrupo.map(m => ({ id: m.id, numero: m.numero }))
      });
    }

    return await separarMesasFusionadas(mesaTarget, res, destinoMesaId);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

app.post('/api/mesas/separar', procesarSepararMesas);
app.post('/api/mesas/restaurar', procesarSepararMesas);

async function separarMesasFusionadas(mesaTarget, res, destinoMesaId = null) {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS TableMerges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mesa_principal_id INTEGER NOT NULL,
      mesa_secundaria_id INTEGER NOT NULL,
      orden_principal_id INTEGER,
      orden_secundaria_id INTEGER,
      snapshot_a TEXT,
      snapshot_b TEXT,
      items_transferidos_ids TEXT,
      creado_en TEXT,
      activo INTEGER DEFAULT 1
    )`);

    // 1. Buscar si existe un snapshot de TableMerges activo para esta mesa
    const activeMerge = await dbGet(
      'SELECT * FROM TableMerges WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1 ORDER BY id DESC LIMIT 1',
      [mesaTarget.id, mesaTarget.id]
    );

    if (activeMerge) {
      const snapA = JSON.parse(activeMerge.snapshot_a);
      const snapB = JSON.parse(activeMerge.snapshot_b);
      const transferIds = JSON.parse(activeMerge.items_transferidos_ids || '[]');

      // Verificar si la mesa original de A (snapA.mesa_id) está actualmente ocupada
      const mesaOriginalA = await dbGet('SELECT * FROM Mesas WHERE id = ?', [snapA.mesa_id]);
      const estaOcupadaOriginal = mesaOriginalA && mesaOriginalA.estado !== 'libre';

      let targetDestinoMesaId = snapA.mesa_id;
      let targetDestinoNumero = snapA.mesa_numero;

      if (destinoMesaId) {
        const mesaDestinoElegida = await dbGet('SELECT * FROM Mesas WHERE id = ?', [destinoMesaId]);
        if (!mesaDestinoElegida) {
          return res.status(404).json({ error: 'La mesa seleccionada no existe.' });
        }
        if (mesaDestinoElegida.estado !== 'libre') {
          return res.status(400).json({ error: 'La mesa de destino seleccionada está ocupada. Por favor selecciona una mesa libre.' });
        }
        targetDestinoMesaId = mesaDestinoElegida.id;
        targetDestinoNumero = mesaDestinoElegida.numero;
      } else if (estaOcupadaOriginal) {
        return res.status(200).json({
          requiereDestino: true,
          mesaOriginalOcupada: true,
          mesaOriginalId: snapA.mesa_id,
          mesaOriginalNumero: snapA.mesa_numero,
          message: `La mesa original ${snapA.mesa_numero} está actualmente ocupada. ¿Deseas restaurar la orden original en otra mesa disponible?`
        });
      }

      // Devolver los productos originales de Mesa A a su orden original
      if (transferIds.length > 0) {
        const placeholders = transferIds.map(() => '?').join(',');
        await dbRun(`UPDATE DetalleOrden SET orden_id = ? WHERE id IN (${placeholders})`, [snapA.orden_id, ...transferIds]);
      }

      // Si se restaura en otra mesa libre, reasignar mesa_id en Ordenes
      if (targetDestinoMesaId !== snapA.mesa_id) {
        await dbRun('UPDATE Ordenes SET mesa_id = ? WHERE id = ?', [targetDestinoMesaId, snapA.orden_id]);
      }

      // Restaurar Orden A con sus productos, totales, impuestos, observaciones y estado
      await dbRun(
        'UPDATE Ordenes SET subtotal = ?, descuento_happy_hour = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?',
        [snapA.subtotal, snapA.descuento_happy_hour || 0, snapA.servicio_10, snapA.iva_13, snapA.total, snapA.estado, snapA.orden_id]
      );

      // Restaurar Mesa Destino (sea la original o la nueva seleccionada)
      await dbRun(
        'UPDATE Mesas SET estado = ?, mesero = ?, unida_a_mesa_id = NULL, unida_con = NULL, grupo_mesas = NULL WHERE id = ?',
        [snapA.mesa_estado || 'abierta', snapA.mesa_mesero || 'Juan Jival', targetDestinoMesaId]
      );

      // Restaurar Orden B con sus productos y totales originales
      const itemsRestantesB = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [snapB.orden_id]);
      let subB = snapB.subtotal;
      let servB = snapB.servicio_10;
      let ivaB = snapB.iva_13;
      let totB = snapB.total;
      let estB = snapB.estado;

      const itemsBIds = snapB.items_ids || [];
      const remainingIds = itemsRestantesB.map(i => i.id);
      const tieneNuevos = remainingIds.some(id => !itemsBIds.includes(id));

      if (tieneNuevos) {
        subB = itemsRestantesB.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);
        servB = Math.round(subB * 0.10);
        ivaB = Math.round(subB * 0.13);
        totB = subB + servB + ivaB;
        estB = evaluarEstadoMesaKDS(itemsRestantesB);
      }

      await dbRun(
        'UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?',
        [subB, servB, ivaB, totB, estB, snapB.orden_id]
      );

      // Restaurar Mesa B
      await dbRun(
        'UPDATE Mesas SET estado = ?, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL WHERE id = ?',
        [estB, snapB.mesa_id]
      );

      // Limpiar flags en la mesa destino
      await dbRun(
        'UPDATE Mesas SET unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL WHERE id = ?',
        [targetDestinoMesaId]
      );

      // Si se restauró a otra mesa, limpiar también la original de A por seguridad
      if (targetDestinoMesaId !== snapA.mesa_id) {
        await dbRun(
          'UPDATE Mesas SET unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL WHERE id = ?',
          [snapA.mesa_id]
        );
      }

      // Normalizar DetalleOrden para que cada orden pertenezca limpiamente a su mesa individual
      await dbRun(
        'UPDATE DetalleOrden SET origen_mesa_numero = ?, origen_mesa_id = ? WHERE orden_id = ?',
        [targetDestinoNumero, targetDestinoMesaId, snapA.orden_id]
      );
      await dbRun(
        'UPDATE DetalleOrden SET origen_mesa_numero = ?, origen_mesa_id = ? WHERE orden_id = ?',
        [snapB.mesa_numero, snapB.mesa_id, snapB.orden_id]
      );

      // Desactivar merge
      await dbRun('UPDATE TableMerges SET activo = 0 WHERE id = ?', [activeMerge.id]);

      io.emit('mesas_separadas', { mesaPrincipalId: snapB.mesa_id, mesaSecundariaId: targetDestinoMesaId });
      io.emit('mesa_actualizada', { mesaId: snapB.mesa_id, estado: estB, total: totB, unida_con: null, es_mesa_unida: false, mesas_unidas: [] });
      io.emit('mesa_actualizada', { mesaId: targetDestinoMesaId, estado: snapA.mesa_estado || 'abierta', total: snapA.total, unida_con: null, es_mesa_unida: false, mesas_unidas: [] });

      return res.json({
        message: `Mesas separadas con éxito. Se restauraron Mesa ${snapB.mesa_numero} y Mesa ${targetDestinoNumero} con sus productos, totales y observaciones exactas.`,
        mesaPrincipal: { id: snapB.mesa_id, numero: snapB.mesa_numero, total: totB, estado: estB },
        mesasRestauradas: [
          { id: targetDestinoMesaId, numero: targetDestinoNumero, total: snapA.total, estado: snapA.mesa_estado || 'abierta' }
        ]
      });
    }

    const mesaId = mesaTarget.id;
    // Determinar mesa principal (si mesaTarget es secundaria, su principal es unida_a_mesa_id)
    let mesaPrincipalId = mesaTarget.unida_a_mesa_id || mesaTarget.id;
    let mesaPrincipal = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaPrincipalId]);

    // Buscar orden activa en la mesa principal
    let ordenPrincipal = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
      [mesaPrincipal.id]
    );

    // Si no tiene orden directa, buscar si hay orden con consumos de esta mesa
    if (!ordenPrincipal) {
      const ordenConConsumos = await dbGet(
        `SELECT o.* FROM Ordenes o 
         JOIN DetalleOrden d ON d.orden_id = o.id 
         WHERE (d.origen_mesa_numero = ? OR d.origen_mesa_id = ?) 
           AND o.estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada') 
         LIMIT 1`,
        [mesaTarget.numero, mesaTarget.id]
      );
      if (ordenConConsumos) {
        ordenPrincipal = ordenConConsumos;
        mesaPrincipal = await dbGet('SELECT * FROM Mesas WHERE id = ?', [ordenPrincipal.mesa_id]);
        mesaPrincipalId = mesaPrincipal.id;
      }
    }

    const mesasRestauradas = [];

    // Buscar mesas secundarias vinculadas
    const mesasSecundariasEnBD = await dbAll(
      'SELECT * FROM Mesas WHERE unida_a_mesa_id = ? OR id = ?',
      [mesaPrincipal.id, mesaTarget.id !== mesaPrincipal.id ? mesaTarget.id : 0]
    );

    let itemsOrden = [];
    if (ordenPrincipal) {
      itemsOrden = await dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
        [ordenPrincipal.id]
      );
    }

    const origenesSecundariosNums = [
      ...new Set([
        ...itemsOrden
          .map(it => it.origen_mesa_numero)
          .filter(num => num && String(num) !== String(mesaPrincipal.numero)),
        ...mesasSecundariasEnBD.map(m => m.numero).filter(num => String(num) !== String(mesaPrincipal.numero))
      ])
    ];

    for (const origenNum of origenesSecundariosNums) {
      let mesaSec = await dbGet('SELECT * FROM Mesas WHERE numero = ?', [origenNum]);
      if (!mesaSec) mesaSec = await dbGet('SELECT * FROM Mesas WHERE numero LIKE ?', [`%${origenNum}%`]);
      if (!mesaSec || mesaSec.id === mesaPrincipal.id) continue;

      const itemsDeEstaSecundaria = itemsOrden.filter(it => 
        String(it.origen_mesa_numero) === String(origenNum) || (it.origen_mesa_id && it.origen_mesa_id === mesaSec.id)
      );

      let totSec = 0;
      let estadoSec = 'libre';

      if (itemsDeEstaSecundaria.length > 0) {
        let ordenSec = await dbGet(
          "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado = 'fusionada' ORDER BY id DESC LIMIT 1",
          [mesaSec.id]
        );

        const ahora = new Date().toISOString();
        if (!ordenSec) {
          const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
          const r = await dbRun(
            "INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado) VALUES (?, ?, ?, ?, ?, 'abierta')",
            [numOrden, mesaSec.id, 'Cliente General', mesaPrincipal.mesero || 'Juan Jival', ahora]
          );
          ordenSec = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [r.lastID]);
        }

        await dbRun(
          'UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ? AND (origen_mesa_numero = ? OR origen_mesa_id = ?)',
          [ordenSec.id, ordenPrincipal.id, origenNum, mesaSec.id]
        );

        const itemsSec = await dbAll(
          "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
          [ordenSec.id]
        );
        const subSec = itemsSec.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);
        const servSec = Math.round(subSec * 0.10);
        const ivaSec = Math.round(subSec * 0.13);
        totSec = subSec + servSec + ivaSec;
        estadoSec = evaluarEstadoMesaKDS(itemsSec);

        await dbRun(
          'UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?',
          [subSec, servSec, ivaSec, totSec, estadoSec, ordenSec.id]
        );
      }

      await dbRun(
        'UPDATE Mesas SET estado = ?, unida_a_mesa_id = NULL, unida_con = NULL, mesero = ? WHERE id = ?',
        [estadoSec, estadoSec === 'libre' ? null : (mesaPrincipal.mesero || 'Juan Jival'), mesaSec.id]
      );

      io.emit('mesa_actualizada', { mesaId: mesaSec.id, estado: estadoSec, total: totSec });
      mesasRestauradas.push({ id: mesaSec.id, numero: mesaSec.numero, total: totSec, estado: estadoSec });
    }

    let totPrinc = 0;
    let estadoPrinc = 'libre';

    if (ordenPrincipal) {
      const itemsRestantes = await dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
        [ordenPrincipal.id]
      );

      if (itemsRestantes.length > 0) {
        const subPrinc = itemsRestantes.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);
        const servPrinc = Math.round(subPrinc * 0.10);
        const ivaPrinc = Math.round(subPrinc * 0.13);
        totPrinc = subPrinc + servPrinc + ivaPrinc;
        estadoPrinc = evaluarEstadoMesaKDS(itemsRestantes);

        await dbRun(
          'UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?',
          [subPrinc, servPrinc, ivaPrinc, totPrinc, estadoPrinc, ordenPrincipal.id]
        );
      } else {
        await dbRun("UPDATE Ordenes SET estado = 'cerrada', total = 0 WHERE id = ?", [ordenPrincipal.id]);
        estadoPrinc = 'libre';
      }
    }

    await dbRun(
      'UPDATE Mesas SET estado = ?, unida_a_mesa_id = NULL, unida_con = NULL WHERE id = ?',
      [estadoPrinc, mesaPrincipal.id]
    );

    io.emit('mesas_separadas', { mesaPrincipalId: mesaPrincipal.id });
    io.emit('mesa_actualizada', { mesaId: mesaPrincipal.id, estado: estadoPrinc, total: totPrinc });

    res.json({
      message: `Mesas separadas con éxito. Se restauraron ${mesasRestauradas.length} mesa(s).`,
      mesaPrincipal: { id: mesaPrincipal.id, numero: mesaPrincipal.numero, total: totPrinc, estado: estadoPrinc },
      mesasRestauradas
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}




// ============================================================================
// 6. CATÁLOGO DE MENÚ & CONTROL DE AGOTADOS ("86 LIST")
// ============================================================================
app.get('/api/menu', async (req, res) => {
  try {
    const categorias = await dbAll('SELECT * FROM Categorias ORDER BY id ASC');
    const productos = await dbAll('SELECT * FROM Productos WHERE activo = 1 ORDER BY categoria_id ASC, id ASC');
    res.json({ categorias, productos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agregar nuevo producto y precio al menú
app.post('/api/productos', async (req, res) => {
  try {
    const { nombre, precio, categoria_id, destino, curso, imagen_url } = req.body;
    const nombreLimpio = (nombre || '').trim();
    const precioNum = parseFloat(precio);

    if (!nombreLimpio) {
      return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
    }
    if (isNaN(precioNum) || precioNum < 0) {
      return res.status(400).json({ error: 'El precio debe ser un número válido mayor o igual a 0.' });
    }

    let catId = categoria_id ? Number(categoria_id) : null;
    let destinoFinal = (destino || '').trim().toLowerCase();

    if (catId) {
      const cat = await dbGet('SELECT * FROM Categorias WHERE id = ?', [catId]);
      if (cat && !destinoFinal) {
        destinoFinal = cat.destino || 'cocina';
      }
    } else {
      const primeraCat = await dbGet('SELECT * FROM Categorias ORDER BY id ASC LIMIT 1');
      catId = primeraCat ? primeraCat.id : 1;
      if (!destinoFinal) destinoFinal = primeraCat ? (primeraCat.destino || 'cocina') : 'cocina';
    }

    if (!destinoFinal || (destinoFinal !== 'barra' && destinoFinal !== 'cocina')) {
      destinoFinal = 'cocina';
    }

    const cursoNum = Number(curso) || (destinoFinal === 'barra' ? 1 : 2);

    const result = await dbRun(
      `INSERT INTO Productos (negocio_id, categoria_id, nombre, precio, destino, curso, imagen_url, happy_hour, agotado, activo)
       VALUES (1, ?, ?, ?, ?, ?, ?, 0, 0, 1)`,
      [catId, nombreLimpio, precioNum, destinoFinal, cursoNum, imagen_url || null]
    );

    const nuevoProd = await dbGet('SELECT * FROM Productos WHERE id = ?', [result.lastID]);
    io.emit('producto_creado', nuevoProd);
    io.emit('menu_actualizado');

    res.status(201).json({ message: 'Producto agregado exitosamente', producto: nuevoProd });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/productos/:id/toggle-86', async (req, res) => {
  try {
    const prodId = req.params.id;
    const prod = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const nuevoAgotado = prod.agotado ? 0 : 1;
    await dbRun('UPDATE Productos SET agotado = ? WHERE id = ?', [nuevoAgotado, prodId]);

    io.emit('producto_agotado_cambiado', { id: Number(prodId), agotado: Boolean(nuevoAgotado), nombre: prod.nombre });
    res.json({ id: Number(prodId), agotado: Boolean(nuevoAgotado), nombre: prod.nombre });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 7. COMANDAS, CURSOS DE COCINA & AUDITORÍA DE ANULACIÓN
// ============================================================================
app.get('/api/ordenes/mesa/:mesaId', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' ORDER BY id ASC", [orden.id]);
    res.json({ orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// HAPPY HOUR — ESTADO Y CONFIGURACIÓN
// ============================================================================
// GET: Retorna el estado actual de Happy Hour
app.get('/api/happy-hour', (req, res) => {
  res.json({ ...happyHourEstado });
});

// POST: Activar / Desactivar (y opcionalmente cambiar horario)
app.post('/api/happy-hour', async (req, res) => {
  const { activo, horaInicio, horaFin } = req.body;

  if (horaInicio !== undefined) happyHourEstado.horaInicio = horaInicio;
  if (horaFin !== undefined) happyHourEstado.horaFin = horaFin;
  if (activo !== undefined) happyHourEstado.activo = Boolean(activo);

  // Persistir en BD
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_activo', ?)", [String(happyHourEstado.activo)], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_inicio', ?)", [happyHourEstado.horaInicio], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_fin', ?)", [happyHourEstado.horaFin], r));

  console.log(`🍸 Happy Hour actualizado: activo=${happyHourEstado.activo}, ${happyHourEstado.horaInicio}–${happyHourEstado.horaFin}`);
  io.emit('happy_hour_cambio', { ...happyHourEstado });
  res.json({ ...happyHourEstado });
});

app.post('/api/comandas/enviar', async (req, res) => {
  try {
    const mesaId = req.body.mesaId || req.body.mesa_id;
    const { mesero = 'Juan Jival', cliente = 'Cliente General', items = [], happyHourActivo = false } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'La comanda no contiene productos' });
    }


    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    const mesaNumero = mesa.nombre || mesa.numero || `Mesa ${mesaId}`;

    // 1. Identificar items nuevos no enviados previamente
    const nuevosItems = items.filter(it => !it.id_detalle_existente && !it.enviado);
    if (!nuevosItems.length && items.length > 0) {
      const ordenExistente = await dbGet(
        "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')",
        [mesaId]
      );
      return res.json({
        message: 'Comanda guardada con éxito',
        ordenId: ordenExistente ? ordenExistente.id : null,
        total: ordenExistente ? ordenExistente.total : 0,
        estado: mesa.estado,
        tieneCocina: false
      });
    }

    // 2. Procesar y normalizar detalles de productos nuevos
    const itemsProcesados = [];
    for (const it of nuevosItems) {
      let prodId = it.producto_id || it.id;
      let nombre = it.nombre || it.nombre_producto;
      let precio = it.precio != null ? Number(it.precio) : (it.precio_unitario != null ? Number(it.precio_unitario) : null);
      let destino = it.destino;
      let curso = it.curso;

      if (prodId) {
        if (!nombre || precio == null || !destino || !curso) {
          const prodDb = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
          if (prodDb) {
            if (!nombre) nombre = prodDb.nombre;
            if (precio == null) precio = prodDb.precio;
            if (!destino) destino = prodDb.destino;
            if (!curso) curso = prodDb.curso || 2;
          }
        }
      } else if (nombre) {
        const prodDb = await dbGet('SELECT * FROM Productos WHERE nombre = ? OR nombre LIKE ?', [nombre, `%${nombre}%`]);
        if (prodDb) {
          prodId = prodDb.id;
          if (precio == null) precio = prodDb.precio;
          if (!destino) destino = prodDb.destino;
          if (!curso) curso = prodDb.curso || 2;
        } else {
          prodId = 1;
        }
      } else {
        prodId = 1;
      }

      itemsProcesados.push({
        id: prodId,
        nombre: nombre || 'Producto',
        precio: precio || 0,
        cantidad: Number(it.cantidad) || 1,
        notas: it.notas || '',
        curso: curso || 2,
        destino: destino || 'cocina',
        origen_mesa_numero: it.origen_mesa_numero || null
      });
    }

    // 3. Evaluar si algún nuevo item va a cocina
    const tieneNuevosCocina = itemsProcesados.some(it => 
      it.destino === 'cocina' || (it.destino !== 'barra' && it.curso && it.curso <= 3)
    );

    // 4. Buscar orden activa o crear una nueva
    let orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')",
      [mesaId]
    );
    const ahora = new Date().toISOString();
    let ordenId;

    if (!orden) {
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const estadoInicialOrden = tieneNuevosCocina ? 'esperando' : 'abierta';
      const r = await dbRun(
        `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [numOrden, mesaId, cliente, mesero, ahora, estadoInicialOrden]
      );
      ordenId = r.lastID;
    } else {
      ordenId = orden.id;
      if (tieneNuevosCocina) {
        await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
      }
    }

    // 5. Determinar nuevo estado de mesa
    let nuevoEstadoMesa;
    if (tieneNuevosCocina) {
      nuevoEstadoMesa = 'esperando';
    } else {
      nuevoEstadoMesa = (mesa.estado === 'libre') ? 'abierta' : mesa.estado;
    }

    await dbRun("UPDATE Mesas SET estado = ?, mesero = ? WHERE id = ?", [nuevoEstadoMesa, mesero, mesaId]);

    // 6. Insertar items nuevos en DetalleOrden con número correlativo de comanda / tanda
    const rowMax = await dbGet('SELECT MAX(comanda_numero) as maxNum FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    const comandaNumero = (rowMax && rowMax.maxNum ? rowMax.maxNum : 0) + 1;

    const nuevasComandas = [];
    for (const it of itemsProcesados) {
      const subtotal = it.precio * it.cantidad;
      const rItem = await dbRun(
        `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, hora_pedido, creado_en, origen_mesa_numero, comanda_numero)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, it.id, it.nombre, it.precio, it.cantidad, subtotal, it.notas, it.curso, it.destino, ahora, ahora, it.origen_mesa_numero, comandaNumero]
      );
      nuevasComandas.push({
        id: rItem.lastID,
        orden_id: ordenId,
        comanda_numero: comandaNumero,
        producto_id: it.id,
        nombre_producto: it.nombre,
        precio_unitario: it.precio,
        cantidad: it.cantidad,
        notas: it.notas,
        curso: it.curso,
        destino: it.destino,
        hora_pedido: ahora
      });
    }

    // Descontar existencias de inventario en tiempo real
    await descontarInventarioPorItems(itemsProcesados);

    // 7. Recalcular totales de orden
    const rows = await dbAll("SELECT d.*, p.happy_hour as prod_happy_hour, p.categoria_id as prod_categoria_id FROM DetalleOrden d LEFT JOIN Productos p ON d.producto_id = p.id WHERE d.orden_id = ? AND d.estado_comanda != 'anulado'", [ordenId]);
    let subtotal = rows.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);

    // Usar el estado de HH del servidor (fuente de verdad), no el del cliente
    let descuentoHH = 0;
    if (happyHourEstado.activo) {
      rows.forEach(r => {
        const esCerveza = Boolean(r.prod_happy_hour || r.prod_categoria_id === 4 || /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(r.nombre_producto || ''));
        if (esCerveza) {
          const pares = Math.floor(r.cantidad / 2);
          descuentoHH += pares * r.precio_unitario;
        }
      });
    }

    const subNeto = subtotal - descuentoHH;
    const servicio = Math.round(subNeto * 0.10);
    const iva = Math.round(subNeto * 0.13);
    const total = subNeto + servicio + iva;

    await dbRun(
      "UPDATE Ordenes SET subtotal = ?, descuento_happy_hour = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?",
      [subtotal, descuentoHH, servicio, iva, total, ordenId]
    );

    // 8. Sockets: Notificar a cocina ÚNICAMENTE si hay items de cocina
    const comandasCocina = nuevasComandas.filter(c => c.destino === 'cocina');
    if (comandasCocina.length > 0) {
      io.emit('nueva_comanda', { mesaId, ordenId, comandas: comandasCocina });
    }

    // Despachar impresión térmica de 80mm a Cocina y Barra (ESC/POS & Virtual)
    let ticketCocina = null;
    let ticketBarra = null;
    if (nuevasComandas.length > 0) {
      const itemsCocina = nuevasComandas.filter(c => c.destino === 'cocina');
      const itemsBarra = nuevasComandas.filter(c => c.destino === 'barra');

      if (itemsCocina.length > 0) {
        const tInfoCocina = printerService.generarTicketComanda({
          ordenId,
          comandaNumero,
          mesaNumero,
          mesero,
          items: itemsCocina,
          destino: 'cocina',
          fechaHora: ahora
        });
        ticketCocina = await printerService.procesarImpresion({
          destinoImpresora: 'cocina',
          ticketInfo: tInfoCocina,
          io
        });
      }

      if (itemsBarra.length > 0) {
        const tInfoBarra = printerService.generarTicketComanda({
          ordenId,
          comandaNumero,
          mesaNumero,
          mesero,
          items: itemsBarra,
          destino: 'barra',
          fechaHora: ahora
        });
        ticketBarra = await printerService.procesarImpresion({
          destinoImpresora: 'barra',
          ticketInfo: tInfoBarra,
          io
        });
      }
    }

    // Notificar siempre al salón de mesa actualizada
    io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa, total });

    res.json({
      message: tieneNuevosCocina ? 'Comanda enviada a cocina' : 'Comanda guardada con éxito',
      ordenId,
      total,
      estado: nuevoEstadoMesa,
      tieneCocina: tieneNuevosCocina,
      ticketCocina: ticketCocina ? ticketCocina.ticketVisual : null,
      ticketBarra: ticketBarra ? ticketBarra.ticketVisual : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/comandas/lanzar-fuertes', async (req, res) => {
  try {
    const { mesaId, ordenId } = req.body;
    await dbRun(
      "UPDATE DetalleOrden SET estado_comanda = 'preparando' WHERE orden_id = ? AND curso = 2 AND estado_comanda = 'pendiente'",
      [ordenId]
    );
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    io.emit('lanzar_fuertes', { mesaId, mesaNumero: mesa ? mesa.numero : 'Mesa', ordenId });
    res.json({ message: 'Platos fuertes lanzados a cocina con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/comandas/anular-item', async (req, res) => {
  try {
    const { detalleId, motivo, supervisorPin, mesaNumero = 'Mesa' } = req.body;

    if (supervisorPin !== SUPERVISOR_PIN) {
      return res.status(403).json({ error: 'PIN de Supervisor incorrecto' });
    }

    const item = await dbGet('SELECT * FROM DetalleOrden WHERE id = ?', [detalleId]);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

    const ahora = new Date().toISOString();
    await dbRun("UPDATE DetalleOrden SET estado_comanda = 'anulado' WHERE id = ?", [detalleId]);
    await dbRun(
      `INSERT INTO Anulaciones (orden_id, detalle_id, mesa, producto_nombre, cantidad, monto, motivo, supervisor_pin, fecha_hora)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.orden_id, detalleId, mesaNumero, item.nombre_producto, item.cantidad, item.subtotal, motivo, supervisorPin, ahora]
    );

    await registrarAuditoria({
      usuarioNombre: req.body.usuarioNombre || 'Supervisor Autorizado',
      accion: 'anulacion_comanda',
      tipoEvento: 'seguridad',
      modulo: 'comandas',
      detalle: `Anulación de ${item.cantidad}x "${item.nombre_producto}" de ${mesaNumero}`,
      motivo: motivo || 'Anulación autorizada',
      monto: item.subtotal,
      pinAutorizado: 1
    });

    const totalItems = await dbGet("SELECT SUM(subtotal) as sub FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [item.orden_id]);
    const subtotal = Number(totalItems.sub) || 0;
    const servicio = Math.round(subtotal * 0.10);
    const iva = Math.round(subtotal * 0.13);
    const total = subtotal + servicio + iva;

    // Recalcular estado de la orden y mesa
    const remainingItems = await dbAll(
      "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
      [item.orden_id]
    );
    const nuevoEstado = evaluarEstadoMesaKDS(remainingItems);

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?", [subtotal, servicio, iva, total, nuevoEstado, item.orden_id]);

    const orden = await dbGet("SELECT * FROM Ordenes WHERE id = ?", [item.orden_id]);
    if (orden && orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = ? WHERE id = ?", [nuevoEstado, orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: nuevoEstado, total });
    }

    io.emit('comanda_anulada', { detalleId, ordenId: item.orden_id, producto: item.nombre_producto, motivo, nuevoEstado });
    res.json({ message: 'Platillo anulado y registrado en auditoría', ordenId: item.orden_id, total, nuevoEstado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 8. KITCHEN DISPLAY SYSTEM (KDS)
// ============================================================================
app.get('/api/kds', async (req, res) => {
  try {
    const destino = req.query.destino || 'todos';
    let query = `
      SELECT d.*, o.numero_orden, o.mesa_id, m.numero as mesa_numero
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE d.estado_comanda IN ('pendiente', 'preparando')
    `;
    const params = [];
    if (destino !== 'todos') {
      query += ' AND d.destino = ?';
      params.push(destino);
    }
    query += ' ORDER BY d.orden_id ASC, d.comanda_numero ASC, d.hora_pedido ASC, d.id ASC';

    const comandas = await dbAll(query, params);
    res.json(comandas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/comandas/activas', async (req, res) => {
  try {
    const comandas = await dbAll(`
      SELECT d.*, o.numero_orden, o.mesa_id, m.numero as mesa_numero
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE d.estado_comanda IN ('pendiente', 'preparando')
      ORDER BY d.orden_id ASC, d.comanda_numero ASC, d.hora_pedido ASC, d.id ASC
    `);
    res.json(comandas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mesas/:id/espera', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')",
      [mesaId]
    );

    if (!orden) {
      return res.json({
        mesaId: Number(mesaId),
        estado: mesa.estado,
        minutos_espera: 0,
        primera_comanda_hora: null,
        platos_pendientes: [],
        items_pendientes: []
      });
    }

    const items = await dbAll(
      "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' ORDER BY hora_pedido ASC, id ASC",
      [orden.id]
    );

    const cocinaItems = items.filter(
      it => it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')
    );
    const pendientes = cocinaItems.filter(
      it => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando'
    );

    let primeraComandaHora = null;
    if (cocinaItems.length > 0) {
      primeraComandaHora = cocinaItems[0].hora_pedido || cocinaItems[0].creado_en || null;
    }

    let minutosEspera = 0;
    if (primeraComandaHora) {
      const diffMs = Math.max(0, Date.now() - new Date(primeraComandaHora).getTime());
      minutosEspera = Math.floor(diffMs / 60000);
    }

    const platosPendientes = pendientes.map(it => {
      if (it.origen_mesa_numero && String(it.origen_mesa_numero) !== String(mesa.numero)) {
        return `[Mesa ${it.origen_mesa_numero}] ${it.nombre_producto}`;
      }
      return it.nombre_producto;
    });

    const tooltip = formatearTooltipEspera(primeraComandaHora || new Date().toISOString(), platosPendientes, new Date());

    res.json({
      mesaId: Number(mesaId),
      estado: mesa.estado,
      minutos_espera: minutosEspera,
      primera_comanda_hora: primeraComandaHora,
      platos_pendientes: platosPendientes,
      items_pendientes: platosPendientes,
      tooltip
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const handleKdsEstadoUpdate = async (req, res) => {
  try {
    const detalleId = req.params.detalleId || req.params.id;
    const { estado } = req.body;
    if (!estado) return res.status(400).json({ error: 'Estado requerido' });

    const item = await dbGet('SELECT * FROM DetalleOrden WHERE id = ?', [detalleId]);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    await dbRun(
      'UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?',
      [estado, horaListo, detalleId]
    );

    // Recalcular estado de cocina para la orden y mesa
    const todosItems = await dbAll(
      "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
      [item.orden_id]
    );
    const nuevoEstadoMesa = evaluarEstadoMesaKDS(todosItems);

    await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [nuevoEstadoMesa, item.orden_id]);

    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [item.orden_id]);
    if (orden && orden.mesa_id) {
      await dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [nuevoEstadoMesa, orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: nuevoEstadoMesa, total: orden.total });
    }

    io.emit('comanda_estado_cambiado', {
      detalleId: Number(detalleId),
      estado,
      ordenId: item.orden_id,
      mesaId: orden ? orden.mesa_id : null,
      nuevoEstadoMesa
    });
    io.emit('comanda_actualizada', {
      detalleId: Number(detalleId),
      estado,
      ordenId: item.orden_id,
      mesaId: orden ? orden.mesa_id : null,
      nuevoEstadoMesa
    });

    res.json({
      message: 'Estado KDS actualizado',
      detalleId: Number(detalleId),
      estado,
      nuevoEstadoMesa,
      ordenId: item.orden_id,
      mesaId: orden ? orden.mesa_id : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

app.post('/api/kds/:detalleId/estado', handleKdsEstadoUpdate);
app.put('/api/kds/:detalleId/estado', handleKdsEstadoUpdate);
app.post('/api/comandas/:id/estado', handleKdsEstadoUpdate);
app.put('/api/comandas/:id/estado', handleKdsEstadoUpdate);

// ============================================================================
// 9. COBRO, CAJA & CONTROL DE PROPINAS (TIP POOL)
// ============================================================================
app.post('/api/ordenes/:id/cobrar', async (req, res) => {
  try {
    const ordenId = req.params.id;
    const { metodo = 'Efectivo', monto, propina = 0, cambio = 0, mesero = 'Juan Jival', liquidar_total = true, items_pagados = [] } = req.body;
    const ahora = new Date().toISOString();

    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const caja = await dbGet("SELECT * FROM Cajas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1");
    const cajaId = caja ? caja.id : null;

    await dbRun(
      'INSERT INTO Pagos (orden_id, caja_id, mesero, metodo, monto, propina, cambio, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ordenId, cajaId, mesero, metodo, monto, propina, cambio, ahora]
    );

    // Obtener información del negocio y mesa para el tiquete impreso
    const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [orden.negocio_id || 1]);
    const mesa = orden.mesa_id ? await dbGet('SELECT * FROM Mesas WHERE id = ?', [orden.mesa_id]) : null;
    const mesaNumero = mesa ? mesa.numero : 'Mesa';

    let ticketGenerado = null;

    if (liquidar_total) {
      await dbRun("UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ?, transferida_de = NULL WHERE id = ?", [ahora, ordenId]);

      // Consultar todos los ítems de la orden para el tiquete final
      const itemsOrden = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [ordenId]);

      const tInfoLiquidacion = printerService.generarTicketLiquidacion({
        negocio,
        ordenId,
        numeroOrden: orden.numero_orden,
        mesaNumero,
        mesero,
        cliente: orden.cliente,
        metodoPago: metodo,
        subtotal: orden.subtotal,
        descuentoHH: orden.descuento_happy_hour,
        servicio: orden.servicio_10,
        iva: orden.iva_13,
        total: orden.total,
        recibido: monto,
        cambio,
        items: itemsOrden,
        fechaHora: ahora
      });

      ticketGenerado = await printerService.procesarImpresion({
        destinoImpresora: 'caja',
        ticketInfo: tInfoLiquidacion,
        io
      });

      if (orden.mesa_id) {
        await dbRun(
          "UPDATE Mesas SET estado = 'libre', mesero = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0 WHERE id = ?",
          [orden.mesa_id]
        );
        await dbRun(
          'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
          [orden.mesa_id, orden.mesa_id]
        );
        io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'libre', total: 0, transferida_de: null, mesas_unidas: [] });
      }

      res.json({
        message: 'Cobro completado y mesa liberada',
        ordenId,
        es_parcial: false,
        ticket: ticketGenerado ? ticketGenerado.ticketVisual : null
      });
    } else {
      // PAGO PARCIAL
      if (Array.isArray(items_pagados) && items_pagados.length > 0) {
        for (const item of items_pagados) {
          const qty = Number(item.cantidad) || 1;
          const detalleItems = await dbAll(
            "SELECT * FROM DetalleOrden WHERE orden_id = ? AND (producto_id = ? OR nombre_producto = ?) AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY id ASC",
            [ordenId, item.producto_id || item.id, item.nombre || item.nombre_producto]
          );

          let restanteADescontar = qty;
          for (const det of detalleItems) {
            if (restanteADescontar <= 0) break;
            if (det.cantidad <= restanteADescontar) {
              restanteADescontar -= det.cantidad;
              await dbRun("UPDATE DetalleOrden SET estado_comanda = 'pagado' WHERE id = ?", [det.id]);
            } else {
              const nuevaCant = det.cantidad - restanteADescontar;
              const nuevoSub = nuevaCant * det.precio_unitario;
              await dbRun("UPDATE DetalleOrden SET cantidad = ?, subtotal = ? WHERE id = ?", [nuevaCant, nuevoSub, det.id]);

              const subPagado = restanteADescontar * det.precio_unitario;
              await dbRun(
                "INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, estado_comanda, hora_pedido, hora_listo, creado_en, origen_mesa_numero, comanda_numero) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pagado', ?, ?, ?, ?, ?)",
                [det.orden_id, det.producto_id, det.nombre_producto, det.precio_unitario, restanteADescontar, subPagado, det.notas, det.curso, det.destino, det.hora_pedido, det.hora_listo, det.creado_en, det.origen_mesa_numero, det.comanda_numero || 1]
              );
              restanteADescontar = 0;
            }
          }
        }
      }

      // Recalcular subtotal y total de la orden con los ítems activos no pagados
      const itemsActivos = await dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' AND estado_comanda != 'pagado'",
        [ordenId]
      );
      const nuevoSubtotal = itemsActivos.reduce((acc, it) => acc + (it.precio_unitario * it.cantidad), 0);
      const servicio10 = Math.round(nuevoSubtotal * 0.10);
      const iva13 = Math.round(nuevoSubtotal * 0.13);
      const nuevoTotal = nuevoSubtotal + servicio10 + iva13;

      await dbRun(
        "UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?",
        [nuevoSubtotal, servicio10, iva13, nuevoTotal, ordenId]
      );

      // Generar ticket térmico de pago parcial
      const subParcial = (items_pagados || []).reduce((acc, it) => acc + ((it.precio || 0) * (it.cantidad || 1)), 0);
      const impParcial = subParcial * 0.23;
      const personaNombre = req.body.persona_nombre || 'Cliente';

      const tInfoParcial = printerService.generarTicketPagoParcial({
        negocio,
        ordenId,
        mesaNumero,
        personaNombre,
        mesero,
        metodoPago: metodo,
        montoCobrado: monto,
        subtotal: subParcial,
        impuestos: impParcial,
        itemsPagados: items_pagados || [],
        saldoRestanteMesa: nuevoTotal,
        fechaHora: ahora
      });

      ticketGenerado = await printerService.procesarImpresion({
        destinoImpresora: 'caja',
        ticketInfo: tInfoParcial,
        io
      });

      if (orden.mesa_id) {
        io.emit('mesa_actualizada', { mesaId: orden.mesa_id, total: nuevoTotal });
      }

      res.json({
        message: 'Cobro parcial registrado con éxito',
        ordenId,
        es_parcial: true,
        saldo_restante: nuevoTotal,
        ticket: ticketGenerado ? ticketGenerado.ticketVisual : null
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/caja/actual', async (req, res) => {
  try {
    const caja = await dbGet("SELECT * FROM Cajas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1");
    if (!caja) return res.json({ caja: null });

    const ventas = await dbAll(`
      SELECT p.metodo, SUM(p.monto) as total
      FROM Pagos p
      WHERE p.caja_id = ?
      GROUP BY p.metodo
    `, [caja.id]);

    const movimientos = await dbAll('SELECT * FROM MovimientosCaja WHERE caja_id = ? ORDER BY id DESC', [caja.id]);

    const tipPool = await dbAll(`
      SELECT 
        COALESCE(p.mesero, 'Mesero General') as nombre,
        COUNT(DISTINCT p.orden_id) as mesas,
        SUM(p.monto) as ventas,
        SUM(COALESCE(p.propina, p.monto * 0.10)) as propina
      FROM Pagos p
      WHERE p.caja_id = ?
      GROUP BY p.mesero
    `, [caja.id]);

    res.json({ caja, ventas, movimientos, tipPool });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 10. FACTURACIÓN ELECTRÓNICA EXPRESS
// ============================================================================
app.post('/api/facturacion/consultar-cliente', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Cédula requerida' });

  res.json({
    cedula: id,
    nombre: 'CORPORACIÓN GASTRONÓMICA S.A.',
    correo: 'facturacion@corpgastro.com',
    actividad: '561001 - Restaurantes y Bares'
  });
});

app.post('/api/facturacion/emitir', async (req, res) => {
  try {
    const { ordenId, clienteId, clienteNombre, clienteCorreo, subtotal, iva, servicio, total } = req.body;
    const ahora = new Date().toISOString();
    const clave = '506' + Math.floor(10000000000000000000 + Math.random() * 90000000000000000000);
    const consecutivo = '0010000101' + Math.floor(1000000000 + Math.random() * 9000000000);

    const r = await dbRun(`
      INSERT INTO FacturasElectronicas (orden_id, tipo_documento, clave, consecutivo, fecha_emision, cliente_id, cliente_nombre, cliente_correo, subtotal, impuesto, servicio, total, estado_hacienda)
      VALUES (?, 'FE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aceptado')
    `, [ordenId || null, clave, consecutivo, ahora, clienteId, clienteNombre, clienteCorreo, subtotal, iva, servicio, total]);

    res.json({
      message: 'Factura electrónica validada y aceptada por Hacienda',
      id: r.lastID,
      clave,
      consecutivo,
      fecha: ahora,
      estado: 'aceptado'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 11. AUTOSERVICIO EN MESA POR QR (PORTAL MÓVIL DEL CLIENTE)
// ============================================================================
app.get('/api/cliente/mesa/:mesaId', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ mesa, orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden.id]);
    res.json({ mesa, orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cliente/mesa/:id/pedir-cuenta', async (req, res) => {
  try {
    const mesaId = req.params.id || req.params.mesaId;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    await dbRun("UPDATE Mesas SET estado = 'cuenta', pidio_cuenta_qr = 1 WHERE id = ?", [mesaId]);
    await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa')", [mesaId]);

    io.emit('cliente_pidio_cuenta', { mesaId: Number(mesaId), mesaNumero: mesa.numero });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'cuenta', pidio_cuenta_qr: 1 });

    res.json({ message: 'Solicitud enviada al mesero' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ENDPOINTS PARA EL CLIENTE (ESCANEÓ QR EN MESA)
// ============================================================================
app.get('/api/cliente/mesa/:id', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [mesa.negocio_id || 1]);
    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')", [mesaId]);

    let items = [];
    if (orden) {
      items = await dbAll('SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC', [orden.id]);
    }

    res.json({
      mesa,
      negocio: negocio || { nombre: 'GastroBar Fuego & Brasas', moneda: 'CRC' },
      orden: orden || null,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// HELPERS: AUDITORÍA & DEDUCCIÓN DE INVENTARIO
// ============================================================================
async function registrarAuditoria({ negocioId = 1, usuarioId = null, usuarioNombre = 'Sistema', accion, tipoEvento = 'operativo', modulo = 'general', detalle, motivo = null, monto = 0, pinAutorizado = 0 }) {
  try {
    const ahora = new Date().toISOString();
    await dbRun(
      `INSERT INTO Auditoria (negocio_id, usuario_id, usuario_nombre, accion, tipo_evento, modulo, detalle, motivo, monto, pin_autorizado, fecha_hora)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, usuarioId, usuarioNombre, accion, tipoEvento, modulo, detalle, motivo, monto, pinAutorizado ? 1 : 0, ahora]
    );
  } catch (e) {
    console.error('Error registrando auditoría:', e.message);
  }
}

async function descontarInventarioPorItems(items = []) {
  try {
    for (const it of items) {
      const prodId = it.id || it.producto_id;
      const cant = Number(it.cantidad || 1);
      if (!prodId || cant <= 0) continue;

      const ahora = new Date().toISOString();
      // 1. Revisar si hay recetas vinculadas en InventarioRecetas
      const recetas = await dbAll('SELECT * FROM InventarioRecetas WHERE producto_id = ?', [prodId]);
      if (recetas && recetas.length > 0) {
        for (const r of recetas) {
          const totalDesc = r.cantidad * cant;
          await dbRun(
            'UPDATE Inventario SET stock_actual = MAX(0, stock_actual - ?), actualizado_en = ? WHERE id = ?',
            [totalDesc, ahora, r.insumo_id]
          );
        }
      } else {
        // 2. Si no hay receta, descontar del insumo vinculado directamente al producto
        await dbRun(
          'UPDATE Inventario SET stock_actual = MAX(0, stock_actual - ?), actualizado_en = ? WHERE producto_id = ?',
          [cant, ahora, prodId]
        );
      }
    }
  } catch (e) {
    console.error('Error descontando inventario:', e.message);
  }
}

function verificarAdmin(req, res, next) {
  const rol = req.headers['x-user-rol'] || (req.query && req.query.rol) || (req.body && req.body.rol);
  if (rol && rol !== 'admin' && rol !== 'developer') {
    return res.status(403).json({ error: 'Acceso denegado: Requiere permisos de Administrador' });
  }
  next();
}

// ============================================================================
// 14. MÓDULOS DE ADMINISTRACIÓN: INVENTARIO, AUDITORÍA & MÉTRICAS (EXCLUSIVO ADMIN)
// ============================================================================

// --- INVENTARIO ---
app.get('/api/admin/inventario', verificarAdmin, async (req, res) => {
  try {
    const insumos = await dbAll(`
      SELECT i.*, p.nombre as producto_vinculado_nombre
      FROM Inventario i
      LEFT JOIN Productos p ON i.producto_id = p.id
      ORDER BY i.categoria ASC, i.nombre ASC
    `);

    const insumosConEstado = insumos.map(ins => {
      let estado = 'normal';
      if (ins.stock_actual <= 0) estado = 'agotado';
      else if (ins.stock_actual <= ins.stock_minimo) estado = 'bajo';
      return { ...ins, estado_stock: estado };
    });

    res.json(insumosConEstado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/inventario', verificarAdmin, async (req, res) => {
  try {
    const { nombre, categoria = 'General', unidad_medida = 'unidades', stock_actual = 0, stock_minimo = 5, costo_unitario = 0, producto_id = null, usuarioNombre = 'Administrador' } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de insumo requerido' });

    const ahora = new Date().toISOString();
    const result = await dbRun(
      `INSERT INTO Inventario (negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo, costo_unitario, producto_id, actualizado_en)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre.trim(), categoria.trim(), unidad_medida.trim(), Number(stock_actual), Number(stock_minimo), Number(costo_unitario), producto_id ? Number(producto_id) : null, ahora]
    );

    await registrarAuditoria({
      usuarioNombre,
      accion: 'crear_insumo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Creación de nuevo insumo "${nombre}" con stock inicial de ${stock_actual} ${unidad_medida}`
    });

    res.json({ id: result.lastID, message: 'Insumo registrado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/inventario/:id', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { nombre, categoria, unidad_medida, stock_minimo, costo_unitario, producto_id, usuarioNombre = 'Administrador' } = req.body;
    const ahora = new Date().toISOString();

    await dbRun(
      `UPDATE Inventario SET 
        nombre = COALESCE(?, nombre),
        categoria = COALESCE(?, categoria),
        unidad_medida = COALESCE(?, unidad_medida),
        stock_minimo = COALESCE(?, stock_minimo),
        costo_unitario = COALESCE(?, costo_unitario),
        producto_id = ?,
        actualizado_en = ?
       WHERE id = ?`,
      [nombre, categoria, unidad_medida, stock_minimo, costo_unitario, producto_id !== undefined ? producto_id : null, ahora, id]
    );

    await registrarAuditoria({
      usuarioNombre,
      accion: 'actualizar_insumo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Modificación de parámetros del insumo ID ${id}`
    });

    res.json({ message: 'Insumo actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/inventario/:id/ajuste', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { tipo, cantidad, motivo = 'Ajuste de stock', usuarioNombre = 'Administrador' } = req.body;
    const cantNum = Number(cantidad);
    if (!tipo || isNaN(cantNum) || cantNum === 0) {
      return res.status(400).json({ error: 'Tipo y cantidad válida requeridos' });
    }

    const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });

    let nuevoStock = insumo.stock_actual;
    let accionAuditoria = 'ajuste_inventario';
    let tipoEvento = 'operativo';

    if (tipo === 'entrada') {
      nuevoStock += Math.abs(cantNum);
      accionAuditoria = 'entrada_mercaderia';
    } else if (tipo === 'merma' || tipo === 'salida') {
      nuevoStock = Math.max(0, nuevoStock - Math.abs(cantNum));
      accionAuditoria = 'merma_perdida';
      tipoEvento = 'financiero';
    } else if (tipo === 'fijar') {
      nuevoStock = Math.max(0, cantNum);
      accionAuditoria = 'conteo_fisico';
    }

    const ahora = new Date().toISOString();
    await dbRun('UPDATE Inventario SET stock_actual = ?, actualizado_en = ? WHERE id = ?', [nuevoStock, ahora, id]);

    const costoTotalAjuste = Math.abs(cantNum) * (insumo.costo_unitario || 0);

    await registrarAuditoria({
      usuarioNombre,
      accion: accionAuditoria,
      tipoEvento,
      modulo: 'inventario',
      detalle: `${tipo.toUpperCase()}: ${insumo.nombre} (${cantNum > 0 ? '+' : ''}${cantNum} ${insumo.unidad_medida}) -> Stock resultante: ${nuevoStock}`,
      motivo,
      monto: costoTotalAjuste
    });

    res.json({ message: 'Ajuste de inventario aplicado', stock_actual: nuevoStock });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- AUDITORÍA ---
app.get('/api/admin/auditoria', verificarAdmin, async (req, res) => {
  try {
    const { tipo, modulo, limite = 100 } = req.query;
    let sql = 'SELECT * FROM Auditoria WHERE 1=1';
    const params = [];

    if (tipo) {
      sql += ' AND tipo_evento = ?';
      params.push(tipo);
    }
    if (modulo) {
      sql += ' AND modulo = ?';
      params.push(modulo);
    }

    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Number(limite));

    const registros = await dbAll(sql, params);
    res.json(registros);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/auditoria/registrar', async (req, res) => {
  try {
    const { usuarioNombre = 'Admin', accion, tipoEvento, modulo, detalle, motivo, monto, pinAutorizado } = req.body;
    if (!accion || !detalle) return res.status(400).json({ error: 'Acción y detalle requeridos' });

    await registrarAuditoria({ usuarioNombre, accion, tipoEvento, modulo, detalle, motivo, monto, pinAutorizado });
    res.json({ message: 'Evento de auditoría registrado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- DASHBOARD & MÉTRICAS EN TIEMPO REAL ---
app.get('/api/admin/metricas/dashboard', verificarAdmin, async (req, res) => {
  try {
    const hoyInicio = new Date();
    hoyInicio.setHours(0, 0, 0, 0);
    const hoyISO = hoyInicio.toISOString();

    const ayerInicio = new Date(hoyInicio.getTime() - 24 * 60 * 60 * 1000);
    const ayerISO = ayerInicio.toISOString();

    // 1. Ventas de Hoy
    const ventasHoyRow = await dbGet(`
      SELECT 
        COALESCE(SUM(monto), 0) as total_ventas,
        COALESCE(SUM(propina), 0) as total_propinas,
        COUNT(DISTINCT orden_id) as total_cuentas
      FROM Pagos
      WHERE fecha_hora >= ?
    `, [hoyISO]);

    // 2. Ventas de Ayer (para comparativa)
    const ventasAyerRow = await dbGet(`
      SELECT COALESCE(SUM(monto), 0) as total_ventas
      FROM Pagos
      WHERE fecha_hora >= ? AND fecha_hora < ?
    `, [ayerISO, hoyISO]);

    const totalVentasHoy = Number(ventasHoyRow ? ventasHoyRow.total_ventas : 0) || 0;
    const totalVentasAyer = Number(ventasAyerRow ? ventasAyerRow.total_ventas : 0) || 0;
    const cuentasHoy = Number(ventasHoyRow ? ventasHoyRow.total_cuentas : 0) || 0;
    const ticketPromedio = cuentasHoy > 0 ? Math.round(totalVentasHoy / cuentasHoy) : 0;
    const propinasHoy = Number(ventasHoyRow ? ventasHoyRow.total_propinas : 0) || 0;

    // 3. Tiempo Promedio de Cocina Hoy (en minutos)
    const tiemposCocina = await dbAll(`
      SELECT hora_pedido, hora_listo
      FROM DetalleOrden
      WHERE hora_listo IS NOT NULL AND creado_en >= ?
    `, [hoyISO]);

    let sumaMinutos = 0;
    let cantPlatosConTiempo = 0;
    for (const t of tiemposCocina) {
      if (t.hora_pedido && t.hora_listo) {
        const diff = Math.max(0, new Date(t.hora_listo).getTime() - new Date(t.hora_pedido).getTime());
        sumaMinutos += Math.floor(diff / 60000);
        cantPlatosConTiempo++;
      }
    }
    const tiempoPromedioCocinaMin = cantPlatosConTiempo > 0 ? Math.round(sumaMinutos / cantPlatosConTiempo) : 0;

    // 4. Top 5 Productos Más Vendidos
    const topProductos = await dbAll(`
      SELECT 
        d.nombre_producto, 
        d.destino,
        SUM(d.cantidad) as total_unidades,
        SUM(d.subtotal) as total_recaudado
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      WHERE d.estado_comanda != 'anulado' AND o.estado IN ('pagada', 'activa', 'abierta', 'cuenta')
      GROUP BY d.nombre_producto
      ORDER BY total_unidades DESC
      LIMIT 5
    `);

    // 5. Ventas por Hora (Horas Pico)
    const pagosHoras = await dbAll(`
      SELECT strftime('%H', fecha_hora) as hora, SUM(monto) as total
      FROM Pagos
      WHERE fecha_hora >= ?
      GROUP BY strftime('%H', fecha_hora)
      ORDER BY hora ASC
    `, [hoyISO]);

    // Mapear de 10:00 a 23:00 para gráfico continuo
    const ventasPorHora = [];
    for (let h = 10; h <= 23; h++) {
      const horaStr = String(h).padStart(2, '0');
      const found = pagosHoras.find(p => p.hora === horaStr);
      ventasPorHora.push({
        hora: `${horaStr}:00`,
        total: found ? Number(found.total) : 0
      });
    }

    // 6. Desempeño por Mesero
    const meseros = await dbAll(`
      SELECT 
        COALESCE(p.mesero, 'General') as nombre,
        COUNT(DISTINCT p.orden_id) as cuentas,
        SUM(p.monto) as ventas,
        SUM(COALESCE(p.propina, 0)) as propinas
      FROM Pagos p
      WHERE p.fecha_hora >= ?
      GROUP BY p.mesero
      ORDER BY ventas DESC
    `, [hoyISO]);

    // 7. Alertas de Inventario Crítico
    const alertasStock = await dbAll(`
      SELECT id, nombre, stock_actual, stock_minimo, unidad_medida
      FROM Inventario
      WHERE stock_actual <= stock_minimo
      ORDER BY stock_actual ASC
      LIMIT 6
    `);

    res.json({
      resumen: {
        totalVentasHoy,
        totalVentasAyer,
        diferenciaAyer: totalVentasAyer > 0 ? Math.round(((totalVentasHoy - totalVentasAyer) / totalVentasAyer) * 100) : 0,
        cuentasHoy,
        ticketPromedio,
        propinasHoy,
        tiempoPromedioCocinaMin
      },
      topProductos,
      ventasPorHora,
      meseros,
      alertasStock
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 12. SISTEMA DE ACTUALIZACIONES AUTOMÁTICAS (24H) Y MANUALES (ADMIN / DEV)
// ============================================================================
const APP_VERSION = '1.0.0';
const GITHUB_REPO = 'pampo32-hub/Punto-de-venta';

async function verificarActualizaciones(origen = 'auto') {
  try {
    const ahora = new Date().toISOString();
    await dbRun("UPDATE ConfigNegocio SET valor = ? WHERE clave = 'update_last_check'", [ahora]);

    const { exec } = require('child_process');

    const checkViaGit = () => new Promise((resolve) => {
      exec('git ls-remote origin refs/heads/main', { cwd: __dirname, timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const parts = stdout.trim().split(/\s+/);
        const sha = parts[0] ? parts[0].substring(0, 7) : null;
        resolve(sha);
      });
    });

    const checkLocalGit = () => new Promise((resolve) => {
      exec('git rev-parse --short HEAD', { cwd: __dirname, timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        resolve(stdout.trim());
      });
    });

    let remoteSha = await checkViaGit();
    let localSha = await checkLocalGit();

    if (!localSha) {
      const rowLocal = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_latest_commit'");
      localSha = rowLocal && rowLocal.valor ? rowLocal.valor : '1.0.0';
    }

    if (!remoteSha) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
          headers: { 'User-Agent': 'GastroBar-POS-Updater', 'Accept': 'application/vnd.github.v3+json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const commitData = await res.json();
          remoteSha = commitData.sha ? commitData.sha.substring(0, 7) : null;
        }
      } catch (e) {}
    }

    if (!remoteSha) {
      return {
        ok: false,
        error: 'No se pudo contactar el repositorio remoto. Verifica la conexión a internet de esta computadora.',
        versionActual: APP_VERSION
      };
    }

    const hayNuevaVersion = Boolean(localSha && remoteSha && localSha !== remoteSha);

    await dbRun("UPDATE ConfigNegocio SET valor = ? WHERE clave = 'update_available'", [hayNuevaVersion ? 'true' : 'false']);
    await dbRun("UPDATE ConfigNegocio SET valor = ? WHERE clave = 'update_latest_commit'", [remoteSha]);

    const resultado = {
      ok: true,
      hayNuevaVersion,
      versionActual: APP_VERSION,
      localSha,
      remoteSha,
      ultimaRevision: ahora,
      origen
    };

    if (hayNuevaVersion) {
      io.emit('actualizacion_disponible', resultado);
    }

    return resultado;
  } catch (err) {
    return {
      ok: false,
      error: 'Error al comprobar actualizaciones: ' + err.message,
      versionActual: APP_VERSION
    };
  }
}

// Comprobación al arrancar (espera 25s para estabilizar red/wifi)
setTimeout(async () => {
  try {
    const rowLast = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_last_check'");
    const ultima = rowLast && rowLast.valor ? new Date(rowLast.valor).getTime() : 0;
    const ahora = Date.now();
    const veinticuatroHorasMs = 24 * 60 * 60 * 1000;

    if (!ultima || ahora - ultima >= veinticuatroHorasMs) {
      console.log('🔄 Ejecutando comprobación automática de actualizaciones (Startup / 24h)...');
      verificarActualizaciones('auto_startup');
    }
  } catch (e) {}
}, 25000);

// Comprobación periódica cada 1 hora para ver si se cumplieron las 24 horas
setInterval(async () => {
  try {
    const rowLast = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_last_check'");
    const ultima = rowLast && rowLast.valor ? new Date(rowLast.valor).getTime() : 0;
    const ahora = Date.now();
    const veinticuatroHorasMs = 24 * 60 * 60 * 1000;

    if (!ultima || ahora - ultima >= veinticuatroHorasMs) {
      console.log('🔄 Comprobación automática programada de actualizaciones (24h transcurridas)...');
      verificarActualizaciones('auto_interval');
    }
  } catch (e) {}
}, 60 * 60 * 1000);

// Endpoint: Estado de actualizaciones
app.get('/api/sistema/actualizaciones/estado', async (req, res) => {
  try {
    const lastCheck = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_last_check'");
    const avail = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_available'");
    const latestCommit = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_latest_commit'");
    const commitMsg = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_commit_msg'");
    const commitDate = await dbGet("SELECT valor FROM ConfigNegocio WHERE clave = 'update_commit_date'");

    res.json({
      version: APP_VERSION,
      repositorio: GITHUB_REPO,
      ultimaRevision: lastCheck ? lastCheck.valor : null,
      actualizacionDisponible: avail ? avail.valor === 'true' : false,
      ultimoCommit: latestCommit ? latestCommit.valor : '',
      commitMsg: commitMsg ? commitMsg.valor : '',
      commitDate: commitDate ? commitDate.valor : ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Búsqueda manual (Sólo Admin y Developer)
app.post('/api/sistema/actualizaciones/buscar', async (req, res) => {
  try {
    const rol = (req.headers['x-user-rol'] || req.body.rol || '').toLowerCase();
    if (rol !== 'admin' && rol !== 'developer') {
      return res.status(403).json({ error: 'Acceso denegado. Solo administradores o desarrolladores pueden buscar actualizaciones.' });
    }

    const resultado = await verificarActualizaciones('manual');
    res.json(resultado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Aplicar actualización (Sólo Admin y Developer)
app.post('/api/sistema/actualizaciones/aplicar', async (req, res) => {
  try {
    const rol = (req.headers['x-user-rol'] || req.body.rol || '').toLowerCase();
    if (rol !== 'admin' && rol !== 'developer') {
      return res.status(403).json({ error: 'Acceso denegado.' });
    }

    const { exec } = require('child_process');
    exec('git pull origin main', { cwd: __dirname }, async (error, stdout, stderr) => {
      if (!error) {
        await dbRun("UPDATE ConfigNegocio SET valor = 'false' WHERE clave = 'update_available'");
        io.emit('sistema_actualizado', { message: 'El sistema ha sido actualizado a la última versión.' });
        return res.json({ ok: true, metodo: 'git', detalle: stdout || 'Actualizado vía Git.' });
      }

      res.json({ ok: true, metodo: 'descarga', detalle: 'Actualización registrada. Los cambios se aplicarán al reiniciar el sistema.' });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 12. IMPRESORAS TÉRMICAS ESC/POS (80MM) & SIMULADOR DE PUERTO TCP 9100
// ============================================================================
// Obtener configuración e historial de impresiones
app.get('/api/impresoras/config', (req, res) => {
  res.json({
    impresoras: printerService.printerConfig,
    historial: printerService.historialImpresiones
  });
});

// Actualizar configuración de impresoras (Caja, Cocina, Barra)
app.post('/api/impresoras/config', (req, res) => {
  const { destino, nombre, tipo, ip, puerto, activa } = req.body;
  if (!destino || !printerService.printerConfig[destino]) {
    return res.status(400).json({ error: 'Destino de impresora inválido (caja, cocina, barra)' });
  }

  printerService.printerConfig[destino] = {
    ...printerService.printerConfig[destino],
    nombre: nombre || printerService.printerConfig[destino].nombre,
    tipo: tipo || printerService.printerConfig[destino].tipo,
    ip: ip || printerService.printerConfig[destino].ip,
    puerto: Number(puerto) || printerService.printerConfig[destino].puerto,
    activa: activa !== undefined ? Boolean(activa) : printerService.printerConfig[destino].activa
  };

  io.emit('impresoras_config_actualizada', printerService.printerConfig);
  res.json({ message: 'Configuración de impresora actualizada', config: printerService.printerConfig[destino] });
});

// Prueba de impresión manual desde el monitor
app.post('/api/impresoras/test', async (req, res) => {
  try {
    const { destino = 'caja' } = req.body;
    const ahora = new Date().toISOString();

    const tInfoTest = printerService.generarTicketLiquidacion({
      negocio: {
        nombre: 'GastroBar Fuego & Brasas',
        slogan: 'Restaurante, Bar & Lounge',
        telefono: '2222-0000 / 8888-9999',
        direccion: 'San José, Costa Rica'
      },
      ordenId: 'TEST-99',
      numeroOrden: 'TEST-99',
      mesaNumero: 'Mesa 1 (Test)',
      mesero: 'Administrador',
      cliente: 'Prueba de Impresión',
      metodoPago: 'Efectivo',
      subtotal: 10000,
      descuentoHH: 1800,
      servicio: 820,
      iva: 1066,
      total: 10086,
      recibido: 15000,
      cambio: 4914,
      items: [
        { nombre: 'Imperial Regular (2x1 Promo)', precio_unitario: 1800, cantidad: 2, subtotal: 3600 },
        { nombre: 'Casado con carne mechada', precio_unitario: 4500, cantidad: 1, subtotal: 4500 },
        { nombre: 'Chiliguaro Especial', precio_unitario: 1500, cantidad: 1, subtotal: 1500 }
      ],
      fechaHora: ahora
    });

    const reg = await printerService.procesarImpresion({
      destinoImpresora: destino,
      ticketInfo: tInfoTest,
      io
    });

    res.json({ message: 'Ticket de prueba despachado con éxito', registro: reg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Emulador Servidor Socket TCP en puerto 9100 (Receptor virtual de datos RAW ESC/POS)
const net = require('net');
const tcpPrinterServer = net.createServer((socket) => {
  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`🖨️ [SIMULADOR PUERTO 9100] Conexión entrante desde ${clientAddr}`);

  let bufferBytes = [];

  socket.on('data', (chunk) => {
    bufferBytes.push(chunk);
  });

  socket.on('end', () => {
    const totalBuffer = Buffer.concat(bufferBytes);
    console.log(`🖨️ [SIMULADOR PUERTO 9100] Recibidos ${totalBuffer.length} bytes RAW ESC/POS desde ${clientAddr}`);
  });

  socket.on('error', (err) => {
    console.log('🖨️ [SIMULADOR PUERTO 9100] Error socket:', err.message);
  });
});

tcpPrinterServer.listen(9100, () => {
  console.log('🖨️ Receptor Virtual ESC/POS activo en Puerto TCP 9100 (Simulador Listo)');
});
tcpPrinterServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('🖨️ Puerto TCP 9100 ya en uso (Servicio existente activo)');
  }
});

// ============================================================================
// PISO DEL SALÓN — Leer y guardar el fondo visual del salón
// ============================================================================
app.get('/api/salon/piso-fondo', (req, res) => {
  db.get("SELECT valor FROM ConfigNegocio WHERE clave = 'salon_piso_fondo'", (err, row) => {
    if (err || !row) return res.json({ pisoId: null });
    res.json({ pisoId: row.valor || null });
  });
});

app.post('/api/salon/piso-fondo', (req, res) => {
  const { pisoId } = req.body;
  if (!pisoId) return res.status(400).json({ error: 'Se requiere pisoId' });
  db.run(
    "INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('salon_piso_fondo', ?)",
    [pisoId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Error al guardar piso' });
      io.emit('salon_piso_fondo_cambiado', { pisoId });
      res.json({ ok: true, pisoId });
    }
  );
});

// ============================================================================
// INICIAR SERVIDOR & EXPORTAR (ENTRYPOINT & TEST HARNESS)
// ============================================================================
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('========================================================');
    console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
    console.log('📍 Puerto: ' + PORT);
    console.log('🌐 URL Local: http://localhost:' + PORT);
    console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
    console.log('🖨️ Impresión Térmica 80mm: ESC/POS en Puerto TCP 9100');
    console.log('========================================================');
  });
}

module.exports = { app, server, io, evaluarEstadoMesaKDS, formatearTooltipEspera, formatearNombreItemConOrigen };
