require('dotenv').config();
const path = require('path');

let db;

if (process.env.DATABASE_URL && !process.env.POS_DB_PATH) {
  const { Pool, types } = require('pg');
  
  // Mapear tipos numéricos de PostgreSQL a Number en JavaScript
  types.setTypeParser(20, (val) => val === null ? null : parseInt(val, 10)); // int8 / bigint
  types.setTypeParser(21, (val) => val === null ? null : parseInt(val, 10)); // int2 / smallint
  types.setTypeParser(23, (val) => val === null ? null : parseInt(val, 10)); // int4 / integer
  types.setTypeParser(1700, (val) => val === null ? null : parseFloat(val)); // numeric / decimal
  types.setTypeParser(700, (val) => val === null ? null : parseFloat(val));  // float4 / real
  types.setTypeParser(701, (val) => val === null ? null : parseFloat(val));  // float8 / double precision

  const isInternalRender = process.env.DATABASE_URL.includes('@dpg-') && !process.env.DATABASE_URL.includes('.render.com');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternalRender ? false : { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('⚠️ Error inesperado en el pool de PostgreSQL:', err.message);
  });

  const isSupabase = (process.env.DATABASE_URL || '').includes('supabase');
  console.log(`🐘 Conectado a base de datos central en la nube (${isSupabase ? 'Supabase PostgreSQL' : 'PostgreSQL'}).`);

  function convertSqlToPg(sql) {
    if (!sql || typeof sql !== 'string') return sql;
    let idx = 0;
    let s = sql.replace(/\?/g, () => `$${++idx}`);
    
    // SQLite PRAGMA
    if (/^\s*PRAGMA/i.test(s)) {
      return null;
    }

    // Auto-increment primary key
    s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY');

    // ALTER TABLE ADD COLUMN -> ADD COLUMN IF NOT EXISTS
    s = s.replace(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ');

    // INSERT OR IGNORE INTO ConfigNegocio
    if (/INSERT\s+OR\s+IGNORE\s+INTO\s+ConfigNegocio/i.test(s)) {
      s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+ConfigNegocio/gi, 'INSERT INTO ConfigNegocio');
      if (!/ON\s+CONFLICT/i.test(s)) {
        s += ' ON CONFLICT (clave) DO NOTHING';
      }
    }

    // INSERT OR REPLACE INTO ConfigNegocio
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+ConfigNegocio/i.test(s)) {
      s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO\s+ConfigNegocio/gi, 'INSERT INTO ConfigNegocio');
      if (!/ON\s+CONFLICT/i.test(s)) {
        s += ' ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor';
      }
    }

    // INSERT OR IGNORE INTO IdempotencyLog
    if (/INSERT\s+OR\s+IGNORE\s+INTO\s+IdempotencyLog/i.test(s)) {
      s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+IdempotencyLog/gi, 'INSERT INTO IdempotencyLog');
      if (!/ON\s+CONFLICT/i.test(s)) {
        s += ' ON CONFLICT (idempotency_key) DO NOTHING';
      }
    }

    // Generic INSERT OR IGNORE -> ON CONFLICT DO NOTHING
    if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
      s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
      if (!/ON\s+CONFLICT/i.test(s)) {
        s += ' ON CONFLICT DO NOTHING';
      }
    }

    // Generic INSERT OR REPLACE -> ON CONFLICT DO NOTHING
    if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(s)) {
      s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
      if (!/ON\s+CONFLICT/i.test(s)) {
        s += ' ON CONFLICT DO NOTHING';
      }
    }

    // GROUP_CONCAT(x) -> STRING_AGG(x::text, ',')
    s = s.replace(/GROUP_CONCAT\s*\(\s*([^)]+)\s*\)/gi, 'STRING_AGG($1::text, \',\')');

    // strftime('%H', col) -> SUBSTRING(col FROM 12 FOR 2)
    s = s.replace(/strftime\s*\(\s*['"]%H['"]\s*,\s*([^)]+)\s*\)/gi, 'SUBSTRING($1 FROM 12 FOR 2)');

    // datetime('now', ...) -> ISO string timestamp
    s = s.replace(/datetime\s*\(\s*['"]now['"][^)]*\)/gi, "TO_CHAR(NOW() AT TIME ZONE 'America/Costa_Rica', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')");

    return s;
  }

  function normalizeParams(params) {
    if (!params) return [];
    if (!Array.isArray(params)) params = [params];
    return params.map(p => {
      if (p === undefined) return null;
      if (typeof p === 'number' && isNaN(p)) return null;
      return p;
    });
  }

  db = {
    isPg: true,
    run(sql, params, cb) {
      if (typeof params === 'function') {
        cb = params;
        params = [];
      }
      params = normalizeParams(params);
      const pgSql = convertSqlToPg(sql);
      if (!pgSql) {
        if (cb) setImmediate(() => cb.call({ lastID: 0, changes: 0 }, null));
        return;
      }

      let queryToRun = pgSql;
      const isInsert = /^\s*INSERT\s+INTO/i.test(pgSql);
      const hasReturning = /RETURNING/i.test(pgSql);
      if (isInsert && !hasReturning) {
        queryToRun += ' RETURNING id';
      }

      pool.query(queryToRun, params)
        .then(res => {
          const context = {
            lastID: (res.rows && res.rows[0] && res.rows[0].id) ? Number(res.rows[0].id) : 0,
            changes: res.rowCount || 0
          };
          if (cb) cb.call(context, null);
        })
        .catch(err => {
          if (isInsert && !hasReturning) {
            pool.query(pgSql, params)
              .then(resRetry => {
                const context = { lastID: 0, changes: resRetry.rowCount || 0 };
                if (cb) cb.call(context, null);
              })
              .catch(errRetry => {
                if (cb) cb(errRetry);
              });
            return;
          }
          if (cb) cb(err);
        });
    },

    get(sql, params, cb) {
      if (typeof params === 'function') {
        cb = params;
        params = [];
      }
      params = normalizeParams(params);
      const pgSql = convertSqlToPg(sql);
      if (!pgSql) {
        if (cb) setImmediate(() => cb(null, null));
        return;
      }

      pool.query(pgSql, params)
        .then(res => {
          if (cb) cb(null, res.rows[0] || null);
        })
        .catch(err => {
          if (cb) cb(err);
        });
    },

    all(sql, params, cb) {
      if (typeof params === 'function') {
        cb = params;
        params = [];
      }
      params = normalizeParams(params);
      const pgSql = convertSqlToPg(sql);
      if (!pgSql) {
        if (cb) setImmediate(() => cb(null, []));
        return;
      }

      pool.query(pgSql, params)
        .then(res => {
          if (cb) cb(null, res.rows || []);
        })
        .catch(err => {
          if (cb) cb(err);
        });
    },

    serialize(cb) {
      if (cb) cb();
    },

    close(cb) {
      pool.end().then(() => { if (cb) cb(null); }).catch(e => { if (cb) cb(e); });
    }
  };
} else {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = process.env.POS_DB_PATH || path.join(__dirname, 'pos.db');
  db = new sqlite3.Database(dbPath);
  console.log('📁 Conectado a base de datos local SQLite (pos.db).');
}

function initDb() {
  db.serialize(() => {
    // 0. Comercios / Negocios (SaaS Multi-Comercio)
    db.run(`CREATE TABLE IF NOT EXISTS Negocios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      slogan TEXT,
      logo_url TEXT,
      moneda TEXT DEFAULT 'CRC',
      telefono TEXT,
      direccion TEXT,
      activo INTEGER DEFAULT 1
    )`);
    db.run("ALTER TABLE Negocios ADD COLUMN activo INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN modulos_activos TEXT DEFAULT 'all'", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN plan_nombre TEXT DEFAULT 'Plan Full Tech 2026'", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN tipo_cambio_usd REAL DEFAULT 520", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN caracteristicas_activas TEXT DEFAULT 'all'", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN restringir_ip_operativos INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN ips_permitidas TEXT DEFAULT ''", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN restringir_dispositivos INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN sesion_unica_activa INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN grupo_id TEXT DEFAULT NULL", () => {});
    db.run("ALTER TABLE Negocios ADD COLUMN es_matriz INTEGER DEFAULT 0", () => {});

    // 1. Zonas del local
    db.run(`CREATE TABLE IF NOT EXISTS Zonas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      nombre TEXT NOT NULL,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);

    // 2. Mesas
    db.run(`CREATE TABLE IF NOT EXISTS Mesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      numero TEXT NOT NULL,
      zona_id INTEGER,
      capacidad INTEGER DEFAULT 4,
      estado TEXT DEFAULT 'libre',
      mesero TEXT,
      x INTEGER DEFAULT 40,
      y INTEGER DEFAULT 40,
      forma TEXT DEFAULT 'square',
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id),
      FOREIGN KEY(zona_id) REFERENCES Zonas(id)
    )`);

    // Migraciones Mesas
    db.run("ALTER TABLE Mesas ADD COLUMN x INTEGER DEFAULT 40", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN y INTEGER DEFAULT 40", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN forma TEXT DEFAULT 'square'", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN ancho INTEGER DEFAULT 130", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN alto INTEGER DEFAULT 120", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN transferida_de TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN piso INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN pidio_cuenta_qr INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN hora_pidio_cuenta TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN reserva_id INTEGER", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN cliente_reserva TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN hora_reserva TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN fecha_reserva TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN pax_reserva INTEGER DEFAULT 2", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN notas_reserva TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN telefono_reserva TEXT", () => {});
    db.run("ALTER TABLE Zonas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("INSERT OR IGNORE INTO Zonas (id, nombre) VALUES (5, 'Segundo Piso')", () => {});

    // Reservas de Mesas (Fase 1)
    db.run(`CREATE TABLE IF NOT EXISTS Reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      mesa_id INTEGER,
      cliente_nombre TEXT NOT NULL,
      cliente_telefono TEXT,
      pax INTEGER DEFAULT 2,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      estado TEXT DEFAULT 'confirmada',
      notas TEXT,
      creado_en TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id),
      FOREIGN KEY(mesa_id) REFERENCES Mesas(id)
    )`);

    // 3. Categorías
    db.run(`CREATE TABLE IF NOT EXISTS Categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      nombre TEXT NOT NULL,
      icono TEXT,
      destino TEXT DEFAULT 'cocina'
    )`);
    db.run("ALTER TABLE Categorias ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});

    // 4. Productos (con soporte para fotos/imágenes personalizables en botones)
    db.run(`CREATE TABLE IF NOT EXISTS Productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      categoria_id INTEGER,
      codigo TEXT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      descripcion TEXT,
      destino TEXT DEFAULT 'cocina',
      curso INTEGER DEFAULT 2,
      happy_hour INTEGER DEFAULT 0,
      agotado INTEGER DEFAULT 0,
      imagen_url TEXT,
      color_badge TEXT,
      activo INTEGER DEFAULT 1,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id),
      FOREIGN KEY(categoria_id) REFERENCES Categorias(id)
    )`);

    // Migraciones Productos
    db.run("ALTER TABLE Productos ADD COLUMN curso INTEGER DEFAULT 2", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN happy_hour INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN agotado INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN imagen_url TEXT", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN color_badge TEXT", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});

    // 4.5. Puntos de Cobro / Cajas Físicas
    db.run(`CREATE TABLE IF NOT EXISTS PuntosDeCobro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      nombre TEXT NOT NULL,
      codigo TEXT,
      ubicacion TEXT,
      icono TEXT DEFAULT '💳',
      pre_asignado_usuario_id INTEGER,
      activo INTEGER DEFAULT 1,
      creado_en TEXT,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);
    db.run("ALTER TABLE PuntosDeCobro ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE PuntosDeCobro ADD COLUMN icono TEXT DEFAULT '💳'", () => {});
    db.run("ALTER TABLE PuntosDeCobro ADD COLUMN pre_asignado_usuario_id INTEGER", () => {});
    db.run("ALTER TABLE PuntosDeCobro ADD COLUMN activo INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE PuntosDeCobro ADD COLUMN creado_en TEXT", () => {});

    // 5. Cajas / Turnos
    db.run(`CREATE TABLE IF NOT EXISTS Cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      usuario_id INTEGER,
      cajero TEXT NOT NULL,
      caja_fisica_id INTEGER,
      caja_nombre TEXT,
      fecha_apertura TEXT NOT NULL,
      monto_inicial REAL DEFAULT 0,
      fecha_cierre TEXT,
      monto_final_efectivo REAL DEFAULT 0,
      total_ventas_efectivo REAL DEFAULT 0,
      total_ventas_tarjeta REAL DEFAULT 0,
      total_ventas_sinpe REAL DEFAULT 0,
      total_ventas_dolares REAL DEFAULT 0,
      total_ventas_usd REAL DEFAULT 0,
      total_ventas_transferencia REAL DEFAULT 0,
      estado TEXT DEFAULT 'abierta'
    )`);
    db.run("ALTER TABLE Cajas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN caja_fisica_id INTEGER", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN caja_nombre TEXT", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_dolares REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_usd REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_transferencia REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN monto_final_dolares REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN monto_inicial_usd REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Cajas ADD COLUMN usuario_id INTEGER", () => {});

    // 6. Movimientos de Caja
    db.run(`CREATE TABLE IF NOT EXISTS MovimientosCaja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caja_id INTEGER,
      tipo TEXT NOT NULL,
      monto REAL NOT NULL,
      concepto TEXT NOT NULL,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(caja_id) REFERENCES Cajas(id)
    )`);

    // 7. Órdenes / Cuentas
    db.run(`CREATE TABLE IF NOT EXISTS Ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      numero_orden TEXT NOT NULL,
      mesa_id INTEGER,
      tipo TEXT DEFAULT 'mesa',
      cliente TEXT DEFAULT 'Cliente General',
      mesero TEXT NOT NULL,
      fecha_apertura TEXT NOT NULL,
      fecha_cierre TEXT,
      estado TEXT DEFAULT 'abierta',
      subtotal REAL DEFAULT 0,
      descuento_happy_hour REAL DEFAULT 0,
      servicio_10 REAL DEFAULT 0,
      iva_13 REAL DEFAULT 0,
      total REAL DEFAULT 0,
      notas TEXT,
      FOREIGN KEY(mesa_id) REFERENCES Mesas(id)
    )`);
    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_happy_hour REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN transferida_de TEXT", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_monto REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_porcentaje REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_motivo TEXT", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_autorizado_por TEXT", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN tipo_orden TEXT DEFAULT 'mesa'", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN es_para_llevar INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Ordenes ADD COLUMN total_usd REAL DEFAULT 0", () => {});

    // 8. Detalle de Órdenes (Comandas)
    db.run(`CREATE TABLE IF NOT EXISTS DetalleOrden (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      nombre_producto TEXT NOT NULL,
      precio_unitario REAL NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL,
      notas TEXT,
      curso INTEGER DEFAULT 2,
      destino TEXT DEFAULT 'cocina',
      estado_comanda TEXT DEFAULT 'pendiente',
      hora_pedido TEXT NOT NULL,
      hora_listo TEXT,
      creado_en TEXT,
      origen_mesa_numero INTEGER,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(producto_id) REFERENCES Productos(id)
    )`);
    db.run("ALTER TABLE DetalleOrden ADD COLUMN curso INTEGER DEFAULT 2", () => {});
    db.run("ALTER TABLE DetalleOrden ADD COLUMN creado_en TEXT", () => {});
    db.run("ALTER TABLE DetalleOrden ADD COLUMN origen_mesa_numero INTEGER", () => {});
    db.run("ALTER TABLE DetalleOrden ADD COLUMN comanda_numero INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE DetalleOrden ADD COLUMN comensal TEXT DEFAULT 'General'", () => {});

    // 9. Pagos
    db.run(`CREATE TABLE IF NOT EXISTS Pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      caja_id INTEGER,
      mesero TEXT,
      metodo TEXT NOT NULL,
      monto REAL NOT NULL,
      propina REAL DEFAULT 0,
      cambio REAL DEFAULT 0,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(caja_id) REFERENCES Cajas(id)
    )`);
    db.run("ALTER TABLE Pagos ADD COLUMN mesero TEXT", () => {});
    db.run("ALTER TABLE Pagos ADD COLUMN caja_fisica_id INTEGER", () => {});
    db.run("ALTER TABLE Pagos ADD COLUMN monto_usd REAL DEFAULT 0", () => {});
    db.run("ALTER TABLE Pagos ADD COLUMN tipo_cambio REAL DEFAULT 1", () => {});

    // 10. Auditoría de Anulaciones
    db.run(`CREATE TABLE IF NOT EXISTS Anulaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER,
      detalle_id INTEGER,
      mesa TEXT,
      producto_nombre TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      monto REAL NOT NULL,
      motivo TEXT NOT NULL,
      supervisor_pin TEXT NOT NULL,
      autorizado_por TEXT DEFAULT 'Supervisor',
      fecha_hora TEXT NOT NULL
    )`);

    // 11. Facturación Electrónica Express
    db.run(`CREATE TABLE IF NOT EXISTS FacturasElectronicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER,
      tipo_documento TEXT DEFAULT 'FE',
      clave TEXT NOT NULL,
      consecutivo TEXT NOT NULL,
      fecha_emision TEXT NOT NULL,
      cliente_tipo_id TEXT,
      cliente_id TEXT,
      cliente_nombre TEXT,
      cliente_correo TEXT,
      subtotal REAL NOT NULL,
      impuesto REAL NOT NULL,
      servicio REAL NOT NULL,
      total REAL NOT NULL,
      estado_hacienda TEXT DEFAULT 'aceptado'
    )`);

    // 12. Usuarios del Sistema con Género y Roles
    db.run(`CREATE TABLE IF NOT EXISTS Usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      usuario TEXT NOT NULL,
      nombre_completo TEXT NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL, -- developer, admin, cajero, salonero
      genero TEXT NOT NULL DEFAULT 'M', -- M = Hombre (Salonero), F = Mujer (Salonera)
      pin TEXT DEFAULT '1234',
      permisos TEXT DEFAULT '{"salon":true,"kds":true,"caja":true,"facturacion":true}',
      activo INTEGER DEFAULT 1,
      debe_cambiar_password INTEGER DEFAULT 0,
      caja_defecto_id INTEGER,
      ultimo_token_sesion TEXT,
      ultima_conexion TEXT,
      ultimo_dispositivo_id TEXT,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id),
      UNIQUE(negocio_id, usuario)
    )`);
    db.run("ALTER TABLE Usuarios ADD COLUMN activo INTEGER DEFAULT 1", () => {});
    db.run("UPDATE Usuarios SET activo = 1 WHERE activo IS NULL", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN debe_cambiar_password INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN caja_defecto_id INTEGER", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN ultimo_token_sesion TEXT", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN ultima_conexion TEXT", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN ultimo_dispositivo_id TEXT", () => {});
    db.run("ALTER TABLE Usuarios ADD COLUMN sucursales_asignadas TEXT DEFAULT NULL", () => {});

    // 12b. Terminales y Dispositivos Autorizados (Device Whitelisting)
    db.run(`CREATE TABLE IF NOT EXISTS DispositivosAutorizados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      device_token TEXT NOT NULL UNIQUE,
      nombre_dispositivo TEXT NOT NULL,
      tipo_dispositivo TEXT DEFAULT 'desktop', -- 'pc', 'tablet', 'movil'
      navegador_info TEXT,
      ip_registro TEXT,
      autorizado_por TEXT DEFAULT 'Administrador',
      creado_en TEXT NOT NULL,
      activo INTEGER DEFAULT 1,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);

    // 13. Historial de Uniones de Mesas (Snapshots para Separación Exacta)
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

    // 14. Inventario & Control de Stock de Insumos
    db.run(`CREATE TABLE IF NOT EXISTS Inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      nombre TEXT NOT NULL,
      categoria TEXT DEFAULT 'General',
      unidad_medida TEXT DEFAULT 'unidades',
      stock_actual REAL DEFAULT 0,
      stock_minimo REAL DEFAULT 5,
      costo_unitario REAL DEFAULT 0,
      producto_id INTEGER,
      actualizado_en TEXT,
      es_licor INTEGER DEFAULT 0,
      capacidad_ml REAL DEFAULT 750,
      medida_shot_ml REAL DEFAULT 30,
      rendimiento_shots REAL DEFAULT 25,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);

    // 15. Escandallo / Recetas de Productos
    db.run(`CREATE TABLE IF NOT EXISTS InventarioRecetas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      insumo_id INTEGER NOT NULL,
      cantidad REAL NOT NULL DEFAULT 1,
      merma_porcentaje REAL DEFAULT 0,
      FOREIGN KEY(producto_id) REFERENCES Productos(id),
      FOREIGN KEY(insumo_id) REFERENCES Inventario(id)
    )`);

    // 15b. Kardex de Movimientos de Inventario
    db.run(`CREATE TABLE IF NOT EXISTS InventarioMovimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      insumo_id INTEGER NOT NULL,
      tipo TEXT NOT NULL, -- 'entrada', 'merma', 'venta', 'ajuste'
      cantidad REAL NOT NULL,
      stock_previo REAL NOT NULL,
      stock_nuevo REAL NOT NULL,
      motivo TEXT,
      usuario_nombre TEXT DEFAULT 'Sistema',
      costo_total REAL DEFAULT 0,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(insumo_id) REFERENCES Inventario(id)
    )`);

    // 16. Sistema de Auditoría y Bitácora de Seguridad
    db.run(`CREATE TABLE IF NOT EXISTS Auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      usuario_id INTEGER,
      usuario_nombre TEXT NOT NULL,
      accion TEXT NOT NULL,
      tipo_evento TEXT NOT NULL DEFAULT 'operativo',
      modulo TEXT NOT NULL DEFAULT 'general',
      detalle TEXT NOT NULL,
      motivo TEXT,
      monto REAL DEFAULT 0,
      pin_autorizado INTEGER DEFAULT 0,
      autorizado_por TEXT,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);
    db.run("ALTER TABLE Auditoria ADD COLUMN autorizado_por TEXT", () => {});
    db.run("ALTER TABLE Anulaciones ADD COLUMN solicitado_por TEXT", () => {});

    // Sembrar Insumos Iniciales si no existen
    db.get('SELECT COUNT(*) as count FROM Inventario', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        const insumosIniciales = [
          { nombre: 'Cerveza Imperial Regular', categoria: 'Bebidas & Cervezas', unidad: 'botellas', stock: 48, min: 12, costo: 950, prodId: 1 },
          { nombre: 'Cerveza Pilsen', categoria: 'Bebidas & Cervezas', unidad: 'botellas', stock: 36, min: 12, costo: 950, prodId: 2 },
          { nombre: 'Cerveza Corona Extra', categoria: 'Bebidas & Cervezas', unidad: 'botellas', stock: 24, min: 10, costo: 1250, prodId: 6 },
          { nombre: 'Ron Bacardí Carta Blanca', categoria: 'Licores & Destilados', unidad: 'botellas', stock: 8, min: 2, costo: 8500, prodId: 3 },
          { nombre: 'Tequila José Cuervo Especial', categoria: 'Licores & Destilados', unidad: 'botellas', stock: 6, min: 2, costo: 11000, prodId: 4 },
          { nombre: 'Gin Tanqueray London Dry', categoria: 'Licores & Destilados', unidad: 'botellas', stock: 5, min: 2, costo: 14000, prodId: 5 },
          { nombre: 'Corte Rib Eye Prime 350g', categoria: 'Carnes & Cocina', unidad: 'cortes', stock: 22, min: 5, costo: 4200, prodId: 7 },
          { nombre: 'Tortas de Carne Angus 200g', categoria: 'Carnes & Cocina', unidad: 'unidades', stock: 30, min: 8, costo: 1800, prodId: 8 },
          { nombre: 'Pan Brioche Artesanal', categoria: 'Panadería & Abarrotes', unidad: 'unidades', stock: 35, min: 10, costo: 450, prodId: null },
          { nombre: 'Queso Cheddar Madurado', categoria: 'Lácteos & Cocina', unidad: 'porciones', stock: 50, min: 15, costo: 300, prodId: null },
          { nombre: 'Pescado Corvina Fresca (Ceviche)', categoria: 'Mariscos & Fríos', unidad: 'porciones', stock: 18, min: 5, costo: 2200, prodId: 9 },
          { nombre: 'Chicharrón de Cerdo Criollo', categoria: 'Carnes & Cocina', unidad: 'kg', stock: 12.5, min: 3, costo: 4500, prodId: 10 },
          { nombre: 'Alitas de Pollo Seleccionadas', categoria: 'Carnes & Cocina', unidad: 'kg', stock: 15.0, min: 4, costo: 2800, prodId: 11 }
        ];

        const ahora = new Date().toISOString();
        insumosIniciales.forEach(ins => {
          const esLic = ins.categoria.includes('Licores') || ins.unidad === 'botellas' && (ins.nombre.includes('Ron') || ins.nombre.includes('Tequila') || ins.nombre.includes('Gin'));
          db.run(
            `INSERT INTO Inventario (negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo, costo_unitario, producto_id, actualizado_en, es_licor, capacidad_ml, medida_shot_ml, rendimiento_shots)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ins.nombre, ins.categoria, ins.unidad, ins.stock, ins.min, ins.costo, ins.prodId, ahora, esLic ? 1 : 0, esLic ? 750 : null, esLic ? 30 : null, esLic ? 25 : null]
          );

        });
        console.log('🌱 Inventario inicial sembrado con existencias y costos.');

        // Registrar auditoría de inicialización
        db.run(
          `INSERT INTO Auditoria (negocio_id, usuario_id, usuario_nombre, accion, tipo_evento, modulo, detalle, fecha_hora)
           VALUES (1, 1, 'Sistema', 'inicio_inventario', 'operativo', 'inventario', 'Carga inicial de inventario base y existencias del restaurante', ?)`,
          [ahora]
        );
      }
    });

    // Sembrar Recetas Iniciales (Escandallos)
    db.get('SELECT COUNT(*) as count FROM InventarioRecetas', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        db.all('SELECT id, nombre FROM Productos', (errP, prods) => {
          if (!errP && prods) {
            db.all('SELECT id, nombre FROM Inventario', (errI, insumos) => {
              if (!errI && insumos) {
                const mapProd = {};
                prods.forEach(p => mapProd[p.nombre.toLowerCase().trim()] = p.id);
                const mapIns = {};
                insumos.forEach(i => mapIns[i.nombre.toLowerCase().trim()] = i.id);

                const recetasSeed = [
                  { prod: 'hamburguesa de la casa con plátano maduro', ins: 'pan brioche artesanal', cant: 1 },
                  { prod: 'hamburguesa de la casa con plátano maduro', ins: 'tortas de carne angus 200g', cant: 1 },
                  { prod: 'hamburguesa de la casa con plátano maduro', ins: 'queso cheddar madurado', cant: 1 },
                  { prod: 'chicharrón de cerdo con yuca', ins: 'chicharrón de cerdo criollo', cant: 0.35 },
                  { prod: 'ceviche de pescado blanco', ins: 'pescado corvina fresca (ceviche)', cant: 1 }
                ];

                recetasSeed.forEach(r => {
                  const pId = mapProd[r.prod];
                  const iId = mapIns[r.ins];
                  if (pId && iId) {
                    db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, 0)', [pId, iId, r.cant]);
                  }
                });
                console.log('🌱 Escandallos y recetas iniciales sembrados.');
              }
            });
          }
        });
      }
    });

    // Sembrar Negocios Iniciales (1: GastroBar, 2: Beta Tester)
    const modulosProduccionBase = JSON.stringify([
      "pos_core", "kds_cocina", "mesas_promos", "split_bill", "menu_qr",
      "auto_pago_qr", "offline_first", "inventario_recetas", "notificaciones_whatsapp",
      "inteligencia_artificial", "facturacion_electronica", "pedir_pin_liberar_con_saldo",
      "caja_arqueo_dual_dolares", "comanda_express_cobro_anticipado"
    ]);

    db.get('SELECT COUNT(*) as count FROM Negocios WHERE id = 1', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        db.run(`INSERT INTO Negocios (id, nombre, slogan, logo_url, moneda, telefono, direccion, activo, plan_nombre, modulos_activos) 
          VALUES (1, 'GastroBar Fuego & Brasas', 'Restaurante, Bar & Lounge', 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80', 'CRC', '2222-3344', 'San José, Costa Rica', 1, 'Plan Full Tech 2026', ?)`, [modulosProduccionBase]);
        console.log('🌱 Negocio 1 (GastroBar) creado.');
      } else if (!err && row && row.count > 0) {
        db.run(`UPDATE Negocios SET modulos_activos = ? WHERE id = 1 AND modulos_activos = 'all'`, [modulosProduccionBase]);
      }
    });

    db.get('SELECT COUNT(*) as count FROM Negocios WHERE id = 2', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        db.run(`INSERT INTO Negocios (id, nombre, slogan, logo_url, moneda, telefono, direccion, activo, plan_nombre, modulos_activos) 
          VALUES (2, 'Beta Tester (Sandbox)', 'Laboratorio de Pruebas & Nuevas Funciones', 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=150&auto=format&fit=crop&q=80', 'CRC', '8888-9900', 'Entorno Virtual de Pruebas Sandbox', 1, 'Plan Sandbox Developer', 'all')`);
        console.log('🌱 Negocio 2 (Beta Tester Sandbox) creado.');

        // Sembrar Inventario aislado para Beta Tester (Sandbox)
        db.get('SELECT COUNT(*) as count FROM Inventario WHERE negocio_id = 2', (errInv, rowInv) => {
          if (!errInv && (!rowInv || rowInv.count === 0)) {
            db.all('SELECT * FROM Inventario WHERE negocio_id = 1', (errOrig, itemsOrig) => {
              if (!errOrig && itemsOrig && itemsOrig.length > 0) {
                itemsOrig.forEach(i => {
                  db.run(`INSERT INTO Inventario (
                    negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo,
                    costo_unitario, producto_id, actualizado_en, es_licor, capacidad_ml, medida_shot_ml, rendimiento_shots
                  ) VALUES (2, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`, [
                    i.nombre, i.categoria, i.unidad_medida, i.stock_actual || 50, i.stock_minimo || 5,
                    i.costo_unitario || 1000, new Date().toISOString(), i.es_licor || 0,
                    i.capacidad_ml, i.medida_shot_ml, i.rendimiento_shots
                  ]);
                });
                console.log('🌱 Inventario base clonado e independizado para Negocio 2 (Sandbox).');
              }
            });
          }
        });

        // Sembrar Zonas para Beta Tester
        const zonasBeta = [
          { id: 101, nombre: 'Salón Principal' },
          { id: 102, nombre: 'Barra & Lounge' },
          { id: 103, nombre: 'Terraza' },
          { id: 104, nombre: 'VIP' },
          { id: 105, nombre: 'Segundo Piso' }
        ];
        zonasBeta.forEach(z => {
          db.run('INSERT OR IGNORE INTO Zonas (id, negocio_id, nombre) VALUES (?, 2, ?)', [z.id, z.nombre]);
        });

        // Sembrar Mesas para Beta Tester
        const mesasBeta = [
          { numero: 'Mesa 1', zona_id: 101, capacidad: 4, forma: 'square', x: 25, y: 25, ancho: 135, alto: 115 },
          { numero: 'Mesa 2', zona_id: 101, capacidad: 4, forma: 'square', x: 185, y: 25, ancho: 135, alto: 115 },
          { numero: 'Mesa 3', zona_id: 101, capacidad: 4, forma: 'round', x: 345, y: 25, ancho: 135, alto: 115 },
          { numero: 'Barra 1', zona_id: 102, capacidad: 1, forma: 'silla', x: 530, y: 25, ancho: 85, alto: 95 },
          { numero: 'Barra 2', zona_id: 102, capacidad: 1, forma: 'silla', x: 635, y: 25, ancho: 85, alto: 95 },
          { numero: 'Mesa VIP', zona_id: 104, capacidad: 8, forma: 'square', x: 530, y: 165, ancho: 200, alto: 130 },
          { numero: 'Terraza 1', zona_id: 103, capacidad: 4, forma: 'square', x: 25, y: 325, ancho: 140, alto: 120 }
        ];
        mesasBeta.forEach(m => {
          db.run('INSERT INTO Mesas (negocio_id, numero, zona_id, capacidad, forma, x, y, ancho, alto, estado) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, "libre")', [m.numero, m.zona_id, m.capacidad, m.forma, m.x, m.y, m.ancho, m.alto]);
        });

        // Sembrar Categorías para Beta Tester
        const categoriasBeta = [
          { id: 101, nombre: 'Comidas Principales', icono: '🍽️', destino: 'cocina' },
          { id: 102, nombre: 'Entradas y Bocas de Bar', icono: '🍢', destino: 'cocina' },
          { id: 103, nombre: 'Postres', icono: '🍰', destino: 'cocina' },
          { id: 104, nombre: 'Cervezas', icono: '🍺', destino: 'barra' },
          { id: 105, nombre: 'Cocteles y Shots', icono: '🍸', destino: 'barra' },
          { id: 106, nombre: 'Naturales / Café', icono: '☕', destino: 'barra' }
        ];
        categoriasBeta.forEach(c => {
          db.run('INSERT OR IGNORE INTO Categorias (id, negocio_id, nombre, icono, destino) VALUES (?, 2, ?, ?, ?)', [c.id, c.nombre, c.icono, c.destino]);
        });

        // Sembrar Productos de prueba para Beta Tester
        const prodsBeta = [
          { cat: 101, nombre: 'Casado con carne mechada [Beta]', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 101, nombre: 'Hamburguesa de la casa con plátano maduro [Beta]', precio: 4900, destino: 'cocina', curso: 2 },
          { cat: 101, nombre: 'Chifrijo tradicional [Beta]', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 102, nombre: 'Patacones con frijoles molidos [Beta]', precio: 3000, destino: 'cocina', curso: 1 },
          { cat: 102, nombre: 'Ceviche de pescado blanco [Beta]', precio: 4000, destino: 'cocina', curso: 1 },
          { cat: 103, nombre: 'Tres leches tradicional [Beta]', precio: 2800, destino: 'cocina', curso: 4 },
          { cat: 104, nombre: 'Imperial Regular [Beta]', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 104, nombre: 'Pilsen [Beta]', precio: 1800, destino: 'barra', curso: 1 }
        ];
        prodsBeta.forEach(p => {
          db.run('INSERT INTO Productos (negocio_id, categoria_id, nombre, precio, destino, curso, activo, agotado, happy_hour) VALUES (2, ?, ?, ?, ?, ?, 1, 0, 0)', [p.cat, p.nombre, p.precio, p.destino, p.curso]);
        });

        // Sembrar Usuarios de prueba para Beta Tester
        const usersBeta = [
          { usuario: 'admin_beta', nombre: 'Admin Beta Tester', pass: 'admin123', rol: 'admin', genero: 'M', pin: '1234', perm: '{"salon":true,"kds":true,"caja":true,"facturacion":true,"empleados":true,"catalogo":true}' },
          { usuario: 'mesero_beta', nombre: 'Carlos Beta Tester', pass: 'mesero123', rol: 'salonero', genero: 'M', pin: '1111', perm: '{"salon":true,"kds":true}' }
        ];
        usersBeta.forEach(u => {
          db.run('INSERT OR IGNORE INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos) VALUES (2, ?, ?, ?, ?, ?, ?, ?)', [u.usuario, u.nombre, u.pass, u.rol, u.genero, u.pin, u.perm]);
        });
      }
    });

    // Sembrar Usuarios Iniciales (dev, admin, cajero, salonero, salonera)
    db.get('SELECT COUNT(*) as count FROM Usuarios', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        const users = [
          {
            negocio_id: 1,
            usuario: 'dev',
            nombre: 'Juan Developer',
            password: 'dev123',
            rol: 'developer',
            genero: 'M',
            pin: '9999',
            permisos: '{"developer":true,"salon":true,"kds":true,"caja":true,"facturacion":true,"negocios":true}'
          },
          {
            negocio_id: 1,
            usuario: 'admin',
            nombre: 'Don Alberto',
            password: 'admin123',
            rol: 'admin',
            genero: 'M',
            pin: '1234',
            permisos: '{"salon":true,"kds":true,"caja":true,"facturacion":true,"empleados":true,"catalogo":true}'
          },
          {
            negocio_id: 1,
            usuario: 'cajero',
            nombre: 'Roberto Caja',
            password: 'caja123',
            rol: 'cajero',
            genero: 'M',
            pin: '5555',
            permisos: '{"salon":true,"caja":true,"facturacion":true}'
          },
          {
            negocio_id: 1,
            usuario: 'carlos',
            nombre: 'Carlos Solano',
            password: 'mesero123',
            rol: 'salonero',
            genero: 'M',
            pin: '1111',
            permisos: '{"salon":true,"kds":true}'
          },
          {
            negocio_id: 1,
            usuario: 'sofia',
            nombre: 'Sofía Morales',
            password: 'mesera123',
            rol: 'salonero',
            genero: 'F',
            pin: '2222',
            permisos: '{"salon":true,"kds":true}'
          }
        ];

        users.forEach(u => {
          db.run(
            `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, activo) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [u.negocio_id, u.usuario, u.nombre, u.password, u.rol, u.genero, u.pin, u.permisos]
          );
        });
        console.log('🌱 Usuarios iniciales (dev, admin, cajero, carlos [M], sofia [F]) sembrados.');
      }
    });

    // Sembrar Puntos de Cobro / Cajas Físicas si no existen
    db.get('SELECT COUNT(*) as count FROM PuntosDeCobro WHERE negocio_id = 1', (err, row) => {
      if (!err && (!row || Number(row.count) === 0)) {
        const ahora = new Date().toISOString();
        const cajasSeed = [
          { nombre: 'Caja 1 - Principal', codigo: 'CAJA-01', ubicacion: 'Entrada / Salón Principal', icono: '💳' },
          { nombre: 'Caja 2 - Barra', codigo: 'CAJA-02', ubicacion: 'Barra de Bebidas', icono: '🍸' },
          { nombre: 'Caja 3 - Terraza', codigo: 'CAJA-03', ubicacion: 'Terraza / Segundo Piso', icono: '🌿' },
          { nombre: 'Caja 4 - Express', codigo: 'CAJA-04', ubicacion: 'Mostrador Para Llevar', icono: '🛵' }
        ];
        cajasSeed.forEach(c => {
          db.run(
            `INSERT INTO PuntosDeCobro (negocio_id, nombre, codigo, ubicacion, icono, activo, creado_en)
             VALUES (1, ?, ?, ?, ?, 1, ?)`,
            [c.nombre, c.codigo, c.ubicacion, c.icono, ahora]
          );
        });
        console.log('🌱 Puntos de Cobro / Cajas Físicas iniciales sembradas para Negocio 1.');
      }
    });

    // Blindaje de imágenes: No sobreescribir imágenes de productos al iniciar el servidor

    // Sembrar Mesas Iniciales si no existen
    db.get('SELECT COUNT(*) as count FROM Mesas', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        const mesasIniciales = [
          { numero: 'Mesa 1', zona_id: 1, capacidad: 4, forma: 'square', x: 25, y: 25, ancho: 135, alto: 115 },
          { numero: 'Mesa 2', zona_id: 1, capacidad: 4, forma: 'square', x: 185, y: 25, ancho: 135, alto: 115 },
          { numero: 'Mesa 3', zona_id: 1, capacidad: 4, forma: 'round', x: 345, y: 25, ancho: 135, alto: 115 },
          { numero: 'Mesa 4', zona_id: 1, capacidad: 4, forma: 'square', x: 25, y: 175, ancho: 135, alto: 115 },
          { numero: 'Barra 1', zona_id: 2, capacidad: 1, forma: 'silla', x: 530, y: 25, ancho: 85, alto: 95 },
          { numero: 'Barra 2', zona_id: 2, capacidad: 1, forma: 'silla', x: 635, y: 25, ancho: 85, alto: 95 },
          { numero: 'Barra 3', zona_id: 2, capacidad: 1, forma: 'silla', x: 740, y: 25, ancho: 85, alto: 95 },
          { numero: 'Barra 4', zona_id: 2, capacidad: 1, forma: 'silla', x: 845, y: 25, ancho: 85, alto: 95 },
          { numero: 'Silla Barra 7', zona_id: 2, capacidad: 1, forma: 'silla', x: 950, y: 25, ancho: 85, alto: 95 },
          { numero: 'Silla Barra 6', zona_id: 2, capacidad: 1, forma: 'silla', x: 1055, y: 25, ancho: 85, alto: 95 },
          { numero: 'Mesa VIP', zona_id: 4, capacidad: 8, forma: 'square', x: 530, y: 165, ancho: 200, alto: 130 },
          { numero: 'Terraza 1', zona_id: 3, capacidad: 4, forma: 'square', x: 25, y: 325, ancho: 140, alto: 120 },
          { numero: 'Terraza 2', zona_id: 3, capacidad: 4, forma: 'square', x: 195, y: 325, ancho: 140, alto: 120 }
        ];
        mesasIniciales.forEach(m => {
          db.run(
            `INSERT INTO Mesas (negocio_id, numero, zona_id, capacidad, forma, x, y, ancho, alto, estado)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'libre')`,
            [m.numero, m.zona_id, m.capacidad, m.forma, m.x, m.y, m.ancho, m.alto]
          );
        });
        console.log('🌱 Mesas iniciales sembradas con distribución limpia y ordenada.');
      }
    });

    // Sembrar Categorías si no existen
    const categoriasOficiales = [
      { id: 1, nombre: 'Comidas Principales', icono: '🍽️', destino: 'cocina' },
      { id: 2, nombre: 'Entradas y Bocas de Bar', icono: '🍢', destino: 'cocina' },
      { id: 3, nombre: 'Postres', icono: '🍰', destino: 'cocina' },
      { id: 4, nombre: 'Cervezas', icono: '🍺', destino: 'barra' },
      { id: 5, nombre: 'Cocteles y Shots', icono: '🍸', destino: 'barra' },
      { id: 6, nombre: 'Naturales / Café', icono: '☕', destino: 'barra' }
    ];

    categoriasOficiales.forEach(cat => {
      db.run(
        `INSERT INTO Categorias (id, negocio_id, nombre, icono, destino)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [cat.id, cat.nombre, cat.icono, cat.destino]
      );
    });

    // Sembrar productos iniciales ÚNICAMENTE si la tabla Productos está totalmente vacía
    db.get('SELECT COUNT(*) as count FROM Productos', (errP, rowP) => {
      if (!errP && rowP && Number(rowP.count) === 0) {
        const productosOficiales = [
          // 1. Comidas Principales (cat: 1)
          { cat: 1, nombre: 'Casado con carne mechada', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Casado con bistec encebollado', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Casado con chuleta de cerdo', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Casado con pollo en salsa', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Casado con pescado frito', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Casado con pollo a la plancha', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Arroz con pollo', precio: 5000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Arroz con camarones', precio: 6500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Arroz con calamares', precio: 6000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Arroz con mariscos', precio: 6500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Arroz de la casa', precio: 6500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Chifrijo tradicional', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Chifrijo gigante', precio: 6500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Olla de carne', precio: 5500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Sopa negra con huevo duro', precio: 4000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Sopa de mondongo', precio: 4500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Sopa de mariscos', precio: 6500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de carne de res', precio: 3500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de salchichón', precio: 3000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de chicharrón de cerdo', precio: 3800, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de picadillo de papa', precio: 3000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de picadillo de chayote con carne', precio: 3500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de picadillo de arracache', precio: 3500, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Gallos de picadillo de plátano verde', precio: 3200, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Vigorón costarricense', precio: 4000, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Chicharrón de cerdo con yuca', precio: 4800, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Sándwich de carne mechada', precio: 4200, destino: 'cocina', curso: 2 },
          { cat: 1, nombre: 'Hamburguesa de la casa con plátano maduro', precio: 4900, destino: 'cocina', curso: 2 },
          // 2. Entradas y Bocas de Bar (cat: 2)
          { cat: 2, nombre: 'Patacones con frijoles molidos', precio: 3000, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Patacones con queso blanco', precio: 3200, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Patacones con carne desmechada', precio: 3800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Patacones con guacamole', precio: 3500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Yuca frita con natilla', precio: 2800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Yuca al mojo de ajo', precio: 2900, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Chorreadas con natilla', precio: 3000, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Deditos de queso frito', precio: 3200, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Ceviche de pescado blanco', precio: 4000, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Ceviche de camarón', precio: 5000, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Ceviche mixto', precio: 5500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Ceviche con plátano verde', precio: 4200, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Caldosa', precio: 3000, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Empanada de queso', precio: 1800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Empanada de frijol', precio: 1500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Empanada de carne', precio: 1800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Empanada arreglada', precio: 2500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Tortilla aliñada con queso', precio: 2500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Pejibayes con mayonesa', precio: 2800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Tamal de cerdo tradicional', precio: 2500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Tamal de pollo', precio: 2500, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Plátano maduro con queso y natilla', precio: 2800, destino: 'cocina', curso: 1 },
          { cat: 2, nombre: 'Canastas de patacón rellenas de mariscos', precio: 4800, destino: 'cocina', curso: 1 },
          // 3. Postres (cat: 3)
          { cat: 3, nombre: 'Tres leches tradicional', precio: 2800, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Cuatro leches', precio: 3000, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Arroz con leche', precio: 2500, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Flan de coco', precio: 2600, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Flan de caramelo', precio: 2600, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Torta chilena', precio: 3000, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Cajeta de coco', precio: 1800, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Cajeta de leche', precio: 1800, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Pie de limón', precio: 2800, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Tamal de masa asado', precio: 2500, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Granizado / Copo tradicional', precio: 2500, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Churchilleta', precio: 2800, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Empanaditas dulces de chiverre', precio: 2200, destino: 'cocina', curso: 4 },
          { cat: 3, nombre: 'Prestiños con miel de caña', precio: 2500, destino: 'cocina', curso: 4 },
          // 4. Cervezas (cat: 4)
          { cat: 4, nombre: 'Imperial Regular', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Imperial Light', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Imperial Silver', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Imperial Ultra', precio: 2000, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Pilsen', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Pilsen 6.0', precio: 2000, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Bavaria Gold', precio: 2200, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Bavaria Light', precio: 2200, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Bavaria Dark', precio: 2200, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Bavaria Masters', precio: 2500, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Rock Ice', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Rock Ice Limo-Ness', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Cerveza Artesanal Treintaycinco', precio: 3500, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Cerveza Artesanal Costa Rica Beer Factory', precio: 3500, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Balde Nacional', precio: 7500, destino: 'barra', curso: 1 },
          { cat: 4, nombre: 'Cerveza Artesanal Domingo Siete', precio: 3500, destino: 'barra', curso: 1 },
          // 5. Cocteles y Shots (cat: 5)
          { cat: 5, nombre: 'Chiliguaro', precio: 1500, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Miguelito', precio: 1500, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Guaro Sour', precio: 3000, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Coctel Cacique Mojito Tico', precio: 3500, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Coco Loco Costarricense', precio: 4200, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Pura Vida Punch', precio: 3800, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Guaro Tonic', precio: 3000, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Caipirinha Tica', precio: 3500, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Shot de Cacique con limón y sal', precio: 1500, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Shot de Guaro Cacao', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 5, nombre: 'Shot de Guaro Sandía', precio: 1800, destino: 'barra', curso: 1 },
          // 6. Naturales / Café (cat: 6)
          { cat: 6, nombre: 'Fresco de Cas', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Fresco de Guanábana en agua', precio: 2000, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Fresco de Guanábana en leche', precio: 2300, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Fresco de Maracuyá', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Fresco de Mora', precio: 1800, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Agua de Sapo', precio: 2000, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Horchata tica', precio: 2200, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Resbaladera', precio: 2200, destino: 'barra', curso: 1 },
          { cat: 6, nombre: 'Café chorreado tradicional', precio: 1500, destino: 'barra', curso: 5 },
          { cat: 6, nombre: 'Café con leche estilo tico', precio: 1800, destino: 'barra', curso: 5 },
          { cat: 6, nombre: 'Agua de pipa natural', precio: 1800, destino: 'barra', curso: 1 }
        ];

        productosOficiales.forEach(prod => {
          db.run(
            `INSERT INTO Productos (negocio_id, categoria_id, nombre, precio, destino, curso, activo, agotado, happy_hour)
             VALUES (1, ?, ?, ?, ?, ?, 1, 0, 0)`,
            [prod.cat, prod.nombre, prod.precio, prod.destino, prod.curso]
          );
        });
        console.log('🌱 Menú inicial sembrado en base de datos vacía.');
      }
    });
    // Saneamiento de selectores CSS frágiles en ConfigNegocio (custom_page_settings)
    db.all("SELECT clave, valor FROM ConfigNegocio WHERE clave LIKE 'custom_page_settings%'", (err, rows) => {
      if (!err && rows && rows.length > 0) {
        rows.forEach(r => {
          try {
            const parsed = JSON.parse(r.valor || '{}');
            let modificado = false;
            if (parsed.elementStyles) {
              for (const sel of Object.keys(parsed.elementStyles)) {
                if (sel.includes('stat-row') || sel.includes('caja-stat-rows') || sel.includes('#view-caja')) {
                  delete parsed.elementStyles[sel];
                  modificado = true;
                }
              }
            }
            if (modificado) {
              db.run('UPDATE ConfigNegocio SET valor = ? WHERE clave = ?', [JSON.stringify(parsed), r.clave]);
            }
          } catch (e) {}
        });
      }
    });

    // Auto-alineación de secuencias y claves foráneas con ON DELETE CASCADE en PostgreSQL
    if (db.isPg) {
      const tablasConId = ['negocios', 'zonas', 'categorias', 'productos', 'mesas', 'usuarios', 'puntosdecobro'];
      tablasConId.forEach(tbl => {
        db.get(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1) + 1, false)`,
          [tbl],
          () => {}
        );
      });
      // Asegurar que claves foráneas a negocios tengan ON DELETE CASCADE
      db.run('ALTER TABLE puntosdecobro DROP CONSTRAINT IF EXISTS puntosdecobro_negocio_id_fkey', () => {
        db.run('ALTER TABLE puntosdecobro ADD CONSTRAINT puntosdecobro_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE', () => {});
      });
      db.run('ALTER TABLE dispositivosautorizados DROP CONSTRAINT IF EXISTS dispositivosautorizados_negocio_id_fkey', () => {
        db.run('ALTER TABLE dispositivosautorizados ADD CONSTRAINT dispositivosautorizados_negocio_id_fkey FOREIGN KEY (negocio_id) REFERENCES negocios(id) ON DELETE CASCADE', () => {});
      });
    }
  });
}

initDb();

module.exports = db;

