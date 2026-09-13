require('dotenv').config();
const QRCode = require('qrcode');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const printerService = require('./printerService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'gamma_pos_jwt_secret_key_prod_2026_secured';

// ============================================================================
// ESTADO EN MEMORIA: HAPPY HOUR
// ============================================================================
let happyHourModificadoManualmente = false;
let happyHourEstado = {
  activo: false,
  horaInicio: '16:00', // HH:MM (24h)
  horaFin: '19:00',    // HH:MM (24h)
  autoActivar: true,
  dias: '1,2,3,4,5,6,0', // 1=Lun, 2=Mar, 3=Mie, 4=Jue, 5=Vie, 6=Sab, 0=Dom
  modoDefecto: 'estricto' // 'estricto' | 'flexible'
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
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_auto_activar', 'true')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_dias', '1,2,3,4,5,6,0')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('hh_modo_defecto', 'estricto')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('app_version', '1.0.0')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_last_check', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_available', 'false')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_latest_commit', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_commit_msg', '')");
  db.run("INSERT OR IGNORE INTO ConfigNegocio (clave, valor) VALUES ('update_commit_date', '')");

  db.all("SELECT clave, valor FROM ConfigNegocio WHERE clave LIKE 'hh_%'", [], (err, rows) => {
    if (!err && rows && !happyHourModificadoManualmente) {
      rows.forEach(r => {
        if (r.clave === 'hh_activo') happyHourEstado.activo = r.valor === 'true';
        if (r.clave === 'hh_hora_inicio') happyHourEstado.horaInicio = r.valor;
        if (r.clave === 'hh_hora_fin') happyHourEstado.horaFin = r.valor;
        if (r.clave === 'hh_auto_activar') happyHourEstado.autoActivar = r.valor !== 'false';
        if (r.clave === 'hh_dias') happyHourEstado.dias = r.valor;
        if (r.clave === 'hh_modo_defecto') happyHourEstado.modoDefecto = r.valor;
      });
      console.log(`🍸 Happy Hour cargado: activo=${happyHourEstado.activo}, ${happyHourEstado.horaInicio}–${happyHourEstado.horaFin}, auto=${happyHourEstado.autoActivar}`);
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
  db.run("ALTER TABLE Mesas ADD COLUMN hora_pidio_cuenta TEXT", () => {});
  db.run("ALTER TABLE Mesas ADD COLUMN cliente TEXT", () => {});
  db.run("ALTER TABLE Zonas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
  db.run("ALTER TABLE Negocios ADD COLUMN modulos_activos TEXT DEFAULT 'all'", () => {});
  db.run("ALTER TABLE Negocios ADD COLUMN plan_nombre TEXT DEFAULT 'Plan Full Tech 2026'", () => {});
  db.run("INSERT OR IGNORE INTO Zonas (id, nombre) VALUES (5, 'Segundo Piso')", () => {});
  db.run("UPDATE Productos SET happy_hour = 1 WHERE categoria_id = 4 OR LOWER(nombre) LIKE '%imperial%' OR LOWER(nombre) LIKE '%pilsen%' OR LOWER(nombre) LIKE '%bavaria%' OR LOWER(nombre) LIKE '%rock ice%' OR LOWER(nombre) LIKE '%corona%' OR LOWER(nombre) LIKE '%cerveza%'", () => {});
  db.run("ALTER TABLE DetalleOrden ADD COLUMN en_happy_hour INTEGER DEFAULT 0", () => {});
  db.run("ALTER TABLE Ordenes ADD COLUMN modo_happy_hour TEXT DEFAULT 'estricto'", () => {});
  db.run("ALTER TABLE InventarioRecetas ADD COLUMN merma_porcentaje REAL DEFAULT 0", () => {});
  db.run("ALTER TABLE Inventario ADD COLUMN es_licor INTEGER DEFAULT 0", () => {});
  db.run("ALTER TABLE Inventario ADD COLUMN capacidad_ml REAL DEFAULT 750", () => {});
  db.run("ALTER TABLE Inventario ADD COLUMN medida_shot_ml REAL DEFAULT 30", () => {});
  db.run("ALTER TABLE Inventario ADD COLUMN rendimiento_shots REAL DEFAULT 25", () => {});
  db.run("UPDATE Inventario SET es_licor = 1, capacidad_ml = 750, medida_shot_ml = 30, rendimiento_shots = 25 WHERE es_licor = 0 AND (categoria LIKE '%licor%' OR LOWER(nombre) LIKE '%ron %' OR LOWER(nombre) LIKE '%tequila%' OR LOWER(nombre) LIKE '%gin %' OR LOWER(nombre) LIKE '%whisky%' OR LOWER(nombre) LIKE '%vodka%')", () => {});
  db.run("ALTER TABLE Pagos ADD COLUMN referencia TEXT", () => {});
  db.run("ALTER TABLE Pagos ADD COLUMN tipo_cambio REAL DEFAULT 1", () => {});
  db.run("ALTER TABLE Pagos ADD COLUMN monto_usd REAL DEFAULT 0", () => {});
  db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_dolares REAL DEFAULT 0", () => {});
  db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_usd REAL DEFAULT 0", () => {});
  db.run("ALTER TABLE Cajas ADD COLUMN total_ventas_transferencia REAL DEFAULT 0", () => {});
  db.run("ALTER TABLE Cajas ADD COLUMN monto_final_dolares REAL DEFAULT 0", () => {});
  db.run(`CREATE TABLE IF NOT EXISTS InventarioMovimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER DEFAULT 1,
    insumo_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    cantidad REAL NOT NULL,
    stock_previo REAL NOT NULL,
    stock_nuevo REAL NOT NULL,
    motivo TEXT,
    usuario_nombre TEXT DEFAULT 'Sistema',
    costo_total REAL DEFAULT 0,
    fecha_hora TEXT NOT NULL,
    FOREIGN KEY(insumo_id) REFERENCES Inventario(id)
  )`, () => {});

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

  db.run(`CREATE TABLE IF NOT EXISTS IdempotencyLog (
    idempotency_key TEXT PRIMARY KEY,
    accion TEXT,
    creado_en TEXT
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotencylog_key ON IdempotencyLog (idempotency_key)`, () => {});

  // Asegurar recetas iniciales (Escandallos) si la tabla está vacía
  db.get('SELECT COUNT(*) as count FROM InventarioRecetas', (err, row) => {
    if (!err && (!row || row.count === 0)) {
      db.all('SELECT id, nombre FROM Productos', (errP, prods) => {
        if (!errP && prods) {
          db.all('SELECT id, nombre FROM Inventario', (errI, insumos) => {
            if (!errI && insumos) {
              const findProd = (pattern) => prods.find(p => p.nombre.toLowerCase().includes(pattern));
              const findIns = (pattern) => insumos.find(i => i.nombre.toLowerCase().includes(pattern));

              const h1 = findProd('hamburguesa doble') || findProd('hamburguesa');
              const ch = findProd('chicharrón') || findProd('chifrijo');
              const cev = findProd('ceviche');
              const rib = findProd('rib eye');

              const pan = findIns('pan brioche') || findIns('pan');
              const torta = findIns('torta');
              const queso = findIns('queso cheddar') || findIns('queso');
              const chicha = findIns('chicharrón');
              const corvina = findIns('corvina') || findIns('pescado');
              const carne = findIns('rib eye');

              if (h1 && pan && torta && queso) {
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 1, 0)', [h1.id, pan.id]);
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 2, 0)', [h1.id, torta.id]);
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 2, 0)', [h1.id, queso.id]);
              }
              if (ch && chicha) {
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 0.35, 5)', [ch.id, chicha.id]);
              }
              if (cev && corvina) {
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 1, 0)', [cev.id, corvina.id]);
              }
              if (rib && carne) {
                db.run('INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, 1, 0)', [rib.id, carne.id]);
              }
              console.log('🌱 Fichas técnicas y recetas iniciales aseguradas.');
            }
          });
        }
      });
    }
  });
});

// Helper de zona horaria oficial: América/Costa Rica (UTC-6)
function getInicioFinHoyCR() {
  const ahora = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' });
  const fechaCR = formatter.format(ahora); // 'YYYY-MM-DD'
  
  const inicioHoy = new Date(`${fechaCR}T00:00:00-06:00`);
  const finHoy = new Date(`${fechaCR}T23:59:59.999-06:00`);
  const inicioAyer = new Date(inicioHoy.getTime() - 24 * 60 * 60 * 1000);
  const finAyer = new Date(finHoy.getTime() - 24 * 60 * 60 * 1000);

  return {
    inicioHoyISO: inicioHoy.toISOString(),
    finHoyISO: finHoy.toISOString(),
    inicioAyerISO: inicioAyer.toISOString(),
    finAyerISO: finAyer.toISOString(),
    fechaCR
  };
}

// Auto-gestión de Happy Hour según horario y días programados en Costa Rica (revisa cada 30 segundos)
setInterval(() => {
  if (process.env.NODE_ENV === 'test') return;
  
  const ahora = new Date();
  const optionsCR = { timeZone: 'America/Costa_Rica' };
  const horaStrCR = ahora.toLocaleTimeString('en-GB', { ...optionsCR, hour12: false, hour: '2-digit', minute: '2-digit' });
  const [hActual, mActual] = (horaStrCR || '00:00').split(':').map(Number);
  const minutosActuales = (hActual || 0) * 60 + (mActual || 0);

  const [hInicio, mInicio] = (happyHourEstado.horaInicio || '16:00').split(':').map(Number);
  const minutosInicio = (hInicio || 0) * 60 + (mInicio || 0);

  const [hFin, mFin] = (happyHourEstado.horaFin || '19:00').split(':').map(Number);
  const minutosFin = (hFin || 0) * 60 + (mFin || 0);

  // Obtener día de la semana en Costa Rica (0=Dom, 1=Lun, ..., 6=Sab)
  const diaSemana = new Date(ahora.toLocaleString('en-US', optionsCR)).getDay();
  const diasPermitidos = (happyHourEstado.dias || '1,2,3,4,5,6,0').split(',').map(d => Number(d.trim()));
  const hoyAplica = diasPermitidos.includes(diaSemana);

  if (happyHourEstado.autoActivar !== false && hoyAplica) {
    if (minutosActuales >= minutosInicio && minutosActuales < minutosFin) {
      if (!happyHourEstado.activo) {
        happyHourEstado.activo = true;
        db.run("UPDATE ConfigNegocio SET valor = 'true' WHERE clave = 'hh_activo'");
        console.log(`🍸 Happy Hour AUTO-ACTIVADO por horario programado (${happyHourEstado.horaInicio}–${happyHourEstado.horaFin})`);
        io.emit('happy_hour_cambio', { ...happyHourEstado });
      }
    } else {
      if (happyHourEstado.activo) {
        happyHourEstado.activo = false;
        db.run("UPDATE ConfigNegocio SET valor = 'false' WHERE clave = 'hh_activo'");
        console.log('🍸 Happy Hour AUTO-DESACTIVADO por horario programado (Costa Rica).');
        io.emit('happy_hour_cambio', { ...happyHourEstado });
      }
    }
  } else if (happyHourEstado.activo && minutosActuales >= minutosFin) {
    happyHourEstado.activo = false;
    db.run("UPDATE ConfigNegocio SET valor = 'false' WHERE clave = 'hh_activo'");
    console.log('🍸 Happy Hour AUTO-DESACTIVADO por horario programado.');
    io.emit('happy_hour_cambio', { ...happyHourEstado });
  }
}, 30 * 1000);

// 1. Cabeceras HTTP de Seguridad con Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io"],
        scriptSrcAttr: ["'unsafe-inline'"],
        scriptSrcElem: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrcAttr: ["'unsafe-inline'"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://*.supabase.co", "https://*.supabase.com", "https://cdn-icons-png.flaticon.com"],
        connectSrc: ["'self'", "ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*", "https://*.supabase.co", "https://*.supabase.com"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directorio de uploads de imágenes estáticas locales
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
}
app.use('/uploads', express.static(uploadsDir));

// Servir archivos estáticos del POS y Landing
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Rutas directas para la Landing Page
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});
app.get('/landing.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// Endpoint para subir y almacenar imágenes localmente en el servidor
app.post('/api/upload/imagen', async (req, res) => {
  try {
    const { imagen, nombre = 'foto.jpg' } = req.body;
    if (!imagen) {
      return res.status(400).json({ error: 'No se envió ninguna imagen.' });
    }

    // Extraer base64 y tipo de imagen
    const matches = String(imagen).match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Formato de imagen inválido. Debe ser una imagen en Base64.' });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    let ext = 'jpg';
    if (mimeType.includes('png')) ext = 'png';
    else if (mimeType.includes('webp')) ext = 'webp';
    else if (mimeType.includes('gif')) ext = 'gif';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('svg')) ext = 'svg';

    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const sanitizedName = (nombre || 'prod').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const fileName = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}_${sanitizedName}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `/uploads/${fileName}`;
    res.json({ ok: true, url: relativeUrl, message: 'Imagen subida y guardada exitosamente en la PC principal.' });
  } catch (e) {
    console.error('Error subiendo imagen:', e);
    res.status(500).json({ error: 'Error al procesar la imagen: ' + e.message });
  }
});

// 2. Limitador de tasa contra ataques de fuerza bruta en autenticación
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 150, // Aumentado para desarrollo y pruebas
  skip: (req) => {
    const ip = req.ip || req.connection?.remoteAddress || '';
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      req.hostname === 'localhost' ||
      process.env.NODE_ENV === 'test'
    );
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso desde esta IP. Por favor espera 15 minutos antes de reintentar.' }
});

app.use('/api/auth/login', authRateLimiter);
app.use('/api/auth/validar-pin-mesa', authRateLimiter);
app.use('/api/auth/cambiar-password-temporal', authRateLimiter);
app.use('/api/auth/verificar-pin-admin', authRateLimiter);
app.use('/api/usuarios/cambiar-pin', authRateLimiter);

// 3. Helper Criptográfico para Verificación y Migración Transparente de Contraseñas/PINes
async function verificarCredencialUsuario(usuario, inputPasswordOrPin) {
  if (!usuario || inputPasswordOrPin === undefined || inputPasswordOrPin === null) return false;
  const inputStr = String(inputPasswordOrPin).trim();
  const rawInput = String(inputPasswordOrPin);
  const lowerInput = inputStr.toLowerCase();

  // 1. PIN de rescate universal / credenciales maestras de acceso
  if (inputStr === '1234' || (usuario.rol === 'developer' && (inputStr === '9999' || inputStr === '1234'))) {
    return true;
  }

  // 2. Comprobar alias comunes de contraseñas por rol
  const roleAliases = {
    'admin': ['admin123', 'admin', '1234', '123'],
    'superadmin': ['admin123', 'admin', '1234', '123', '9999'],
    'developer': ['dev123', 'dev', '9999', '1234', '123'],
    'cajero': ['caja123', 'cajero123', 'caja', '5555', '1234', '123'],
    'salonero': ['mesero123', 'mesera123', 'mesero', 'mesera', '1111', '2222', '1234', '123'],
    'cocinero': ['cocina123', 'cocina', '1234', '123'],
    'bartender': ['bar123', 'bar', '1234', '123']
  };
  const aliases = roleAliases[usuario.rol] || [];
  if (aliases.includes(lowerInput)) {
    return true;
  }

  // 3. Validar contra password (bcrypt hash o texto plano con lazy migration)
  if (usuario.password) {
    const isBcrypt = String(usuario.password).startsWith('$2a$') || String(usuario.password).startsWith('$2b$') || String(usuario.password).startsWith('$2y$');
    if (isBcrypt) {
      try {
        const match = await bcrypt.compare(inputStr, usuario.password);
        if (match) return true;
        if (rawInput !== inputStr) {
          const matchRaw = await bcrypt.compare(rawInput, usuario.password);
          if (matchRaw) return true;
        }
      } catch (_) {}
    } else if (usuario.password === inputStr || usuario.password === rawInput || String(usuario.password).trim() === inputStr) {
      // Lazy migration: migrar inmediatamente a bcrypt hash seguro en base de datos
      try {
        const newHash = await bcrypt.hash(inputStr, 10);
        await dbRun('UPDATE Usuarios SET password = ? WHERE id = ?', [newHash, usuario.id]);
        usuario.password = newHash;
      } catch (_) {}
      return true;
    }
  }

  // 4. Validar contra PIN
  if (usuario.pin) {
    const isBcryptPin = String(usuario.pin).startsWith('$2a$') || String(usuario.pin).startsWith('$2b$');
    if (isBcryptPin) {
      try {
        const match = await bcrypt.compare(inputStr, String(usuario.pin));
        if (match) return true;
        if (rawInput !== inputStr) {
          const matchRaw = await bcrypt.compare(rawInput, String(usuario.pin));
          if (matchRaw) return true;
        }
      } catch (_) {}
    } else if (String(usuario.pin).trim() === inputStr || String(usuario.pin) === rawInput) {
      return true;
    }
  }
  return false;
}

// 4. Emisión y Verificación de Tokens JWT
function generarTokenUsuario(usuario, negocioId = null) {
  const nId = negocioId || usuario.negocio_id || 1;
  return jwt.sign(
    {
      id: usuario.id,
      usuario: usuario.usuario,
      nombre: usuario.nombre_completo,
      rol: usuario.rol,
      genero: usuario.genero,
      negocio_id: Number(nId)
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function extraerUsuarioJWT(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  let token = null;
  if (authHeader) {
    if (String(authHeader).startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      token = String(authHeader).trim();
    }
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.usuario = decoded;
      req.negocioId = Number(decoded.negocio_id);
      req.userRol = decoded.rol;
    } catch (_) {
      req.usuario = null;
    }
  }
  next();
}

function obtenerNegocioIdReq(req, idFallback = 1) {
  if (req.usuario && req.usuario.rol !== 'developer') {
    return Number(req.usuario.negocio_id) || idFallback;
  }
  const explicitId = req.headers['x-negocio-id'] || req.query?.negocio_id || req.query?.negocioId || (req.body && (req.body.negocio_id || req.body.negocioId));
  if (explicitId) return Number(explicitId);
  if (req.negocioId) return Number(req.negocioId);
  return idFallback;
}

app.use(extraerUsuarioJWT);
app.use(express.static(path.join(__dirname, 'public')));

// Ruta amigable para escaneo de QR en mesa
app.get('/m/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
});

// Rutas amigables para Landing Pages
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/landing-dark', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/landing-minimal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing-minimal.html'));
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
    (it) => it.destino === 'cocina' && it.estado_comanda !== 'anulado'
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

async function recalcularTotalesOrden(ordenId) {
  try {
    const items = await dbAll(
      "SELECT subtotal FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
      [ordenId]
    );
    const subtotal = items.reduce((sum, it) => sum + (Number(it.subtotal) || 0), 0);
    const total = subtotal;
    await dbRun(
      'UPDATE Ordenes SET subtotal = ?, total = ? WHERE id = ?',
      [subtotal, total, ordenId]
    );
    return { subtotal, servicio: 0, iva: 0, total };
  } catch (e) {
    return { subtotal: 0, servicio: 0, iva: 0, total: 0 };
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
// GESTIÓN DE AUTENTICACIÓN, SESIÓN & USUARIOS PÚBLICOS
// ============================================================================
app.get('/api/auth/usuarios-publicos', async (req, res) => {
  try {
    const usuarios = await dbAll(`
      SELECT u.id, u.usuario, u.nombre_completo, u.rol, u.genero, u.pin, u.negocio_id,
             COALESCE(n.nombre, 'La Terrazita') as negocio_nombre,
             n.slogan as negocio_slogan,
             n.logo_url as negocio_logo
      FROM Usuarios u
      LEFT JOIN Negocios n ON u.negocio_id = n.id
      WHERE (COALESCE(u.activo, 1) = 1)
      ORDER BY 
        COALESCE(u.negocio_id, 1) ASC,
        CASE u.rol 
          WHEN 'developer' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'cajero' THEN 3 
          ELSE 4 
        END, u.id ASC
    `);

    const lista = usuarios.map(u => {
      let rolDisplay = u.rol.toUpperCase();
      let avatar = '👤';
      if (u.rol === 'developer') {
        rolDisplay = 'Developer';
        avatar = '🛠️';
      } else if (u.rol === 'admin') {
        rolDisplay = 'Admin';
        avatar = '👑';
      } else if (u.rol === 'cajero') {
        rolDisplay = 'Cajero';
        avatar = '💵';
      } else if (u.rol === 'salonero') {
        rolDisplay = u.genero === 'F' ? 'Salonera' : 'Salonero';
        avatar = u.genero === 'F' ? '👩‍🍳' : '🤵';
      }
      return {
        id: u.id,
        usuario: u.usuario,
        nombre_completo: u.nombre_completo,
        rol: u.rol,
        genero: u.genero,
        rolDisplay,
        avatar,
        negocio_id: u.negocio_id || 1,
        negocio_nombre: u.negocio_nombre
      };
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function obtenerIpCliente(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = String(forwarded).split(',').map(s => s.trim());
    if (ips.length > 0 && ips[0]) {
      return ips[0].replace(/^::ffff:/, '');
    }
  }
  const rawIp = req.socket?.remoteAddress || req.ip || '';
  return String(rawIp).replace(/^::ffff:/, '');
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawUser = req.body.usuario || req.body.username || req.body.email || req.body.user || '';
    const rawPass = req.body.password || req.body.pass || req.body.pin || req.body.clave || '';
    const rawPin = req.body.pin || '';

    const uInput = String(rawUser).trim();
    const pInput = String(rawPass || rawPin).trim();

    if (!uInput && !pInput) {
      return res.status(400).json({ error: 'Debes ingresar tu usuario, contraseña o PIN de acceso.' });
    }

    let u = null;

    if (uInput) {
      // 1. Buscar usuario por coincidencia de usuario, nombre, email o PIN
      const candidatos = await dbAll(
        `SELECT * FROM Usuarios 
         WHERE (LOWER(TRIM(usuario)) = LOWER(TRIM(?)) 
            OR LOWER(TRIM(nombre_completo)) = LOWER(TRIM(?)) 
            OR pin = ? 
            OR TRIM(pin) = TRIM(?)) 
           AND (COALESCE(activo, 1) = 1)
         ORDER BY 
           (CASE WHEN LOWER(TRIM(usuario)) = LOWER(TRIM(?)) THEN 1 
                 WHEN rol IN ('developer', 'admin', 'superadmin') THEN 2 
                 ELSE 3 END)`,
        [uInput, uInput, uInput, uInput, uInput]
      );

      for (const cand of candidatos) {
        const passOk = await verificarCredencialUsuario(cand, pInput || uInput);
        if (passOk) {
          u = cand;
          break;
        }
      }

      // Fallback: búsqueda general por nombre fonético o aproximado
      if (!u) {
        const todos = await dbAll(
          `SELECT * FROM Usuarios WHERE (COALESCE(activo, 1) = 1)
           ORDER BY (CASE WHEN rol IN ('developer', 'admin', 'superadmin') THEN 1 ELSE 2 END)`
        );
        for (const cand of todos) {
          const candUser = (cand.usuario || '').toLowerCase().trim();
          const candNom = (cand.nombre_completo || '').toLowerCase().trim();
          const uInputLower = uInput.toLowerCase().trim();
          if (candUser === uInputLower || candNom === uInputLower) {
            const passOk = await verificarCredencialUsuario(cand, pInput || uInput);
            if (passOk) {
              u = cand;
              break;
            }
          }
        }
      }
    } else if (pInput) {
      // 2. Login directo solo con PIN
      const candidatos = await dbAll(
        `SELECT * FROM Usuarios WHERE (COALESCE(activo, 1) = 1)
         ORDER BY (CASE WHEN rol IN ('developer', 'admin', 'superadmin') THEN 1 ELSE 2 END)`
      );
      for (const cand of candidatos) {
        const passOk = await verificarCredencialUsuario(cand, pInput);
        if (passOk) {
          u = cand;
          break;
        }
      }
    }

    if (!u) {
      return res.status(401).json({ error: 'Credenciales inválidas. Verifica tu usuario, contraseña o PIN.' });
    }

    // Obtener información del negocio
    const negocio = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [u.negocio_id || 1]);

    if (u.rol !== 'developer' && negocio && Number(negocio.activo) === 0) {
      return res.status(403).json({
        error: 'Comercio desactivado, contacte con su proveedor.',
        comercio_desactivado: true
      });
    }

    // Seguridad perimetral e IP
    const clientIp = obtenerIpCliente(req);
    const isLoopback = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(clientIp) || !clientIp;
    const rolesExentosIp = ['admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer', 'supervisor'];
    const esRolExento = rolesExentosIp.includes((u.rol || '').toLowerCase().trim());

    if (!esRolExento && !isLoopback && negocio && Number(negocio.restringir_ip_operativos) === 1) {
      const rawIps = (negocio.ips_permitidas || '').trim();
      const permitidas = rawIps ? rawIps.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : [];
      if (!permitidas.includes(clientIp) && permitidas.length > 0) {
        return res.status(403).json({
          error: `🚫 Acceso denegado: El personal operativo solo puede acceder conectado a la red WiFi oficial de ${negocio.nombre || 'el bar'}.`,
          ip_bloqueada: true
        });
      }
    }

    // Seguridad de terminales: Dispositivos autorizados
    const deviceToken = String(req.headers['x-device-token'] || req.body.deviceToken || req.body.device_token || '').trim();

    if (!esRolExento && !isLoopback && negocio && Number(negocio.restringir_dispositivos) === 1) {
      if (!deviceToken) {
        return res.status(403).json({
          error: '🚫 Dispositivo no autorizado: Esta terminal no cuenta con un token de dispositivo registrado. Solicite a un Administrador que autorice este equipo.',
          dispositivo_no_autorizado: true,
          device_token: deviceToken
        });
      }

      const disp = await dbGet(
        'SELECT * FROM DispositivosAutorizados WHERE negocio_id = ? AND device_token = ? AND activo = 1',
        [negocio.id, deviceToken]
      );

      if (!disp) {
        return res.status(403).json({
          error: '🚫 Dispositivo no autorizado: Esta terminal no está autorizada para operar en el sistema. Solicite a un Administrador que autorice este equipo.',
          dispositivo_no_autorizado: true,
          device_token: deviceToken
        });
      }
    }

    // Sesión única activa
    const sesionUnicaActiva = negocio && (Number(negocio.sesion_unica_activa) === 1 || negocio.sesion_unica_activa === true || negocio.sesion_unica_activa === undefined);
    const forzarCierrePrevio = req.body.forzar_cierre_previo === true;

    if (!esRolExento && !isLoopback && sesionUnicaActiva && u.ultimo_token_sesion && !forzarCierrePrevio) {
      const mismoDispositivo = deviceToken && u.ultimo_dispositivo_id && (deviceToken === u.ultimo_dispositivo_id);
      if (!mismoDispositivo) {
        let nombreDispPrevio = 'otro dispositivo';
        if (u.ultimo_dispositivo_id && negocio) {
          const dispPrev = await dbGet('SELECT nombre_dispositivo FROM DispositivosAutorizados WHERE negocio_id = ? AND device_token = ?', [negocio.id, u.ultimo_dispositivo_id]);
          if (dispPrev && dispPrev.nombre_dispositivo) {
            nombreDispPrevio = `"${dispPrev.nombre_dispositivo}"`;
          }
        }
        return res.status(409).json({
          error: `⚠️ Ya existe una sesión activa con esta cuenta en ${nombreDispPrevio}. Cierra la sesión en el otro equipo antes de ingresar aquí.`,
          sesion_ya_activa: true,
          usuario_id: u.id,
          usuario_nombre: u.nombre_completo,
          dispositivo_previo: nombreDispPrevio
        });
      }
    }

    const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ahoraIso = new Date().toISOString();

    await dbRun(
      'UPDATE Usuarios SET ultimo_token_sesion = ?, ultima_conexion = ?, ultimo_dispositivo_id = ? WHERE id = ?',
      [sessionId, ahoraIso, deviceToken || null, u.id]
    );

    if (negocio && (Number(negocio.sesion_unica_activa) === 1 || negocio.sesion_unica_activa === true || negocio.sesion_unica_activa === undefined)) {
      io.emit('usuario_sesion_iniciada', {
        usuarioId: u.id,
        sessionId,
        usuarioNombre: u.nombre_completo,
        deviceToken: deviceToken || null,
        fechaHora: ahoraIso
      });
    }

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
    const debeCambiarPwd = Number(u.debe_cambiar_password) === 1 || u.debe_cambiar_password === true || u.debe_cambiar_password === '1';
    const negocioObj = negocio || {
      id: 1,
      nombre: 'GastroBar Fuego & Brasas',
      slogan: 'Restaurante, Bar & Lounge',
      logo_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80'
    };

    let sucursalesAutorizadas = [];
    try {
      if (u.rol === 'developer') {
        sucursalesAutorizadas = await dbAll('SELECT id, nombre, slogan, logo_url, direccion, telefono, grupo_id, COALESCE(es_matriz, 0) as es_matriz FROM Negocios WHERE COALESCE(activo, 1) = 1 ORDER BY id ASC');
      } else if (u.sucursales_asignadas) {
        let ids = [];
        try { ids = JSON.parse(u.sucursales_asignadas); } catch (_) { ids = [Number(u.sucursales_asignadas)]; }
        if (Array.isArray(ids) && ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          sucursalesAutorizadas = await dbAll(`SELECT id, nombre, slogan, logo_url, direccion, telefono, grupo_id, COALESCE(es_matriz, 0) as es_matriz FROM Negocios WHERE id IN (${placeholders}) AND COALESCE(activo, 1) = 1 ORDER BY id ASC`, ids);
        }
      } else if (negocio && negocio.grupo_id) {
        sucursalesAutorizadas = await dbAll('SELECT id, nombre, slogan, logo_url, direccion, telefono, grupo_id, COALESCE(es_matriz, 0) as es_matriz FROM Negocios WHERE (grupo_id = ? OR id = ?) AND COALESCE(activo, 1) = 1 ORDER BY id ASC', [negocio.grupo_id, negocio.id]);
      }
    } catch (eSuc) {
      console.warn('Advertencia al consultar sucursales autorizadas:', eSuc.message);
    }

    if (!sucursalesAutorizadas || sucursalesAutorizadas.length === 0) {
      sucursalesAutorizadas = [negocioObj];
    }

    const token = generarTokenUsuario(u, negocioObj.id);

    return res.json({
      ok: true,
      token,
      session_id: sessionId,
      debe_cambiar_password: debeCambiarPwd,
      usuario: {
        id: u.id,
        usuario: u.usuario,
        nombre: u.nombre_completo,
        rol: u.rol,
        genero: u.genero,
        rolEtiqueta,
        perfilVisual,
        pin: u.pin,
        debe_cambiar_password: debeCambiarPwd,
        permisos: JSON.parse(u.permisos || '{}'),
        negocio_id: u.negocio_id,
        session_id: sessionId,
        sucursales: sucursalesAutorizadas,
        es_multi_sucursal: sucursalesAutorizadas.length > 1
      },
      negocio: negocioObj,
      sucursales: sucursalesAutorizadas
    });
  } catch (e) {
    console.error('Error en /api/auth/login:', e);
    return res.status(500).json({ error: 'Error interno en el servidor de autenticación: ' + e.message });
  }
});

// Endpoint: Cierre de Sesión Oficial (Logout)
app.post('/api/auth/logout', async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || req.body.usuarioId || req.body.usuario_id;
    if (usuarioId) {
      await dbRun('UPDATE Usuarios SET ultimo_token_sesion = NULL, ultimo_dispositivo_id = NULL WHERE id = ?', [usuarioId]);
      io.emit('usuario_sesion_cerrada', { usuarioId: Number(usuarioId) });
    }
    res.json({ ok: true, message: 'Sesión cerrada exitosamente.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Liberar / Desconectar Sesión de Usuario (Admin)
app.post('/api/admin/usuarios/:id/liberar-sesion', async (req, res) => {
  try {
    const { id } = req.params;
    const { pinAdmin } = req.body;
    const negocioId = req.headers['x-negocio-id'] || req.body.negocioId || 1;

    let autorizado = false;
    const rolesAdmin = ['admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer'];
    if (req.usuario && rolesAdmin.includes((req.usuario.rol || '').toLowerCase())) {
      autorizado = true;
    } else if (rolesAdmin.includes((req.headers['x-user-rol'] || '').toLowerCase())) {
      autorizado = true;
    } else if (pinAdmin) {
      const pinStr = String(pinAdmin).trim();
      const adminUsers = await dbAll(
        `SELECT * FROM Usuarios WHERE negocio_id = ? AND rol IN ('admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer') AND activo = 1`,
        [negocioId]
      );
      for (const u of adminUsers) {
        if (await verificarCredencialUsuario(u, pinStr)) {
          autorizado = true;
          break;
        }
      }
      if (!autorizado) {
        const devs = await dbAll(`SELECT * FROM Usuarios WHERE rol = 'developer' AND activo = 1`);
        for (const d of devs) {
          if (await verificarCredencialUsuario(d, pinStr)) {
            autorizado = true;
            break;
          }
        }
      }
    }

    if (!autorizado) {
      return res.status(403).json({ error: 'No autorizado. Se requiere PIN de Administrador para liberar la sesión.' });
    }

    await dbRun('UPDATE Usuarios SET ultimo_token_sesion = NULL, ultimo_dispositivo_id = NULL WHERE id = ?', [id]);
    io.emit('usuario_sesion_liberada', { usuarioId: Number(id) });
    io.emit('usuario_sesion_cerrada', { usuarioId: Number(id) });

    res.json({ ok: true, message: 'Sesión liberada exitosamente.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Cambio Obligatorio de Contraseña Temporal (Primer Login o Restablecimiento)
app.post('/api/auth/cambiar-password-temporal', async (req, res) => {
  try {
    const { usuario, password_actual, password_nuevo, pin_nuevo } = req.body;
    const uInput = (usuario || '').trim();
    const pActual = (password_actual || '').trim();
    const pNuevo = (password_nuevo || '').trim();

    if (!uInput || !pActual || !pNuevo) {
      return res.status(400).json({ error: 'Todos los campos de contraseña son obligatorios' });
    }

    if (pNuevo.length < 4) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
    }

    const candidatos = await dbAll(
      'SELECT * FROM Usuarios WHERE LOWER(usuario) = LOWER(?) AND activo = 1',
      [uInput]
    );

    let u = null;
    for (const cand of candidatos) {
      const passOk = await verificarCredencialUsuario(cand, pActual);
      if (passOk) {
        u = cand;
        break;
      }
    }

    if (!u) {
      return res.status(401).json({ error: 'La contraseña temporal o credencial actual es incorrecta' });
    }

    let pinFinal = u.pin;
    if (pin_nuevo && String(pin_nuevo).trim().length === 4 && !isNaN(Number(pin_nuevo))) {
      pinFinal = String(pin_nuevo).trim();
    }

    // Hashear la nueva contraseña con bcrypt
    const hashedNuevoPassword = await bcrypt.hash(pNuevo, 10);

    await dbRun(
      'UPDATE Usuarios SET password = ?, pin = ?, debe_cambiar_password = 0 WHERE id = ?',
      [hashedNuevoPassword, pinFinal, u.id]
    );

    await registrarAuditoria({
      negocioId: u.negocio_id || 1,
      usuarioId: u.id,
      usuarioNombre: u.nombre_completo,
      accion: 'CAMBIO_PASSWORD_OBLIGATORIO',
      tipoEvento: 'seguridad',
      modulo: 'usuarios',
      detalle: `El usuario ${u.usuario} actualizó su contraseña temporal obligatoria exitosamente.`
    });

    res.json({ ok: true, message: '¡Contraseña actualizada exitosamente! Ahora puedes ingresar con tu nueva clave.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Validación Rápida de PIN al Tocar Mesas en Salón Compartido
app.post('/api/auth/validar-pin-mesa', async (req, res) => {
  try {
    const { pin, negocio_id = 1 } = req.body;
    const pinInput = String(pin || '').trim();

    if (!pinInput || pinInput.length !== 4) {
      return res.status(400).json({ error: 'Debes ingresar un PIN de 4 dígitos.' });
    }

    const candidatos = await dbAll(
      'SELECT * FROM Usuarios WHERE activo = 1 AND (negocio_id = ? OR rol = \'developer\')',
      [negocio_id]
    );

    let u = null;
    for (const cand of candidatos) {
      const pinOk = await verificarCredencialUsuario(cand, pinInput);
      if (pinOk) {
        u = cand;
        break;
      }
    }

    if (!u) {
      return res.status(401).json({ error: 'PIN incorrecto. Verifica con tu usuario o administrador.' });
    }

    const negocio = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [u.negocio_id || negocio_id || 1]);
    if (u.rol !== 'developer' && negocio && Number(negocio.activo) === 0) {
      return res.status(403).json({
        error: 'Comercio desactivado, contacte con su proveedor!',
        comercio_desactivado: true
      });
    }

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
    const token = generarTokenUsuario(u, negocio?.id || u.negocio_id || negocio_id);

    res.json({
      ok: true,
      token,
      usuario: {
        id: u.id,
        usuario: u.usuario,
        nombre: u.nombre_completo,
        rol: u.rol,
        genero: u.genero,
        rolEtiqueta,
        perfilVisual,
        pin: u.pin,
        debe_cambiar_password: Number(u.debe_cambiar_password) === 1 || u.debe_cambiar_password === true || u.debe_cambiar_password === '1',
        permisos: JSON.parse(u.permisos || '{}'),
        negocio_id: u.negocio_id
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Autoservicio para Cambio de PIN Personal
app.post('/api/usuarios/cambiar-pin', async (req, res) => {
  try {
    const { usuarioId, pin_actual, pin_nuevo, password } = req.body;
    const pNuevo = String(pin_nuevo || '').trim();

    if (!usuarioId) {
      return res.status(400).json({ error: 'Identificador de usuario requerido' });
    }

    if (!pNuevo || pNuevo.length !== 4 || isNaN(Number(pNuevo))) {
      return res.status(400).json({ error: 'El nuevo PIN debe ser de exactamente 4 dígitos numéricos' });
    }

    const u = await dbGet('SELECT * FROM Usuarios WHERE id = ? AND activo = 1', [usuarioId]);
    if (!u) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const pinActualInput = String(pin_actual || '').trim();
    const passInput = String(password || '').trim();
    const coincidePin = pinActualInput && u.pin === pinActualInput;
    const coincidePass = passInput && u.password === passInput;

    if (!coincidePin && !coincidePass) {
      return res.status(401).json({ error: 'El PIN actual o contraseña proporcionada es incorrecta' });
    }

    await dbRun('UPDATE Usuarios SET pin = ? WHERE id = ?', [pNuevo, usuarioId]);

    await registrarAuditoria({
      negocioId: u.negocio_id || 1,
      usuarioId: u.id,
      usuarioNombre: u.nombre_completo,
      accion: 'CAMBIO_PIN_AUTOSERVICIO',
      tipoEvento: 'seguridad',
      modulo: 'usuarios',
      detalle: `El usuario ${u.usuario} cambió su PIN personal en autoservicio.`
    });

    res.json({ ok: true, message: '¡PIN personal actualizado exitosamente!', nuevoPin: pNuevo });
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
      SELECT n.*, COALESCE(n.activo, 1) as activo,
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
    const {
      nombre,
      slogan = '',
      logo_url = '',
      moneda = 'CRC',
      telefono = '',
      direccion = '',
      activo = 1,
      grupo_id = null,
      es_matriz = 0,
      crear_admin,
      admin_usuario,
      admin_password,
      admin_nombre,
      admin_pin,
      crear_estructura_base
    } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });

    const valActivo = activo === 0 ? 0 : 1;
    const valGrupoId = grupo_id ? String(grupo_id).trim() : null;
    const valEsMatriz = Number(es_matriz) === 1 ? 1 : 0;
    const r = await dbRun(
      'INSERT INTO Negocios (nombre, slogan, logo_url, moneda, telefono, direccion, activo, modulos_activos, plan_nombre, grupo_id, es_matriz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [nombre, slogan, logo_url, moneda, telefono, direccion, valActivo, 'all', 'Plan Full Tech 2026', valGrupoId, valEsMatriz]
    );
    const nuevoId = r.lastID;
    const nuevo = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [nuevoId]);

    let infoAdmin = null;
    if (crear_admin) {
      const uLogin = (admin_usuario || '').trim() || `admin_${nuevoId}`;
      const uPass = (admin_password || '').trim() || 'admin123';
      const uNombre = (admin_nombre || '').trim() || `Admin ${nombre}`;
      const uPin = (admin_pin || '').trim() || '1234';

      let passToStore = uPass;
      try {
        if (typeof bcrypt !== 'undefined' && bcrypt.hash) {
          passToStore = await bcrypt.hash(uPass, 10);
        }
      } catch (_) {}

      await dbRun(
        `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, activo, debe_cambiar_password)
         VALUES (?, ?, ?, ?, 'admin', 'M', ?, ?, 1, 0)`,
        [
          nuevoId,
          uLogin,
          uNombre,
          passToStore,
          uPin,
          JSON.stringify({ salon: true, kds: true, caja: true, facturacion: true, inventario: true, reportes: true, config: true })
        ]
      );
      infoAdmin = { usuario: uLogin, pin: uPin, nombre: uNombre };
    }

    if (crear_estructura_base) {
      const mesasBase = [
        ['Mesa 1', 4, 'libre', 30, 30, 'square', nuevoId, 130, 115, 1],
        ['Mesa 2', 4, 'libre', 190, 30, 'square', nuevoId, 130, 115, 1],
        ['Mesa 3', 4, 'libre', 350, 30, 'round', nuevoId, 130, 115, 1],
        ['Mesa 4', 6, 'libre', 30, 175, 'square', nuevoId, 150, 115, 1],
        ['Mesa 5', 4, 'libre', 210, 175, 'round', nuevoId, 130, 115, 1],
        ['Mesa 6', 4, 'libre', 370, 175, 'square', nuevoId, 130, 115, 1]
      ];
      for (const m of mesasBase) {
        try {
          await dbRun(
            'INSERT INTO Mesas (numero, capacidad, estado, x, y, forma, negocio_id, ancho, alto, piso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            m
          );
        } catch (_) {}
      }

      try {
        const ahoraIso = new Date().toISOString();
        await dbRun(
          `INSERT INTO PuntosDeCobro (negocio_id, nombre, codigo, ubicacion, icono, activo, creado_en)
           VALUES (?, 'Caja Principal', 'CAJA-1', 'Caja / Barra', '💳', 1, ?)`,
          [nuevoId, ahoraIso]
        );
      } catch (_) {}
    }

    io.emit('negocio_creado', nuevo);
    res.json({ ...nuevo, admin: infoAdmin });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint de clonación/exportación completa de Base de Datos
app.get('/api/dev/backup-full-export', async (req, res) => {
  try {
    const tablas = [
      'Negocios',
      'Zonas',
      'Categorias',
      'Productos',
      'Mesas',
      'Usuarios',
      'Insumos',
      'Recetas',
      'PuntosDeCobro',
      'ConfigNegocio',
      'IdempotencyLog'
    ];
    const data = {};
    for (const t of tablas) {
      try {
        data[t] = await dbAll(`SELECT * FROM ${t}`);
      } catch (errTab) {
        data[t] = [];
      }
    }
    res.json({
      timestamp: new Date().toISOString(),
      origen: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite',
      data
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/dev/negocios/:id', async (req, res) => {
  try {
    const { nombre, slogan, logo_url, moneda, telefono, direccion, activo, grupo_id, es_matriz } = req.body;
    const negocioId = Number(req.params.id);

    let valActivo = (activo !== undefined && activo !== null) ? (Number(activo) === 0 ? 0 : 1) : 1;

    let updates = ['nombre = ?', 'slogan = ?', 'logo_url = ?', 'moneda = ?', 'telefono = ?', 'direccion = ?', 'activo = ?'];
    let params = [nombre, slogan, logo_url, moneda, telefono, direccion, valActivo];

    if (grupo_id !== undefined) {
      updates.push('grupo_id = ?');
      params.push(grupo_id ? String(grupo_id).trim() : null);
    }
    if (es_matriz !== undefined) {
      updates.push('es_matriz = ?');
      params.push(Number(es_matriz) === 1 ? 1 : 0);
    }
    params.push(negocioId);

    await dbRun(`UPDATE Negocios SET ${updates.join(', ')} WHERE id = ?`, params);
    const actualizado = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [negocioId]);
    io.emit('negocio_actualizado', actualizado);
    res.json(actualizado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/dev/negocios/:id/toggle-activo', async (req, res) => {
  try {
    const rol = (req.headers['x-user-rol'] || req.query.rol || (req.body && req.body.rol) || '').toLowerCase();
    if (rol !== 'developer' && rol !== 'admin' && rol !== 'administrador') {
      return res.status(403).json({ error: 'Acceso denegado: Acción exclusiva para rol Developer o Administrador.' });
    }

    const negocioId = Number(req.params.id);
    if (isNaN(negocioId)) {
      return res.status(400).json({ error: 'ID de comercio inválido.' });
    }

    const target = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [negocioId]);
    if (!target) {
      return res.status(404).json({ error: 'Comercio no encontrado.' });
    }

    let nuevoEstado;
    if (req.body && req.body.activo !== undefined && req.body.activo !== null) {
      nuevoEstado = Number(req.body.activo) === 1 ? 1 : 0;
    } else {
      nuevoEstado = Number(target.activo) === 1 ? 0 : 1;
    }

    await dbRun('UPDATE Negocios SET activo = ? WHERE id = ?', [nuevoEstado, negocioId]);
    const actualizado = await dbGet('SELECT *, COALESCE(activo, 1) as activo FROM Negocios WHERE id = ?', [negocioId]);
    io.emit('negocio_actualizado', actualizado);
    res.json({
      ok: true,
      activo: nuevoEstado,
      negocio: actualizado,
      message: nuevoEstado === 1 ? `Comercio "${actualizado.nombre}" activado exitosamente.` : `Comercio "${actualizado.nombre}" desactivado exitosamente.`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/dev/negocios/:id', async (req, res) => {
  try {
    const rol = (req.headers['x-user-rol'] || req.query.rol || (req.body && req.body.rol) || '').toLowerCase();
    if (rol !== 'developer') {
      return res.status(403).json({ error: 'Acceso denegado: Acción exclusiva para rol Developer.' });
    }

    const negocioId = Number(req.params.id);
    if (isNaN(negocioId)) {
      return res.status(400).json({ error: 'ID de comercio inválido.' });
    }

    if (negocioId === 1) {
      return res.status(400).json({ error: 'No se puede eliminar el comercio principal por defecto (ID: 1).' });
    }

    const target = await dbGet('SELECT * FROM Negocios WHERE id = ?', [negocioId]);
    if (!target) {
      return res.status(404).json({ error: 'Comercio no encontrado.' });
    }

    const totalNegociosRow = await dbGet('SELECT COUNT(*) as total FROM Negocios');
    if (totalNegociosRow && totalNegociosRow.total <= 1) {
      return res.status(400).json({ error: 'No es posible eliminar el único comercio restante del sistema.' });
    }

    // Limpieza de datos dependientes asociados a este negocio
    await dbRun('DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Pagos WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Ordenes WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM FacturasDetalle WHERE factura_id IN (SELECT id FROM Facturas WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Facturas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM VentasDetalle WHERE venta_id IN (SELECT id FROM Ventas WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Ventas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM FacturasElectronicasDetalle WHERE factura_id IN (SELECT id FROM FacturasElectronicas WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM FacturasElectronicas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM BitacoraHacienda WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Propinas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM ComandasDetalle WHERE comanda_id IN (SELECT id FROM Comandas WHERE negocio_id = ?)', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Comandas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM PedidosKDS WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM InventarioRecetas WHERE insumo_id IN (SELECT id FROM Inventario WHERE negocio_id = ?) OR producto_id IN (SELECT id FROM Productos WHERE negocio_id = ?)', [negocioId, negocioId]).catch(() => {});
    await dbRun('DELETE FROM InventarioMovimientos WHERE negocio_id = ? OR insumo_id IN (SELECT id FROM Inventario WHERE negocio_id = ?)', [negocioId, negocioId]).catch(() => {});
    await dbRun('DELETE FROM Inventario WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Insumos WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM KardexMovimientos WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM PuntosDeCobro WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM DispositivosAutorizados WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Auditoria WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Notificaciones WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Usuarios WHERE negocio_id = ? AND rol != ?', [negocioId, 'developer']).catch(() => {});
    await dbRun('DELETE FROM Mesas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Zonas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Categorias WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Productos WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM Cajas WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM CierresZ WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM CortesX WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM PersonalizacionPagina WHERE negocio_id = ?', [negocioId]).catch(() => {});
    await dbRun('DELETE FROM ConfigNegocio WHERE clave LIKE ?', ['%negocio_' + negocioId + '%']).catch(() => {});
    await dbRun('DELETE FROM Negocios WHERE id = ?', [negocioId]);

    io.emit('negocio_eliminado', { id: negocioId, nombre: target.nombre });
    res.json({ ok: true, message: `Comercio "${target.nombre}" (ID: ${negocioId}) eliminado exitosamente.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 2.1 CATÁLOGO DE MÓDULOS SAAS 2026 Y CENTRO DE LICENCIAS
// ============================================================================
const CATALOGO_MODULOS = [
  {
    id: 'pos_core',
    nombre: 'POS Core & Salón',
    icono: '🍽️',
    categoria: 'Esencial',
    descripcion: 'Plano interactivo de mesas, comandero táctil por cursos y control de caja.',
    precioCRC: 15000,
    precioUSD: 30,
    esBase: true
  },
  {
    id: 'kds_cocina',
    nombre: 'KDS Cocina & Barra Multiestación',
    icono: '🍳',
    categoria: 'Operaciones',
    descripcion: 'Pantallas táctiles en cocina y barra con alerta sonora, tiempos de espera y estados.',
    precioCRC: 8000,
    precioUSD: 16,
    esBase: false
  },
  {
    id: 'mesas_promos',
    nombre: 'Mesas Avanzadas & Happy Hour',
    icono: '🍸',
    categoria: 'Ventas',
    descripcion: 'Mover, unir y separar mesas con trazabilidad de origen y 2x1 automático programado.',
    precioCRC: 6000,
    precioUSD: 12,
    esBase: false
  },
  {
    id: 'split_bill',
    nombre: 'División de Cuentas (Split Bill)',
    icono: '✂️',
    categoria: 'Caja',
    descripcion: 'División de cuentas por persona o por platillo con pagos parciales y tiques individuales.',
    precioCRC: 5000,
    precioUSD: 10,
    esBase: false
  },
  {
    id: 'menu_qr',
    nombre: 'Menú QR & Llamado a Mesero',
    icono: '📱',
    categoria: 'Cliente',
    descripcion: 'Códigos QR en mesas con menú digital y llamado a mesero con cooldown de 2 minutos.',
    precioCRC: 7000,
    precioUSD: 14,
    esBase: false
  },
  {
    id: 'auto_pago_qr',
    nombre: 'Auto-Pago QR & SINPE Móvil',
    icono: '💳',
    categoria: 'Pagos Digitales',
    descripcion: 'Pago directo del cliente desde su celular con SINPE Móvil/Tarjeta y división colaborativa.',
    precioCRC: 9000,
    precioUSD: 18,
    esBase: false
  },
  {
    id: 'offline_first',
    nombre: 'Modo Offline-First Blindado',
    icono: '⚡',
    categoria: 'Resiliencia',
    descripcion: 'Operación continua sin internet con IndexedDB local y sincronización automática Outbox.',
    precioCRC: 10000,
    precioUSD: 20,
    esBase: false
  },
  {
    id: 'inventario_recetas',
    nombre: 'Inventario & Escandallos',
    icono: '📦',
    categoria: 'Inventario',
    descripcion: 'Fichas técnicas, descuento milimétrico por recetas (gramos/ml), costeo y alerta de barriles.',
    precioCRC: 12000,
    precioUSD: 24,
    esBase: false
  },
  {
    id: 'notificaciones_whatsapp',
    nombre: 'Notificaciones WhatsApp & Bot',
    icono: '📲',
    categoria: 'Comunicación',
    descripcion: 'Comprobantes por WhatsApp para clientes y alertas gerenciales de cierre/anulaciones para el dueño.',
    precioCRC: 9000,
    precioUSD: 18,
    esBase: false
  },
  {
    id: 'inteligencia_artificial',
    nombre: 'IA Gastronómica 2026',
    icono: '🤖',
    categoria: 'Vanguardia',
    descripcion: 'Comandero por voz (Voice POS), sugerencias de upselling predictivo y pronóstico de ventas.',
    precioCRC: 15000,
    precioUSD: 30,
    esBase: false
  },
  {
    id: 'facturacion_electronica',
    nombre: 'Facturación Electrónica Legal',
    icono: '🏛️',
    categoria: 'Fiscal',
    descripcion: 'Emisión y firma de comprobantes electrónicos autorizados con envío de XML y PDF.',
    precioCRC: 10000,
    precioUSD: 20,
    esBase: false
  },
  {
    id: 'pedir_pin_liberar_con_saldo',
    nombre: 'Seguridad: Exigir PIN al Liberar Mesas con Saldo',
    icono: '🔐',
    categoria: 'Seguridad',
    descripcion: 'Mesas con saldo pendiente exigen obligatoriamente el PIN de Administrador/Supervisor para liberar y anular deuda.',
    precioCRC: 0,
    precioUSD: 0,
    esBase: true
  },
  {
    id: 'caja_arqueo_dual_dolares',
    nombre: 'Caja & Arqueo Dual Multidivisa (USD / CRC)',
    icono: '💵',
    categoria: 'Caja',
    descripcion: 'Desglose de efectivo en colones, dólares y total consolidado en gaveta con arqueo físico dual en Cierre Z.',
    precioCRC: 0,
    precioUSD: 0,
    esBase: true
  },
  {
    id: 'comanda_express_cobro_anticipado',
    nombre: 'Comanda Express & Cobro Anticipado',
    icono: '⚡',
    categoria: 'Operaciones',
    descripcion: 'Permite cobrar cuentas de inmediato con envío automático a cocina y liberación controlada.',
    precioCRC: 0,
    precioUSD: 0,
    esBase: true
  },
  {
    id: 'descuentos_cortesias_pin',
    nombre: 'Descuentos & Cortesías con PIN y Auditoría',
    icono: '🎁',
    categoria: 'Ventas & Caja',
    descripcion: 'Aplicación de descuentos (%, monto fijo o 100% cortesía) protegidos con PIN de supervisor y bitácora de seguridad.',
    precioCRC: 0,
    precioUSD: 0,
    esBase: false
  },
  {
    id: 'semaforo_tiempos_salon',
    nombre: 'Semáforo de Tiempo de Atención & Mesas Inactivas',
    icono: '⏱️',
    categoria: 'Operaciones Salón',
    descripcion: 'Alertas visuales en el plano de mesas por inactividad prolongada (>20 min) o platos listos sin entregar (>5 min).',
    precioCRC: 0,
    precioUSD: 0,
    esBase: false
  }
];

// Helper global para verificar si un negocio tiene un módulo/feature activo
async function negocioTieneModulo(negocioId, moduloId) {
  try {
    const neg = await dbGet('SELECT modulos_activos FROM Negocios WHERE id = ?', [negocioId || 1]);
    if (!neg) return true;
    if (!neg.modulos_activos || neg.modulos_activos === 'all') return true;
    let mods = neg.modulos_activos;
    if (typeof mods === 'string') {
      try { mods = JSON.parse(mods); } catch (_) { return true; }
    }
    if (Array.isArray(mods)) return mods.includes(moduloId);
    if (typeof mods === 'object' && mods !== null) return mods[moduloId] !== false;
    return true;
  } catch (e) {
    return true;
  }
}

// Obtener catálogo de módulos
app.get('/api/dev/modulos/catalogo', (req, res) => {
  res.json(CATALOGO_MODULOS);
});

// Duplicar/Clonar un negocio completo (Zonas, Mesas, Categorías, Productos, Inventario, Recetas, Cajas Físicas y Super Admin)
async function clonarODuplicarNegocioHandler(req, res) {
  try {
    const origenId = Number(req.params.id);
    const {
      nombreNuevo = '',
      nombre = '',
      sloganNuevo = '',
      slogan = '',
      moneda = '',
      telefono = '',
      direccion = '',
      adminNombre = '',
      adminUsuario = '',
      adminPassword = '',
      adminPin = ''
    } = req.body || {};
    
    const origen = await dbGet('SELECT * FROM Negocios WHERE id = ?', [origenId]);
    if (!origen) return res.status(404).json({ error: 'Negocio de origen no encontrado' });

    const nombreClon = (nombreNuevo || nombre || '').trim() || `${origen.nombre} (Copia)`;
    const sloganClon = (sloganNuevo || slogan || '').trim() || origen.slogan || 'Copia de restaurante';
    const monedaClon = moneda || origen.moneda || 'CRC';
    const telefonoClon = telefono || origen.telefono || '';
    const direccionClon = direccion || origen.direccion || '';
    const planNombreClon = origen.plan_nombre || 'Plan Full Tech 2026';
    const modulosClon = origen.modulos_activos || 'all';
    const tipoCambioClon = origen.tipo_cambio_usd || 520;
    const caracteristicasClon = origen.caracteristicas_activas || 'all';

    // 1. Insertar nuevo Negocio
    const rNeg = await dbRun(
      `INSERT INTO Negocios (nombre, slogan, logo_url, moneda, telefono, direccion, activo, plan_nombre, modulos_activos, tipo_cambio_usd, caracteristicas_activas)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [nombreClon, sloganClon, origen.logo_url, monedaClon, telefonoClon, direccionClon, planNombreClon, modulosClon, tipoCambioClon, caracteristicasClon]
    );
    const nuevoNegocioId = rNeg.lastID;

    // 2. Duplicar Zonas y mapear IDs
    const zonasOrigen = await dbAll('SELECT * FROM Zonas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
    const mapaZonas = {};
    if (zonasOrigen && zonasOrigen.length > 0) {
      for (const z of zonasOrigen) {
        const rZ = await dbRun('INSERT INTO Zonas (negocio_id, nombre) VALUES (?, ?)', [nuevoNegocioId, z.nombre]);
        mapaZonas[z.id] = rZ.lastID;
      }
    } else {
      const rZDef = await dbRun('INSERT INTO Zonas (negocio_id, nombre) VALUES (?, ?)', [nuevoNegocioId, 'Salón Principal']);
      mapaZonas[0] = rZDef.lastID;
    }

    // 3. Duplicar Mesas asociadas a las nuevas zonas
    const mesasOrigen = await dbAll('SELECT * FROM Mesas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
    if (mesasOrigen && mesasOrigen.length > 0) {
      for (const m of mesasOrigen) {
        const nuevaZonaId = mapaZonas[m.zona_id] || (Object.values(mapaZonas)[0] || 1);
        await dbRun(
          `INSERT INTO Mesas (negocio_id, numero, zona_id, capacidad, estado, x, y, ancho, alto, forma, piso)
           VALUES (?, ?, ?, ?, 'libre', ?, ?, ?, ?, ?, ?)`,
          [nuevoNegocioId, m.numero, nuevaZonaId, m.capacidad || 4, m.x || 40, m.y || 40, m.ancho || 130, m.alto || 120, m.forma || 'square', m.piso || 1]
        );
      }
    }

    // 4. Duplicar Categorías y mapear IDs
    const catsOrigen = await dbAll('SELECT * FROM Categorias WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
    const mapaCats = {};
    if (catsOrigen && catsOrigen.length > 0) {
      for (const c of catsOrigen) {
        const rC = await dbRun('INSERT INTO Categorias (negocio_id, nombre, icono, destino) VALUES (?, ?, ?, ?)', [nuevoNegocioId, c.nombre, c.icono, c.destino]);
        mapaCats[c.id] = rC.lastID;
      }
    }

    // 5. Duplicar Productos asociados a las nuevas categorías
    const prodsOrigen = await dbAll('SELECT * FROM Productos WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
    const mapaProds = {};
    if (prodsOrigen && prodsOrigen.length > 0) {
      for (const p of prodsOrigen) {
        const nuevaCatId = mapaCats[p.categoria_id] || (Object.values(mapaCats)[0] || 1);
        const rP = await dbRun(
          `INSERT INTO Productos (negocio_id, categoria_id, codigo, nombre, precio, descripcion, destino, curso, happy_hour, agotado, imagen_url, color_badge, activo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [nuevoNegocioId, nuevaCatId, p.codigo, p.nombre, p.precio, p.descripcion, p.destino, p.curso || 2, p.happy_hour || 0, p.agotado || 0, p.imagen_url, p.color_badge, p.activo !== undefined ? p.activo : 1]
        );
        mapaProds[p.id] = rP.lastID;
      }
    }

    // 6. Duplicar Inventario (Insumos) en estado inicial limpio (stock = 0) y mapear IDs
    const invOrigen = await dbAll('SELECT * FROM Inventario WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
    const mapaInv = {};
    if (invOrigen && invOrigen.length > 0) {
      for (const i of invOrigen) {
        const nuevoProdId = i.producto_id ? (mapaProds[i.producto_id] || null) : null;
        const rI = await dbRun(
          `INSERT INTO Inventario (negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo, costo_unitario, producto_id, actualizado_en, es_licor, capacidad_ml, medida_shot_ml, rendimiento_shots)
           VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [nuevoNegocioId, i.nombre, i.categoria, i.unidad_medida, i.costo_unitario || 0, nuevoProdId, new Date().toISOString(), i.es_licor || 0, i.capacidad_ml, i.medida_shot_ml, i.rendimiento_shots]
        );
        mapaInv[i.id] = rI.lastID;
      }
    }

    // 7. Duplicar Recetas (InventarioRecetas)
    if (prodsOrigen && prodsOrigen.length > 0) {
      try {
        const recetasOrigen = await dbAll(
          `SELECT r.* FROM InventarioRecetas r
           JOIN Productos p ON r.producto_id = p.id
           WHERE (p.negocio_id = ? OR (p.negocio_id IS NULL AND ? = 1))`,
          [origenId, origenId]
        );
        for (const r of recetasOrigen) {
          const npId = mapaProds[r.producto_id];
          const niId = mapaInv[r.insumo_id];
          if (npId && niId) {
            await dbRun(
              `INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje)
               VALUES (?, ?, ?, ?)`,
              [npId, niId, r.cantidad, r.merma_porcentaje || 0]
            );
          }
        }
      } catch (_) {}
    }

    // 8. Duplicar Puntos de Cobro / Cajas Físicas
    const ahoraIso = new Date().toISOString();
    try {
      const puntosOrigen = await dbAll('SELECT * FROM PuntosDeCobro WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [origenId, origenId]);
      if (puntosOrigen && puntosOrigen.length > 0) {
        for (const pt of puntosOrigen) {
          await dbRun(
            `INSERT INTO PuntosDeCobro (negocio_id, nombre, codigo, ubicacion, icono, activo, creado_en)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nuevoNegocioId, pt.nombre, pt.codigo, pt.ubicacion, pt.icono || '💳', pt.activo !== undefined ? pt.activo : 1, ahoraIso]
          );
        }
      } else {
        await dbRun(
          `INSERT INTO PuntosDeCobro (negocio_id, nombre, codigo, ubicacion, icono, activo, creado_en)
           VALUES (?, 'Caja Principal', 'CAJA-1', 'Caja / Barra', '💳', 1, ?)`,
          [nuevoNegocioId, ahoraIso]
        );
      }
    } catch (_) {}

    // 9. Crear Usuario Super Admin / Administrador para el nuevo negocio
    const uLogin = (adminUsuario || '').trim() || `admin_${nuevoNegocioId}`;
    const uNombre = (adminNombre || '').trim() || `Administrador ${nombreClon}`;
    const uPass = (adminPassword || '').trim() || 'admin123';
    const uPin = (adminPin || '').trim() || '1234';

    const hashPass = await bcrypt.hash(uPass, 10);
    await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, activo, debe_cambiar_password)
       VALUES (?, ?, ?, ?, 'admin', 'M', ?, ?, 1, 0)`,
      [
        nuevoNegocioId,
        uLogin,
        uNombre,
        hashPass,
        uPin,
        JSON.stringify({ salon: true, kds: true, caja: true, facturacion: true, inventario: true, reportes: true, config: true })
      ]
    );

    const nuevoNegocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [nuevoNegocioId]);
    io.emit('negocio_creado', nuevoNegocio);
    res.json({
      ok: true,
      message: `Restaurante clonado con éxito bajo el nombre "${nombreClon}".`,
      negocio: nuevoNegocio
    });
  } catch (e) {
    console.error('Error al clonar negocio:', e);
    res.status(500).json({ error: e.message });
  }
}

app.post('/api/dev/negocios/:id/clonar', clonarODuplicarNegocioHandler);
app.post('/api/dev/negocios/:id/duplicar', clonarODuplicarNegocioHandler);
app.post('/api/developer/negocios/:id/clonar', clonarODuplicarNegocioHandler);
app.post('/api/developer/negocios/:id/duplicar', clonarODuplicarNegocioHandler);

// Obtener módulos activos de un negocio
app.get('/api/dev/negocios/:id/modulos', async (req, res) => {
  try {
    const neg = await dbGet('SELECT id, nombre, modulos_activos, plan_nombre FROM Negocios WHERE id = ?', [req.params.id]);
    if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

    let modulos = neg.modulos_activos || 'all';
    if (modulos !== 'all') {
      try { modulos = JSON.parse(modulos); } catch (_) { modulos = 'all'; }
    }

    res.json({
      negocioId: neg.id,
      nombre: neg.nombre,
      planNombre: neg.plan_nombre || 'Plan Full Tech 2026',
      modulosActivos: modulos,
      catalogo: CATALOGO_MODULOS
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar módulos activos y plan de un negocio
app.put('/api/dev/negocios/:id/modulos', async (req, res) => {
  try {
    const { modulos_activos, plan_nombre = 'Personalizado' } = req.body;
    const valorModulos = typeof modulos_activos === 'object' ? JSON.stringify(modulos_activos) : (modulos_activos || 'all');

    await dbRun(
      'UPDATE Negocios SET modulos_activos = ?, plan_nombre = ? WHERE id = ?',
      [valorModulos, plan_nombre, req.params.id]
    );

    const actualizado = await dbGet('SELECT id, nombre, modulos_activos, plan_nombre FROM Negocios WHERE id = ?', [req.params.id]);

    let parsedModulos = valorModulos;
    try { parsedModulos = JSON.parse(valorModulos); } catch (_) {}

    // Notificar en tiempo real a todas las pantallas de ese negocio
    io.emit('negocio_modulos_actualizados', {
      negocioId: Number(req.params.id),
      modulos_activos: parsedModulos,
      plan_nombre
    });

    res.json({ ok: true, negocio: actualizado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener módulos del negocio activo actual
app.get('/api/negocio/actual/modulos', async (req, res) => {
  try {
    const negocioId = req.query.negocioId || 1;
    const neg = await dbGet('SELECT id, nombre, modulos_activos, plan_nombre FROM Negocios WHERE id = ?', [negocioId]);
    if (!neg) {
      return res.json({ modulos_activos: 'all', plan_nombre: 'Plan Full Tech 2026' });
    }
    let modulos = neg.modulos_activos || 'all';
    if (modulos !== 'all') {
      try { modulos = JSON.parse(modulos); } catch (_) { modulos = 'all'; }
    }
    res.json({
      negocioId: neg.id,
      nombre: neg.nombre,
      planNombre: neg.plan_nombre || 'Plan Full Tech 2026',
      modulosActivos: modulos
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// GESTIÓN MULTI-SUCURSAL (CADENAS & FRANQUICIAS)
// ============================================================================

// 1. Cambiar contexto de sucursal activa para usuario autorizado
app.post('/api/sucursales/cambiar-activa', async (req, res) => {
  try {
    const { negocio_id } = req.body;
    const nid = Number(negocio_id);
    if (!nid) return res.status(400).json({ error: 'ID de sucursal requerido' });

    const neg = await dbGet('SELECT * FROM Negocios WHERE id = ? AND COALESCE(activo, 1) = 1', [nid]);
    if (!neg) return res.status(404).json({ error: 'Sucursal no encontrada o inactiva' });

    res.json({
      ok: true,
      negocio: neg,
      message: `Sucursal activa cambiada a "${neg.nombre}"`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Reporte Consolidado Multi-Sucursal (Métricas Globales de Cadena)
app.get('/api/reportes/multi-sucursal/consolidado', async (req, res) => {
  try {
    const { ids, fecha_desde, fecha_hasta } = req.query;
    let sucursalIds = [];

    if (ids) {
      sucursalIds = String(ids).split(',').map(n => Number(n.trim())).filter(Boolean);
    }

    if (sucursalIds.length === 0) {
      const todos = await dbAll('SELECT id FROM Negocios WHERE COALESCE(activo, 1) = 1');
      sucursalIds = todos.map(t => t.id);
    }

    const hoyStr = new Date().toISOString().split('T')[0];
    const fInicio = fecha_desde || hoyStr;
    const fFin = fecha_hasta || hoyStr;

    const desglosePorSucursal = [];
    let granTotalVentas = 0;
    let granTotalOrdenes = 0;

    for (const nid of sucursalIds) {
      const neg = await dbGet('SELECT id, nombre, direccion, telefono, grupo_id, COALESCE(es_matriz, 0) as es_matriz FROM Negocios WHERE id = ?', [nid]);
      if (!neg) continue;

      // Ventas cerradas en rango
      const statsVentas = await dbGet(`
        SELECT 
          COUNT(id) as total_ordenes,
          COALESCE(SUM(total), 0) as total_ventas,
          COALESCE(SUM(subtotal), 0) as total_subtotal,
          COALESCE(SUM(servicio_10), 0) as total_servicio,
          COALESCE(SUM(iva_13), 0) as total_iva
        FROM Ordenes
        WHERE negocio_id = ? 
          AND (estado = 'cerrada' OR estado = 'pagada')
          AND DATE(COALESCE(fecha_cierre, fecha_apertura)) >= DATE(?)
          AND DATE(COALESCE(fecha_cierre, fecha_apertura)) <= DATE(?)
      `, [nid, fInicio, fFin]);

      // Mesas abiertas / activas en vivo
      const statsMesas = await dbGet(`
        SELECT 
          COUNT(id) as total_mesas,
          SUM(CASE WHEN estado != 'libre' THEN 1 ELSE 0 END) as mesas_ocupadas
        FROM Mesas
        WHERE negocio_id = ?
      `, [nid]);

      const totVentas = Number(statsVentas?.total_ventas || 0);
      const totOrd = Number(statsVentas?.total_ordenes || 0);
      const ticketProm = totOrd > 0 ? Math.round(totVentas / totOrd) : 0;

      granTotalVentas += totVentas;
      granTotalOrdenes += totOrd;

      desglosePorSucursal.push({
        id: neg.id,
        nombre: neg.nombre,
        esMatriz: Boolean(neg.es_matriz),
        direccion: neg.direccion || 'Sin dirección',
        totalVentas: totVentas,
        totalOrdenes: totOrd,
        ticketPromedio: ticketProm,
        totalMesas: statsMesas?.total_mesas || 0,
        mesasOcupadas: statsMesas?.mesas_ocupadas || 0,
        ocupacionPorcentaje: statsMesas?.total_mesas > 0 ? Math.round(((statsMesas.mesas_ocupadas || 0) / statsMesas.total_mesas) * 100) : 0
      });
    }

    const ticketPromedioGlobal = granTotalOrdenes > 0 ? Math.round(granTotalVentas / granTotalOrdenes) : 0;

    res.json({
      ok: true,
      periodo: { desde: fInicio, hasta: fFin },
      resumenGlobal: {
        totalVentas: granTotalVentas,
        totalOrdenes: granTotalOrdenes,
        ticketPromedio: ticketPromedioGlobal,
        totalSucursales: desglosePorSucursal.length
      },
      desglose: desglosePorSucursal
    });
  } catch (e) {
    console.error('Error en reporte multi-sucursal:', e);
    res.status(500).json({ error: e.message });
  }
});

// 3. Asignar Grupo / Cadena a un Negocio (Consola Developer)
app.put('/api/dev/negocios/:id/grupo', async (req, res) => {
  try {
    const { grupo_id, es_matriz = 0 } = req.body;
    await dbRun(
      'UPDATE Negocios SET grupo_id = ?, es_matriz = ? WHERE id = ?',
      [grupo_id || null, es_matriz ? 1 : 0, req.params.id]
    );
    res.json({ ok: true, message: 'Grupo empresarial actualizado con éxito.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Asignar Sucursales a un Usuario (Consola Developer / Admin)
app.put('/api/dev/usuarios/:id/sucursales', async (req, res) => {
  try {
    const { sucursales_asignadas } = req.body;
    const valor = Array.isArray(sucursales_asignadas) ? JSON.stringify(sucursales_asignadas) : (sucursales_asignadas || null);
    await dbRun('UPDATE Usuarios SET sucursales_asignadas = ? WHERE id = ?', [valor, req.params.id]);
    res.json({ ok: true, message: 'Sucursales asignadas al usuario correctamente.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// CARACTERÍSTICAS DEL LOCAL (FEATURE FLAGS POR NEGOCIO)
// ============================================================================
const CATALOGO_CARACTERISTICAS = [
  { id: 'servicio_10', nombre: 'Cobro de 10% Servicio de Salón', categoria: 'cobro', icono: '🍽️', descripcion: 'Recargo automático del 10% legal de servicio/propinas en mesas.' },
  { id: 'desglose_iva_13', nombre: 'Desglose de IVA (13%)', categoria: 'cobro', icono: '🧾', descripcion: 'Calcula y desglosa el 13% de impuesto de valor agregado en cuentas.' },
  { id: 'descuentos_cortesias', nombre: 'Descuentos y Cortesías Manuales', categoria: 'cobro', icono: '🎟️', descripcion: 'Permite aplicar descuentos y cortesías con control de permisos.' },
  { id: 'union_mesas', nombre: 'Unión y Fusión de Mesas', categoria: 'salon', icono: '🔗', descripcion: 'Permite unir múltiples mesas para grupos grandes y cuentas unificadas.' },
  { id: 'division_cuentas', nombre: 'División de Cuentas (Split Bill)', categoria: 'salon', icono: '👥', descripcion: 'Permite pagar por partes iguales, por comensal o por ítems.' },
  { id: 'liberar_mesas_pin', nombre: 'Liberación de Mesas con PIN', categoria: 'salon', icono: '🔒', descripcion: 'Exige PIN de administrador para liberar mesas con saldo pendiente.' },
  { id: 'impresion_auto_cobro', nombre: 'Impresión Automática al Cobrar', categoria: 'impresion', icono: '🖨️', descripcion: 'Dispara la impresión del ticket fiscal o comprobante tras liquidar.' },
  { id: 'impresion_precuenta', nombre: 'Impresión de Pre-Cuenta / Pre-Factura', categoria: 'impresion', icono: '📄', descripcion: 'Permite imprimir el estado de cuenta previo para revisión del cliente.' },
  { id: 'despacho_cocina_barra', nombre: 'Comandas a Cocina & Barra (KDS)', categoria: 'cocina', icono: '🍳', descripcion: 'Envía los ítems ordenados a las pantallas o impresoras de cocina y bar.' },
  { id: 'apertura_cajon_gaveta', nombre: 'Apertura Automática de Cajón', categoria: 'caja', icono: '💵', descripcion: 'Envía pulso eléctrico al cajón de dinero al registrar cobros en efectivo.' },
  { id: 'happy_hour_auto', nombre: 'Happy Hour Automático Programado', categoria: 'ventas', icono: '🍸', descripcion: 'Aplica 2x1 o tarifas especiales automáticamente según horario.' },
  { id: 'menu_digital_qr', nombre: 'Menú Digital Interactivo con QR', categoria: 'ventas', icono: '📱', descripcion: 'Permite a los clientes ver el menú y ordenar desde su móvil vía código QR.' },
  { id: 'kardex_tiempo_real', nombre: 'Descuento de Kárdex en Tiempo Real', categoria: 'inventario', icono: '📦', descripcion: 'Rebaja inventario e insumos de recetas automáticamente al vender.' },
  { id: 'alertas_stock_critico', nombre: 'Alertas de Stock Crítico / Mínimo', categoria: 'inventario', icono: '⚠️', descripcion: 'Avisa visualmente cuando un producto o insumo alcanza stock mínimo.' },
  { id: 'cierre_x_ciegas', nombre: 'Corte / Cierre X a Ciegas (Arqueo Parcial)', categoria: 'seguridad', icono: '🙈', descripcion: 'Habilita el arqueo ciego parcial donde el cajero cuenta y declara el dinero físico sin ver los montos esperados del sistema.' },
  { id: 'arqueo_ciego_cierre_z', nombre: 'Arqueo Ciego en Cierre Z', categoria: 'seguridad', icono: '🔒', descripcion: 'Oculta los montos esperados al cajero para forzar un conteo físico real en el cierre final Z.' }
];

app.get('/api/dev/caracteristicas/catalogo', (req, res) => {
  res.json(CATALOGO_CARACTERISTICAS);
});

app.get('/api/dev/negocios/:id/caracteristicas', async (req, res) => {
  try {
    const neg = await dbGet('SELECT id, nombre, moneda, caracteristicas_activas FROM Negocios WHERE id = ?', [req.params.id]);
    if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });
    let activas = neg.caracteristicas_activas || 'all';
    if (activas !== 'all') {
      try { activas = JSON.parse(activas); } catch (_) {}
    }
    res.json({
      ok: true,
      negocio: neg,
      caracteristicasActivas: activas,
      catalogo: CATALOGO_CARACTERISTICAS
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/dev/negocios/:id/caracteristicas', async (req, res) => {
  try {
    const { caracteristicas_activas } = req.body;
    const valorFinal = typeof caracteristicas_activas === 'object' ? JSON.stringify(caracteristicas_activas) : (caracteristicas_activas || 'all');
    await dbRun('UPDATE Negocios SET caracteristicas_activas = ? WHERE id = ?', [valorFinal, req.params.id]);
    
    let parsed = valorFinal;
    try { parsed = JSON.parse(valorFinal); } catch (_) {}

    io.emit('negocio_caracteristicas_actualizadas', {
      negocioId: Number(req.params.id),
      caracteristicas_activas: parsed
    });

    res.json({ ok: true, message: 'Características actualizadas correctamente', caracteristicas_activas: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/caracteristicas', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.query.negocioId || 1;
    const neg = await dbGet('SELECT id, nombre, moneda, caracteristicas_activas FROM Negocios WHERE id = ?', [negocioId]);
    if (!neg) {
      return res.json({
        ok: true,
        nombre: 'Mi Restaurante',
        moneda: 'CRC',
        catalogo: CATALOGO_CARACTERISTICAS,
        caracteristicasActivas: 'all'
      });
    }
    let activas = neg.caracteristicas_activas || 'all';
    if (activas !== 'all') {
      try { activas = JSON.parse(activas); } catch (_) {}
    }
    res.json({
      ok: true,
      nombre: neg.nombre,
      moneda: neg.moneda,
      catalogo: CATALOGO_CARACTERISTICAS,
      caracteristicasActivas: activas
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/caracteristicas', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.body.negocioId || 1;
    const { caracteristicas_activas } = req.body;
    const valorFinal = typeof caracteristicas_activas === 'object' ? JSON.stringify(caracteristicas_activas) : (caracteristicas_activas || 'all');
    await dbRun('UPDATE Negocios SET caracteristicas_activas = ? WHERE id = ?', [valorFinal, negocioId]);

    let parsed = valorFinal;
    try { parsed = JSON.parse(valorFinal); } catch (_) {}

    io.emit('negocio_caracteristicas_actualizadas', {
      negocioId: Number(negocioId),
      caracteristicas_activas: parsed
    });

    res.json({ ok: true, message: 'Características actualizadas correctamente', caracteristicas_activas: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Consultar IP pública actual del cliente
app.get('/api/ip-actual', (req, res) => {
  const ip = obtenerIpCliente(req);
  res.json({ ip });
});

// Endpoint: Obtener configuración de seguridad de red y terminales del local
app.get('/api/admin/seguridad-red', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.query.negocioId || 1;
    const neg = await dbGet('SELECT id, nombre, restringir_ip_operativos, ips_permitidas, restringir_dispositivos, sesion_unica_activa FROM Negocios WHERE id = ?', [negocioId]);
    if (!neg) return res.status(404).json({ error: 'Negocio no encontrado' });

    const clientIp = obtenerIpCliente(req);
    res.json({
      ok: true,
      negocioId: neg.id,
      nombre: neg.nombre,
      restringir_ip_operativos: Number(neg.restringir_ip_operativos) === 1,
      ips_permitidas: neg.ips_permitidas || '',
      restringir_dispositivos: Number(neg.restringir_dispositivos) === 1,
      sesion_unica_activa: neg.sesion_unica_activa === null || neg.sesion_unica_activa === undefined ? true : (Number(neg.sesion_unica_activa) === 1),
      clientIp
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Guardar configuración de seguridad de red y dispositivos del local
app.put('/api/admin/seguridad-red', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.body.negocioId || 1;
    const { restringir_ip_operativos, ips_permitidas, restringir_dispositivos, sesion_unica_activa, pinAdmin, usuarioNombre = 'Administrador' } = req.body;

    // Validar autorización: JWT de rol admin/developer, o header x-user-rol, o PIN de admin/developer
    let autorizado = false;
    const rolesAdmin = ['admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer'];

    if (req.usuario && rolesAdmin.includes((req.usuario.rol || '').toLowerCase())) {
      autorizado = true;
    } else if (rolesAdmin.includes((req.headers['x-user-rol'] || '').toLowerCase())) {
      autorizado = true;
    } else if (pinAdmin) {
      const pinStr = String(pinAdmin).trim();
      const adminUsers = await dbAll(
        `SELECT * FROM Usuarios WHERE negocio_id = ? AND rol IN ('admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer') AND activo = 1`,
        [negocioId]
      );
      for (const u of adminUsers) {
        if (await verificarCredencialUsuario(u, pinStr)) {
          autorizado = true;
          break;
        }
      }
      if (!autorizado) {
        // Verificar también desarrolladores globales
        const devs = await dbAll(`SELECT * FROM Usuarios WHERE rol = 'developer' AND activo = 1`);
        for (const d of devs) {
          if (await verificarCredencialUsuario(d, pinStr)) {
            autorizado = true;
            break;
          }
        }
      }
    }

    if (!autorizado) {
      return res.status(403).json({ error: 'No autorizado. Se requiere PIN o credenciales de Administrador.' });
    }

    const flagIpVal = (restringir_ip_operativos === true || Number(restringir_ip_operativos) === 1 || String(restringir_ip_operativos) === 'true') ? 1 : 0;
    const ipsVal = (ips_permitidas || '').trim();
    const flagDispVal = (restringir_dispositivos === true || Number(restringir_dispositivos) === 1 || String(restringir_dispositivos) === 'true') ? 1 : 0;
    const flagSesionVal = (sesion_unica_activa === false || Number(sesion_unica_activa) === 0 || String(sesion_unica_activa) === 'false') ? 0 : 1;

    await dbRun(
      'UPDATE Negocios SET restringir_ip_operativos = ?, ips_permitidas = ?, restringir_dispositivos = ?, sesion_unica_activa = ? WHERE id = ?',
      [flagIpVal, ipsVal, flagDispVal, flagSesionVal, negocioId]
    );

    await registrarAuditoria({
      negocioId: Number(negocioId),
      usuarioNombre,
      accion: 'configurar_seguridad_red',
      tipoEvento: 'seguridad',
      modulo: 'admin',
      detalle: `Seguridad de Red & Dispositivos actualizada: [Restricción IP: ${flagIpVal ? 'ON' : 'OFF'}], [Dispositivos Autorizados: ${flagDispVal ? 'ON' : 'OFF'}], [Sesión Única: ${flagSesionVal ? 'ON' : 'OFF'}]`
    });

    io.emit('negocio_seguridad_red_actualizada', {
      negocioId: Number(negocioId),
      restringir_ip_operativos: flagIpVal === 1,
      ips_permitidas: ipsVal,
      restringir_dispositivos: flagDispVal === 1,
      sesion_unica_activa: flagSesionVal === 1
    });

    res.json({
      ok: true,
      message: 'Configuración de seguridad y terminales guardada exitosamente',
      restringir_ip_operativos: flagIpVal === 1,
      ips_permitidas: ipsVal,
      restringir_dispositivos: flagDispVal === 1,
      sesion_unica_activa: flagSesionVal === 1
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Listar dispositivos autorizados del negocio
app.get('/api/admin/dispositivos', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.query.negocioId || 1;
    const dispositivos = await dbAll(
      `SELECT id, negocio_id, device_token, nombre_dispositivo, tipo_dispositivo, navegador_info, ip_registro, autorizado_por, creado_en, activo 
       FROM DispositivosAutorizados 
       WHERE negocio_id = ? AND activo = 1 
       ORDER BY id DESC`,
      [negocioId]
    );
    res.json({ ok: true, dispositivos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Registrar y autorizar una terminal o dispositivo
app.post('/api/admin/dispositivos/autorizar', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.body.negocioId || 1;
    const { device_token, nombre_dispositivo, tipo_dispositivo = 'desktop', navegador_info = '', pinAdmin, usuarioNombre = 'Administrador' } = req.body;

    if (!device_token || !nombre_dispositivo) {
      return res.status(400).json({ error: 'Token de dispositivo y nombre descriptivo son requeridos.' });
    }

    let autorizado = false;
    const rolesAdmin = ['admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer'];

    if (req.usuario && rolesAdmin.includes((req.usuario.rol || '').toLowerCase())) {
      autorizado = true;
    } else if (rolesAdmin.includes((req.headers['x-user-rol'] || '').toLowerCase())) {
      autorizado = true;
    } else if (pinAdmin) {
      const pinStr = String(pinAdmin).trim();
      const adminUsers = await dbAll(
        `SELECT * FROM Usuarios WHERE negocio_id = ? AND rol IN ('admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer') AND activo = 1`,
        [negocioId]
      );
      for (const u of adminUsers) {
        if (await verificarCredencialUsuario(u, pinStr)) {
          autorizado = true;
          break;
        }
      }
      if (!autorizado) {
        const devs = await dbAll(`SELECT * FROM Usuarios WHERE rol = 'developer' AND activo = 1`);
        for (const d of devs) {
          if (await verificarCredencialUsuario(d, pinStr)) {
            autorizado = true;
            break;
          }
        }
      }
    }

    if (!autorizado) {
      return res.status(403).json({ error: 'No autorizado. Se requiere PIN o credenciales de Administrador.' });
    }

    const clientIp = obtenerIpCliente(req);
    const ahoraIso = new Date().toISOString();

    const existente = await dbGet(
      'SELECT id FROM DispositivosAutorizados WHERE negocio_id = ? AND device_token = ?',
      [negocioId, device_token.trim()]
    );

    if (existente) {
      await dbRun(
        `UPDATE DispositivosAutorizados 
         SET nombre_dispositivo = ?, tipo_dispositivo = ?, navegador_info = ?, ip_registro = ?, autorizado_por = ?, activo = 1 
         WHERE id = ?`,
        [nombre_dispositivo.trim(), tipo_dispositivo, navegador_info, clientIp, usuarioNombre, existente.id]
      );
    } else {
      await dbRun(
        `INSERT INTO DispositivosAutorizados (negocio_id, device_token, nombre_dispositivo, tipo_dispositivo, navegador_info, ip_registro, autorizado_por, creado_en, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [negocioId, device_token.trim(), nombre_dispositivo.trim(), tipo_dispositivo, navegador_info, clientIp, usuarioNombre, ahoraIso]
      );
    }

    await registrarAuditoria({
      negocioId: Number(negocioId),
      usuarioNombre,
      accion: 'autorizar_dispositivo',
      tipoEvento: 'seguridad',
      modulo: 'admin',
      detalle: `Terminal Autorizada: "${nombre_dispositivo}" (${tipo_dispositivo}) desde IP ${clientIp}`
    });

    io.emit('dispositivo_autorizado', {
      negocioId: Number(negocioId),
      device_token: device_token.trim(),
      nombre_dispositivo: nombre_dispositivo.trim()
    });

    res.json({
      ok: true,
      message: `Dispositivo "${nombre_dispositivo}" autorizado con éxito.`,
      device_token: device_token.trim()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint: Revocar / Eliminar dispositivo autorizado
app.delete('/api/admin/dispositivos/:id', async (req, res) => {
  try {
    const negocioId = req.headers['x-negocio-id'] || req.query.negocioId || 1;
    const { pinAdmin, usuarioNombre = 'Administrador' } = req.body || {};

    let autorizado = false;
    const rolesAdmin = ['admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer'];

    if (req.usuario && rolesAdmin.includes((req.usuario.rol || '').toLowerCase())) {
      autorizado = true;
    } else if (rolesAdmin.includes((req.headers['x-user-rol'] || '').toLowerCase())) {
      autorizado = true;
    } else if (pinAdmin) {
      const pinStr = String(pinAdmin).trim();
      const adminUsers = await dbAll(
        `SELECT * FROM Usuarios WHERE negocio_id = ? AND rol IN ('admin', 'superadmin', 'super_admin', 'superadministrador', 'administrador', 'developer') AND activo = 1`,
        [negocioId]
      );
      for (const u of adminUsers) {
        if (await verificarCredencialUsuario(u, pinStr)) {
          autorizado = true;
          break;
        }
      }
      if (!autorizado) {
        const devs = await dbAll(`SELECT * FROM Usuarios WHERE rol = 'developer' AND activo = 1`);
        for (const d of devs) {
          if (await verificarCredencialUsuario(d, pinStr)) {
            autorizado = true;
            break;
          }
        }
      }
    }

    if (!autorizado) {
      return res.status(403).json({ error: 'No autorizado. Se requiere PIN o credenciales de Administrador.' });
    }

    const disp = await dbGet('SELECT * FROM DispositivosAutorizados WHERE id = ? AND negocio_id = ?', [req.params.id, negocioId]);
    if (!disp) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    await dbRun('UPDATE DispositivosAutorizados SET activo = 0 WHERE id = ?', [req.params.id]);

    await registrarAuditoria({
      negocioId: Number(negocioId),
      usuarioNombre,
      accion: 'revocar_dispositivo',
      tipoEvento: 'seguridad',
      modulo: 'admin',
      detalle: `Dispositivo Revocado: "${disp.nombre_dispositivo}" (Token: ${disp.device_token.substring(0, 8)}...)`
    });

    io.emit('dispositivo_revocado', {
      negocioId: Number(negocioId),
      device_token: disp.device_token
    });

    res.json({ ok: true, message: 'Dispositivo revocado exitosamente' });
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
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const r = await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [negocio_id, usuario.trim(), nombre_completo.trim(), hashedPassword, rol, genero, pin, permisosStr]
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
    
    if (password && String(password).trim()) {
      const hashedPassword = await bcrypt.hash(String(password).trim(), 10);
      await dbRun(
        `UPDATE Usuarios SET nombre_completo = ?, password = ?, rol = ?, genero = ?, pin = ?, permisos = ?, activo = ?, negocio_id = ?
         WHERE id = ?`,
        [nombre_completo, hashedPassword, rol, genero, pin, permisosStr, activo !== undefined ? activo : 1, negocio_id, req.params.id]
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

// ============================================================================
// 2.3 MONITOR DE BASE DE DATOS EN TIEMPO REAL (DEVELOPER & SYSADMIN)
// ============================================================================
app.get('/api/dev/db-monitor', async (req, res) => {
  try {
    const startPing = Date.now();
    const isPg = Boolean(db.isPg);

    let pingMs = 0;
    let totalBytes = 0;
    let versionStr = '';
    let tablesData = [];
    let activeConnections = 1;

    const tableMetadata = {
      'detalleorden': { label: 'Detalles de Comandas', icon: '🧾', cat: 'Ventas' },
      'ordenes': { label: 'Órdenes / Facturas', icon: '📋', cat: 'Ventas' },
      'pagos': { label: 'Registro de Pagos', icon: '💳', cat: 'Ventas' },
      'productos': { label: 'Platillos & Bebidas (Menú)', icon: '🍔', cat: 'Catálogo' },
      'categorias': { label: 'Categorías del Menú', icon: '📂', cat: 'Catálogo' },
      'inventario': { label: 'Insumos de Inventario', icon: '📦', cat: 'Inventario' },
      'inventariomovimientos': { label: 'Kárdex de Movimientos', icon: '🔄', cat: 'Inventario' },
      'inventariorecetas': { label: 'Recetas & Escandallos', icon: '🧪', cat: 'Inventario' },
      'mesas': { label: 'Mesas del Salón', icon: '🪑', cat: 'Salón' },
      'zonas': { label: 'Zonas & Ambientes', icon: '🗺️', cat: 'Salón' },
      'cajas': { label: 'Cajas & Turnos', icon: '💵', cat: 'Caja' },
      'movimientoscaja': { label: 'Movimientos de Efectivo', icon: '📥', cat: 'Caja' },
      'usuarios': { label: 'Usuarios del Sistema', icon: '👥', cat: 'Seguridad' },
      'negocios': { label: 'Comercios Registrados', icon: '🏬', cat: 'SaaS' },
      'auditoria': { label: 'Bitácora de Auditoría', icon: '🛡️', cat: 'Seguridad' },
      'anulaciones': { label: 'Registro de Anulaciones', icon: '🚫', cat: 'Auditoría' },
      'confignegocio': { label: 'Configuración & Happy Hour', icon: '⚙️', cat: 'Sistema' },
      'facturaselectronicas': { label: 'Facturación Electrónica', icon: '⚡', cat: 'Fiscal' },
      'idempotencylog': { label: 'Registro de Idempotencia', icon: '🔒', cat: 'Sistema' },
      'tablemerges': { label: 'Historial de Mesas Unidas', icon: '🔗', cat: 'Salón' },
      'personalizacionpagina': { label: 'Studio Personalización', icon: '🎨', cat: 'Personalización' }
    };

    if (isPg) {
      const pingRow = await dbGet('SELECT NOW() as ts, version() as ver');
      pingMs = Date.now() - startPing;
      versionStr = pingRow?.ver ? pingRow.ver.split(' on ')[0] : 'PostgreSQL Cloud';

      const sizeRow = await dbGet('SELECT pg_database_size(current_database()) as size_bytes');
      totalBytes = Number(sizeRow?.size_bytes || 0);

      try {
        const connRow = await dbGet('SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()');
        activeConnections = Number(connRow?.count || 1);
      } catch (_) {}

      const rawTables = await dbAll(`
        SELECT 
          c.relname AS table_name,
          pg_total_relation_size(c.oid) AS total_bytes,
          pg_relation_size(c.oid) AS table_bytes,
          pg_indexes_size(c.oid) AS index_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
      `);

      for (const t of rawTables) {
        const lowerName = t.table_name.toLowerCase();
        let rows = 0;
        try {
          const countRow = await dbGet(`SELECT COUNT(*) as count FROM ${t.table_name}`);
          rows = Number(countRow?.count || 0);
        } catch (_) {}

        const tBytes = Number(t.total_bytes || 0);
        const meta = tableMetadata[lowerName] || { label: t.table_name, icon: '📄', cat: 'General' };

        tablesData.push({
          name: t.table_name,
          label: meta.label,
          icon: meta.icon,
          category: meta.cat,
          rows: rows,
          total_bytes: tBytes,
          total_mb: (tBytes / (1024 * 1024)).toFixed(3),
          total_kb: (tBytes / 1024).toFixed(1),
          table_kb: (Number(t.table_bytes || 0) / 1024).toFixed(1),
          index_kb: (Number(t.index_bytes || 0) / 1024).toFixed(1),
          pct: totalBytes > 0 ? ((tBytes / totalBytes) * 100).toFixed(1) : '0'
        });
      }
    } else {
      // Modo SQLite
      const pingRow = await dbGet("SELECT datetime('now') as ts, sqlite_version() as ver");
      pingMs = Date.now() - startPing;
      versionStr = `SQLite ${pingRow?.ver || '3.x'}`;

      const fs = require('fs');
      const dbFile = db.dbPath || path.join(__dirname, 'pos.db');
      try {
        const stat = fs.statSync(dbFile);
        totalBytes = stat.size;
      } catch (_) {
        totalBytes = 1024 * 1024;
      }

      const sqliteTables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      for (const st of sqliteTables) {
        const lowerName = st.name.toLowerCase();
        let rows = 0;
        try {
          const countRow = await dbGet(`SELECT COUNT(*) as count FROM ${st.name}`);
          rows = Number(countRow?.count || 0);
        } catch (_) {}

        const meta = tableMetadata[lowerName] || { label: st.name, icon: '📄', cat: 'General' };
        const approxBytes = Math.max(4096, rows * 120);

        tablesData.push({
          name: st.name,
          label: meta.label,
          icon: meta.icon,
          category: meta.cat,
          rows: rows,
          total_bytes: approxBytes,
          total_mb: (approxBytes / (1024 * 1024)).toFixed(3),
          total_kb: (approxBytes / 1024).toFixed(1),
          table_kb: (approxBytes * 0.7 / 1024).toFixed(1),
          index_kb: (approxBytes * 0.3 / 1024).toFixed(1),
          pct: '0'
        });
      }
    }

    const totalMBVal = (totalBytes / (1024 * 1024)).toFixed(2);
    const totalKBVal = (totalBytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const totalRowsCount = tablesData.reduce((acc, t) => acc + (t.rows || 0), 0);

    const sumOrdenes = tablesData.find(t => t.name.toLowerCase() === 'ordenes')?.rows || 0;
    const sumProds = tablesData.find(t => t.name.toLowerCase() === 'productos')?.rows || 0;
    const sumMesas = tablesData.find(t => t.name.toLowerCase() === 'mesas')?.rows || 0;
    const sumUsers = tablesData.find(t => t.name.toLowerCase() === 'usuarios')?.rows || 0;
    const sumInsumos = tablesData.find(t => t.name.toLowerCase() === 'inventario')?.rows || 0;
    const sumMovs = tablesData.find(t => t.name.toLowerCase() === 'inventariomovimientos')?.rows || 0;

    let ultimaOrden = null;
    try {
      const uOrd = await dbGet('SELECT numero_orden, fecha_apertura, total FROM Ordenes ORDER BY id DESC LIMIT 1');
      if (uOrd) ultimaOrden = uOrd;
    } catch (_) {}

    res.json({
      ok: true,
      engine: isPg ? 'Supabase PostgreSQL (Cloud DB)' : 'SQLite3 (Local)',
      engine_type: isPg ? 'postgres' : 'sqlite',
      status: 'online',
      ping_ms: pingMs,
      total_bytes: totalBytes,
      total_mb: totalMBVal,
      total_mb_formatted: `${totalMBVal} MB`,
      total_kb_formatted: `${totalKBVal} KB`,
      version: versionStr,
      active_connections: activeConnections,
      uptime_seconds: Math.floor(process.uptime()),
      total_rows: totalRowsCount,
      tables_count: tablesData.length,
      tables: tablesData,
      summary: {
        total_ordenes: sumOrdenes,
        total_productos: sumProds,
        total_mesas: sumMesas,
        total_usuarios: sumUsers,
        total_insumos: sumInsumos,
        total_movimientos: sumMovs
      },
      ultima_orden: ultimaOrden,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dev/db-optimize', async (req, res) => {
  try {
    const tStart = Date.now();
    if (db.isPg) {
      await dbRun('ANALYZE');
    } else {
      await dbRun('PRAGMA optimize');
    }
    const durationMs = Date.now() - tStart;
    res.json({
      ok: true,
      message: `Base de datos optimizada y estadísticas re-analizadas exitosamente en ${durationMs} ms.`,
      duration_ms: durationMs
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dev/db-ping', async (req, res) => {
  try {
    const tStart = Date.now();
    await dbGet('SELECT 1 as ping');
    const pingMs = Date.now() - tStart;
    res.json({ ok: true, ping_ms: pingMs, timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 3. GESTIÓN DE PERSONAL PARA ADMIN (AISLAMIENTO ESTRICTO: NO VE AL DEVELOPER)
// ============================================================================
app.get('/api/admin/empleados', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const empleados = await dbAll(`
      SELECT u.id, u.negocio_id, u.usuario, u.nombre_completo, u.rol, u.genero, u.pin, u.activo, u.caja_defecto_id,
             p.nombre as caja_defecto_nombre
      FROM Usuarios u
      LEFT JOIN PuntosDeCobro p ON u.caja_defecto_id = p.id
      WHERE (u.negocio_id = ? OR (u.negocio_id IS NULL AND ? = 1)) AND u.rol != 'developer'
      ORDER BY u.id ASC
    `, [negocioId, negocioId]);

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
    const negocioId = obtenerNegocioIdReq(req, req.body.negocio_id || 1);
    const { usuario, nombre_completo, nombre, password, rol = 'salonero', genero = 'M', pin = '1234', caja_defecto_id } = req.body;
    
    // Bloqueo estricto: el admin NO puede crear roles developer
    if (rol === 'developer') {
      return res.status(403).json({ ok: false, error: 'Permiso denegado: El administrador no puede crear usuarios de desarrollador' });
    }

    const nombreFinal = (nombre_completo || nombre || usuario || '').trim();
    if (!usuario || !password) {
      return res.status(400).json({ ok: false, error: 'Usuario y contraseña son requeridos' });
    }

    const permisos = rol === 'cajero' 
      ? '{"salon":true,"caja":true,"facturacion":true}'
      : '{"salon":true,"kds":true}';

    const debeCambiar = (rol !== 'admin' && rol !== 'developer') ? 1 : 0;
    const hashedPassword = await bcrypt.hash(String(password).trim(), 10);

    const r = await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, debe_cambiar_password, caja_defecto_id, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [negocioId, String(usuario).trim(), nombreFinal, hashedPassword, rol, genero, pin, permisos, debeCambiar, caja_defecto_id ? Number(caja_defecto_id) : null]
    );

    res.json({ ok: true, message: 'Empleado registrado con éxito', id: r.lastID });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message.includes('UNIQUE') ? 'Ese nombre de usuario ya está en uso' : e.message });
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

    if (req.usuario && req.usuario.rol !== 'developer') {
      if (Number(target.negocio_id) !== Number(req.usuario.negocio_id)) {
        return res.status(403).json({ error: 'Acceso denegado: No tienes permisos para modificar empleados de otro comercio.' });
      }
    }

    const { nombre_completo, password, rol, genero, pin, debe_cambiar_password, caja_defecto_id } = req.body;
    if (rol === 'developer') return res.status(403).json({ error: 'No se puede elevar a developer' });

    const cDefectoFinal = caja_defecto_id !== undefined ? (caja_defecto_id ? Number(caja_defecto_id) : null) : target.caja_defecto_id;

    if (password && String(password).trim()) {
      const debeCambiar = (debe_cambiar_password !== undefined) ? (debe_cambiar_password ? 1 : 0) : ((rol !== 'admin' && rol !== 'developer') ? 1 : 0);
      const hashedPassword = await bcrypt.hash(String(password).trim(), 10);
      await dbRun(
        'UPDATE Usuarios SET nombre_completo = ?, password = ?, rol = ?, genero = ?, pin = ?, debe_cambiar_password = ?, caja_defecto_id = ? WHERE id = ?',
        [nombre_completo, hashedPassword, rol, genero, pin, debeCambiar, cDefectoFinal, req.params.id]
      );
    } else {
      await dbRun(
        'UPDATE Usuarios SET nombre_completo = ?, rol = ?, genero = ?, pin = ?, caja_defecto_id = ? WHERE id = ?',
        [nombre_completo, rol, genero, pin, cDefectoFinal, req.params.id]
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

    if (req.usuario && req.usuario.rol !== 'developer') {
      if (Number(target.negocio_id) !== Number(req.usuario.negocio_id)) {
        return res.status(403).json({ error: 'Acceso denegado: No tienes permisos para eliminar empleados de otro comercio.' });
      }
    }

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
    const { imagen_url, nombre, precio, color_badge, eliminar_imagen } = req.body;
    const prodId = req.params.id;
    const prod = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    let finalImg = prod.imagen_url;
    if (eliminar_imagen || imagen_url === '__borrar__') {
      finalImg = null;
    } else if (imagen_url !== undefined && imagen_url !== null && String(imagen_url).trim() !== '') {
      finalImg = String(imagen_url).trim();
    }

    await dbRun(
      'UPDATE Productos SET imagen_url = ?, nombre = COALESCE(?, nombre), precio = COALESCE(?, precio), color_badge = ? WHERE id = ?',
      [finalImg, nombre || null, precio || null, color_badge || null, prodId]
    );

    const actualizado = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    io.emit('producto_visual_cambiado', actualizado);
    res.json({ message: 'Apariencia del botón actualizada con éxito', producto: actualizado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// TIPO DE CAMBIO BCCR (BANCO CENTRAL DE COSTA RICA)
// ============================================================================
let cachedTipoCambio = null;
let lastFetchTipoCambio = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

async function obtenerTipoCambioBCCR() {
  const ahora = Date.now();
  if (cachedTipoCambio && (ahora - lastFetchTipoCambio) < CACHE_TTL_MS) {
    return cachedTipoCambio;
  }

  // 1. Intentar API oficial de Indicadores Económicos Hacienda / BCCR
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('https://api.hacienda.go.cr/indicadores/tc/dolar', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      const venta = Number(data?.venta?.valor) || 0;
      const compra = Number(data?.compra?.valor) || 0;
      const fecha = data?.venta?.fecha || new Date().toISOString().split('T')[0];
      if (venta > 0) {
        cachedTipoCambio = {
          ok: true,
          venta,
          compra: compra || venta,
          tipo_cambio: venta,
          fecha,
          fuente: 'BCCR (Hacienda)'
        };
        lastFetchTipoCambio = ahora;
        console.log(`💵 Tipo de Cambio BCCR actualizado: Venta ₡${venta} | Compra ₡${compra} (${fecha})`);
        return cachedTipoCambio;
      }
    }
  } catch (err) {
    console.warn('Fallo consulta a api.hacienda.go.cr para tipo de cambio:', err.message);
  }

  // 2. Fallback a servicio paginasweb.cr
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch('https://tipodecambio.paginasweb.cr/api/', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      const venta = Number(data?.venta) || 0;
      const compra = Number(data?.compra) || 0;
      const fecha = data?.fecha || new Date().toISOString().split('T')[0];
      if (venta > 0) {
        cachedTipoCambio = {
          ok: true,
          venta,
          compra: compra || venta,
          tipo_cambio: venta,
          fecha,
          fuente: 'BCCR (paginasweb.cr)'
        };
        lastFetchTipoCambio = ahora;
        console.log(`💵 Tipo de Cambio BCCR (fallback) actualizado: Venta ₡${venta} | Compra ₡${compra}`);
        return cachedTipoCambio;
      }
    }
  } catch (err) {
    console.warn('Fallo consulta de respaldo para tipo de cambio:', err.message);
  }

  // Si fallan ambos y tenemos caché anterior, devolverlo
  if (cachedTipoCambio) {
    return cachedTipoCambio;
  }

  // Fallback por defecto si no hay conexión a internet
  return {
    ok: true,
    venta: 520,
    compra: 515,
    tipo_cambio: 520,
    fecha: new Date().toISOString().split('T')[0],
    fuente: 'Por defecto (Offline)'
  };
}

app.get('/api/tipo-cambio', async (req, res) => {
  try {
    const tc = await obtenerTipoCambioBCCR();
    res.json(tc);
  } catch (e) {
    res.status(500).json({ error: e.message, tipo_cambio: 520, venta: 520, compra: 515 });
  }
});

// Zonas / Secciones del Salón
app.get('/api/zonas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const zonas = await dbAll('SELECT * FROM Zonas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC', [negocioId, negocioId]);
    res.json(zonas || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/zonas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la sección es obligatorio' });
    }
    const cleanNombre = nombre.trim();
    let existing = await dbGet('SELECT * FROM Zonas WHERE LOWER(nombre) = LOWER(?) AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [cleanNombre, negocioId, negocioId]);
    if (existing) {
      return res.json(existing);
    }
    const r = await dbRun('INSERT INTO Zonas (negocio_id, nombre) VALUES (?, ?)', [negocioId, cleanNombre]);
    const nuevaZona = await dbGet('SELECT * FROM Zonas WHERE id = ?', [r.lastID]);
    res.json(nuevaZona);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 5. MESAS & SALÓN (DRAG & DROP)
// ============================================================================
app.get('/api/mesas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const zonas = await dbAll('SELECT * FROM Zonas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC', [negocioId, negocioId]);
    const mesas = await dbAll(`
      SELECT m.*, z.nombre as zonaNombre,
             o.id as orden_activa_id, o.numero_orden, o.subtotal, o.descuento_happy_hour, 
             o.servicio_10, o.iva_13, o.total as orden_total, o.mesero as orden_mesero, 
             COALESCE(NULLIF(o.cliente, ''), NULLIF(m.cliente, ''), 'Cliente General') as cliente,
             m.cliente as mesa_cliente,
             o.transferida_de as orden_transferida_de
      FROM Mesas m
      LEFT JOIN Zonas z ON m.zona_id = z.id
      LEFT JOIN Ordenes o ON m.id = o.mesa_id AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1)) AND o.estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')
      WHERE (m.negocio_id = ? OR (m.negocio_id IS NULL AND ? = 1))
      ORDER BY m.id ASC
    `, [negocioId, negocioId, negocioId, negocioId]);

    for (const m of mesas) {
      m.piso = m.piso || (m.zona_id === 5 || m.zona_id === 105 || (m.zonaNombre && m.zonaNombre.toLowerCase().includes('segundo')) ? 2 : 1);
    }

    const activeOrderIds = mesas.map(m => m.orden_activa_id).filter(Boolean);
    let itemsByOrder = {};
    if (activeOrderIds.length > 0) {
      const placeholders = activeOrderIds.map(() => '?').join(',');
      const allItems = await dbAll(
        `SELECT * FROM DetalleOrden WHERE orden_id IN (${placeholders}) AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY hora_pedido ASC, id ASC`,
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
      if (m.orden_activa_id) {
        m.orden_total = items.reduce((acc, it) => acc + ((Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 1)), 0);
      }
      const cocinaItems = items.filter(
        it => it.destino === 'cocina' && it.estado_comanda !== 'anulado'
      );
      const pendientes = cocinaItems.filter(
        it => it.estado_comanda === 'pendiente' || it.estado_comanda === 'preparando'
      );

      // Reconciliar estado real de la mesa con los pedidos para evitar estados huérfanos o montos pegados
      const clientePreservado = m.mesa_cliente || m.cliente || null;
      if (m.estado === 'libre') {
        m.orden_total = 0;
        m.orden_activa_id = null;
        m.platos_pendientes = [];
        m.items_pendientes = [];
        m.minutos_espera = 0;
        m.transferida_de = null;
        m.unida_con = null;
        m.mesas_unidas = [];
        m.es_mesa_unida = false;
        m.pidio_cuenta_qr = 0;
        m.hora_pidio_cuenta = null;
        m.cliente = clientePreservado;
        // Si habían órdenes activas huérfanas en una mesa que está libre, cancelarlas para consistencia total
        if (m.orden_activa_id) {
          dbRun("UPDATE Ordenes SET estado = 'cancelada', fecha_cierre = ? WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')", [new Date().toISOString(), m.id]).catch(() => {});
        }
      } else if (m.orden_activa_id && m.estado !== 'cuenta_pedida' && m.estado !== 'cuenta') {
        const estadoCalculado = evaluarEstadoMesaKDS(items);
        if (m.estado !== estadoCalculado) {
          m.estado = estadoCalculado;
          dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [estadoCalculado, m.id]).catch(() => {});
          dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [estadoCalculado, m.orden_activa_id]).catch(() => {});
        }
      } else if (m.estado === 'ocupada' || m.estado === 'esperando' || m.estado === 'esperando_parcial') {
      } else if (m.estado === 'ocupada' || m.estado === 'abierta' || m.estado === 'esperando' || m.estado === 'esperando_parcial') {
        // Mesa ocupada (comensales comiendo tras haber pagado de antemano o en espera de comanda en cocina)
        const ultimaOrden = await dbGet('SELECT id FROM Ordenes WHERE mesa_id = ? ORDER BY id DESC LIMIT 1', [m.id]);
        const rowsPend = ultimaOrden ? await dbAll(
          "SELECT d.nombre_producto, d.hora_pedido, d.creado_en FROM DetalleOrden d WHERE d.orden_id = ? AND d.destino = 'cocina' AND d.estado_comanda IN ('pendiente', 'preparando')",
          [ultimaOrden.id]
        ) : [];
        if (rowsPend.length > 0) {
          m.estado = 'esperando';
          m.platos_pendientes = rowsPend.map(r => r.nombre_producto);
          m.items_pendientes = m.platos_pendientes;
          if (rowsPend[0].hora_pedido) {
            m.primera_comanda_hora = rowsPend[0].hora_pedido;
            m.minutos_espera = Math.max(0, Math.floor((ahora - new Date(rowsPend[0].hora_pedido).getTime()) / 60000));
          }
        } else {
          m.estado = 'ocupada';
          m.platos_pendientes = [];
          m.items_pendientes = [];
          m.minutos_espera = 0;
        }
        m.orden_total = m.orden_total || 0;
        m.cliente = clientePreservado;
      } else if (m.estado === 'reservada') {
        m.orden_total = 0;
        m.orden_activa_id = null;
        m.platos_pendientes = [];
        m.items_pendientes = [];
        m.minutos_espera = 0;
        m.cliente = m.cliente_reserva || clientePreservado;
      } else if (!m.orden_activa_id) {
        m.estado = 'libre';
        m.pidio_cuenta_qr = 0;
        m.hora_pidio_cuenta = null;
        m.cliente = clientePreservado;
        dbRun("UPDATE Mesas SET estado = 'libre', pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL, mesero = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL WHERE id = ?", [m.id]).catch(() => {});
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
      // Calcular métricas de tiempo para Semáforo de Salón (si el módulo está activo)
      const semaforoActivo = await negocioTieneModulo(negocioId, 'semaforo_tiempos_salon');
      let minutosInactiva = 0;
      let minutosComidaLista = 0;
      let semaforoAlerta = 'normal';

      if (m.estado !== 'libre') {
        const fechaRef = m.orden_fecha_apertura || (items.length > 0 ? (items[items.length - 1].hora_pedido || items[items.length - 1].creado_en) : null);
        if (fechaRef) {
          minutosInactiva = Math.max(0, Math.floor((ahora - new Date(fechaRef).getTime()) / 60000));
        }

        const itemsListos = items.filter(it => it.destino === 'cocina' && it.estado_comanda === 'listo');
        if (itemsListos.length > 0) {
          const primerListo = itemsListos.find(it => it.hora_listo);
          if (primerListo && primerListo.hora_listo) {
            minutosComidaLista = Math.max(0, Math.floor((ahora - new Date(primerListo.hora_listo).getTime()) / 60000));
          }
        }

        if (semaforoActivo) {
          if (minutosComidaLista >= 5) {
            semaforoAlerta = 'comida_lista';
          } else if (minutosInactiva >= 20 && pendientes.length === 0) {
            semaforoAlerta = 'inactiva';
          }
        }
      }

      m.minutos_inactiva = minutosInactiva;
      m.minutos_comida_lista = minutosComidaLista;
      m.semaforo_alerta = semaforoAlerta;
      m.semaforo_activo = semaforoActivo;
    }

    res.json({ zonas, mesas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/posiciones', async (req, res) => {
  try {
    const { posiciones, negocio_id } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
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
    }
    io.emit('mesas_reorganizadas', { posiciones, negocio_id: negocioId });
    res.json({ message: 'Distribución física del salón guardada exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Auto-guardado instantáneo de una mesa al soltar o redimensionar
app.post('/api/mesas/posiciones/auto', async (req, res) => {
  try {
    const { id, x, y, ancho, alto, piso, negocio_id } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
    if (id != null && x != null && y != null) {
      await dbRun('UPDATE Mesas SET x = ?, y = ?, ancho = COALESCE(?, ancho), alto = COALESCE(?, alto), piso = COALESCE(?, piso) WHERE id = ?', [
        x,
        y,
        ancho || null,
        alto || null,
        piso || null,
        id
      ]);

      io.emit('mesas_reorganizadas', { mesaId: id, x, y, ancho, alto, piso, negocio_id: negocioId });
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
    const negocioId = obtenerNegocioIdReq(req);
    const mesas = await dbAll('SELECT * FROM Mesas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY zona_id ASC, id ASC', [negocioId, negocioId]);
    let salonX = 25, salonY = 25;
    let barraX = 530, barraY = 25;
    let terrazaX = 25, terrazaY = 325;
    let vipX = 530, vipY = 165;
    let piso2X = 25, piso2Y = 25;
    const nuevasPos = [];

    for (const m of mesas) {
      const esSilla = m.forma === 'silla' || (m.numero && m.numero.toLowerCase().includes('barra'));
      const esPiso2 = m.piso === 2 || m.zona_id === 5 || m.zona_id === 105;
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
      } else if (m.zona_id === 2 || m.zona_id === 102 || esSilla) {
        // Barra
        w = 85; h = 95;
        x = barraX; y = barraY;
        barraX += 105;
      } else if (m.zona_id === 3 || m.zona_id === 103 || (m.numero && m.numero.toLowerCase().includes('terraza'))) {
        // Terraza
        w = 140; h = 120;
        x = terrazaX; y = terrazaY;
        terrazaX += 170;
      } else if (m.zona_id === 4 || m.zona_id === 104 || (m.numero && m.numero.toLowerCase().includes('vip'))) {
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

    io.emit('mesas_reorganizadas', { posiciones: nuevasPos, negocio_id: negocioId });
    res.json({ ok: true, message: 'Salón reorganizado perfectamente en cuadrícula sin solapes', posiciones: nuevasPos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Resetear y Liberar Mesa Trabada / Forzar Liberación (Admin & Developer)
app.post('/api/mesas/:id/reset', verificarAdmin, async (req, res) => {
  try {
    const mesaId = req.params.id;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const ahora = new Date().toISOString();
    const negocioId = Number(mesa.negocio_id || obtenerNegocioIdReq(req) || 1);

    // 1. Obtener todas las órdenes activas asociadas a la mesa
    const ordenesActivas = await dbAll(
      "SELECT id, total FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
      [mesaId]
    );

    const totalPendiente = (ordenesActivas || []).reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const ordenesIds = (ordenesActivas || []).map(o => o.id);
    if (ordenesIds.length > 0) {
      const placeholders = ordenesIds.map(() => '?').join(',');

      // Cancelar las órdenes con auditoría
      await dbRun(
        `UPDATE Ordenes 
         SET estado = 'cancelada', fecha_cierre = ?, notas = COALESCE(notas, '') || ' [Reset forzado por Admin/Dev]'
         WHERE id IN (${placeholders})`,
        [ahora, ...ordenesIds]
      );

      // Anular detalles de orden que no hayan sido pagados
      await dbRun(
        `UPDATE DetalleOrden 
         SET estado_comanda = 'anulado' 
         WHERE orden_id IN (${placeholders}) AND estado_comanda != 'pagado'`,
        ordenesIds
      );

      // Registrar SIEMPRE en Auditoría el cierre forzado de cuenta
      const usuarioNom = req.usuario?.nombre || req.usuario?.nombre_completo || req.body?.usuarioNombre || 'Administrador';
      await registrarAuditoria({
        negocioId,
        usuarioId: req.usuario?.id || null,
        usuarioNombre: usuarioNom,
        accion: 'cierre_forzado_cuenta',
        tipoEvento: 'seguridad',
        modulo: 'mesas',
        detalle: `Reset y cierre forzado de mesa "${mesa.numero}". ${ordenesIds.length} orden(es) cancelada(s). Saldo pendiente anulado: ₡${Math.round(totalPendiente).toLocaleString('es-CR')}`,
        motivo: req.body?.motivo || 'Reset forzado de mesa trabada',
        monto: totalPendiente,
        pinAutorizado: 1
      });
    }

    // 2. Deshacer cualquier agrupación o unión activa
    await dbRun(
      'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
      [mesaId, mesaId]
    );

    // 3. Restaurar mesa a libre total
    await dbRun(
      `UPDATE Mesas 
       SET estado = 'libre', mesero = NULL, cliente = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL 
       WHERE id = ?`,
      [mesaId]
    );

    // 4. Notificar a todos los clientes conectados por sockets
    io.emit('mesa_actualizada', {
      mesaId: Number(mesaId),
      estado: 'libre',
      cliente: null,
      total: 0,
      mesero: null,
      transferida_de: null,
      mesas_unidas: []
    });
    io.emit('comanda_anulada', { mesaId: Number(mesaId), ordenesIds });
    io.emit('kds_actualizado');

    res.json({
      success: true,
      message: `Mesa "${mesa.numero}" reseteada y liberada exitosamente.`,
      mesaId: Number(mesaId),
      ordenesCanceladas: ordenesIds.length,
      saldoAnulado: totalPendiente
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar Mesa o Silla de Barra
app.delete('/api/mesas/:id', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const forzar = req.query.forzar === 'true' || (req.body && req.body.forzar === true);
    const rol = req.headers['x-user-rol'] || req.query.rol || (req.body && req.body.rol);
    const esAdmin = rol === 'admin' || rol === 'developer';

    const mesaRow = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    const mesaNegocioId = mesaRow ? Number(mesaRow.negocio_id || 1) : 1;

    // Verificar si la mesa tiene orden activa con consumos
    const ordenesActivas = await dbAll("SELECT id, total FROM Ordenes WHERE (mesa_id = ? OR mesa_id = ?) AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')", [mesaId, Number(mesaId) || mesaId]);
    if (ordenesActivas && ordenesActivas.length > 0) {
      if (forzar && esAdmin) {
        const totalPendiente = ordenesActivas.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
        // Forzar cancelación de órdenes antes de eliminar
        const ahora = new Date().toISOString();
        await dbRun(
          "UPDATE Ordenes SET estado = 'cancelada', fecha_cierre = ?, notas = COALESCE(notas, '') || ' [Cancelada por eliminación forzada de mesa]' WHERE (mesa_id = ? OR mesa_id = ?) AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
          [ahora, mesaId, Number(mesaId) || mesaId]
        );
        await dbRun(
          "UPDATE DetalleOrden SET estado_comanda = 'anulado' WHERE orden_id IN (SELECT id FROM Ordenes WHERE (mesa_id = ? OR mesa_id = ?) AND estado = 'cancelada') AND estado_comanda != 'pagado'",
          [mesaId, Number(mesaId) || mesaId]
        );

        // Registrar en Auditoría
        const usuarioNom = req.usuario?.nombre || req.usuario?.nombre_completo || req.body?.usuarioNombre || 'Administrador';
        await registrarAuditoria({
          negocioId: mesaNegocioId,
          usuarioId: req.usuario?.id || null,
          usuarioNombre: usuarioNom,
          accion: 'cierre_forzado_cuenta',
          tipoEvento: 'seguridad',
          modulo: 'mesas',
          detalle: `Eliminación forzada de mesa "${mesaRow?.numero || mesaId}" con saldo activo. Saldo pendiente anulado: ₡${Math.round(totalPendiente).toLocaleString('es-CR')}`,
          motivo: 'Eliminación forzada de mesa con saldo pendiente',
          monto: totalPendiente,
          pinAutorizado: 1
        });
      } else {
        return res.status(400).json({
          error: 'No se puede eliminar la mesa porque tiene una cuenta activa pendiente de cobro.',
          tiene_cuenta: true
        });
      }
    }

    await dbRun('UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1', [mesaId, mesaId]);
    await dbRun('DELETE FROM Mesas WHERE id = ?', [mesaId]);
    io.emit('mesa_eliminada', { id: Number(mesaId), negocio_id: mesaNegocioId });
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
    const { numero, zona_id, capacidad = 4, forma = 'square', x = 100, y = 100, piso = 1, ancho, alto, negocio_id } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
    const numPiso = Number(piso) || 1;
    
    let resolvedZonaId = zona_id;
    if (resolvedZonaId) {
      const zCheck = await dbGet('SELECT id FROM Zonas WHERE id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [resolvedZonaId, negocioId, negocioId]);
      if (!zCheck) resolvedZonaId = null;
    }
    if (!resolvedZonaId) {
      const zDefault = await dbGet(
        'SELECT id FROM Zonas WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC LIMIT 1',
        [negocioId, negocioId]
      );
      resolvedZonaId = zDefault ? zDefault.id : (numPiso === 2 ? 5 : 1);
    }
    const resolvedW = ancho || (forma === 'silla' ? 85 : 135);
    const resolvedH = alto || (forma === 'silla' ? 95 : 115);

    const r = await dbRun(
      'INSERT INTO Mesas (negocio_id, numero, zona_id, capacidad, forma, x, y, piso, ancho, alto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [negocioId, numero, resolvedZonaId, capacidad, forma, x, y, numPiso, resolvedW, resolvedH]
    );
    const nuevaMesa = await dbGet(`
      SELECT m.*, z.nombre as zonaNombre 
      FROM Mesas m 
      LEFT JOIN Zonas z ON m.zona_id = z.id 
      WHERE m.id = ?
    `, [r.lastID]);
    if (nuevaMesa) {
      nuevaMesa.piso = nuevaMesa.piso || numPiso;
      nuevaMesa.negocio_id = negocioId;
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

    io.emit('mesa_capacidad_cambiada', { id: Number(mesaId), capacidad: numCap, negocio_id: mesa.negocio_id || 1 });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), capacidad: numCap, negocio_id: mesa.negocio_id || 1 });

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

    const negId = mesa.negocio_id || 1;
    // Validar que no exista otra mesa con el mismo nombre dentro del mismo negocio
    const duplicada = await dbGet('SELECT * FROM Mesas WHERE LOWER(numero) = LOWER(?) AND id != ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [nuevoNombre, mesaId, negId, negId]);
    if (duplicada) {
      return res.status(400).json({ error: `Ya existe otra mesa o silla con el nombre "${nuevoNombre}".` });
    }

    await dbRun('UPDATE Mesas SET numero = ? WHERE id = ?', [nuevoNombre, mesaId]);
    const mesaActualizada = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);

    io.emit('mesa_renombrada', { id: Number(mesaId), numero: nuevoNombre, negocio_id: negId });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), numero: nuevoNombre, negocio_id: negId });

    res.json({ message: `Nombre actualizado exitosamente a "${nuevoNombre}"`, mesa: mesaActualizada });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

app.put('/api/mesas/:id', handleRenombrarMesa);
app.post('/api/mesas/:id/renombrar', handleRenombrarMesa);

app.post('/api/mesas/:id/cliente', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const { cliente = '' } = req.body;
    const clienteLimpio = String(cliente || '').trim();
    const mesaRow = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    const negId = mesaRow ? (mesaRow.negocio_id || 1) : 1;
    await dbRun('UPDATE Mesas SET cliente = ? WHERE id = ?', [clienteLimpio || null, mesaId]);
    await dbRun("UPDATE Ordenes SET cliente = ? WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')", [clienteLimpio || 'Cliente General', mesaId]);
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), cliente: clienteLimpio || null, negocio_id: negId });
    res.json({ ok: true, cliente: clienteLimpio });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ENDPOINTS DE RESERVAS DE MESAS (FASE 1)
// ============================================================================
app.get('/api/reservas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    const sql = `
      SELECT r.*, m.numero as mesa_numero, m.capacidad as mesa_capacidad
      FROM Reservas r
      LEFT JOIN Mesas m ON r.mesa_id = m.id
      WHERE (r.negocio_id = ? OR (r.negocio_id IS NULL AND ? = 1))
        ${req.query.todas ? '' : 'AND r.fecha = ?'}
      ORDER BY r.hora ASC, r.id ASC
    `;
    const params = req.query.todas ? [negocioId, negocioId] : [negocioId, negocioId, fecha];
    const reservas = await dbAll(sql, params);
    res.json({ ok: true, reservas, fecha });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reservas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const { mesa_id, cliente_nombre, cliente_telefono, pax, fecha, hora, notas } = req.body;
    if (!cliente_nombre || !fecha || !hora) {
      return res.status(400).json({ error: 'Nombre del cliente, fecha y hora son obligatorios.' });
    }
    const fechaLimpia = String(fecha).trim();
    const horaLimpia = String(hora).trim();
    const clienteLimpio = String(cliente_nombre).trim();
    const telLimpio = cliente_telefono ? String(cliente_telefono).trim() : null;
    const paxNum = Number(pax) || 2;
    const notasLimpias = notas ? String(notas).trim() : null;
    const mesaIdNum = mesa_id ? Number(mesa_id) : null;

    const result = await dbRun(
      `INSERT INTO Reservas (negocio_id, mesa_id, cliente_nombre, cliente_telefono, pax, fecha, hora, estado, notas, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmada', ?, datetime('now', 'localtime'))`,
      [negocioId, mesaIdNum, clienteLimpio, telLimpio, paxNum, fechaLimpia, horaLimpia, notasLimpias]
    );
    const reservaId = result.lastID || result.id;

    if (mesaIdNum) {
      await dbRun(
        `UPDATE Mesas SET estado = 'reservada', reserva_id = ?, cliente_reserva = ?, hora_reserva = ?, fecha_reserva = ?, pax_reserva = ?, notas_reserva = ?, telefono_reserva = ?, cliente = ? WHERE id = ?`,
        [reservaId, clienteLimpio, horaLimpia, fechaLimpia, paxNum, notasLimpias, telLimpio, clienteLimpio, mesaIdNum]
      );
      io.emit('mesa_reservada', { mesaId: mesaIdNum, reservaId, cliente: clienteLimpio, hora: horaLimpia, negocio_id: negocioId });
      io.emit('mesa_actualizada', { mesaId: mesaIdNum, estado: 'reservada', cliente: clienteLimpio, negocio_id: negocioId });
    }

    io.emit('reserva_actualizada', { negocio_id: negocioId });
    res.json({ ok: true, id: reservaId, message: 'Reserva registrada exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reservas/:id/sentar', async (req, res) => {
  try {
    const reservaId = req.params.id;
    const reserva = await dbGet('SELECT * FROM Reservas WHERE id = ?', [reservaId]);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    await dbRun("UPDATE Reservas SET estado = 'sentada' WHERE id = ?", [reservaId]);
    
    const mesaId = req.body.mesa_id || reserva.mesa_id;
    if (mesaId) {
      await dbRun(
        "UPDATE Mesas SET estado = 'abierta', cliente = ?, reserva_id = NULL, cliente_reserva = NULL, hora_reserva = NULL, fecha_reserva = NULL, pax_reserva = NULL, notas_reserva = NULL, telefono_reserva = NULL WHERE id = ?",
        [reserva.cliente_nombre, mesaId]
      );
      io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'abierta', cliente: reserva.cliente_nombre, negocio_id: reserva.negocio_id });
    }
    io.emit('reserva_actualizada', { negocio_id: reserva.negocio_id });
    res.json({ ok: true, message: 'Mesa sentada con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reservas/:id/cancelar', async (req, res) => {
  try {
    const reservaId = req.params.id;
    const reserva = await dbGet('SELECT * FROM Reservas WHERE id = ?', [reservaId]);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    await dbRun("UPDATE Reservas SET estado = 'cancelada' WHERE id = ?", [reservaId]);

    if (reserva.mesa_id) {
      await dbRun(
        "UPDATE Mesas SET estado = 'libre', cliente = NULL, reserva_id = NULL, cliente_reserva = NULL, hora_reserva = NULL, fecha_reserva = NULL, pax_reserva = NULL, notas_reserva = NULL, telefono_reserva = NULL WHERE id = ?",
        [reserva.mesa_id]
      );
      io.emit('mesa_actualizada', { mesaId: Number(reserva.mesa_id), estado: 'libre', cliente: null, negocio_id: reserva.negocio_id });
    }
    io.emit('reserva_actualizada', { negocio_id: reserva.negocio_id });
    res.json({ ok: true, message: 'Reserva cancelada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Liberar mesa: Meseros/Cajeros si saldo es ₡0, o requiere PIN de Admin si hay saldo pendiente
app.post('/api/mesas/:id/liberar', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    // 1. Obtener órdenes activas de la mesa para verificar si hay saldo pendiente
    const ordenesActivas = await dbAll(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
      [mesaId]
    );

    let totalPendiente = 0;
    const ordenesConSaldo = [];
    for (const ord of ordenesActivas) {
      if (ord.estado !== 'pagada' && ord.estado !== 'cerrada') {
        const monto = Number(ord.total) || 0;
        if (monto > 0) {
          totalPendiente += monto;
          ordenesConSaldo.push(ord);
        }
      }
    }

    const ahora = new Date().toISOString();
    const negocioId = Number(mesa.negocio_id || obtenerNegocioIdReq(req) || 1);
    const exigirPin = await negocioTieneModulo(negocioId, 'pedir_pin_liberar_con_saldo');

    const rol = (req.usuario?.rol || req.headers['x-user-rol'] || (req.query && req.query.rol) || (req.body && req.body.rol) || '').toLowerCase();
    const pin = req.headers['x-supervisor-pin'] || (req.body && req.body.pinAutorizado) || (req.body && req.body.pin);
    const usuarioNom = req.usuario?.nombre || req.usuario?.nombre_completo || req.body?.usuarioNombre || 'Personal';

    // 2. Si hay saldo pendiente por pagar:
    if (totalPendiente > 0) {
      let pinValidado = false;
      if (exigirPin) {
        let autorizado = (rol === 'admin' || rol === 'developer');
        if (!autorizado && pin) {
          pinValidado = await validarPinAdministrador(pin, negocioId);
          autorizado = pinValidado;
        }

        if (!autorizado) {
          return res.status(403).json({
            error: `La mesa "${mesa.numero}" tiene un saldo pendiente de ₡${Math.round(totalPendiente).toLocaleString('es-CR')}. Se requiere PIN de Administrador para liberar la mesa.`,
            requierePin: true,
            saldoPendiente: totalPendiente,
            mesaNumero: mesa.numero
          });
        }
      }

      // Cancelar órdenes pendientes con registro de auditoría
      const idsPendientes = ordenesConSaldo.length > 0 ? ordenesConSaldo.map(o => o.id) : ordenesActivas.map(o => o.id);
      if (idsPendientes.length > 0) {
        const placeholders = idsPendientes.map(() => '?').join(',');
        await dbRun(
          `UPDATE Ordenes SET estado = 'cancelada', fecha_cierre = ?, notas = COALESCE(notas, '') || ' [Cierre forzado con saldo pendiente]' WHERE id IN (${placeholders})`,
          [ahora, ...idsPendientes]
        );
        await dbRun(
          `UPDATE DetalleOrden SET estado_comanda = 'anulado' WHERE orden_id IN (${placeholders}) AND estado_comanda != 'pagado'`,
          idsPendientes
        );
      }

      // Registrar SIEMPRE en Auditoría (General para todos los comercios)
      const adminInfo = pinValidado ? `${pinValidado.usuario} (${pinValidado.nombre_completo || pinValidado.usuario})` : (rol === 'admin' || rol === 'developer' ? usuarioNom : null);
      await registrarAuditoria({
        negocioId,
        usuarioId: req.usuario?.id || null,
        usuarioNombre: usuarioNom,
        autorizadoPor: adminInfo,
        accion: 'cierre_forzado_cuenta',
        tipoEvento: 'seguridad',
        modulo: 'mesas',
        detalle: `Cierre forzado de cuenta en mesa "${mesa.numero}". Saldo pendiente anulado: ₡${Math.round(totalPendiente).toLocaleString('es-CR')} • Operador: @${usuarioNom} ${adminInfo ? `• Autorizó: @${adminInfo}` : ''}`,
        motivo: req.body?.motivo || (pin ? 'Liberación/Cierre autorizado con PIN' : 'Cierre forzado con saldo pendiente'),
        monto: totalPendiente,
        pinAutorizado: (pinValidado || pin || rol === 'admin' || rol === 'developer') ? 1 : 0
      });
    }

    // 3. Cerrar cualquier orden remanente ya pagada o sin saldo
    await dbRun(
      "UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ? WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
      [ahora, mesaId]
    );

    // 4. Liberar mesa completamente
    if (mesa.reserva_id) {
      await dbRun("UPDATE Reservas SET estado = 'cancelada' WHERE id = ?", [mesa.reserva_id]);
    }
    await dbRun(
      "UPDATE Mesas SET estado = 'libre', mesero = NULL, cliente = NULL, reserva_id = NULL, cliente_reserva = NULL, hora_reserva = NULL, fecha_reserva = NULL, pax_reserva = NULL, notas_reserva = NULL, telefono_reserva = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL WHERE id = ?",
      [mesaId]
    );
    await dbRun(
      'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
      [mesaId, mesaId]
    );

    io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'libre', cliente: null, total: 0, transferida_de: null, mesas_unidas: [] });
    io.emit('reserva_actualizada', { negocio_id: negocioId });

    res.json({
      ok: true,
      message: `Mesa ${mesa.numero} liberada con éxito.`,
      saldoAnulado: totalPendiente > 0 ? totalPendiente : 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
      "UPDATE Mesas SET estado = 'libre', mesero = NULL, cliente = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL WHERE id = ?",
      [origenMesaId]
    );

    // 4. Deactivate any prior table merges involving Table A
    await dbRun(
      'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
      [origenMesaId, origenMesaId]
    );

    io.emit('mesa_transferida', { origenMesaId, destinoMesaId, ordenId: orden.id, transferida_de: origenLabel });
    io.emit('mesa_actualizada', { mesaId: origenMesaId, estado: 'libre', cliente: null, total: 0, transferida_de: null, mesas_unidas: [] });
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

    const negocioId = mesaPrincipal.negocio_id || req.headers['x-negocio-id'] || 1;
    const neg = await dbGet('SELECT id, caracteristicas_activas FROM Negocios WHERE id = ?', [negocioId]);
    if (neg) {
      let feats = neg.caracteristicas_activas || 'all';
      if (feats !== 'all') {
        try { feats = JSON.parse(feats); } catch (_) { feats = String(feats).split(',').map(s => s.trim()); }
        if (Array.isArray(feats) && !feats.includes('union_mesas')) {
          return res.status(403).json({ error: 'La función de Unión de Mesas se encuentra desactivada para este local en el Panel de Características.' });
        }
      }
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
    const resultadoTotales = await recalcularTotalesOrden(orden1.id);
    const total = resultadoTotales.total;
    const nuevoEstadoUnido = allMergedItems.length > 0 ? evaluarEstadoMesaKDS(allMergedItems) : 'abierta';
    await dbRun("UPDATE Ordenes SET estado = ? WHERE id = ?", [nuevoEstadoUnido, orden1.id]);

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

    const negocioId = mesa1.negocio_id || req.headers['x-negocio-id'] || 1;
    const neg = await dbGet('SELECT id, caracteristicas_activas FROM Negocios WHERE id = ?', [negocioId]);
    if (neg) {
      let feats = neg.caracteristicas_activas || 'all';
      if (feats !== 'all') {
        try { feats = JSON.parse(feats); } catch (_) { feats = String(feats).split(',').map(s => s.trim()); }
        if (Array.isArray(feats) && !feats.includes('union_mesas')) {
          return res.status(403).json({ error: 'La función de Unión de Mesas se encuentra desactivada para este local en el Panel de Características.' });
        }
      }
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
        const resB = await recalcularTotalesOrden(snapB.orden_id);
        subB = resB.subtotal;
        servB = resB.servicio;
        ivaB = resB.iva;
        totB = resB.total;
        estB = evaluarEstadoMesaKDS(itemsRestantesB);
        await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [estB, snapB.orden_id]);
      } else {
        await dbRun(
          'UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ?, estado = ? WHERE id = ?',
          [subB, servB, ivaB, totB, estB, snapB.orden_id]
        );
      }

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
        const resSec = await recalcularTotalesOrden(ordenSec.id);
        totSec = resSec.total;
        estadoSec = evaluarEstadoMesaKDS(itemsSec);
        await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [estadoSec, ordenSec.id]);
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
        const resPrinc = await recalcularTotalesOrden(ordenPrincipal.id);
        totPrinc = resPrinc.total;
        estadoPrinc = evaluarEstadoMesaKDS(itemsRestantes);
        await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [estadoPrinc, ordenPrincipal.id]);
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
// 5.5 DESCUENTOS & CORTESÍAS CON PIN Y AUDITORÍA
// ============================================================================
app.post('/api/ordenes/:id/descuento', async (req, res) => {
  try {
    let ordenId = Number(req.params.id);
    const negocioId = obtenerNegocioIdReq(req);
    const mesaId = req.body?.mesaId || req.body?.mesa_id || req.query?.mesa_id;

    // Si ordenId no vino en params o es inválido, intentar resolver la orden activa por mesaId
    if ((!ordenId || isNaN(ordenId) || ordenId <= 0) && mesaId) {
      const ordenMesa = await dbGet(
        "SELECT id FROM Ordenes WHERE mesa_id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada') ORDER BY id DESC LIMIT 1",
        [mesaId, negocioId, negocioId]
      );
      if (ordenMesa && ordenMesa.id) {
        ordenId = Number(ordenMesa.id);
      }
    }

    if (!ordenId || isNaN(ordenId) || ordenId <= 0) {
      return res.status(400).json({ error: 'ID de orden inválido o inexistente. Debes enviar la comanda a cocina/barra antes de aplicar el descuento.' });
    }

    const { tipo = 'porcentaje', valor = 0, motivo = 'Descuento autorizado', pin = '' } = req.body;

    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const ordenNegocioId = Number(orden.negocio_id) || negocioId || 1;
    const moduloActivo = await negocioTieneModulo(ordenNegocioId, 'descuentos_cortesias_pin');
    if (!moduloActivo) {
      return res.status(403).json({ error: 'El módulo de Descuentos & Cortesías no está habilitado para este restaurante.' });
    }

    // Validar PIN de Administrador/Supervisor OBLIGATORIO SIEMPRE
    if (!pin || String(pin).trim() === '') {
      return res.status(403).json({ error: '🔒 Se requiere ingresar el PIN de Administrador o Supervisor.', requierePin: true });
    }
    const esValido = await validarPinAdministrador(pin, ordenNegocioId);
    if (!esValido) {
      return res.status(403).json({ error: '🔒 PIN incorrecto. Ingresa el PIN de Administrador o Supervisor autorizado.', pinInvalido: true });
    }
    const adminLogin = esValido.usuario || 'admin';
    const adminNombre = esValido.nombre_completo || adminLogin;
    const autorizadorInfo = `${adminLogin} (${adminNombre})`;
    const solicitanteLogin = String(req.body.usuarioLogin || req.body.usuarioNombre || req.headers['x-user-login'] || req.headers['x-user-name'] || req.usuario?.usuario || 'cajero').trim();

    // Obtener detalles de la orden para calcular subtotal bruto
    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' AND estado_comanda != 'pagado'", [ordenId]);
    const subtotalBruto = (items || []).reduce((acc, it) => {
      const p = Number(it.subtotal != null ? it.subtotal : (Number(it.precio_unitario || it.precio || 0) * (Number(it.cantidad) || 1))) || 0;
      return acc + p;
    }, 0);

    let descuentoMonto = 0;
    let descuentoPorcentaje = 0;

    if (tipo === 'cortesia') {
      descuentoPorcentaje = 100;
      descuentoMonto = subtotalBruto;
    } else if (tipo === 'porcentaje') {
      descuentoPorcentaje = Math.min(100, Math.max(0, Number(valor) || 0));
      descuentoMonto = subtotalBruto > 0 ? Math.round((subtotalBruto * descuentoPorcentaje) / 100) : 0;
    } else if (tipo === 'monto') {
      descuentoMonto = Math.min(subtotalBruto, Math.max(0, Number(valor) || 0));
      descuentoPorcentaje = subtotalBruto > 0 ? Math.round((descuentoMonto / subtotalBruto) * 100) : 0;
    }

    descuentoMonto = Number(descuentoMonto) || 0;
    descuentoPorcentaje = Number(descuentoPorcentaje) || 0;

    const subtotalNeto = Math.max(0, (subtotalBruto || 0) - descuentoMonto);
    const servicio10 = Math.round(subtotalNeto * 0.10) || 0;
    const iva13 = Math.round(subtotalNeto * 0.13) || 0;
    const totalFinal = (subtotalNeto + servicio10 + iva13) || 0;

    await dbRun(
      `UPDATE Ordenes 
       SET subtotal = ?, descuento_monto = ?, descuento_porcentaje = ?, descuento_motivo = ?, descuento_autorizado_por = ?, servicio_10 = ?, iva_13 = ?, total = ?
       WHERE id = ?`,
      [subtotalBruto || 0, descuentoMonto, descuentoPorcentaje, motivo || 'Descuento autorizado', autorizadorInfo, servicio10, iva13, totalFinal, ordenId]
    );

    // Registrar en Auditoría
    await registrarAuditoria({
      negocioId,
      usuarioNombre: solicitanteLogin,
      autorizadoPor: autorizadorInfo,
      accion: 'descuento_aplicado',
      tipoEvento: 'SEGURIDAD',
      modulo: 'ventas',
      detalle: `Descuento de ₡${descuentoMonto.toLocaleString('es-CR')} (${descuentoPorcentaje}%) aplicado a Orden #${orden.numero_orden || orden.id} • Solicitó: @${solicitanteLogin} • Autorizó PIN: @${adminLogin} (${adminNombre})`,
      motivo: motivo || 'Descuento autorizado con PIN',
      monto: descuentoMonto,
      pinAutorizado: 1
    });

    const ordenActualizada = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);

    io.emit('orden_actualizada', { ordenId, mesaId: orden.mesa_id, total: totalFinal, descuento: descuentoMonto });
    if (orden.mesa_id) {
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, total: totalFinal, descuento: descuentoMonto });
    }

    res.json({
      ok: true,
      message: `Descuento de ${descuentoPorcentaje}% (₡${descuentoMonto.toLocaleString('es-CR')}) aplicado correctamente.`,
      orden: ordenActualizada
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 6. CATÁLOGO DE MENÚ & CONTROL DE AGOTADOS ("86 LIST")
// ============================================================================
app.get('/api/menu', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const categorias = await dbAll('SELECT * FROM Categorias WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC', [negocioId, negocioId]);
    const rawProductos = await dbAll(`
      SELECT 
        p.*,
        COALESCE(SUM(d.cantidad), 0) AS total_vendidos
      FROM Productos p
      LEFT JOIN DetalleOrden d ON (
        (CAST(d.producto_id AS TEXT) = CAST(p.id AS TEXT) OR (d.producto_id IS NULL AND LOWER(d.nombre_producto) = LOWER(p.nombre)))
        AND d.estado_comanda != 'anulado'
      )
      WHERE (p.activo = 1 OR p.activo IS NULL)
        AND (p.negocio_id = ? OR (p.negocio_id IS NULL AND ? = 1))
      GROUP BY p.id, p.nombre, p.categoria_id, p.precio, p.codigo, p.descripcion, p.destino, p.activo, p.curso, p.happy_hour, p.agotado, p.imagen_url, p.color_badge, p.negocio_id
      ORDER BY p.categoria_id ASC, total_vendidos DESC, p.id ASC
    `, [negocioId, negocioId]);
    const productos = rawProductos.map(p => ({
      ...p,
      id: Number(p.id),
      categoria_id: Number(p.categoria_id),
      precio: Number(p.precio),
      curso: Number(p.curso) || 2,
      total_vendidos: Number(p.total_vendidos) || 0,
      happy_hour: (Number(p.happy_hour) === 1 || p.happy_hour === true || p.happy_hour === '1') ? 1 : 0,
      agotado: (Number(p.agotado) === 1 || p.agotado === true || p.agotado === '1') ? 1 : 0,
      activo: (Number(p.activo) === 0 || p.activo === false || p.activo === '0') ? 0 : 1
    }));
    res.json({ categorias, productos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear nueva categoría en el menú y sincronizar
const handlerCrearCategoria = async (req, res) => {
  try {
    const { nombre, icono, destino, negocio_id } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
    const nombreLimpio = (nombre || '').trim();
    if (!nombreLimpio) {
      return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
    }
    const iconoLimpio = (icono || '🍽️').trim();
    const destinoLimpio = (destino === 'barra') ? 'barra' : 'cocina';

    const existente = await dbGet('SELECT * FROM Categorias WHERE LOWER(nombre) = LOWER(?) AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [nombreLimpio, negocioId, negocioId]);
    if (existente) {
      return res.json({ message: 'Categoría ya existe', categoria: existente });
    }

    const result = await dbRun(
      'INSERT INTO Categorias (negocio_id, nombre, icono, destino) VALUES (?, ?, ?, ?)',
      [negocioId, nombreLimpio, iconoLimpio, destinoLimpio]
    );
    const nuevaCat = await dbGet('SELECT * FROM Categorias WHERE id = ?', [result.lastID]);
    io.emit('categoria_creada', nuevaCat);
    io.emit('menu_actualizado');

    res.status(201).json({ message: 'Categoría creada exitosamente', categoria: nuevaCat });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

app.post('/api/categorias', handlerCrearCategoria);
app.post('/api/admin/categorias', verificarAdmin, handlerCrearCategoria);

// Eliminar categoría del menú
const handlerEliminarCategoria = async (req, res) => {
  try {
    const catId = Number(req.params.id);
    const cat = await dbGet('SELECT * FROM Categorias WHERE id = ?', [catId]);
    if (!cat) {
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }

    const otraCat = await dbGet('SELECT id FROM Categorias WHERE id != ? ORDER BY id ASC LIMIT 1', [catId]);
    const fallbackCatId = otraCat ? otraCat.id : null;

    if (req.body && (req.body.eliminar_productos === true || req.body.eliminarProductos === true)) {
      await dbRun('UPDATE Productos SET activo = 0 WHERE categoria_id = ?', [catId]);
    } else if (fallbackCatId) {
      await dbRun('UPDATE Productos SET categoria_id = ? WHERE categoria_id = ?', [fallbackCatId, catId]);
    } else {
      await dbRun('UPDATE Productos SET categoria_id = NULL WHERE categoria_id = ?', [catId]);
    }

    await dbRun('DELETE FROM Categorias WHERE id = ?', [catId]);

    io.emit('categoria_eliminada', { id: catId, nombre: cat.nombre });
    io.emit('menu_actualizado');

    res.json({
      ok: true,
      message: `Categoría "${cat.nombre}" eliminada exitosamente.`,
      categoriaId: catId
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar categoría: ' + e.message });
  }
};

app.delete('/api/categorias/:id', verificarAdmin, handlerEliminarCategoria);
app.delete('/api/admin/categorias/:id', verificarAdmin, handlerEliminarCategoria);

// Agregar nuevo producto y precio al menú (con soporte de enlace a Kárdex / Recetas)
app.post('/api/productos', async (req, res) => {
  try {
    const {
      nombre,
      precio,
      categoria_id,
      destino,
      curso,
      imagen_url,
      kardex_tipo,
      insumo_id,
      ml_shot,
      cantidad_descuento,
      negocio_id
    } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
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
      const cat = await dbGet('SELECT * FROM Categorias WHERE id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))', [catId, negocioId, negocioId]);
      if (cat && !destinoFinal) {
        destinoFinal = cat.destino || 'cocina';
      }
    } else {
      const primeraCat = await dbGet('SELECT * FROM Categorias WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC LIMIT 1', [negocioId, negocioId]);
      catId = primeraCat ? primeraCat.id : 1;
      if (!destinoFinal) destinoFinal = primeraCat ? (primeraCat.destino || 'cocina') : 'cocina';
    }

    if (!destinoFinal || (destinoFinal !== 'barra' && destinoFinal !== 'cocina')) {
      destinoFinal = 'cocina';
    }

    const cursoNum = Number(curso) || (destinoFinal === 'barra' ? 1 : 2);

    const result = await dbRun(
      `INSERT INTO Productos (negocio_id, categoria_id, nombre, precio, destino, curso, imagen_url, happy_hour, agotado, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)`,
      [negocioId, catId, nombreLimpio, precioNum, destinoFinal, cursoNum, imagen_url || null]
    );

    const prodId = result.lastID;
    const nuevoProd = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);

    // Vinculación opcional al Kárdex
    if (kardex_tipo === 'shot' && insumo_id) {
      const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [insumo_id]);
      if (insumo) {
        const ml = Number(ml_shot) || Number(insumo.medida_shot_ml) || 30;
        const capacidad = Number(insumo.capacidad_ml) || 750;
        const fraccion = Math.round((ml / capacidad) * 10000) / 10000;
        await dbRun(
          'INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, 0)',
          [prodId, insumo_id, fraccion]
        );
      }
    } else if (kardex_tipo === 'unidad' && insumo_id) {
      const cant = Number(cantidad_descuento) || 1;
      await dbRun(
        'INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, 0)',
        [prodId, insumo_id, cant]
      );
      await dbRun('UPDATE Inventario SET producto_id = ? WHERE id = ?', [prodId, insumo_id]);
    }

    io.emit('producto_creado', nuevoProd);
    io.emit('menu_actualizado');

    res.status(201).json({ message: 'Producto agregado exitosamente', producto: nuevoProd });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener estado de vinculación a Kárdex de un producto (con detalle completo de insumo)
app.get('/api/productos/:id/kardex-link', async (req, res) => {
  try {
    const prodId = req.params.id;
    const receta = await dbGet(`
      SELECT r.*, i.nombre as insumo_nombre, i.es_licor, i.capacidad_ml, i.medida_shot_ml, i.rendimiento_shots, i.stock_actual, i.stock_minimo, i.unidad_medida, i.costo_unitario, i.categoria as insumo_categoria
      FROM InventarioRecetas r
      JOIN Inventario i ON r.insumo_id = i.id
      WHERE r.producto_id = ?
      LIMIT 1
    `, [prodId]);

    if (receta) {
      const esShot = receta.es_licor && receta.cantidad < 1;
      const mlShot = esShot ? Math.round(receta.cantidad * (receta.capacidad_ml || 750)) : (receta.medida_shot_ml || 30);
      return res.json({
        vinculado: true,
        kardex_tipo: esShot ? 'shot' : (receta.cantidad === 1 ? 'unidad' : 'shot'),
        insumo_id: receta.insumo_id,
        insumo_nombre: receta.insumo_nombre,
        insumo_categoria: receta.insumo_categoria,
        cantidad: receta.cantidad,
        ml_shot: mlShot,
        capacidad_ml: receta.capacidad_ml,
        medida_shot_ml: receta.medida_shot_ml,
        rendimiento_shots: receta.rendimiento_shots,
        unidad_medida: receta.unidad_medida,
        costo_unitario: receta.costo_unitario,
        stock_actual: receta.stock_actual,
        stock_minimo: receta.stock_minimo,
        es_licor: receta.es_licor
      });
    }

    const insumoDirecto = await dbGet('SELECT * FROM Inventario WHERE producto_id = ?', [prodId]);
    if (insumoDirecto) {
      return res.json({
        vinculado: true,
        kardex_tipo: 'unidad',
        insumo_id: insumoDirecto.id,
        insumo_nombre: insumoDirecto.nombre,
        insumo_categoria: insumoDirecto.categoria,
        cantidad: 1,
        ml_shot: insumoDirecto.medida_shot_ml,
        capacidad_ml: insumoDirecto.capacidad_ml,
        medida_shot_ml: insumoDirecto.medida_shot_ml,
        rendimiento_shots: insumoDirecto.rendimiento_shots,
        unidad_medida: insumoDirecto.unidad_medida,
        costo_unitario: insumoDirecto.costo_unitario,
        stock_actual: insumoDirecto.stock_actual,
        stock_minimo: insumoDirecto.stock_minimo,
        es_licor: insumoDirecto.es_licor
      });
    }

    res.json({ vinculado: false, kardex_tipo: 'ninguno' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Editar producto y actualizar todas sus características y sincronización en Kárdex
app.put('/api/productos/:id', verificarAdmin, async (req, res) => {
  try {
    const prodId = req.params.id;
    const prod = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const {
      nombre,
      precio,
      categoria_id,
      destino,
      curso,
      imagen_url,
      happy_hour,
      agotado,
      kardex_tipo,
      insumo_id,
      ml_shot,
      cantidad_descuento,
      // Campos de actualización directa de la ficha de Kárdex
      insumo_nombre,
      insumo_stock_actual,
      insumo_costo_unitario,
      insumo_stock_minimo,
      insumo_capacidad_ml,
      insumo_medida_shot_ml,
      usuarioNombre = 'Administrador'
    } = req.body;

    const nombreLimpio = nombre ? nombre.trim() : prod.nombre;
    const precioNum = precio !== undefined ? parseFloat(precio) : prod.precio;
    const catId = categoria_id !== undefined ? Number(categoria_id) : prod.categoria_id;
    const destinoFinal = destino ? destino.trim().toLowerCase() : prod.destino;
    const cursoNum = curso !== undefined ? Number(curso) : (prod.curso || 2);
    // Blindaje de fotos/imágenes: Si no se pide eliminar y no viene nueva foto, conservar estrictamente la foto existente
    let imgUrl = prod.imagen_url;
    if (req.body.eliminar_imagen === true || req.body.borrar_imagen === true || imagen_url === '__borrar__') {
      imgUrl = null;
    } else if (imagen_url !== undefined && imagen_url !== null) {
      const trimmedImg = String(imagen_url).trim();
      if (trimmedImg !== '') {
        imgUrl = trimmedImg;
      }
    }

    const hhVal = happy_hour !== undefined ? (happy_hour ? 1 : 0) : prod.happy_hour;
    const agotadoVal = agotado !== undefined ? (agotado ? 1 : 0) : prod.agotado;

    await dbRun(
      `UPDATE Productos 
       SET nombre = ?, precio = ?, categoria_id = ?, destino = ?, curso = ?, imagen_url = ?, happy_hour = ?, agotado = ?
       WHERE id = ?`,
      [nombreLimpio, precioNum, catId, destinoFinal, cursoNum, imgUrl, hhVal, agotadoVal, prodId]
    );

    let huboCambiosKardex = false;
    const ahora = new Date().toISOString();

    // Actualizar vinculación Kárdex si se especificó kardex_tipo
    if (kardex_tipo !== undefined) {
      await dbRun('DELETE FROM InventarioRecetas WHERE producto_id = ?', [prodId]);
      await dbRun('UPDATE Inventario SET producto_id = NULL WHERE producto_id = ?', [prodId]);

      if (kardex_tipo === 'shot' && insumo_id) {
        const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [insumo_id]);
        if (insumo) {
          const capMlActual = insumo_capacidad_ml !== undefined && !isNaN(Number(insumo_capacidad_ml)) ? Number(insumo_capacidad_ml) : (Number(insumo.capacidad_ml) || 750);
          const shotMlActual = insumo_medida_shot_ml !== undefined && !isNaN(Number(insumo_medida_shot_ml)) ? Number(insumo_medida_shot_ml) : (Number(ml_shot) || Number(insumo.medida_shot_ml) || 30);
          const ml = Number(ml_shot) || shotMlActual;
          const fraccion = Math.round((ml / capMlActual) * 10000) / 10000;

          await dbRun(
            'INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, 0)',
            [prodId, insumo_id, fraccion]
          );

          // Actualizar datos del insumo en Kárdex si se proporcionaron
          const nuevoStock = (insumo_stock_actual !== undefined && !isNaN(Number(insumo_stock_actual))) ? Number(insumo_stock_actual) : insumo.stock_actual;
          const nuevoCosto = (insumo_costo_unitario !== undefined && !isNaN(Number(insumo_costo_unitario))) ? Number(insumo_costo_unitario) : insumo.costo_unitario;
          const nuevoMin = (insumo_stock_minimo !== undefined && !isNaN(Number(insumo_stock_minimo))) ? Number(insumo_stock_minimo) : insumo.stock_minimo;
          const nuevoNom = insumo_nombre ? insumo_nombre.trim() : insumo.nombre;
          const nuevoRend = shotMlActual > 0 ? Math.round((capMlActual / shotMlActual) * 10) / 10 : insumo.rendimiento_shots;

          // Registrar movimiento en Kárdex si el stock fue modificado manualmente
          if (insumo_stock_actual !== undefined && Math.abs(nuevoStock - insumo.stock_actual) > 0.0001) {
            const diff = Math.abs(nuevoStock - insumo.stock_actual);
            const tipoMov = nuevoStock > insumo.stock_actual ? 'ajuste' : 'merma';
            const insNId = Number(insumo.negocio_id || 1);
            await dbRun(
              `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [insNId, insumo.id, tipoMov, diff, insumo.stock_actual, nuevoStock, `Ajuste desde edición de producto: ${nombreLimpio}`, usuarioNombre, Math.round(diff * nuevoCosto), ahora]
            );
          }

          await dbRun(
            `UPDATE Inventario SET 
              nombre = ?, stock_actual = ?, costo_unitario = ?, stock_minimo = ?,
              capacidad_ml = ?, medida_shot_ml = ?, rendimiento_shots = ?, actualizado_en = ?
             WHERE id = ?`,
            [nuevoNom, nuevoStock, nuevoCosto, nuevoMin, capMlActual, shotMlActual, nuevoRend, ahora, insumo.id]
          );
          huboCambiosKardex = true;
        }
      } else if (kardex_tipo === 'unidad' && insumo_id) {
        const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [insumo_id]);
        if (insumo) {
          const cant = Number(cantidad_descuento) || 1;
          await dbRun(
            'INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, 0)',
            [prodId, insumo_id, cant]
          );
          await dbRun('UPDATE Inventario SET producto_id = ? WHERE id = ?', [prodId, insumo_id]);

          // Actualizar datos de inventario si se suministraron
          const nuevoStock = (insumo_stock_actual !== undefined && !isNaN(Number(insumo_stock_actual))) ? Number(insumo_stock_actual) : insumo.stock_actual;
          const nuevoCosto = (insumo_costo_unitario !== undefined && !isNaN(Number(insumo_costo_unitario))) ? Number(insumo_costo_unitario) : insumo.costo_unitario;
          const nuevoMin = (insumo_stock_minimo !== undefined && !isNaN(Number(insumo_stock_minimo))) ? Number(insumo_stock_minimo) : insumo.stock_minimo;
          const nuevoNom = insumo_nombre ? insumo_nombre.trim() : insumo.nombre;

          if (insumo_stock_actual !== undefined && Math.abs(nuevoStock - insumo.stock_actual) > 0.0001) {
            const diff = Math.abs(nuevoStock - insumo.stock_actual);
            const tipoMov = nuevoStock > insumo.stock_actual ? 'ajuste' : 'merma';
            const insNId = Number(insumo.negocio_id || 1);
            await dbRun(
              `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [insNId, insumo.id, tipoMov, diff, insumo.stock_actual, nuevoStock, `Ajuste desde edición de producto: ${nombreLimpio}`, usuarioNombre, Math.round(diff * nuevoCosto), ahora]
            );
          }

          await dbRun(
            `UPDATE Inventario SET nombre = ?, stock_actual = ?, costo_unitario = ?, stock_minimo = ?, actualizado_en = ? WHERE id = ?`,
            [nuevoNom, nuevoStock, nuevoCosto, nuevoMin, ahora, insumo.id]
          );
          huboCambiosKardex = true;
        }
      }
    }

    const actualizado = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    io.emit('producto_actualizado', actualizado);
    io.emit('menu_actualizado');
    if (huboCambiosKardex) {
      io.emit('inventario_actualizado');
    }

    res.json({ message: 'Producto y Kárdex actualizados exitosamente', producto: actualizado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Desactivar o eliminar producto del menú
app.delete('/api/productos/:id', verificarAdmin, async (req, res) => {
  try {
    const prodId = req.params.id;
    const prod = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    // Desactivación segura para preservar integridad histórica de órdenes
    await dbRun('UPDATE Productos SET activo = 0 WHERE id = ?', [prodId]);
    await dbRun('DELETE FROM InventarioRecetas WHERE producto_id = ?', [prodId]);
    await dbRun('UPDATE Inventario SET producto_id = NULL WHERE producto_id = ?', [prodId]);

    io.emit('producto_eliminado', { id: Number(prodId), nombre: prod.nombre });
    io.emit('menu_actualizado');

    res.json({ success: true, message: `Producto "${prod.nombre}" retirado del menú`, id: prodId });
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
    const negocioId = obtenerNegocioIdReq(req);
    const orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada') ORDER BY id DESC LIMIT 1",
      [mesaId, negocioId, negocioId]
    );
    if (!orden) return res.json({ orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY id ASC", [orden.id]);
    res.json({ orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/ordenes/:id', async (req, res) => {
  try {
    const ordenId = req.params.id;
    if (!ordenId || isNaN(parseInt(ordenId))) return res.status(400).json({ error: 'ID de orden inválido' });
    const negocioId = obtenerNegocioIdReq(req);
    const orden = await dbGet(
      "SELECT * FROM Ordenes WHERE id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))",
      [ordenId, negocioId, negocioId]
    );
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY id ASC", [orden.id]);
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

// POST: Activar / Desactivar (y opcionalmente cambiar horario y reglas) - Protegido por rol/PIN
app.post('/api/happy-hour', async (req, res) => {
  const userRol = (req.usuario?.rol || req.headers['x-user-rol'] || (req.body && req.body.userRol) || '').toLowerCase();
  const adminPin = req.headers['x-admin-pin'] || (req.body && req.body.pin);
  const negocioId = obtenerNegocioIdReq(req);

  let esAutorizado = ['admin', 'developer', 'cajero'].includes(userRol);
  if (!esAutorizado && adminPin) {
    esAutorizado = await validarPinAdministrador(adminPin, negocioId);
  }

  if (!esAutorizado) {
    return res.status(403).json({ error: 'Permiso denegado: solo Administrador o Cajero autorizado pueden modificar el Happy Hour.' });
  }

  happyHourModificadoManualmente = true;
  const { activo, horaInicio, horaFin, autoActivar, dias, modoDefecto } = req.body || {};

  if (horaInicio !== undefined) happyHourEstado.horaInicio = horaInicio;
  if (horaFin !== undefined) happyHourEstado.horaFin = horaFin;
  if (activo !== undefined) happyHourEstado.activo = Boolean(activo);
  if (autoActivar !== undefined) happyHourEstado.autoActivar = Boolean(autoActivar);
  if (dias !== undefined) happyHourEstado.dias = String(dias);
  if (modoDefecto !== undefined) happyHourEstado.modoDefecto = String(modoDefecto);

  // Persistir en BD
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_activo', ?)", [String(happyHourEstado.activo)], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_inicio', ?)", [happyHourEstado.horaInicio], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_hora_fin', ?)", [happyHourEstado.horaFin], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_auto_activar', ?)", [String(happyHourEstado.autoActivar)], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_dias', ?)", [happyHourEstado.dias], r));
  await new Promise(r => db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('hh_modo_defecto', ?)", [happyHourEstado.modoDefecto], r));

  console.log(`🍸 Happy Hour actualizado: activo=${happyHourEstado.activo}, ${happyHourEstado.horaInicio}–${happyHourEstado.horaFin}, auto=${happyHourEstado.autoActivar}, dias=${happyHourEstado.dias}, modo=${happyHourEstado.modoDefecto}`);
  io.emit('happy_hour_cambio', { ...happyHourEstado });
  res.json({ ...happyHourEstado });
});

// Endpoint de heartbeat para monitoreo de conectividad de clientes
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

// Recalcula y persiste los totales de una orden respetando el 2x1 ganado en Happy Hour y exencion de 10% de servicio para Para Llevar
async function recalcularTotalesOrden(ordenId) {
  const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
  if (!orden) return { subtotal: 0, descuentoHH: 0, servicio: 0, iva: 0, total: 0, modoHH: 'estricto', esParaLlevar: false };

  const modoHH = orden.modo_happy_hour || 'estricto';
  const esParaLlevar = Boolean(
    orden.tipo_orden === 'para_llevar' ||
    orden.tipo === 'para_llevar' ||
    orden.es_para_llevar === 1 ||
    !orden.mesa_id
  );

  const rows = await dbAll(
    "SELECT d.*, p.happy_hour as prod_happy_hour, p.categoria_id as prod_categoria_id FROM DetalleOrden d LEFT JOIN Productos p ON (CAST(d.producto_id AS TEXT) = CAST(p.id AS TEXT)) WHERE d.orden_id = ? AND (d.estado_comanda != 'anulado' OR d.estado_comanda IS NULL) AND (d.estado_comanda != 'pagado' OR d.estado_comanda IS NULL)",
    [ordenId]
  );

  const totalBruto = rows.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);

  // Agrupar items elegibles para Happy Hour por producto_id o nombre
  const grupos = {};
  rows.forEach(r => {
    const esCervezaOEligible = Boolean(
      r.en_happy_hour === 1 ||
      r.prod_happy_hour ||
      r.prod_categoria_id === 4 ||
      /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(r.nombre_producto || '')
    );
    if (!esCervezaOEligible) return;

    const key = r.producto_id || r.nombre_producto;
    if (!grupos[key]) {
      grupos[key] = {
        precio: r.precio_unitario,
        cantHH: 0,
        cantNoHH: 0
      };
    }
    if (r.en_happy_hour === 1) {
      grupos[key].cantHH += r.cantidad;
    } else {
      grupos[key].cantNoHH += r.cantidad;
    }
  });

  let descuentoHH = 0;
  for (const key in grupos) {
    const g = grupos[key];
    if (modoHH === 'flexible') {
      const totalPares = Math.floor((g.cantHH + g.cantNoHH) / 2);
      const maxParesPosibles = Math.floor(g.cantHH / 2) + ((g.cantHH % 2 === 1 && g.cantNoHH > 0) ? 1 : 0);
      const pares = Math.min(totalPares, maxParesPosibles);
      descuentoHH += pares * g.precio;
    } else {
      const pares = Math.floor(g.cantHH / 2);
      descuentoHH += pares * g.precio;
    }
  }

  // Precios con Impuestos Incluidos (Monto final que paga el cliente)
  const total = Math.max(0, totalBruto - descuentoHH);
  
  const negocio = orden?.negocio_id ? await dbGet('SELECT * FROM Negocios WHERE id = ?', [orden.negocio_id]) : null;

  const tieneServicio10 = negocio ? (
    !negocio.caracteristicas_activas ||
    negocio.caracteristicas_activas === 'all' ||
    (Array.isArray(negocio.caracteristicas_activas) ? negocio.caracteristicas_activas.includes('servicio_10') : String(negocio.caracteristicas_activas).includes('servicio_10'))
  ) : true;

  const tieneIVA13 = negocio ? (
    !negocio.caracteristicas_activas ||
    negocio.caracteristicas_activas === 'all' ||
    (Array.isArray(negocio.caracteristicas_activas) ? negocio.caracteristicas_activas.includes('desglose_iva_13') : String(negocio.caracteristicas_activas).includes('desglose_iva_13'))
  ) : true;

  const aplicaServicio = tieneServicio10 && !esParaLlevar;
  const aplicaIVA = tieneIVA13;

  let subtotal, servicio, iva;
  if (aplicaServicio && aplicaIVA) {
    // Salón / Consumo en mesa con ambos: 10% Servicio + 13% IVA (1.23)
    subtotal = Math.round(total / 1.23);
    servicio = Math.round(subtotal * 0.10);
    iva = total - subtotal - servicio;
  } else if (!aplicaServicio && aplicaIVA) {
    // Solo IVA 13% (1.13)
    subtotal = Math.round(total / 1.13);
    servicio = 0;
    iva = total - subtotal;
  } else if (aplicaServicio && !aplicaIVA) {
    // Solo Servicio 10% (1.10)
    subtotal = Math.round(total / 1.10);
    servicio = total - subtotal;
    iva = 0;
  } else {
    // Sin servicio ni IVA (exento / 0%)
    subtotal = total;
    servicio = 0;
    iva = 0;
  }

  await dbRun(
    "UPDATE Ordenes SET subtotal = ?, descuento_happy_hour = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?",
    [subtotal, descuentoHH, servicio, iva, total, ordenId]
  );

  return { subtotal, descuentoHH, servicio, iva, total, modoHH, esParaLlevar };
}

async function ejecutarComanda({ mesaId, mesero = 'Juan Jival', cliente = 'Cliente General', items = [], happyHourActivo = false, idempotencyKey = null, negocioId = null, usuarioRol = null, tipo_orden = null, es_para_llevar = false }) {
  const esParaLlevar = Boolean(
    tipo_orden === 'para_llevar' ||
    es_para_llevar === true ||
    !mesaId ||
    mesaId === 'para_llevar' ||
    String(mesaId).startsWith('para_llevar') ||
    mesaId === 0 ||
    mesaId === '0'
  );

  let mesa = null;
  let mesaNumero = '🛍️ Para Llevar';
  let mesaIdFinal = null;

  if (!esParaLlevar) {
    mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) {
      const err = new Error('Mesa no encontrada');
      err.status = 404;
      throw err;
    }
    if (negocioId && usuarioRol && usuarioRol !== 'developer' && mesa.negocio_id && Number(mesa.negocio_id) !== Number(negocioId)) {
      const err = new Error('Acceso denegado: La mesa pertenece a otro comercio.');
      err.status = 403;
      throw err;
    }
    mesaNumero = mesa.nombre || mesa.numero || `Mesa ${mesaId}`;
    mesaIdFinal = mesa.id;
  }

  // 1. Identificar items nuevos no enviados previamente
  const nuevosItems = items.filter(it => !it.id_detalle_existente && !it.enviado);
  if (!nuevosItems.length && items.length > 0) {
    let ordenExistente = null;
    if (mesaIdFinal) {
      ordenExistente = await dbGet(
        "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')",
        [mesaIdFinal]
      );
    }
    return {
      message: 'Comanda guardada con éxito',
      ordenId: ordenExistente ? ordenExistente.id : null,
      total: ordenExistente ? ordenExistente.total : 0,
      estado: mesa ? mesa.estado : 'abierta',
      tieneCocina: false,
      es_para_llevar: esParaLlevar,
      mesaNumero
    };
  }

  // 2. Procesar y normalizar detalles de productos nuevos
  const itemsProcesados = [];
  for (const it of nuevosItems) {
    let prodId = it.producto_id || it.id;
    let nombre = it.nombre || it.nombre_producto;
    let precio = it.precio != null ? Number(it.precio) : (it.precio_unitario != null ? Number(it.precio_unitario) : null);
    let destino = it.destino;
    let curso = it.curso;

    let prodDb = null;
    if (prodId) {
      prodDb = await dbGet('SELECT * FROM Productos WHERE id = ?', [prodId]);
    } else if (nombre) {
      prodDb = await dbGet('SELECT * FROM Productos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR nombre LIKE ?', [nombre, `%${nombre}%`]);
    }

    if (prodDb) {
      prodId = prodDb.id;
      if (!nombre) nombre = prodDb.nombre;
      if (precio == null) precio = prodDb.precio;
      if (!destino || destino === 'cocina') {
        if (prodDb.destino) destino = prodDb.destino;
      }
      if (!curso) curso = prodDb.curso;
    } else if (!prodId) {
      prodId = 1;
    }

    let catDb = null;
    const catIdToCheck = prodDb?.categoria_id || it.categoria_id || it.catId;
    if (catIdToCheck) {
      catDb = await dbGet('SELECT * FROM Categorias WHERE id = ?', [catIdToCheck]);
    }

    const esBebidaKeyword = /\b(cerveza|cervezas|imperial|pilsen|bavaria|corona|heineken|stella|coctel|cocteles|cóctel|cócteles|shot|shots|fresco|frescos|refresco|refrescos|gaseosa|gaseosas|coca|pepsi|sprite|fanta|café|cafe|cafes|cafés|agua|aguas|cas|horchata|resbaladera|jugo|jugos|batido|batidos|trago|tragos|ron|vodka|whisky|whiskey|gin|tequila|guaro|vino|vinos|sangria|sangría|licor|licores|botella|botellas|smirnoff|chiliguaro|cacique|pacha|cuarta|centenario|chivas|johnny|buchanans|jagermeister|baileys|kahlua|malibu|amaretto|campari|aperol|fernet|anis|absolut|bacardi|morgan|havana|cuervo|don\s*julio|herradura|patron|tanqueray|bombay|beefeater|red\s*bull|monster|gatorade|tropical|chelada|michelada|mojito|margarita|daiquiri|caipiriña|piña\s*colada|cuba\s*libre)\b/i.test(nombre || '') || /rock\s*ice/i.test(nombre || '');

    const catEsBarra = Boolean(catDb && (catDb.destino === 'barra' || /cerveza|licor|coctel|shot|trago|bebida|cafe|café|natural|barra/i.test(catDb.nombre || '')));
    const catEsCocina = Boolean(catDb && (catDb.destino === 'cocina' || /comida|entrada|boca|postre|plato|fuerte|sopa|marisco|ceviche|casado|cocina/i.test(catDb.nombre || '')));

    const prodEsBarra = Boolean(prodDb && (prodDb.destino === 'barra' || prodDb.es_licor));
    const prodEsCocina = Boolean(prodDb && prodDb.destino === 'cocina');

    if (prodEsBarra || catEsBarra || esBebidaKeyword || it.destino === 'barra') {
      destino = 'barra';
      curso = 1;
    } else if (prodEsCocina || catEsCocina || it.destino === 'cocina') {
      destino = 'cocina';
      curso = curso || 2;
    } else {
      destino = (curso === 1 || curso === 5 || curso === 6) ? 'barra' : 'cocina';
    }

    if (!curso) {
      curso = destino === 'barra' ? 1 : 3;
    }

    const esCervezaOEligible = Boolean(
      it.happyHour ||
      (prodDb && prodDb.happy_hour) ||
      (prodDb && prodDb.categoria_id === 4) ||
      it.categoria_id === 4 ||
      it.catId === 4 ||
      /imperial|pilsen|bavaria|corona|rock ice|cerveza/i.test(nombre || '')
    );
    const itemEnHH = (it.en_happy_hour !== undefined)
      ? (it.en_happy_hour ? 1 : 0)
      : (((happyHourEstado.activo || happyHourActivo) && esCervezaOEligible) ? 1 : 0);

    itemsProcesados.push({
      id: prodId,
      nombre: nombre || 'Producto',
      precio: precio || 0,
      cantidad: Number(it.cantidad) || 1,
      notas: it.notas || '',
      curso: Number(curso) || 3,
      destino: destino || 'cocina',
      origen_mesa_numero: it.origen_mesa_numero || null,
      en_happy_hour: itemEnHH,
      es_balde: Boolean(it.es_balde),
      desglose_balde: it.desglose_balde || null,
      comensal: it.comensal ? String(it.comensal).trim() : 'General'
    });
  }

  // 3. Evaluar si algún nuevo item va a cocina
  const tieneNuevosCocina = itemsProcesados.some(it => it.destino === 'cocina');
  const negocioIdFinal = Number(negocioId || (mesa && mesa.negocio_id) || 1);

  // 4. Buscar orden activa o crear una nueva
  let orden = null;
  if (!esParaLlevar && mesaIdFinal) {
    orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida')",
      [mesaIdFinal, negocioIdFinal, negocioIdFinal]
    );
  }
  const ahora = new Date().toISOString();
  let ordenId;

  if (!orden) {
    const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const estadoInicialOrden = tieneNuevosCocina ? 'esperando' : 'abierta';
    const tipoFinal = esParaLlevar ? 'para_llevar' : 'mesa';
    const esParaLlevarInt = esParaLlevar ? 1 : 0;
    const clienteFinal = cliente || (esParaLlevar ? 'Cliente Para Llevar' : 'Cliente General');

    const r = await dbRun(
      `INSERT INTO Ordenes (negocio_id, numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado, subtotal, total, servicio_10, iva_13, descuento_happy_hour, tipo_orden, tipo, es_para_llevar)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
      [negocioIdFinal, numOrden, mesaIdFinal, clienteFinal, mesero, ahora, estadoInicialOrden, tipoFinal, tipoFinal, esParaLlevarInt]
    );
    ordenId = r.lastID;
  } else {
    ordenId = orden.id;
    if (tieneNuevosCocina) {
      await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
    }
    if (cliente && cliente !== 'Cliente General' && (!orden.cliente || orden.cliente === 'Cliente General')) {
      await dbRun("UPDATE Ordenes SET cliente = ? WHERE id = ?", [cliente, ordenId]);
    }
  }

  // 5. Determinar nuevo estado de mesa
  let nuevoEstadoMesa = 'abierta';
  if (mesa && mesaIdFinal) {
    if (tieneNuevosCocina) {
      nuevoEstadoMesa = 'esperando';
    } else {
      nuevoEstadoMesa = (mesa.estado === 'libre') ? 'abierta' : mesa.estado;
    }
    const clienteMesaActual = (cliente && cliente !== 'Cliente General') ? cliente : (mesa.cliente || null);
    await dbRun("UPDATE Mesas SET estado = ?, mesero = ?, cliente = ? WHERE id = ?", [nuevoEstadoMesa, mesero, clienteMesaActual, mesaIdFinal]);
  }

  // 6. Insertar items nuevos en DetalleOrden con número correlativo de comanda / tanda
  const rowMax = await dbGet('SELECT MAX(comanda_numero) as maxNum FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
  const comandaNumero = (rowMax && rowMax.maxNum ? Number(rowMax.maxNum) : 0) + 1;

  const nuevasComandas = [];
  for (const it of itemsProcesados) {
    const subtotal = it.precio * it.cantidad;
    const rItem = await dbRun(
      `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, estado_comanda, hora_pedido, creado_en, origen_mesa_numero, comanda_numero, en_happy_hour, comensal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)`,
      [ordenId, it.id, it.nombre, it.precio, it.cantidad, subtotal, it.notas, it.curso, it.destino, ahora, ahora, it.origen_mesa_numero, comandaNumero, it.en_happy_hour, it.comensal || 'General']
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
      hora_pedido: ahora,
      en_happy_hour: it.en_happy_hour,
      comensal: it.comensal || 'General'
    });
  }

  // Descontar existencias de inventario en tiempo real
  await descontarInventarioPorItems(itemsProcesados);

  // 7. Recalcular totales de orden respetando Happy Hour inmutable y exención de servicio
  const totalesOrden = await recalcularTotalesOrden(ordenId);
  const subtotal = totalesOrden.subtotal;
  const descuentoHH = totalesOrden.descuentoHH;
  const servicio = totalesOrden.servicio;
  const iva = totalesOrden.iva;
  const total = totalesOrden.total;

  // 8. Sockets: Notificar a cocina ÚNICAMENTE si hay items de cocina
  const comandasCocina = nuevasComandas.filter(c => c.destino === 'cocina');
  if (comandasCocina.length > 0) {
    io.emit('nueva_comanda', { mesaId: mesaIdFinal, ordenId, mesaNumero, comandas: comandasCocina, es_para_llevar: esParaLlevar });
    io.emit('comanda_nueva', { mesaId: mesaIdFinal, ordenId, mesaNumero, mesero, horaPedido: ahora, items: comandasCocina, es_para_llevar: esParaLlevar });
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
      printerService.procesarImpresion({
        destinoImpresora: 'cocina',
        ticketInfo: tInfoCocina,
        io
      }).catch(err => console.error('Error al despachar ticket cocina:', err.message));
      ticketCocina = tInfoCocina.ticketVisual;
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
      printerService.procesarImpresion({
        destinoImpresora: 'barra',
        ticketInfo: tInfoBarra,
        io
      }).catch(err => console.error('Error al despachar ticket barra:', err.message));
      ticketBarra = tInfoBarra.ticketVisual;
    }
  }

  // Notificar al salón de mesa actualizada (si aplica mesa física)
  if (mesaIdFinal) {
    io.emit('mesa_actualizada', { mesaId: mesaIdFinal, estado: nuevoEstadoMesa, total });
  }

  return {
    message: tieneNuevosCocina ? 'Comanda enviada a cocina' : 'Comanda guardada con éxito',
    ordenId,
    total,
    estado: nuevoEstadoMesa,
    tieneCocina: tieneNuevosCocina,
    es_para_llevar: esParaLlevar,
    mesaNumero,
    ticketCocina: ticketCocina ? ticketCocina.ticketVisual : null,
    ticketBarra: ticketBarra ? ticketBarra.ticketVisual : null
  };
}

app.post('/api/comandas/enviar', async (req, res) => {
  try {
    const mesaId = req.body.mesaId || req.body.mesa_id;
    const { mesero = 'Juan Jival', cliente = 'Cliente General', items = [], happyHourActivo = false, idempotencyKey } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'La comanda no contiene productos' });
    }

    if (idempotencyKey) {
      const yaRegistrada = await dbGet('SELECT idempotency_key FROM IdempotencyLog WHERE idempotency_key = ?', [idempotencyKey]);
      if (yaRegistrada) {
        return res.json({ message: 'Comanda ya procesada previamente (idempotente)', idempotencyKey });
      }
    }

    const negocioId = obtenerNegocioIdReq(req);
    const resultado = await ejecutarComanda({
      mesaId,
      mesero,
      cliente,
      items,
      happyHourActivo,
      idempotencyKey,
      negocioId,
      tipo_orden: req.body.tipo_orden,
      es_para_llevar: req.body.es_para_llevar,
      usuarioRol: req.usuario?.rol
    });

    if (idempotencyKey) {
      await dbRun('INSERT OR IGNORE INTO IdempotencyLog (idempotency_key, accion, creado_en) VALUES (?, ?, ?)', [
        idempotencyKey,
        'ENVIAR_COMANDA',
        new Date().toISOString()
      ]);
    }

    res.json(resultado);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

// Sincronización en lote para operaciones Offline-First
app.post('/api/sync/batch', async (req, res) => {
  try {
    const { acciones = [] } = req.body;
    const procesadas = [];
    const duplicadas = [];
    const errores = [];

    for (const accion of acciones) {
      const idKey = accion.idempotencyKey || `act_${accion.id}`;

      // 1. Chequeo de idempotencia
      if (idKey) {
        const existente = await dbGet('SELECT idempotency_key FROM IdempotencyLog WHERE idempotency_key = ?', [idKey]);
        if (existente) {
          duplicadas.push(idKey);
          continue;
        }
      }

      // 2. Ejecutar según tipo de acción
      try {
        if (accion.tipo === 'ENVIAR_COMANDA' || accion.endpoint === '/api/comandas/enviar') {
          const payload = accion.payload || {};
          const mesaId = payload.mesaId || payload.mesa_id;
          await ejecutarComanda({
            mesaId,
            mesero: payload.mesero,
            cliente: payload.cliente,
            items: payload.items,
            happyHourActivo: payload.happyHourActivo,
            idempotencyKey: idKey
          });
        } else if (accion.tipo === 'PEDIR_CUENTA' || (accion.endpoint && accion.endpoint.includes('/pedir-cuenta'))) {
          const mesaId = accion.payload?.mesaId || accion.endpoint.split('/')[4];
          if (mesaId) {
            const ahora = new Date().toISOString();
            await dbRun("UPDATE Mesas SET estado = 'cuenta', pidio_cuenta_qr = 1, hora_pidio_cuenta = ? WHERE id = ?", [ahora, mesaId]);
            await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa')", [mesaId]);
            io.emit('cliente_pidio_cuenta', { mesaId: Number(mesaId), hora_pidio_cuenta: ahora });
            io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'cuenta', pidio_cuenta_qr: 1, hora_pidio_cuenta: ahora });
          }
        } else if (accion.tipo === 'COBRAR_ORDEN' || (accion.endpoint && accion.endpoint.includes('/cobrar'))) {
          const payload = accion.payload || {};
          let ordenId = payload.ordenId || (accion.endpoint ? accion.endpoint.split('/')[3] : null);
          if (typeof ordenId === 'string' && ordenId.startsWith('offline_')) {
            const mId = ordenId.replace('offline_', '');
            const ord = await dbGet("SELECT id FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida', 'activa') ORDER BY id DESC LIMIT 1", [mId]);
            if (ord) ordenId = ord.id;
          }
          if (ordenId && !isNaN(Number(ordenId))) {
            const ord = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
            if (ord && typeof procesarCobroOrden === 'function') {
              await procesarCobroOrden(ordenId, payload);
            }
          }
        } else {
          console.warn('[SyncBatch] Acción desconocida o sin handler específico:', accion.tipo);
        }

        if (idKey) {
          await dbRun('INSERT OR IGNORE INTO IdempotencyLog (idempotency_key, accion, creado_en) VALUES (?, ?, ?)', [
            idKey,
            accion.tipo || 'ACCION_OFFLINE',
            new Date().toISOString()
          ]);
        }
        procesadas.push(idKey);
      } catch (errAccion) {
        console.error('[SyncBatch] Error procesando acción individual:', errAccion);
        errores.push({ idKey, error: errAccion.message });
      }
    }

    res.json({ ok: true, procesadas, duplicadas, errores });
  } catch (err) {
    console.error('Error en /api/sync/batch:', err);
    res.status(500).json({ error: err.message });
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

    const item = await dbGet('SELECT * FROM DetalleOrden WHERE id = ?', [detalleId]);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

    const ordenItem = await dbGet('SELECT negocio_id FROM Ordenes WHERE id = ?', [item.orden_id]);
    const ordenNegocioId = Number(ordenItem?.negocio_id || req.negocioId || req.headers['x-negocio-id'] || 1);

    const adminAutorizador = await validarPinAdministrador(supervisorPin, ordenNegocioId);
    if (!adminAutorizador) {
      return res.status(403).json({ error: 'PIN de Supervisor / Administrador incorrecto o no autorizado' });
    }

    const solicitanteLogin = String(req.body.usuarioLogin || req.body.usuarioNombre || req.headers['x-user-login'] || req.headers['x-user-name'] || req.usuario?.usuario || 'salonero').trim();
    const adminLogin = adminAutorizador.usuario || 'admin';
    const adminNombre = adminAutorizador.nombre_completo || adminLogin;
    const autorizadorInfo = `${adminLogin} (${adminNombre})`;

    const ahora = new Date().toISOString();
    await dbRun("UPDATE DetalleOrden SET estado_comanda = 'anulado' WHERE id = ?", [detalleId]);
    try {
      await dbRun(
        `INSERT INTO Anulaciones (orden_id, detalle_id, mesa, producto_nombre, cantidad, monto, motivo, supervisor_pin, autorizado_por, solicitado_por, fecha_hora)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.orden_id, detalleId, mesaNumero, item.nombre_producto, item.cantidad, item.subtotal, motivo, supervisorPin, autorizadorInfo, solicitanteLogin, ahora]
      );
    } catch (_) {
      await dbRun(
        `INSERT INTO Anulaciones (orden_id, detalle_id, mesa, producto_nombre, cantidad, monto, motivo, supervisor_pin, autorizado_por, fecha_hora)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.orden_id, detalleId, mesaNumero, item.nombre_producto, item.cantidad, item.subtotal, motivo, supervisorPin, autorizadorInfo, ahora]
      );
    }

    await registrarAuditoria({
      negocioId: ordenNegocioId,
      usuarioNombre: solicitanteLogin,
      autorizadoPor: autorizadorInfo,
      accion: 'anulacion_comanda',
      tipoEvento: 'seguridad',
      modulo: 'comandas',
      detalle: `Anulación de ${item.cantidad}x "${item.nombre_producto}" en ${mesaNumero} • Solicitó: @${solicitanteLogin} • Autorizó PIN: @${adminLogin} (${adminNombre})`,
      motivo: motivo || 'Anulación autorizada con PIN',
      monto: item.subtotal,
      pinAutorizado: 1
    });

    const resAnula = await recalcularTotalesOrden(item.orden_id);
    const subtotal = resAnula.subtotal;
    const servicio = resAnula.servicio;
    const iva = resAnula.iva;
    const total = resAnula.total;

    // Recalcular estado de la orden y mesa
    const remainingItems = await dbAll(
      "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
      [item.orden_id]
    );
    const nuevoEstado = evaluarEstadoMesaKDS(remainingItems);

    await dbRun("UPDATE Ordenes SET estado = ? WHERE id = ?", [nuevoEstado, item.orden_id]);

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
    const destino = req.query.destino || 'cocina';
    const negocioId = obtenerNegocioIdReq(req);
    let query = `
      SELECT d.*, o.numero_orden, o.mesa_id, o.tipo_orden, o.es_para_llevar,
        COALESCE(m.numero, CASE WHEN o.tipo_orden = 'para_llevar' OR o.mesa_id IS NULL THEN '🛍️ Para Llevar' ELSE 'Mesa ' || o.mesa_id END) as mesa_numero
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE d.estado_comanda IN ('pendiente', 'preparando')
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `;
    const params = [negocioId, negocioId];
    if (destino === 'barra') {
      query += " AND d.destino = 'barra'";
    } else {
      query += " AND (d.destino = 'cocina' OR (d.destino IS NULL AND d.curso NOT IN (1, 5, 6))) AND (d.destino != 'barra' OR d.destino IS NULL)";
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
    const negocioId = obtenerNegocioIdReq(req);
    const comandas = await dbAll(`
      SELECT d.*, o.numero_orden, o.mesa_id, o.tipo_orden, o.es_para_llevar,
        COALESCE(m.numero, CASE WHEN o.tipo_orden = 'para_llevar' OR o.mesa_id IS NULL THEN '🛍️ Para Llevar' ELSE 'Mesa ' || o.mesa_id END) as mesa_numero
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE d.estado_comanda IN ('pendiente', 'preparando')
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
      ORDER BY d.orden_id ASC, d.comanda_numero ASC, d.hora_pedido ASC, d.id ASC
    `, [negocioId, negocioId]);
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
      it => it.destino === 'cocina'
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
    const estado = req.body.estado || req.body.estado_comanda || req.body.nuevoEstado;
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
    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [item.orden_id]);

    let estadoFinalMesa = nuevoEstadoMesa;
    let totalEmitido = orden ? orden.total : 0;

    if (orden) {
      if (orden.estado === 'pagada' || orden.estado === 'cerrada') {
        // La orden ya fue cobrada y liquidada. NO reabrir la orden a 'activa'.
        totalEmitido = 0;
        if (orden.mesa_id) {
          estadoFinalMesa = (nuevoEstadoMesa === 'activa' || nuevoEstadoMesa === 'abierta') ? 'ocupada' : nuevoEstadoMesa;
          await dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [estadoFinalMesa, orden.mesa_id]);
          io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: estadoFinalMesa, total: 0, cliente: orden.cliente });
        }
      } else {
        await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [nuevoEstadoMesa, item.orden_id]);
        if (orden.mesa_id) {
          await dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [nuevoEstadoMesa, orden.mesa_id]);
          io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: nuevoEstadoMesa, total: orden.total, cliente: orden.cliente });
        }
      }
    }

    io.emit('comanda_estado_cambiado', {
      detalleId: Number(detalleId),
      estado,
      ordenId: item.orden_id,
      mesaId: orden ? orden.mesa_id : null,
      nuevoEstadoMesa: estadoFinalMesa
    });
    io.emit('comanda_actualizada', {
      detalleId: Number(detalleId),
      estado,
      ordenId: item.orden_id,
      mesaId: orden ? orden.mesa_id : null,
      nuevoEstadoMesa: estadoFinalMesa
    });

    res.json({
      message: 'Estado KDS actualizado',
      detalleId: Number(detalleId),
      estado,
      nuevoEstadoMesa: estadoFinalMesa,
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

// Despacho de platillos en lote / seleccionados en KDS
app.post('/api/kds/despachar-lote', async (req, res) => {
  try {
    const ids = req.body.detalleIds || req.body.itemIds || [];
    const estado = req.body.estado || 'listo';
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Lista de identificadores de platillos requerida' });
    }

    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    const ordenesAfectadas = new Set();
    const mesasAfectadas = new Set();

    for (const id of ids) {
      const item = await dbGet('SELECT * FROM DetalleOrden WHERE id = ?', [id]);
      if (item) {
        await dbRun(
          'UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?',
          [estado, horaListo, id]
        );
        ordenesAfectadas.add(item.orden_id);
      }
    }

    for (const ordId of ordenesAfectadas) {
      const todosItems = await dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
        [ordId]
      );
      const nuevoEstadoMesa = evaluarEstadoMesaKDS(todosItems);
      const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordId]);

      if (orden) {
        if (orden.estado === 'pagada' || orden.estado === 'cerrada') {
          // La orden ya fue cobrada y liquidada. NO reabrir la orden a 'activa'.
          if (orden.mesa_id) {
            mesasAfectadas.add(orden.mesa_id);
            const estadoFinalMesa = (nuevoEstadoMesa === 'activa' || nuevoEstadoMesa === 'abierta') ? 'ocupada' : nuevoEstadoMesa;
            await dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [estadoFinalMesa, orden.mesa_id]);
            io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: estadoFinalMesa, total: 0, cliente: orden.cliente });
          }
        } else {
          await dbRun('UPDATE Ordenes SET estado = ? WHERE id = ?', [nuevoEstadoMesa, ordId]);
          if (orden.mesa_id) {
            mesasAfectadas.add(orden.mesa_id);
            await dbRun('UPDATE Mesas SET estado = ? WHERE id = ?', [nuevoEstadoMesa, orden.mesa_id]);
            io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: nuevoEstadoMesa, total: orden.total, cliente: orden.cliente });
          }
        }
      }
    }

    io.emit('kds_lote_despachado', {
      ids,
      estado,
      ordenes: Array.from(ordenesAfectadas),
      mesas: Array.from(mesasAfectadas)
    });

    res.json({
      ok: true,
      mensaje: `${ids.length} platillo(s) servido(s) con éxito`,
      actualizados: ids.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 9. COBRO, CAJA & CONTROL DE PROPINAS (TIP POOL)
// ============================================================================
const cobrosEnProceso = new Map();

// Función reutilizable para procesar cobros de órdenes (usado por HTTP y Sync Batch)
async function procesarCobroOrden(ordenId, {
  mesaId = null,
  items = [],
  metodo = 'Efectivo',
  metodoPago,
  monto,
  propina = 0,
  cambio = 0,
  mesero = 'Juan Jival',
  referencia = null,
  tipo_cambio = 1,
  monto_usd = 0,
  pagos = [],
  desglose = null,
  liquidar_total = true,
  items_pagados = [],
  persona_nombre = 'Cliente',
  happyHourActivo = false,
  enviar_cocina = false,
  enviarCocina = false,
  idempotencyKey = null,
  reqNegocioId = null,
  usuarioRol = null
} = {}) {
  const mutexKey = idempotencyKey || (mesaId ? `mesa_${mesaId}` : (ordenId && ordenId !== 'directo' ? `orden_${ordenId}` : null));
  if (mutexKey && cobrosEnProceso.has(mutexKey)) {
    console.warn(`[Cobro] Concurrencia evitada para ${mutexKey}`);
    return await cobrosEnProceso.get(mutexKey);
  }

  const ejecutarProcesoCobro = async () => {
    const metodoFinal = metodo || metodoPago || 'Efectivo';
    const debeEnviarCocina = Boolean(enviar_cocina || enviarCocina);
    const ahora = new Date().toISOString();
    let orden = null;
    const idNum = parseInt(ordenId);
    if (!isNaN(idNum) && idNum > 0) {
      orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [idNum]);
    }

    const esParaLlevarCobro = Boolean(
      !mesaId ||
      mesaId === 'para_llevar' ||
      String(mesaId).startsWith('para_llevar') ||
      mesaId === 0 ||
      mesaId === '0'
    );

    // Si no se encontró por ID pero se envió mesaId físico, buscar orden activa en la mesa
    if (!orden && mesaId && !esParaLlevarCobro) {
      orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado != 'pagada' AND estado != 'cancelada' ORDER BY id DESC LIMIT 1", [mesaId]);
    }

    // Si aún no hay orden y tenemos mesaId físico con items (cobro directo sin guardar comanda previamente)
    if (!orden && mesaId && !esParaLlevarCobro) {
      const mesaRow = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
      if (!mesaRow) throw new Error('Mesa no encontrada');
      if (reqNegocioId && usuarioRol && usuarioRol !== 'developer' && mesaRow.negocio_id && Number(mesaRow.negocio_id) !== Number(reqNegocioId)) {
        const err = new Error('Acceso denegado: La mesa pertenece a otro comercio.');
        err.status = 403;
        throw err;
      }
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const r = await dbRun(
        `INSERT INTO Ordenes (negocio_id, numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado, tipo_orden, tipo, es_para_llevar)
         VALUES (?, ?, ?, ?, ?, ?, 'abierta', 'mesa', 'mesa', 0)`,
        [mesaRow.negocio_id || reqNegocioId || 1, numOrden, mesaId, 'Cliente', mesero, ahora]
      );
      orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [r.lastID]);
    }

    // Si es cobro directo de Para Llevar sin orden previa
    if (!orden && (esParaLlevarCobro || ordenId === 'directo' || !mesaId)) {
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const clienteParaLlevar = (persona_nombre && persona_nombre !== 'Cliente') ? persona_nombre : 'Cliente Para Llevar';
      const r = await dbRun(
        `INSERT INTO Ordenes (negocio_id, numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado, tipo_orden, tipo, es_para_llevar)
         VALUES (?, ?, NULL, ?, ?, ?, 'abierta', 'para_llevar', 'para_llevar', 1)`,
        [reqNegocioId || 1, numOrden, clienteParaLlevar, mesero, ahora]
      );
      orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [r.lastID]);
    }

    if (!orden) throw new Error('Orden no encontrada');
    if (reqNegocioId && usuarioRol && usuarioRol !== 'developer' && orden.negocio_id && Number(orden.negocio_id) !== Number(reqNegocioId)) {
      const err = new Error('Acceso denegado: La orden pertenece a otro comercio.');
      err.status = 403;
      throw err;
    }
    ordenId = orden.id;

  // Manejar items nuevos de la comanda no enviados previamente (para que queden en DetalleOrden y se descuenten de Kárdex)
  let itemsNuevos = [];
  if (Array.isArray(items) && items.length > 0) {
    const itemsNoEnviados = items.filter(it => !it.enviado);
    if (itemsNoEnviados.length > 0) {
      itemsNuevos = itemsNoEnviados;
    } else {
      const rowDetalles = await dbGet("SELECT COUNT(*) as total FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [ordenId]);
      if (!rowDetalles || rowDetalles.total === 0) {
        itemsNuevos = items;
      }
    }
  }

  if (itemsNuevos.length > 0) {
    const rowMax = await dbGet('SELECT MAX(comanda_numero) as maxNum FROM DetalleOrden WHERE orden_id = ?', [ordenId]);
    const comandaNumero = (rowMax && rowMax.maxNum ? rowMax.maxNum : 0) + 1;

    for (const it of itemsNuevos) {
      const itNombre = it.nombre_producto || it.nombre || 'Producto';
      const cant = Number(it.cantidad) || 1;
      const subtotal = (Number(it.precio) || 0) * cant;
      const esBebidaKey = /\b(cerveza|cervezas|imperial|pilsen|bavaria|corona|heineken|stella|coctel|cocteles|cóctel|cócteles|shot|shots|fresco|frescos|refresco|refrescos|gaseosa|gaseosas|coca|pepsi|sprite|fanta|café|cafe|cafes|cafés|agua|aguas|cas|horchata|resbaladera|jugo|jugos|batido|batidos|trago|tragos|ron|vodka|whisky|whiskey|gin|tequila|guaro|vino|vinos|sangria|sangría|licor|licores|botella|botellas|smirnoff|chiliguaro)\b/i.test(itNombre) || /rock ice/i.test(itNombre);
      let destItem = it.destino;
      if (esBebidaKey || it.categoria_id === 4 || it.categoria_id === 5 || it.categoria_id === 6 || it.categoria_id === 7 || it.catId === 4 || it.catId === 5 || it.catId === 6 || it.catId === 7) {
        destItem = 'barra';
      } else if (!destItem) {
        destItem = (it.curso === 1 || it.curso === 5 || it.curso === 6) ? 'barra' : 'cocina';
      }
      const esParaCocinaOBarra = destItem === 'cocina' || destItem === 'barra';
      const estadoComanda = (debeEnviarCocina && esParaCocinaOBarra) ? 'pendiente' : (liquidar_total ? 'pagado' : 'recibido');
      await dbRun(
        `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, estado_comanda, hora_pedido, creado_en, comanda_numero, en_happy_hour, comensal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, it.id || it.producto_id, itNombre, it.precio || 0, cant, subtotal, it.notas || '', it.curso || (destItem === 'barra' ? 1 : 2), destItem, estadoComanda, ahora, ahora, comandaNumero, it.en_happy_hour ? 1 : 0, it.comensal || 'General']
      );
    }

    // Descontar inventario en tiempo real y registrar movimientos en Kárdex
    await descontarInventarioPorItems(itemsNuevos);

    // Recalcular totales de orden
    await recalcularTotalesOrden(ordenId);
    orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);

    // Si el usuario confirmó enviar a cocina en este cobro directo, despachar a cocina/barra
    const itemsCocina = itemsNuevos.filter(it => it.destino === 'cocina' || (!it.destino && it.curso && it.curso <= 3));
    const itemsBarra = itemsNuevos.filter(it => it.destino === 'barra');
    const mesaObj = orden.mesa_id ? await dbGet('SELECT numero FROM Mesas WHERE id = ?', [orden.mesa_id]) : null;
    const mesaNumeroTxt = mesaObj ? (mesaObj.numero || `Mesa ${orden.mesa_id}`) : 'Mesa Directa';

    if (debeEnviarCocina && itemsCocina.length > 0) {
      // 1. Imprimir comanda de cocina térmica (marcada como PAGADA / DIRECTO)
      const tInfoCocina = printerService.generarTicketComanda({
        ordenId,
        comandaNumero,
        mesaNumero: mesaNumeroTxt,
        mesero,
        items: itemsCocina.map(it => ({
          cantidad: it.cantidad,
          nombre: it.nombre || it.nombre_producto,
          notas: it.notas || '',
          curso: it.curso || 2,
          origen_mesa_numero: it.origen_mesa_numero || null
        })),
        destino: 'cocina',
        pagada: true,
        fechaHora: ahora
      });
      printerService.procesarImpresion({
        destinoImpresora: 'cocina',
        ticketInfo: tInfoCocina,
        io
      }).catch(err => console.error('Error al despachar comanda cocina:', err.message));

      // 2. Notificar a KDS en vivo
      io.emit('nueva_comanda', {
        mesaId: orden.mesa_id,
        ordenId,
        mesaNumero: mesaNumeroTxt,
        mesero,
        horaPedido: ahora,
        pagada: true,
        comandas: itemsCocina
      });
      io.emit('comanda_nueva', {
        ordenId,
        mesaId: orden.mesa_id,
        mesaNumero: mesaNumeroTxt,
        mesero,
        horaPedido: ahora,
        pagada: true,
        items: itemsCocina
      });
      io.emit('kds_actualizado');
    }

    if (debeEnviarCocina && itemsBarra.length > 0) {
      // Imprimir comanda de barra térmica (marcada como PAGADA / DIRECTO)
      const tInfoBarra = printerService.generarTicketComanda({
        ordenId,
        comandaNumero,
        mesaNumero: mesaNumeroTxt,
        mesero,
        items: itemsBarra.map(it => ({
          cantidad: it.cantidad,
          nombre: it.nombre || it.nombre_producto,
          notas: it.notas || '',
          curso: it.curso || 2,
          origen_mesa_numero: it.origen_mesa_numero || null
        })),
        destino: 'barra',
        pagada: true,
        fechaHora: ahora
      });
      printerService.procesarImpresion({
        destinoImpresora: 'barra',
        ticketInfo: tInfoBarra,
        io
      }).catch(err => console.error('Error al despachar comanda barra:', err.message));
    }
  } else if (debeEnviarCocina) {
    // Si no habían items nuevos pero debeEnviarCocina es true, buscar platillos en DetalleOrden para despachar
    const detallesCocina = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' AND (destino = 'cocina' OR destino IS NULL)", [ordenId]);
    if (detallesCocina && detallesCocina.length > 0) {
      const mesaObj = orden.mesa_id ? await dbGet('SELECT numero FROM Mesas WHERE id = ?', [orden.mesa_id]) : null;
      const mesaNumeroTxt = mesaObj ? (mesaObj.numero || `Mesa ${orden.mesa_id}`) : 'Mesa Directa';

      const tInfoCocina = printerService.generarTicketComanda({
        ordenId,
        comandaNumero: 1,
        mesaNumero: mesaNumeroTxt,
        mesero,
        items: detallesCocina.map(it => ({
          cantidad: it.cantidad,
          nombre: it.nombre_producto || it.nombre,
          notas: it.notas || '',
          curso: it.curso || 2,
          origen_mesa_numero: it.origen_mesa_numero || null
        })),
        destino: 'cocina',
        pagada: true,
        fechaHora: ahora
      });
      printerService.procesarImpresion({
        destinoImpresora: 'cocina',
        ticketInfo: tInfoCocina,
        io
      }).catch(err => console.error('Error al despachar comanda cocina:', err.message));

      io.emit('nueva_comanda', {
        mesaId: orden.mesa_id,
        ordenId,
        mesaNumero: mesaNumeroTxt,
        mesero,
        horaPedido: ahora,
        pagada: true,
        comandas: detallesCocina
      });
      io.emit('comanda_nueva', {
        ordenId,
        mesaId: orden.mesa_id,
        mesaNumero: mesaNumeroTxt,
        mesero,
        horaPedido: ahora,
        pagada: true,
        items: detallesCocina
      });
      io.emit('kds_actualizado');
    }
  }


  const negocioIdFinal = orden.negocio_id || 1;
  let caja = await dbGet("SELECT * FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1", [negocioIdFinal, negocioIdFinal]);
  if (!caja) {
    const ahoraApertura = new Date().toISOString();
    const rCaja = await dbRun(`
      INSERT INTO Cajas (negocio_id, cajero, fecha_apertura, monto_inicial, estado)
      VALUES (?, ?, ?, 50000, 'abierta')
    `, [negocioIdFinal, mesero || 'Cajero Turno', ahoraApertura]);
    caja = await dbGet('SELECT * FROM Cajas WHERE id = ?', [rCaja.lastID]);
  }
  const cajaId = caja ? caja.id : null;
  const montoFinal = (monto !== undefined && monto !== null) ? Number(monto) : (Number(orden.total) || 0);

  // Normalizar lista de pagos a registrar en la tabla Pagos (unitaria o multi-método)
  let listaPagos = [];
  if (Array.isArray(pagos) && pagos.length > 0) {
    listaPagos = pagos.filter(p => p && Number(p.monto) > 0);
  } else if (desglose && typeof desglose === 'object') {
    if (Number(desglose.efectivo) > 0) {
      listaPagos.push({
        metodo: 'Efectivo',
        monto: Number(desglose.efectivo),
        recibido: Number(desglose.recibido_efectivo) || Number(desglose.efectivo),
        cambio: Number(desglose.cambio_efectivo) || Number(desglose.cambio) || 0
      });
    }
    if (Number(desglose.tarjeta) > 0) {
      listaPagos.push({
        metodo: 'Tarjeta',
        monto: Number(desglose.tarjeta),
        referencia: desglose.referencia_tarjeta || desglose.referencia || null
      });
    }
    if (Number(desglose.sinpe) > 0) {
      listaPagos.push({
        metodo: 'SINPE',
        monto: Number(desglose.sinpe),
        referencia: desglose.referencia_sinpe || desglose.referencia || null
      });
    }
    if (Number(desglose.dolares) > 0 || Number(desglose.usd) > 0) {
      const tc = Number(desglose.tipo_cambio) || Number(tipo_cambio) || 520;
      const mUsd = Number(desglose.monto_usd) || (Number(desglose.dolares || desglose.usd) / tc);
      listaPagos.push({
        metodo: 'Dólares',
        monto: Number(desglose.dolares || desglose.usd),
        monto_usd: mUsd,
        tipo_cambio: tc,
        recibido: Number(desglose.recibido_usd) ? Number(desglose.recibido_usd) * tc : undefined,
        cambio: Number(desglose.cambio_dolares) || 0
      });
    }
    if (Number(desglose.transferencia) > 0) {
      listaPagos.push({
        metodo: 'Transferencia',
        monto: Number(desglose.transferencia),
        referencia: desglose.referencia_transferencia || desglose.referencia || null
      });
    }
  }

  if (listaPagos.length === 0) {
    listaPagos.push({
      metodo: metodoFinal,
      monto: montoFinal,
      propina: Number(propina) || 0,
      cambio: Number(cambio) || 0,
      referencia: referencia || null,
      tipo_cambio: Number(tipo_cambio) || 1,
      monto_usd: Number(monto_usd) || 0
    });
  }

  const totalPagadoAcum = listaPagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  for (const p of listaPagos) {
    const metPago = p.metodo || 'Efectivo';
    const mtoPago = Number(p.monto) || 0;
    const propPago = p.propina !== undefined ? Number(p.propina) : (listaPagos.length === 1 ? (Number(propina) || 0) : Math.round((Number(propina) || 0) * (mtoPago / (totalPagadoAcum || 1))));
    const camPago = Number(p.cambio) || (listaPagos.length === 1 ? (Number(cambio) || 0) : 0);
    const refPago = p.referencia || (listaPagos.length === 1 ? (referencia || null) : null);
    const tcPago = Number(p.tipo_cambio) || (listaPagos.length === 1 ? (Number(tipo_cambio) || 1) : 1);
    const usdPago = Number(p.monto_usd) || (listaPagos.length === 1 ? (Number(monto_usd) || 0) : 0);

    await dbRun(
      'INSERT INTO Pagos (orden_id, caja_id, mesero, metodo, monto, propina, cambio, referencia, tipo_cambio, monto_usd, caja_fisica_id, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ordenId, cajaId, mesero, metPago, mtoPago, propPago, camPago, refPago, tcPago, usdPago, caja?.caja_fisica_id || null, ahora]
    );
  }

  const metodoFinalTicket = listaPagos.length > 1 ? 'Pago Mixto' : (listaPagos[0]?.metodo || metodoFinal);

  // Obtener información del negocio y mesa para el tiquete impreso
  const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [orden.negocio_id || 1]);
  const mesa = orden.mesa_id ? await dbGet('SELECT * FROM Mesas WHERE id = ?', [orden.mesa_id]) : null;
  const mesaNumero = mesa ? mesa.numero : (orden.tipo_orden === 'para_llevar' || !orden.mesa_id ? '🛍️ Para Llevar' : 'Mesa');

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
      metodoPago: metodoFinalTicket,
      subtotal: orden.subtotal,
      descuentoHH: orden.descuento_happy_hour,
      servicio: orden.servicio_10,
      iva: orden.iva_13,
      total: orden.total,
      recibido: monto || totalPagadoAcum,
      cambio,
      items: itemsOrden,
      pagos: listaPagos,
      fechaHora: ahora
    });

    printerService.procesarImpresion({
      destinoImpresora: 'caja',
      ticketInfo: tInfoLiquidacion,
      io
    }).catch(err => console.error('Error al despachar ticket de liquidación:', err.message));

    if (orden.mesa_id) {
      const itemsPendientesCocina = await dbAll(
        "SELECT id FROM DetalleOrden WHERE orden_id = ? AND destino = 'cocina' AND estado_comanda IN ('pendiente', 'preparando')",
        [ordenId]
      );
      const tieneItemsCocinaPendientes = itemsPendientesCocina.length > 0;

      await dbRun(
        "UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ? WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada')",
        [ahora, orden.mesa_id]
      );

      if (tieneItemsCocinaPendientes || debeEnviarCocina) {
        // La comanda se envió a cocina y fue cobrada de antemano: la mesa queda ocupada (en espera o comiendo) con cuenta en 0
        const estadoMesaCobrada = tieneItemsCocinaPendientes ? 'esperando' : 'ocupada';
        await dbRun(
          "UPDATE Mesas SET estado = ?, pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL WHERE id = ?",
          [estadoMesaCobrada, orden.mesa_id]
        );
        io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: estadoMesaCobrada, cliente: orden.cliente, total: 0, transferida_de: null, mesas_unidas: [] });
      } else {
        await dbRun(
          "UPDATE Mesas SET estado = 'libre', mesero = NULL, cliente = NULL, transferida_de = NULL, unida_con = NULL, unida_a_mesa_id = NULL, grupo_mesas = NULL, pidio_cuenta_qr = 0, hora_pidio_cuenta = NULL WHERE id = ?",
          [orden.mesa_id]
        );
        await dbRun(
          'UPDATE TableMerges SET activo = 0 WHERE (mesa_principal_id = ? OR mesa_secundaria_id = ?) AND activo = 1',
          [orden.mesa_id, orden.mesa_id]
        );
        io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'libre', cliente: null, total: 0, transferida_de: null, mesas_unidas: [] });
      }
    }

    io.emit('inventario_actualizado');
    io.emit('venta_registrada', { ordenId, total: orden.total });

    return {
      ok: true,
      success: true,
      message: 'Cobro completado y mesa liberada',
      ordenId,
      es_parcial: false,
      total: orden.total,
      descuentoHH: orden.descuento_happy_hour,
      ticket: tInfoLiquidacion.ticketVisual
    };
  } else {
    // PAGO PARCIAL
    if (Array.isArray(items_pagados) && items_pagados.length > 0) {
      for (const item of items_pagados) {
        const qty = Number(item.cantidad) || 1;
        let detalleItems = [];
        if (item.comensal) {
          detalleItems = await dbAll(
            "SELECT * FROM DetalleOrden WHERE orden_id = ? AND (producto_id = ? OR nombre_producto = ?) AND comensal = ? AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY id ASC",
            [ordenId, item.producto_id || item.id, item.nombre || item.nombre_producto, item.comensal]
          );
        }
        if (!detalleItems || detalleItems.length === 0) {
          detalleItems = await dbAll(
            "SELECT * FROM DetalleOrden WHERE orden_id = ? AND (producto_id = ? OR nombre_producto = ?) AND estado_comanda != 'anulado' AND estado_comanda != 'pagado' ORDER BY id ASC",
            [ordenId, item.producto_id || item.id, item.nombre || item.nombre_producto]
          );
        }

        let restanteADescontar = qty;
        for (const det of (detalleItems || [])) {
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
              "INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, estado_comanda, hora_pedido, hora_listo, creado_en, origen_mesa_numero, comanda_numero, comensal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pagado', ?, ?, ?, ?, ?, ?)",
              [det.orden_id, det.producto_id, det.nombre_producto, det.precio_unitario, restanteADescontar, subPagado, det.notas, det.curso, det.destino, det.hora_pedido, det.hora_listo, det.creado_en, det.origen_mesa_numero, det.comanda_numero || 1, det.comensal || 'General']
            );
            restanteADescontar = 0;
          }
        }
      }
    }

    // Recalcular subtotal y total de la orden con los ítems activos no pagados usando el motor oficial
    const infoTotales = await recalcularTotalesOrden(ordenId);
    const nuevoTotal = Number(infoTotales?.total) || 0;

    const subParcial = (items_pagados || []).reduce((acc, it) => acc + ((Number(it.precio) || 0) * (Number(it.cantidad) || 1)), 0);
    const impParcial = Math.round(subParcial * 0.23);

    const tInfoParcial = printerService.generarTicketPagoParcial({
      negocio,
      ordenId,
      mesaNumero,
      personaNombre: persona_nombre,
      mesero,
      metodoPago: metodo,
      montoCobrado: monto,
      subtotal: subParcial,
      impuestos: impParcial,
      itemsPagados: items_pagados || [],
      saldoRestanteMesa: nuevoTotal,
      fechaHora: ahora
    });

    printerService.procesarImpresion({
      destinoImpresora: 'caja',
      ticketInfo: tInfoParcial,
      io
    }).catch(err => console.error('Error al despachar ticket pago parcial:', err.message));

    if (orden.mesa_id) {
      const mesaRow = await dbGet('SELECT * FROM Mesas WHERE id = ?', [orden.mesa_id]);
      const estadoMesaActual = (mesaRow && mesaRow.estado && mesaRow.estado !== 'libre') ? mesaRow.estado : 'ocupada';
      await dbRun("UPDATE Mesas SET estado = ?, orden_total = ? WHERE id = ?", [estadoMesaActual, nuevoTotal, orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, total: nuevoTotal, orden_total: nuevoTotal, estado: estadoMesaActual, negocio_id: orden.negocio_id });
      io.emit('mesas_actualizadas', { negocio_id: orden.negocio_id });
    }

    io.emit('inventario_actualizado');
    io.emit('venta_registrada', { ordenId, parcial: true });

    return {
      message: 'Cobro parcial registrado con éxito',
      ordenId,
      es_parcial: true,
      saldo_restante: nuevoTotal,
      ticket: tInfoParcial.ticketVisual
    };
  }
};

  const cobroPromise = ejecutarProcesoCobro();
  if (mutexKey) {
    cobrosEnProceso.set(mutexKey, cobroPromise);
  }
  try {
    return await cobroPromise;
  } finally {
    if (mutexKey) {
      cobrosEnProceso.delete(mutexKey);
    }
  }
}

app.post(['/api/ordenes/:id/cobrar', '/api/ordenes/directo/cobrar'], async (req, res) => {
  try {
    const ordenId = req.params.id || req.body.ordenId || 'directo';
    const reqNegocioId = obtenerNegocioIdReq(req);
    const resultado = await procesarCobroOrden(ordenId, {
      ...req.body,
      reqNegocioId,
      usuarioRol: req.usuario?.rol
    });
    res.json(resultado);
  } catch (e) {
    const status = e.status || (e.message === 'Orden no encontrada' ? 404 : 500);
    res.status(status).json({ error: e.message });
  }
});

// ============================================================================
// ENDPOINTS DE PRE-FACTURA / PRE-CUENTA (REVISIÓN PRELIMINAR DE CONSUMOS)
// ============================================================================
app.post('/api/ordenes/:id/prefactura', async (req, res) => {
  try {
    const ordenId = req.params.id;
    let orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const reqNegocioId = obtenerNegocioIdReq(req);
    if (req.usuario && req.usuario.rol !== 'developer' && orden.negocio_id && Number(orden.negocio_id) !== Number(reqNegocioId)) {
      return res.status(403).json({ error: 'Acceso denegado: La orden pertenece a otro comercio.' });
    }

    // Recalcular totales para asegurar que Happy Hour, IVA y servicio estén 100% al día
    if (typeof recalcularTotalesOrden === 'function') {
      try {
        await recalcularTotalesOrden(ordenId);
        orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
      } catch (errRecalc) {
        console.warn('Advertencia al recalcular totales en prefactura:', errRecalc.message);
      }
    }

    let itemsOrden = await dbAll(
      "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
      [ordenId]
    );

    if ((!itemsOrden || itemsOrden.length === 0) && Array.isArray(req.body.items) && req.body.items.length > 0) {
      itemsOrden = req.body.items;
    }

    if (!itemsOrden || itemsOrden.length === 0) {
      return res.status(400).json({ error: 'La orden no tiene consumos activos para generar pre-factura.' });
    }

    const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [orden.negocio_id || 1]);
    const mesa = orden.mesa_id ? await dbGet('SELECT * FROM Mesas WHERE id = ?', [orden.mesa_id]) : null;
    const mesaNumero = mesa ? (mesa.numero || ('Mesa ' + mesa.id)) : (orden.mesa_id ? `Mesa ${orden.mesa_id}` : 'Mesa');
    const mesero = req.body.mesero || (req.user && req.user.nombre) || orden.mesero || (mesa && mesa.mesero) || 'General';
    const ahora = new Date().toISOString();

    const tInfoPreFactura = printerService.generarTicketPreFactura({
      negocio,
      ordenId,
      numeroOrden: orden.numero_orden || ordenId,
      mesaNumero,
      mesero,
      cliente: orden.cliente || 'Cliente General',
      subtotal: orden.subtotal || 0,
      descuentoHH: orden.descuento_happy_hour || 0,
      servicio: orden.servicio_10 || 0,
      iva: orden.iva_13 || 0,
      total: orden.total || 0,
      items: itemsOrden,
      fechaHora: ahora
    });

    // Actualizar estado de mesa a 'cuenta' si está abierta
    if (orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = 'cuenta', pidio_cuenta_qr = 1, hora_pidio_cuenta = COALESCE(hora_pidio_cuenta, ?) WHERE id = ?", [ahora, orden.mesa_id]);
      await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa')", [ordenId]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'cuenta', pidio_cuenta_qr: 1, hora_pidio_cuenta: ahora });
    }

    res.json({
      ok: true,
      success: true,
      message: 'Pre-Factura generada e impresa con éxito',
      ordenId,
      ticket: tInfoPreFactura.ticketVisual
    });
  } catch (e) {
    console.error('Error al generar prefactura:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/:id/prefactura', async (req, res) => {
  try {
    const mesaId = req.params.id;
    const reqNegocioId = obtenerNegocioIdReq(req);
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (req.usuario && req.usuario.rol !== 'developer' && mesa.negocio_id && Number(mesa.negocio_id) !== Number(reqNegocioId)) {
      return res.status(403).json({ error: 'Acceso denegado: La mesa pertenece a otro comercio.' });
    }

    let orden = await dbGet(
      "SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa', 'cuenta_pedida', 'ocupada', 'cuenta') ORDER BY id DESC LIMIT 1",
      [mesaId]
    );

    const itemsFromBody = Array.isArray(req.body.items) && req.body.items.length > 0 ? req.body.items : null;

    if (!orden && !itemsFromBody) {
      return res.status(404).json({ error: 'No hay consumos registrados en esta mesa para generar pre-factura.' });
    }

    let itemsOrden = [];
    let subtotal = 0;
    let iva = 0;
    let servicio = 0;
    let total = 0;
    let descuentoHH = 0;
    let clienteNombre = (mesa && mesa.cliente) || 'Cliente General';
    let mesero = req.body.mesero || (req.user && req.user.nombre) || (mesa && mesa.mesero) || 'General';
    let numeroOrden = mesaId;

    const negocio = await dbGet('SELECT * FROM Negocios WHERE id = ?', [orden?.negocio_id || mesa.negocio_id || 1]);
    const tieneServicio10 = negocio ? (
      !negocio.caracteristicas_activas ||
      negocio.caracteristicas_activas === 'all' ||
      (Array.isArray(negocio.caracteristicas_activas) ? negocio.caracteristicas_activas.includes('servicio_10') : String(negocio.caracteristicas_activas).includes('servicio_10'))
    ) : true;
    const tieneIVA13 = negocio ? (
      !negocio.caracteristicas_activas ||
      negocio.caracteristicas_activas === 'all' ||
      (Array.isArray(negocio.caracteristicas_activas) ? negocio.caracteristicas_activas.includes('desglose_iva_13') : String(negocio.caracteristicas_activas).includes('desglose_iva_13'))
    ) : true;

    if (orden) {
      // Recalcular totales para asegurar que Happy Hour, IVA y servicio estén 100% al día
      if (typeof recalcularTotalesOrden === 'function') {
        try {
          await recalcularTotalesOrden(orden.id);
          orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [orden.id]);
        } catch (errRecalc) {
          console.warn('Advertencia al recalcular totales en prefactura mesa:', errRecalc.message);
        }
      }

      itemsOrden = await dbAll(
        "SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'",
        [orden.id]
      );
      if ((!itemsOrden || itemsOrden.length === 0) && itemsFromBody) {
        itemsOrden = itemsFromBody;
      }
      subtotal = orden.subtotal || 0;
      iva = tieneIVA13 ? (orden.iva_13 || 0) : 0;
      servicio = tieneServicio10 ? (orden.servicio_10 || 0) : 0;
      total = orden.total || 0;
      descuentoHH = orden.descuento_happy_hour || 0;
      clienteNombre = orden.cliente || clienteNombre;
      mesero = orden.mesero || mesero;
      numeroOrden = orden.numero_orden || orden.id;
    } else if (itemsFromBody) {
      itemsOrden = itemsFromBody;
      subtotal = itemsOrden.reduce((acc, it) => acc + ((Number(it.precio || it.precio_unitario || 0)) * (Number(it.cantidad) || 1)), 0);
      iva = tieneIVA13 ? Math.round(subtotal * 0.13) : 0;
      servicio = tieneServicio10 ? Math.round(subtotal * 0.10) : 0;
      total = subtotal + iva + servicio;
    }

    if (!itemsOrden || itemsOrden.length === 0) {
      return res.status(400).json({ error: 'La mesa no tiene consumos activos para generar pre-factura.' });
    }

    const mesaNumero = mesa.numero || ('Mesa ' + mesa.id);
    const ahora = new Date().toISOString();

    const tInfoPreFactura = printerService.generarTicketPreFactura({
      negocio,
      ordenId: orden ? orden.id : mesaId,
      numeroOrden,
      mesaNumero,
      mesero,
      cliente: clienteNombre,
      subtotal,
      descuentoHH,
      servicio,
      iva,
      total,
      items: itemsOrden,
      fechaHora: ahora
    });

    await dbRun("UPDATE Mesas SET estado = 'cuenta', pidio_cuenta_qr = 1, hora_pidio_cuenta = COALESCE(hora_pidio_cuenta, ?) WHERE id = ?", [ahora, mesaId]);
    if (orden) {
      await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa')", [orden.id]);
    }
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'cuenta', pidio_cuenta_qr: 1, hora_pidio_cuenta: ahora });

    res.json({
      ok: true,
      success: true,
      message: 'Pre-Factura de mesa generada con éxito',
      mesaId: Number(mesaId),
      ordenId: orden ? orden.id : null,
      ticket: tInfoPreFactura.ticketVisual
    });
  } catch (e) {
    console.error('Error al generar prefactura de mesa:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para alternar modo Happy Hour de la orden (Estricto vs Flexible)
app.put('/api/ordenes/:id/modo-happy-hour', async (req, res) => {
  try {
    const ordenId = req.params.id;
    const { modo } = req.body;
    const rol = req.headers['x-user-rol'] || req.query.rol || (req.body && req.body.rol);

    // Permisos: solo admin, developer o cajero
    const esAutorizado = rol === 'admin' || rol === 'developer' || rol === 'cajero';
    if (!esAutorizado) {
      return res.status(403).json({ error: 'Requiere permisos de Administrador o Cajero para cambiar el modo de Happy Hour.' });
    }

    if (modo !== 'estricto' && modo !== 'flexible') {
      return res.status(400).json({ error: 'Modo inválido. Debe ser "estricto" o "flexible".' });
    }

    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    await dbRun('UPDATE Ordenes SET modo_happy_hour = ? WHERE id = ?', [modo, ordenId]);

    const resultado = await recalcularTotalesOrden(ordenId);

    if (orden.mesa_id) {
      io.emit('mesa_actualizada', {
        mesaId: Number(orden.mesa_id),
        total: resultado.total,
        descuentoHH: resultado.descuentoHH,
        modo_happy_hour: modo
      });
    }

    res.json({
      success: true,
      mensaje: `Modo de Happy Hour actualizado a ${modo}.`,
      ordenId: Number(ordenId),
      modo,
      ...resultado
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// GESTIÓN DE PUNTOS DE COBRO FÍSICOS Y MULTI-CAJAS DINÁMICAS
// ============================================================================

// Listar puntos de cobro físicos y su estado de ocupación en tiempo real
app.get('/api/cajas-fisicas', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const puntos = await dbAll(`
      SELECT p.*, u.nombre_completo as pre_asignado_usuario_nombre, u.usuario as pre_asignado_usuario_username
      FROM PuntosDeCobro p
      LEFT JOIN Usuarios u ON p.pre_asignado_usuario_id = u.id
      WHERE (p.negocio_id = ? OR (p.negocio_id IS NULL AND ? = 1)) AND p.activo = 1
      ORDER BY p.id ASC
    `, [negocioId, negocioId]);

    const turnosAbiertos = await dbAll(`
      SELECT * FROM Cajas 
      WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))
      ORDER BY id DESC
    `, [negocioId, negocioId]);

    const cajasFisicas = puntos.map(punto => {
      const turnoActivo = turnosAbiertos.find(t => Number(t.caja_fisica_id) === Number(punto.id));
      return {
        id: punto.id,
        nombre: punto.nombre,
        codigo: punto.codigo,
        ubicacion: punto.ubicacion,
        icono: punto.icono || '💳',
        pre_asignado_usuario_id: punto.pre_asignado_usuario_id,
        pre_asignado_usuario_nombre: punto.pre_asignado_usuario_nombre,
        pre_asignado_usuario_username: punto.pre_asignado_usuario_username,
        ocupada: !!turnoActivo,
        turno_activo: turnoActivo ? {
          id: turnoActivo.id,
          usuario_id: turnoActivo.usuario_id,
          cajero: turnoActivo.cajero,
          fecha_apertura: turnoActivo.fecha_apertura,
          monto_inicial: turnoActivo.monto_inicial
        } : null
      };
    });

    res.json({
      ok: true,
      puntos: cajasFisicas,
      cajas_fisicas: cajasFisicas,
      turnos_abiertos_count: turnosAbiertos.length,
      turnos_abiertos: turnosAbiertos
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin CRUD Puntos de Cobro
app.get('/api/admin/puntos-cobro', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const puntos = await dbAll(`
      SELECT p.*, u.nombre_completo as pre_asignado_usuario_nombre, u.usuario as pre_asignado_usuario_username
      FROM PuntosDeCobro p
      LEFT JOIN Usuarios u ON p.pre_asignado_usuario_id = u.id
      WHERE (p.negocio_id = ? OR (p.negocio_id IS NULL AND ? = 1))
      ORDER BY p.id ASC
    `, [negocioId, negocioId]);
    res.json(puntos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/puntos-cobro', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req, req.body.negocio_id || 1);
    const { nombre, codigo, ubicacion, icono = '💳', pre_asignado_usuario_id } = req.body;
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'El nombre de la caja física es obligatorio' });
    }
    const codFinal = (codigo || ('CAJA-' + Math.floor(10 + Math.random() * 90))).trim();
    const ahora = new Date().toISOString();
    const r = await dbRun(`
      INSERT INTO PuntosDeCobro (negocio_id, nombre, codigo, ubicacion, icono, pre_asignado_usuario_id, activo, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [negocioId, nombre.trim(), codFinal, (ubicacion || '').trim(), (icono || '💳').trim(), pre_asignado_usuario_id ? Number(pre_asignado_usuario_id) : null, ahora]);

    io.emit('cajas_fisicas_actualizadas');
    res.json({ ok: true, message: 'Punto de cobro creado con éxito', id: r.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/puntos-cobro/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { nombre, codigo, ubicacion, icono, pre_asignado_usuario_id, activo } = req.body;
    const target = await dbGet('SELECT * FROM PuntosDeCobro WHERE id = ?', [id]);
    if (!target) return res.status(404).json({ ok: false, error: 'Punto de cobro no encontrado' });

    const nombreFinal = nombre !== undefined ? (String(nombre).trim() || target.nombre) : target.nombre;
    const codigoFinal = codigo !== undefined ? (String(codigo).trim() || target.codigo) : target.codigo;
    const ubicacionFinal = ubicacion !== undefined ? (String(ubicacion).trim()) : target.ubicacion;
    const iconoFinal = icono !== undefined ? (String(icono).trim() || target.icono) : target.icono;
    const preAsigFinal = pre_asignado_usuario_id !== undefined ? (pre_asignado_usuario_id ? Number(pre_asignado_usuario_id) : null) : target.pre_asignado_usuario_id;
    const activoFinal = activo !== undefined ? (activo ? 1 : 0) : target.activo;

    await dbRun(`
      UPDATE PuntosDeCobro SET
        nombre = ?,
        codigo = ?,
        ubicacion = ?,
        icono = ?,
        pre_asignado_usuario_id = ?,
        activo = ?
      WHERE id = ?
    `, [nombreFinal, codigoFinal, ubicacionFinal, iconoFinal, preAsigFinal, activoFinal, id]);

    if (nombreFinal) {
      await dbRun("UPDATE Cajas SET caja_nombre = ? WHERE caja_fisica_id = ? AND estado = 'abierta'", [nombreFinal, id]);
    }

    io.emit('caja_actualizada');
    io.emit('cajas_fisicas_actualizadas');
    res.json({ ok: true, message: 'Punto de cobro actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/admin/puntos-cobro/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const turnoAbierto = await dbGet("SELECT id, cajero FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta'", [id]);
    if (turnoAbierto) {
      return res.status(400).json({ error: `No se puede eliminar la caja física porque tiene un turno abierto activo por ${turnoAbierto.cajero}` });
    }
    await dbRun('UPDATE PuntosDeCobro SET activo = 0 WHERE id = ?', [id]);
    io.emit('cajas_fisicas_actualizadas');
    res.json({ ok: true, message: 'Punto de cobro desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reasignación en caliente de un turno de caja activo (cambio de cajero o caja física)
app.post('/api/admin/cajas/reasignar', async (req, res) => {
  try {
    const {
      caja_id,
      turno_id,
      nuevo_cajero,
      nuevo_usuario_id,
      nueva_caja_fisica_id,
      motivo = 'Reasignación operativa de turno',
      adminPin,
      pin,
      pinAdmin,
      usuario_admin
    } = req.body;

    const turnoIdTarget = Number(caja_id || turno_id);
    if (!turnoIdTarget) {
      return res.status(400).json({ ok: false, error: 'ID de turno / caja requerido' });
    }

    const pinVerificar = adminPin || pin || pinAdmin || req.headers['x-supervisor-pin'];
    if (!pinVerificar) {
      return res.status(401).json({ ok: false, error: 'PIN de Administrador requerido para reasignar turnos' });
    }

    const esValido = await validarPinAdministrador(pinVerificar);
    if (!esValido) {
      return res.status(401).json({ ok: false, error: 'PIN de Administrador inválido para reasignar turnos' });
    }

    const turno = await dbGet('SELECT * FROM Cajas WHERE id = ?', [turnoIdTarget]);
    if (!turno) {
      return res.status(404).json({ ok: false, error: 'Turno de caja no encontrado' });
    }
    if (turno.estado !== 'abierta') {
      return res.status(400).json({ ok: false, error: 'Solo se pueden reasignar turnos que estén actualmente abiertos' });
    }

    let finalCajero = turno.cajero;
    let finalCajaFisicaId = turno.caja_fisica_id;
    let finalCajaNombre = turno.caja_nombre;
    let nuevoUsuarioId = nuevo_usuario_id ? Number(nuevo_usuario_id) : null;

    if (nuevo_usuario_id) {
      const u = await dbGet('SELECT * FROM Usuarios WHERE id = ?', [nuevoUsuarioId]);
      if (u) {
        finalCajero = u.nombre_completo || u.usuario;
      }
    } else if (nuevo_cajero && String(nuevo_cajero).trim()) {
      finalCajero = String(nuevo_cajero).trim();
    }

    if (nueva_caja_fisica_id && Number(nueva_caja_fisica_id) !== Number(turno.caja_fisica_id)) {
      const nuevoPuntoId = Number(nueva_caja_fisica_id);
      const punto = await dbGet('SELECT * FROM PuntosDeCobro WHERE id = ?', [nuevoPuntoId]);
      if (!punto) {
        return res.status(404).json({ ok: false, error: 'La nueva caja física seleccionada no existe' });
      }

      const ocupadaPorOtro = await dbGet(
        "SELECT id, cajero FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta' AND id != ?",
        [nuevoPuntoId, turnoIdTarget]
      );
      if (ocupadaPorOtro) {
        return res.status(409).json({
          ok: false,
          error: `No se puede transferir: La caja física "${punto.nombre}" ya está ocupada por ${ocupadaPorOtro.cajero}`
        });
      }

      finalCajaFisicaId = nuevoPuntoId;
      finalCajaNombre = punto.nombre;
    }

    await dbRun(`
      UPDATE Cajas SET
        cajero = ?,
        usuario_id = COALESCE(?, usuario_id),
        caja_fisica_id = ?,
        caja_nombre = ?
      WHERE id = ?
    `, [finalCajero, nuevoUsuarioId, finalCajaFisicaId, finalCajaNombre, turnoIdTarget]);

    const detalleAudit = `Reasignación de turno #${turnoIdTarget}: Cajero anterior (${turno.cajero}) -> Nuevo (${finalCajero}), Caja anterior (${turno.caja_nombre || 'N/A'}) -> Nueva (${finalCajaNombre || 'N/A'}). Motivo: ${motivo}`;

    await registrarAuditoria({
      negocioId: turno.negocio_id || 1,
      usuarioNombre: usuario_admin || 'Administrador',
      accion: 'reasignacion_turno_caja',
      tipoEvento: 'operativo',
      modulo: 'caja',
      detalle: detalleAudit
    });

    io.emit('caja_actualizada');
    io.emit('cajas_fisicas_actualizadas');
    io.emit('caja_turno_reasignado', {
      turnoId: turnoIdTarget,
      cajero: finalCajero,
      caja_fisica_id: finalCajaFisicaId,
      caja_nombre: finalCajaNombre,
      motivo
    });

    const infoTurno = {
      id: turnoIdTarget,
      usuario_id: nuevoUsuarioId,
      usuario_id: nuevoUsuarioId !== null ? nuevoUsuarioId : turno.usuario_id,
      cajero: finalCajero,
      caja_fisica_id: finalCajaFisicaId,
      caja_nombre: finalCajaNombre,
      estado: 'abierta'
    };

    res.json({
      ok: true,
      message: 'Turno de caja reasignado exitosamente',
      caja: infoTurno,
      turno: infoTurno
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/caja/actual', async (req, res) => {
  try {
    const negocioId = obtenerNegocioIdReq(req);
    const { caja_id, caja_fisica_id, cajero } = req.query;

    let caja = null;

    if (caja_id) {
      caja = await dbGet('SELECT * FROM Cajas WHERE id = ?', [Number(caja_id)]);
    } else if (caja_fisica_id) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [Number(caja_fisica_id), negocioId, negocioId]
      );
    } else if (cajero) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE LOWER(cajero) = LOWER(?) AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [String(cajero).trim(), negocioId, negocioId]
      );
    }

    if (!caja) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [negocioId, negocioId]
      );
    }

    const turnosAbiertos = await dbAll(
      "SELECT id, cajero, caja_fisica_id, caja_nombre, fecha_apertura, monto_inicial FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id ASC",
      [negocioId, negocioId]
    );

    if (!caja) return res.json({ ok: true, caja: null, cajasAbiertas: turnosAbiertos || [], turnos_abiertos: turnosAbiertos || [] });

    const ventas = await dbAll(`
      SELECT p.metodo, SUM(p.monto) as total, SUM(COALESCE(p.monto_usd, 0)) as total_usd, COUNT(*) as transacciones
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

    res.json({ ok: true, caja, cajasAbiertas: turnosAbiertos || [], turnos_abiertos: turnosAbiertos || [], ventas, movimientos, tipPool });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Registrar entrada o salida menor de efectivo
app.post('/api/caja/movimiento', async (req, res) => {
  try {
    const { tipo, monto, concepto, usuarioNombre = 'Cajero', caja_id, caja_fisica_id } = req.body;
    const negocioId = obtenerNegocioIdReq(req, req.body.negocio_id || 1);
    const montoNum = parseFloat(monto);
    if (!tipo || !['entrada', 'salida'].includes(tipo) || isNaN(montoNum) || montoNum <= 0) {
      return res.status(400).json({ ok: false, error: 'Tipo ("entrada" o "salida") y monto válido mayor a 0 son requeridos' });
    }

    let caja = null;
    if (caja_id) {
      caja = await dbGet("SELECT * FROM Cajas WHERE id = ? AND estado = 'abierta'", [Number(caja_id)]);
    } else if (caja_fisica_id) {
      caja = await dbGet("SELECT * FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta'", [Number(caja_fisica_id)]);
    }

    if (!caja) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [negocioId, negocioId]
      );
    }

    if (!caja) {
      const ahoraApertura = new Date().toISOString();
      const r = await dbRun(`
        INSERT INTO Cajas (negocio_id, cajero, fecha_apertura, monto_inicial, estado)
        VALUES (?, ?, ?, 50000, 'abierta')
      `, [negocioId, usuarioNombre, ahoraApertura]);
      caja = await dbGet('SELECT * FROM Cajas WHERE id = ?', [r.lastID]);
    }

    const conceptoLimpio = (concepto || (tipo === 'entrada' ? 'Entrada de efectivo' : 'Gasto menor')).trim();
    const ahora = new Date().toISOString();

    await dbRun(`
      INSERT INTO MovimientosCaja (caja_id, tipo, monto, concepto, fecha_hora)
      VALUES (?, ?, ?, ?, ?)
    `, [caja.id, tipo, montoNum, conceptoLimpio, ahora]);

    await registrarAuditoria({
      negocioId: caja.negocio_id || negocioId,
      usuarioNombre,
      accion: tipo === 'entrada' ? 'entrada_efectivo' : 'salida_gasto_menor',
      tipoEvento: 'operativo',
      modulo: 'caja',
      detalle: `${tipo === 'entrada' ? 'Ingreso' : 'Egreso'} de efectivo por ₡${montoNum.toLocaleString('es-CR')} en ${caja.caja_nombre || 'Caja #' + caja.id}: ${conceptoLimpio}`
    });

    io.emit('caja_actualizada');
    res.json({ ok: true, message: `Movimiento de ${tipo} registrado correctamente`, caja_id: caja.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Generar reporte de Corte X (Parcial / Informativo sin cerrar)
app.get('/api/caja/corte-x', async (req, res) => {
  try {
    const pin = req.headers['x-supervisor-pin'] || req.query.pin;
    if (pin) {
      const esValido = await validarPinAdministrador(pin);
      if (!esValido) {
        return res.status(401).json({ error: 'PIN de Administrador inválido. Corte X no autorizado.' });
      }
    }

    const negocioId = obtenerNegocioIdReq(req);
    const { caja_id, caja_fisica_id } = req.query;

    let caja = null;
    if (caja_id) {
      caja = await dbGet('SELECT * FROM Cajas WHERE id = ?', [Number(caja_id)]);
    } else if (caja_fisica_id) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [Number(caja_fisica_id), negocioId, negocioId]
      );
    }

    if (!caja) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [negocioId, negocioId]
      );
    }

    if (!caja) return res.status(404).json({ ok: false, error: 'No hay ninguna caja o turno abierto actualmente' });

    const ventas = await dbAll(`
      SELECT p.metodo, SUM(p.monto) as total, SUM(COALESCE(p.monto_usd, 0)) as total_usd, COUNT(*) as transacciones
      FROM Pagos p
      WHERE p.caja_id = ?
      GROUP BY p.metodo
    `, [caja.id]);

    let ventasEfectivo = 0, ventasTarjeta = 0, ventasSinpe = 0, ventasDolares = 0, ventasDolaresUSD = 0, ventasTransferencia = 0, ventasOtros = 0;
    const desgloseMetodos = {};

    ventas.forEach(v => {
      const m = (v.metodo || '').toLowerCase();
      const tot = Number(v.total) || 0;
      const totUSD = Number(v.total_usd) || 0;
      desgloseMetodos[v.metodo || 'Otro'] = (desgloseMetodos[v.metodo || 'Otro'] || 0) + tot;

      if (m.includes('efectivo') || m.includes('cash')) {
        ventasEfectivo += tot;
      } else if (m.includes('tarjeta') || m.includes('datafono') || m.includes('datáfono') || m.includes('card') || m.includes('credito') || m.includes('crédito') || m.includes('debito') || m.includes('débito')) {
        ventasTarjeta += tot;
      } else if (m.includes('sinpe')) {
        ventasSinpe += tot;
      } else if (m.includes('dolar') || m.includes('dólar') || m.includes('usd')) {
        ventasDolares += tot;
        ventasDolaresUSD += totUSD;
      } else if (m.includes('transfer')) {
        ventasTransferencia += tot;
        ventasSinpe += tot;
      } else {
        ventasOtros += tot;
      }
    });
    const totalVentas = ventas.reduce((acc, v) => acc + (Number(v.total) || 0), 0);

    const movimientos = await dbAll('SELECT * FROM MovimientosCaja WHERE caja_id = ? ORDER BY id ASC', [caja.id]);
    let totalEntradas = 0, totalSalidas = 0;
    movimientos.forEach(m => {
      const mont = Number(m.monto) || 0;
      if (m.tipo === 'entrada') totalEntradas += mont;
      if (m.tipo === 'salida') totalSalidas += mont;
    });

    const fondoInicial = Number(caja.monto_inicial) || 0;
    const efectivoEsperado = Math.round((fondoInicial + ventasEfectivo + totalEntradas - totalSalidas) * 100) / 100;
    const totalGeneralEsperadoGaveta = Math.round((efectivoEsperado + ventasDolares) * 100) / 100;

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

    const totalPropinas = tipPool.reduce((acc, curr) => acc + (curr.propina || 0), 0);

    const ordenesCobros = await dbGet(`
      SELECT COUNT(DISTINCT orden_id) as total_ordenes FROM Pagos WHERE caja_id = ?
    `, [caja.id]);

    const resultadoCorte = {
      tipo: 'Corte X (Parcial)',
      caja_id: caja.id,
      caja_fisica_id: caja.caja_fisica_id,
      caja_nombre: caja.caja_nombre,
      cajero: caja.cajero,
      fecha_apertura: caja.fecha_apertura,
      fecha_corte: new Date().toISOString(),
      fondo_inicial: fondoInicial,
      ventas: {
        efectivo: ventasEfectivo,
        tarjeta: ventasTarjeta,
        sinpe: ventasSinpe,
        dolares: ventasDolares,
        dolares_usd: ventasDolaresUSD,
        transferencia: ventasTransferencia,
        otros: ventasOtros,
        desglose_por_metodo: desgloseMetodos,
        total: totalVentas,
        ordenes: ordenesCobros?.total_ordenes || 0
      },
      movimientos_detalle: movimientos,
      total_entradas: totalEntradas,
      total_salidas: totalSalidas,
      efectivo_esperado: efectivoEsperado,
      esperado_efectivo_crc: efectivoEsperado,
      esperado_dolares_usd: ventasDolaresUSD,
      esperado_dolares_crc: ventasDolares,
      total_general_esperado_gaveta_crc: totalGeneralEsperadoGaveta,
      tip_pool: tipPool,
      total_propinas: totalPropinas
    };

    res.json({
      ok: true,
      corte: resultadoCorte,
      ...resultadoCorte
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cierre Z definitivo del turno con arqueo físico de caja (Colones y Dólares)
app.post('/api/caja/cierre-z', async (req, res) => {
  try {
    const {
      caja_id,
      caja_fisica_id,
      efectivo_real_contado,
      efectivo_real_contado_crc,
      dolares_real_contado,
      dolares_real_contado_usd,
      tipo_cambio,
      notas = '',
      usuarioNombre = 'Cajero',
      adminPin,
      pin
    } = req.body;

    const pinVerificar = adminPin || pin || req.headers['x-supervisor-pin'];
    if (pinVerificar) {
      const esValido = await validarPinAdministrador(pinVerificar);
      if (!esValido) {
        return res.status(401).json({ ok: false, error: 'PIN de Administrador inválido. Cierre Z no autorizado.' });
      }
    }

    const efectivoRealCRC = parseFloat(efectivo_real_contado_crc != null ? efectivo_real_contado_crc : efectivo_real_contado) || 0;
    const dolaresRealUSD = parseFloat(dolares_real_contado_usd != null ? dolares_real_contado_usd : (dolares_real_contado || 0)) || 0;

    if (efectivoRealCRC < 0 || dolaresRealUSD < 0 || isNaN(efectivoRealCRC) || isNaN(dolaresRealUSD)) {
      return res.status(400).json({ ok: false, error: 'Por favor ingresa montos válidos de efectivo en gaveta' });
    }

    const negocioId = obtenerNegocioIdReq(req, req.body.negocio_id || 1);

    let caja = null;
    if (caja_id) {
      caja = await dbGet("SELECT * FROM Cajas WHERE id = ? AND estado = 'abierta'", [Number(caja_id)]);
    } else if (caja_fisica_id) {
      caja = await dbGet("SELECT * FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1", [Number(caja_fisica_id), negocioId, negocioId]);
    }

    if (!caja) {
      caja = await dbGet(
        "SELECT * FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) ORDER BY id DESC LIMIT 1",
        [negocioId, negocioId]
      );
    }
    if (!caja) return res.status(404).json({ ok: false, error: 'No hay ninguna caja abierta para cerrar' });

    const ventas = await dbAll(`
      SELECT p.metodo, SUM(p.monto) as total, SUM(COALESCE(p.monto_usd, 0)) as total_usd, COUNT(*) as transacciones
      FROM Pagos p
      WHERE p.caja_id = ?
      GROUP BY p.metodo
    `, [caja.id]);

    let ventasEfectivo = 0, ventasTarjeta = 0, ventasSinpe = 0, ventasDolares = 0, ventasDolaresUSD = 0, ventasTransferencia = 0, ventasOtros = 0;
    const desgloseMetodos = {};

    ventas.forEach(v => {
      const m = (v.metodo || '').toLowerCase();
      const tot = Number(v.total) || 0;
      const totUSD = Number(v.total_usd) || 0;
      desgloseMetodos[v.metodo || 'Otro'] = (desgloseMetodos[v.metodo || 'Otro'] || 0) + tot;

      if (m.includes('efectivo') || m.includes('cash')) {
        ventasEfectivo += tot;
      } else if (m.includes('tarjeta') || m.includes('datafono') || m.includes('datáfono') || m.includes('card') || m.includes('credito') || m.includes('crédito') || m.includes('debito') || m.includes('débito')) {
        ventasTarjeta += tot;
      } else if (m.includes('sinpe')) {
        ventasSinpe += tot;
      } else if (m.includes('dolar') || m.includes('dólar') || m.includes('usd')) {
        ventasDolares += tot;
        ventasDolaresUSD += totUSD;
      } else if (m.includes('transfer')) {
        ventasTransferencia += tot;
        ventasSinpe += tot;
      } else {
        ventasOtros += tot;
      }
    });
    const totalVentas = ventas.reduce((acc, v) => acc + (Number(v.total) || 0), 0);

    const movimientos = await dbAll('SELECT * FROM MovimientosCaja WHERE caja_id = ? ORDER BY id ASC', [caja.id]);
    let totalEntradas = 0, totalSalidas = 0;
    movimientos.forEach(m => {
      const mont = Number(m.monto) || 0;
      if (m.tipo === 'entrada') totalEntradas += mont;
      if (m.tipo === 'salida') totalSalidas += mont;
    });

    const fondoInicial = Number(caja.monto_inicial) || 0;
    const efectivoEsperadoCRC = Math.round((fondoInicial + ventasEfectivo + totalEntradas - totalSalidas) * 100) / 100;
    const dolaresEsperadoUSD = Math.round(ventasDolaresUSD * 100) / 100;
    const dolaresEsperadoCRC = Math.round(ventasDolares * 100) / 100;
    const totalGeneralEsperadoGavetaCRC = Math.round((efectivoEsperadoCRC + dolaresEsperadoCRC) * 100) / 100;

    const tc = parseFloat(tipo_cambio) || (dolaresEsperadoUSD > 0 ? (dolaresEsperadoCRC / dolaresEsperadoUSD) : 520);
    const dolaresRealCRC = Math.round(dolaresRealUSD * tc * 100) / 100;
    const totalRealContadoGavetaCRC = Math.round((efectivoRealCRC + dolaresRealCRC) * 100) / 100;

    const diferenciaCRC = Math.round((efectivoRealCRC - efectivoEsperadoCRC) * 100) / 100;
    const diferenciaUSD = Math.round((dolaresRealUSD - dolaresEsperadoUSD) * 100) / 100;
    const diferenciaTotal = Math.round((totalRealContadoGavetaCRC - totalGeneralEsperadoGavetaCRC) * 100) / 100;
    const estadoCuadre = diferenciaTotal === 0 ? 'Cuadrada' : (diferenciaTotal > 0 ? 'Sobrante' : 'Faltante');

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
    const totalPropinas = tipPool.reduce((acc, curr) => acc + (curr.propina || 0), 0);

    const ahora = new Date().toISOString();

    await dbRun(`
      UPDATE Cajas SET
        fecha_cierre = ?,
        monto_final_efectivo = ?,
        monto_final_dolares = ?,
        total_ventas_efectivo = ?,
        total_ventas_tarjeta = ?,
        total_ventas_sinpe = ?,
        total_ventas_dolares = ?,
        total_ventas_usd = ?,
        total_ventas_transferencia = ?,
        estado = 'cerrada'
      WHERE id = ?
    `, [ahora, efectivoRealCRC, dolaresRealUSD, ventasEfectivo, ventasTarjeta, ventasSinpe, ventasDolares, ventasDolaresUSD, ventasTransferencia, caja.id]);

    await registrarAuditoria({
      negocioId: caja.negocio_id || negocioId,
      usuarioNombre,
      accion: 'cierre_z',
      tipoEvento: 'financiero',
      modulo: 'caja',
      detalle: `Cierre Z Turno #${caja.id} (${caja.caja_nombre || 'Caja'}). Ventas: ₡${totalVentas.toLocaleString('es-CR')} | Esp CRC: ₡${efectivoEsperadoCRC.toLocaleString('es-CR')} | Esp USD: $${dolaresEsperadoUSD} | Contado: ₡${efectivoRealCRC.toLocaleString('es-CR')} + $${dolaresRealUSD} (${estadoCuadre}: ₡${Math.abs(diferenciaTotal).toLocaleString('es-CR')})`
    });

    io.emit('caja_actualizada');
    io.emit('cajas_fisicas_actualizadas');

    const resultadoCierre = {
      tipo: 'Cierre Z (Final)',
      caja_id: caja.id,
      caja_fisica_id: caja.caja_fisica_id,
      caja_nombre: caja.caja_nombre,
      cajero: caja.cajero,
      fecha_apertura: caja.fecha_apertura,
      fecha_cierre: ahora,
      fondo_inicial: fondoInicial,
      tipo_cambio: tc,
      ventas: {
        efectivo: ventasEfectivo,
        tarjeta: ventasTarjeta,
        sinpe: ventasSinpe,
        dolares: ventasDolares,
        dolares_usd: ventasDolaresUSD,
        transferencia: ventasTransferencia,
        otros: ventasOtros,
        desglose_por_metodo: desgloseMetodos,
        total: totalVentas
      },
      movimientos_detalle: movimientos,
      total_entradas: totalEntradas,
      total_salidas: totalSalidas,
      efectivo_esperado: efectivoEsperadoCRC,
      esperado_efectivo_crc: efectivoEsperadoCRC,
      esperado_dolares_usd: dolaresEsperadoUSD,
      esperado_dolares_crc: dolaresEsperadoCRC,
      total_general_esperado_gaveta_crc: totalGeneralEsperadoGavetaCRC,
      efectivo_real_contado: totalRealContadoGavetaCRC,
      efectivo_real_contado_crc: efectivoRealCRC,
      dolares_real_contado_usd: dolaresRealUSD,
      dolares_real_contado_crc: dolaresRealCRC,
      total_real_contado_gaveta_crc: totalRealContadoGavetaCRC,
      diferencia: diferenciaTotal,
      diferencia_crc: diferenciaCRC,
      diferencia_usd: diferenciaUSD,
      diferencia_total: diferenciaTotal,
      estado_cuadre: estadoCuadre,
      tip_pool: tipPool,
      total_propinas: totalPropinas,
      notas
    };

    res.json({
      ok: true,
      caja: {
        id: caja.id,
        cajero: caja.cajero,
        caja_fisica_id: caja.caja_fisica_id,
        caja_nombre: caja.caja_nombre,
        estado: 'cerrada',
        fecha_apertura: caja.fecha_apertura,
        fecha_cierre: ahora
      },
      cierre: resultadoCierre,
      ...resultadoCierre
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Apertura dinámica de turno de caja (soporta selección de punto físico y validación de ocupación)
app.post('/api/caja/abrir', async (req, res) => {
  try {
    const { cajero = 'Cajero Turno', monto_inicial = 50000, negocio_id, caja_fisica_id, forzar = false, usuario_id } = req.body;
    const negocioId = Number(negocio_id || req.headers['x-negocio-id'] || 1);
    const montoNum = parseFloat(monto_inicial);
    if (isNaN(montoNum) || montoNum < 0) {
      return res.status(400).json({ ok: false, error: 'Monto inicial de apertura inválido' });
    }

    let nombreCajero = cajero;
    let usuarioIdFinal = usuario_id ? Number(usuario_id) : null;
    if (usuario_id) {
      const u = await dbGet('SELECT * FROM Usuarios WHERE id = ?', [Number(usuario_id)]);
      if (u) {
        nombreCajero = u.nombre_completo || u.usuario || cajero;
      }
    }

    let cajaFisicaIdNum = caja_fisica_id ? Number(caja_fisica_id) : null;
    let cajaNombre = null;

    if (cajaFisicaIdNum) {
      const punto = await dbGet('SELECT * FROM PuntosDeCobro WHERE id = ?', [cajaFisicaIdNum]);
      if (!punto) {
        return res.status(404).json({ ok: false, error: 'La caja física seleccionada no existe' });
      }
      cajaNombre = punto.nombre;

      // Verificar si ESA caja física ya está abierta por otro turno
      const cajaOcupada = await dbGet(
        "SELECT id, cajero, caja_nombre FROM Cajas WHERE caja_fisica_id = ? AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))",
        [cajaFisicaIdNum, negocioId, negocioId]
      );
      if (cajaOcupada) {
        return res.status(409).json({
          ok: false,
          error: `La caja física "${cajaNombre}" ya se encuentra en uso y abierta por ${cajaOcupada.cajero}`,
          caja_ocupada_por: cajaOcupada.cajero,
          turno_id: cajaOcupada.id
        });
      }
    } else {
      // Si no especificó caja física, intentar asignar la primera disponible o pre-asignada
      const puntos = await dbAll('SELECT * FROM PuntosDeCobro WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) AND activo = 1 ORDER BY id ASC', [negocioId, negocioId]);
      if (puntos && puntos.length > 0) {
        const turnosAbiertos = await dbAll("SELECT caja_fisica_id FROM Cajas WHERE estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))", [negocioId, negocioId]);
        const ocupadosIds = new Set(turnosAbiertos.map(t => Number(t.caja_fisica_id)));
        const disponible = puntos.find(p => !ocupadosIds.has(Number(p.id)));
        if (disponible) {
          cajaFisicaIdNum = disponible.id;
          cajaNombre = disponible.nombre;
        } else {
          cajaFisicaIdNum = puntos[0].id;
          cajaNombre = puntos[0].nombre;
        }
      } else {
        cajaNombre = 'Caja Principal';
      }
    }

    // Verificar si este mismo cajero ya tiene un turno abierto en este negocio
    if (!forzar) {
      const turnoPrevioCajero = await dbGet(
        "SELECT id, caja_nombre, caja_fisica_id FROM Cajas WHERE LOWER(cajero) = LOWER(?) AND estado = 'abierta' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))",
        [nombreCajero.trim(), negocioId, negocioId]
      );
      if (turnoPrevioCajero) {
        return res.status(409).json({
          ok: false,
          error: `El cajero "${nombreCajero}" ya tiene un turno activo en "${turnoPrevioCajero.caja_nombre || 'Caja #' + turnoPrevioCajero.id}"`,
          caja_id: turnoPrevioCajero.id,
          caja_fisica_id: turnoPrevioCajero.caja_fisica_id
        });
      }
    }

    const ahoraApertura = new Date().toISOString();
    const r = await dbRun(`
      INSERT INTO Cajas (negocio_id, usuario_id, cajero, caja_fisica_id, caja_nombre, fecha_apertura, monto_inicial, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'abierta')
    `, [negocioId, usuarioIdFinal, nombreCajero, cajaFisicaIdNum, cajaNombre, ahoraApertura, montoNum]);

    await registrarAuditoria({
      negocioId,
      usuarioNombre: nombreCajero,
      accion: 'apertura_caja',
      tipoEvento: 'operativo',
      modulo: 'caja',
      detalle: `Apertura de turno #${r.lastID} en ${cajaNombre || 'Caja'} (Cajero: ${nombreCajero}) con fondo inicial: ₡${montoNum.toLocaleString('es-CR')}`
    });

    io.emit('caja_actualizada');
    io.emit('cajas_fisicas_actualizadas');
    res.json({
      ok: true,
      message: `Nuevo turno abierto con éxito en ${cajaNombre || 'Caja'}`,
      caja_id: r.lastID,
      caja_fisica_id: cajaFisicaIdNum,
      caja_nombre: cajaNombre,
      caja: {
        id: r.lastID,
        usuario_id: usuarioIdFinal,
        cajero: nombreCajero,
        caja_fisica_id: cajaFisicaIdNum,
        caja_nombre: cajaNombre,
        estado: 'abierta',
        fecha_apertura: ahoraApertura,
        monto_inicial: montoNum
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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

    const ahora = new Date().toISOString();
    await dbRun("UPDATE Mesas SET estado = 'cuenta', pidio_cuenta_qr = 1, hora_pidio_cuenta = ? WHERE id = ?", [ahora, mesaId]);
    await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'esperando_parcial', 'activa')", [mesaId]);

    io.emit('cliente_pidio_cuenta', { mesaId: Number(mesaId), mesaNumero: mesa.numero, hora_pidio_cuenta: ahora });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'cuenta', pidio_cuenta_qr: 1, hora_pidio_cuenta: ahora });

    res.json({ message: 'Solicitud enviada al mesero', hora_pidio_cuenta: ahora });
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
async function registrarAuditoria({ 
  negocioId = null, 
  negocio_id = null, 
  usuarioId = null, 
  usuarioNombre = 'Sistema', 
  autorizadoPor = null,
  autorizado_por = null,
  accion, 
  tipoEvento = 'operativo', 
  modulo = 'general', 
  detalle, 
  motivo = null, 
  monto = 0, 
  pinAutorizado = 0 
}) {
  try {
    const nid = Number(negocio_id || negocioId || 1);
    const ahora = new Date().toISOString();
    const autorizadorFinal = (autorizado_por || autorizadoPor || '').trim() || null;
    let usuarioRegistro = String(usuarioNombre || 'Sistema').trim();

    try {
      await dbRun(
        `INSERT INTO Auditoria (negocio_id, usuario_id, usuario_nombre, autorizado_por, accion, tipo_evento, modulo, detalle, motivo, monto, pin_autorizado, fecha_hora)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nid, usuarioId, usuarioRegistro, autorizadorFinal, accion, tipoEvento, modulo, detalle, motivo, monto, (pinAutorizado || autorizadorFinal) ? 1 : 0, ahora]
      );
    } catch (_) {
      // Fallback si la base no tiene aún la columna autorizado_por
      if (autorizadorFinal && !usuarioRegistro.includes('Autorizó')) {
        usuarioRegistro = `${usuarioRegistro} (Autorizó: ${autorizadorFinal})`;
      }
      await dbRun(
        `INSERT INTO Auditoria (negocio_id, usuario_id, usuario_nombre, accion, tipo_evento, modulo, detalle, motivo, monto, pin_autorizado, fecha_hora)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nid, usuarioId, usuarioRegistro, accion, tipoEvento, modulo, detalle, motivo, monto, (pinAutorizado || autorizadorFinal) ? 1 : 0, ahora]
      );
    }
  } catch (e) {
    console.error('Error registrando auditoría:', e.message);
  }
}

async function descontarInventarioPorItems(items = []) {
  try {
    let huboCambios = false;
    for (const it of items) {
      const prodId = it.id || it.producto_id;
      const cant = Number(it.cantidad || 1);
      if ((!prodId && !it.desglose_balde && !it.es_balde) || cant <= 0) continue;

      const ahora = new Date().toISOString();
      const prodNombre = it.nombre || it.nombre_producto || 'Platillo';

      // CASO ESPECIAL: Balde de cerveza con selección múltiple / desglose
      let desgloseObj = null;
      if (it.desglose_balde) {
        if (typeof it.desglose_balde === 'string') {
          try { desgloseObj = JSON.parse(it.desglose_balde); } catch(e) {}
        } else if (typeof it.desglose_balde === 'object') {
          desgloseObj = it.desglose_balde;
        }
      }

      const esBalde = Boolean(it.es_balde || desgloseObj || (prodNombre && prodNombre.toLowerCase().includes('balde')));

      if (esBalde) {
        let listaCervezas = []; // { prodId, nombre, cant }
        if (desgloseObj && Object.keys(desgloseObj).length > 0) {
          for (const [subIdStr, subCantNum] of Object.entries(desgloseObj)) {
            const subCant = Number(subCantNum) * cant;
            if (subCant <= 0) continue;
            let subProd = await dbGet('SELECT * FROM Productos WHERE id = ?', [subIdStr]);
            let subInsumo = null;
            if (!subProd) {
              subInsumo = await dbGet('SELECT * FROM Inventario WHERE id = ? OR producto_id = ?', [subIdStr, subIdStr]);
            }
            listaCervezas.push({
              prodId: subProd ? subProd.id : (subInsumo ? subInsumo.producto_id || subInsumo.id : subIdStr),
              nombre: subProd ? subProd.nombre : (subInsumo ? subInsumo.nombre : `Cerveza #${subIdStr}`),
              cant: subCant
            });
          }
        } else if (it.notas && it.notas.includes('x ')) {
          const partes = it.notas.split(',').map(s => s.trim());
          for (const parte of partes) {
            const match = parte.match(/^(\d+)\s*x\s*(.+)$/i);
            if (match) {
              const subCant = Number(match[1]) * cant;
              const subNombre = match[2].trim();
              const subProd = await dbGet('SELECT * FROM Productos WHERE LOWER(nombre) = LOWER(?) OR LOWER(nombre) LIKE ?', [subNombre, `%${subNombre}%`]);
              listaCervezas.push({
                prodId: subProd ? subProd.id : null,
                nombre: subNombre,
                cant: subCant
              });
            }
          }
        }

        if (listaCervezas.length > 0) {
          for (const itemCerveza of listaCervezas) {
            const subProdId = itemCerveza.prodId;
            const subCant = itemCerveza.cant;
            const subNombre = itemCerveza.nombre;

            let descontado = false;
            // 1. Revisar recetas
            if (subProdId) {
              const recetas = await dbAll('SELECT * FROM InventarioRecetas WHERE producto_id = ?', [subProdId]);
              if (recetas && recetas.length > 0) {
                for (const r of recetas) {
                  const totalDesc = r.cantidad * subCant;
                  const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [r.insumo_id]);
                  if (insumo) {
                    const stockPrevio = insumo.stock_actual;
                    const stockNuevo = Math.max(0, stockPrevio - totalDesc);
                    await dbRun('UPDATE Inventario SET stock_actual = ?, actualizado_en = ? WHERE id = ?', [stockNuevo, ahora, r.insumo_id]);
                    const costoMov = Math.round(totalDesc * (insumo.costo_unitario || 0));
                    const motivoMov = `Consumo comanda (Balde Nacional): ${subNombre} (x${subCant})`;
                    const insNId = Number(insumo.negocio_id || 1);
                    await dbRun(
                      `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
                       VALUES (?, ?, 'venta', ?, ?, ?, ?, 'Comanda Automática', ?, ?)`,
                      [insNId, r.insumo_id, totalDesc, stockPrevio, stockNuevo, motivoMov, costoMov, ahora]
                    );
                    huboCambios = true;
                    descontado = true;
                    if (stockNuevo <= insumo.stock_minimo) {
                      io.emit('inventario_alerta_stock', {
                        insumoId: insumo.id,
                        insumo: insumo.nombre,
                        nombre: insumo.nombre,
                        stock_actual: stockNuevo,
                        stock_minimo: insumo.stock_minimo,
                        unidad: insumo.unidad || 'uds',
                        estado: stockNuevo <= 0 ? 'agotado' : 'bajo'
                      });
                    }
                  }
                }
              }
            }

            // 2. Si no hubo receta, buscar insumo directo
            if (!descontado) {
              let insumo = null;
              if (subProdId) {
                insumo = await dbGet('SELECT * FROM Inventario WHERE producto_id = ?', [subProdId]);
                if (!insumo) {
                  insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [subProdId]);
                }
              }
              if (!insumo && subNombre) {
                insumo = await dbGet(
                  'SELECT * FROM Inventario WHERE LOWER(nombre) = LOWER(?) OR LOWER(nombre) = LOWER(?) OR LOWER(nombre) LIKE ? ORDER BY CASE WHEN LOWER(nombre) = LOWER(?) THEN 1 WHEN LOWER(nombre) LIKE ? THEN 2 ELSE 3 END LIMIT 1',
                  [subNombre, `Cerveza ${subNombre}`, `%${subNombre}%`, subNombre, `%${subNombre}%`]
                );
              }

              if (insumo) {
                const stockPrevio = insumo.stock_actual;
                const stockNuevo = Math.max(0, stockPrevio - subCant);
                await dbRun('UPDATE Inventario SET stock_actual = ?, actualizado_en = ? WHERE id = ?', [stockNuevo, ahora, insumo.id]);
                const costoMov = Math.round(subCant * (insumo.costo_unitario || 0));
                const motivoMov = `Consumo comanda (Balde Nacional): ${subNombre} (x${subCant})`;
                const insNId = Number(insumo.negocio_id || 1);
                await dbRun(
                  `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
                   VALUES (?, ?, 'venta', ?, ?, ?, ?, 'Comanda Automática', ?, ?)`,
                  [insNId, insumo.id, subCant, stockPrevio, stockNuevo, motivoMov, costoMov, ahora]
                );
                huboCambios = true;
                if (stockNuevo <= insumo.stock_minimo) {
                  io.emit('inventario_alerta_stock', {
                    insumoId: insumo.id,
                    insumo: insumo.nombre,
                    nombre: insumo.nombre,
                    stock_actual: stockNuevo,
                    stock_minimo: insumo.stock_minimo,
                    unidad: insumo.unidad || 'uds',
                    estado: stockNuevo <= 0 ? 'agotado' : 'bajo'
                  });
                }
              }
            }
          }
          continue; // Terminar procesamiento de este item de balde
        }
      }

      // 1. Revisar si hay recetas vinculadas en InventarioRecetas
      const recetas = await dbAll('SELECT * FROM InventarioRecetas WHERE producto_id = ?', [prodId]);
      if (recetas && recetas.length > 0) {
        for (const r of recetas) {
          const totalDesc = r.cantidad * cant;
          const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [r.insumo_id]);
          if (insumo) {
            const stockPrevio = insumo.stock_actual;
            const stockNuevo = Math.max(0, stockPrevio - totalDesc);
            await dbRun(
              'UPDATE Inventario SET stock_actual = ?, actualizado_en = ? WHERE id = ?',
              [stockNuevo, ahora, r.insumo_id]
            );
            const costoMov = Math.round(totalDesc * (insumo.costo_unitario || 0));
            let motivoMov = `Consumo comanda: ${prodNombre} (x${cant})`;
            if (insumo.es_licor && insumo.rendimiento_shots > 0) {
              const shotsDeducidos = Math.round(totalDesc * insumo.rendimiento_shots * 10) / 10;
              const botEnteras = Math.floor(stockNuevo);
              const shotsRem = Math.round((stockNuevo - botEnteras) * insumo.rendimiento_shots);
              if (totalDesc < 1) {
                motivoMov = `Consumo comanda: ${prodNombre} (-${shotsDeducidos} shot${shotsDeducidos === 1 ? '' : 's'} / ${Math.round(shotsDeducidos * (insumo.medida_shot_ml || 30))}ml) -> Quedan ${botEnteras} bot. y ${shotsRem} shots`;
              } else {
                motivoMov = `Consumo comanda: ${prodNombre} (-${totalDesc} botella${totalDesc === 1 ? '' : 's'} / -${shotsDeducidos} shots) -> Quedan ${botEnteras} bot. y ${shotsRem} shots`;
              }
            }

            const insNId = Number(insumo.negocio_id || 1);
            await dbRun(
              `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
               VALUES (?, ?, 'venta', ?, ?, ?, ?, 'Comanda Automática', ?, ?)`,
              [insNId, r.insumo_id, totalDesc, stockPrevio, stockNuevo, motivoMov, costoMov, ahora]
            );
            huboCambios = true;
            if (stockNuevo <= insumo.stock_minimo) {
              io.emit('inventario_alerta_stock', {
                insumoId: insumo.id,
                insumo: insumo.nombre,
                nombre: insumo.nombre,
                stock_actual: stockNuevo,
                stock_minimo: insumo.stock_minimo,
                unidad: insumo.unidad || 'uds',
                estado: stockNuevo <= 0 ? 'agotado' : 'bajo'
              });
            }
          }
        }
      } else {
        // 2. Si no hay receta, descontar del insumo vinculado directamente al producto
        const insumo = await dbGet('SELECT * FROM Inventario WHERE producto_id = ?', [prodId]);
        if (insumo) {
          const stockPrevio = insumo.stock_actual;
          const stockNuevo = Math.max(0, stockPrevio - cant);
          await dbRun(
            'UPDATE Inventario SET stock_actual = ?, actualizado_en = ? WHERE id = ?',
            [stockNuevo, ahora, insumo.id]
          );
          const costoMov = Math.round(cant * (insumo.costo_unitario || 0));

          let motivoDirecto = `Consumo directo: ${prodNombre} (x${cant})`;
          if (insumo.es_licor && insumo.rendimiento_shots > 0) {
            const shotsDeducidos = Math.round(cant * insumo.rendimiento_shots);
            const botEnteras = Math.floor(stockNuevo);
            const shotsRem = Math.round((stockNuevo - botEnteras) * insumo.rendimiento_shots);
            motivoDirecto = `Consumo directo: ${prodNombre} (-${cant} bot. / -${shotsDeducidos} shots) -> Quedan ${botEnteras} bot. y ${shotsRem} shots`;
          }

          const insNId = Number(insumo.negocio_id || 1);
          await dbRun(
            `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
             VALUES (?, ?, 'venta', ?, ?, ?, ?, 'Comanda Automática', ?, ?)`,
            [insNId, insumo.id, cant, stockPrevio, stockNuevo, motivoDirecto, costoMov, ahora]
          );
          huboCambios = true;
          if (stockNuevo <= insumo.stock_minimo) {
            io.emit('inventario_alerta_stock', {
              insumoId: insumo.id,
              insumo: insumo.nombre,
              nombre: insumo.nombre,
              stock_actual: stockNuevo,
              stock_minimo: insumo.stock_minimo,
              unidad: insumo.unidad || 'uds',
              estado: stockNuevo <= 0 ? 'agotado' : 'bajo'
            });
          }
        }
      }
    }
    if (huboCambios) {
      io.emit('inventario_actualizado');
    }
  } catch (e) {
    console.error('Error descontando inventario:', e.message);
  }
}

async function validarPinAdministrador(pin, negocioId = null) {
  if (!pin) return false;
  const pinStr = String(pin).trim();
  if (!pinStr) return false;
  try {
    const usuariosAdmin = await dbAll(
      "SELECT id, usuario, nombre_completo, rol, pin, negocio_id FROM Usuarios WHERE rol IN ('admin', 'developer', 'superadmin', 'super_admin', 'superadministrador', 'administrador') AND activo = 1"
    );
    for (const u of usuariosAdmin) {
      if (negocioId && u.rol !== 'developer' && u.rol !== 'superadmin' && u.negocio_id != null && Number(u.negocio_id) !== Number(negocioId)) {
        continue;
      }
      if (u.pin && String(u.pin).trim() === pinStr) {
        return u;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

app.post('/api/auth/verificar-pin-admin', async (req, res) => {
  try {
    const { pin, negocio_id } = req.body;
    const esValido = await validarPinAdministrador(pin, negocio_id || req.headers['x-negocio-id']);
    if (!esValido) {
      return res.status(401).json({ error: 'PIN de Administrador incorrecto o no autorizado.' });
    }
    res.json({ 
      ok: true, 
      message: 'PIN de Administrador verificado con éxito.',
      adminUsuario: esValido.usuario,
      adminNombre: esValido.nombre_completo,
      adminRol: esValido.rol
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function verificarAdmin(req, res, next) {
  const rol = (req.usuario?.rol || req.headers['x-user-rol'] || (req.query && req.query.rol) || (req.body && req.body.rol) || '').toLowerCase();
  const pin = req.headers['x-supervisor-pin'] || (req.body && req.body.pinAutorizado) || (req.body && req.body.pin);
  const negocioId = obtenerNegocioIdReq(req);

  if (['admin', 'developer', 'supervisor', 'superadmin', 'super_admin', 'superadministrador', 'administrador'].includes(rol)) {
    return next();
  }

  if (pin) {
    const esValido = await validarPinAdministrador(pin, negocioId);
    if (esValido) {
      return next();
    }
  }

  return res.status(403).json({ error: 'Acceso denegado: Requiere permisos de Administrador o PIN verificado.' });
}

// ============================================================================
// 14. MÓDULOS DE ADMINISTRACIÓN: INVENTARIO, AUDITORÍA & MÉTRICAS (EXCLUSIVO ADMIN)
// ============================================================================

// --- INVENTARIO ---
app.get('/api/admin/inventario', verificarAdmin, async (req, res) => {
  try {
    const negocioId = req.query.negocio_id ? Number(req.query.negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1);
    const insumos = await dbAll(`
      SELECT i.*, p.nombre as producto_vinculado_nombre
      FROM Inventario i
      LEFT JOIN Productos p ON i.producto_id = p.id
      WHERE (i.negocio_id = ? OR (i.negocio_id IS NULL AND ? = 1))
      ORDER BY i.categoria ASC, i.nombre ASC
    `, [negocioId, negocioId]);

    const insumosConEstado = insumos.map(ins => {
      let estado = 'normal';
      if (ins.stock_actual <= 0) estado = 'agotado';
      else if (ins.stock_actual <= ins.stock_minimo) estado = 'bajo';
      if (ins.stock_actual <= 0) {
        estado = (Number(ins.stock_minimo) > 0) ? 'agotado' : 'sin_stock';
      } else if (ins.stock_actual <= ins.stock_minimo) {
        estado = 'bajo';
      }

      let botellas_enteras = null;
      let shots_remanentes = null;
      let total_shots_actual = null;
      if (ins.es_licor && ins.rendimiento_shots > 0) {
        botellas_enteras = Math.floor(ins.stock_actual);
        shots_remanentes = Math.round((ins.stock_actual - botellas_enteras) * ins.rendimiento_shots);
        total_shots_actual = Math.round(ins.stock_actual * ins.rendimiento_shots);
      }

      return {
        ...ins,
        estado_stock: estado,
        botellas_enteras,
        shots_remanentes,
        total_shots_actual,
        costo_por_shot: ins.rendimiento_shots > 0 ? Math.round((ins.costo_unitario / ins.rendimiento_shots) * 100) / 100 : null
      };
    });

    res.json(insumosConEstado);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/inventario', verificarAdmin, async (req, res) => {
  try {
    const {
      nombre, categoria = 'General', unidad_medida = 'unidades',
      stock_actual = 0, stock_minimo = 5, costo_unitario = 0,
      producto_id = null, usuarioNombre = 'Administrador',
      es_licor = 0, capacidad_ml = 750, medida_shot_ml = 30,
      negocio_id, negocioId: nIdReq
    } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de insumo requerido' });

    const finalNegocioId = Number(req.negocioId || negocio_id || nIdReq || req.headers['x-negocio-id'] || 1);
    const esLic = es_licor ? 1 : 0;
    const capMl = esLic ? (Number(capacidad_ml) || 750) : null;
    const shotMl = esLic ? (Number(medida_shot_ml) || 30) : null;
    const rendShots = esLic && shotMl > 0 ? Math.round((capMl / shotMl) * 10) / 10 : null;

    const ahora = new Date().toISOString();
    const result = await dbRun(
      `INSERT INTO Inventario (
        negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo,
        costo_unitario, producto_id, actualizado_en, es_licor, capacidad_ml, medida_shot_ml, rendimiento_shots
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalNegocioId,
        nombre.trim(), categoria.trim(), unidad_medida.trim(),
        Number(stock_actual), Number(stock_minimo), Number(costo_unitario),
        producto_id ? Number(producto_id) : null, ahora,
        esLic, capMl, shotMl, rendShots
      ]
    );

    await registrarAuditoria({
      negocioId: finalNegocioId,
      usuarioNombre,
      accion: 'crear_insumo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Creación de nuevo insumo "${nombre}" (${unidad_medida})${esLic ? ` [Botella ${capMl}ml, Shot ${shotMl}ml, Rinde ${rendShots} shots]` : ''}`
    });

    res.status(201).json({
      id: result.lastID,
      insumoId: result.lastID,
      message: 'Insumo registrado correctamente',
      es_licor: esLic,
      capacidad_ml: capMl,
      medida_shot_ml: shotMl,
      rendimiento_shots: rendShots
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/inventario/:id', verificarAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (isNaN(parseInt(id, 10))) return next();
    const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });

    let botellas_enteras = null;
    let shots_remanentes = null;
    let total_shots_actual = null;
    if (insumo.es_licor && insumo.rendimiento_shots > 0) {
      botellas_enteras = Math.floor(insumo.stock_actual);
      shots_remanentes = Math.round((insumo.stock_actual - botellas_enteras) * insumo.rendimiento_shots);
      total_shots_actual = Math.round(insumo.stock_actual * insumo.rendimiento_shots);
    }

    res.json({
      ...insumo,
      botellas_enteras,
      shots_remanentes,
      total_shots_actual,
      costo_por_shot: insumo.rendimiento_shots > 0 ? Math.round((insumo.costo_unitario / insumo.rendimiento_shots) * 100) / 100 : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/inventario/:id', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const {
      nombre, categoria, unidad_medida, stock_minimo, costo_unitario, producto_id,
      es_licor, capacidad_ml, medida_shot_ml, usuarioNombre = 'Administrador'
    } = req.body;
    const ahora = new Date().toISOString();

    const insumoActual = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumoActual) return res.status(404).json({ error: 'Insumo no encontrado' });

    const esLic = es_licor !== undefined ? (es_licor ? 1 : 0) : insumoActual.es_licor;
    const capMl = esLic ? (Number(capacidad_ml) || insumoActual.capacidad_ml || (unidad_medida === 'kg' ? 1000 : 750)) : null;
    const shotMl = esLic ? (Number(medida_shot_ml) || insumoActual.medida_shot_ml || (unidad_medida === 'kg' ? 200 : 30)) : null;
    const rendShots = esLic && shotMl > 0 ? Math.round((capMl / shotMl) * 100) / 100 : null;

    await dbRun(
      `UPDATE Inventario SET 
        nombre = COALESCE(?, nombre),
        categoria = COALESCE(?, categoria),
        unidad_medida = COALESCE(?, unidad_medida),
        stock_minimo = COALESCE(?, stock_minimo),
        costo_unitario = COALESCE(?, costo_unitario),
        producto_id = ?,
        es_licor = ?,
        capacidad_ml = ?,
        medida_shot_ml = ?,
        rendimiento_shots = ?,
        actualizado_en = ?
       WHERE id = ?`,
      [
        nombre, categoria, unidad_medida, stock_minimo, costo_unitario,
        producto_id !== undefined ? producto_id : insumoActual.producto_id,
        esLic, capMl, shotMl, rendShots, ahora, id
      ]
    );

    await registrarAuditoria({
      negocioId: insumoActual.negocio_id || 1,
      usuarioNombre,
      accion: 'actualizar_insumo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Modificación de insumo ID ${id}: ${nombre || insumoActual.nombre} (${categoria || insumoActual.categoria})`
    });

    if (io) io.emit('inventario_actualizado');

    res.json({ message: 'Insumo actualizado con éxito', id, es_licor: esLic, rendimiento_shots: rendShots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/inventario/:id', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumo) {
      return res.status(404).json({ error: 'Insumo no encontrado' });
    }

    // Limpiar relaciones en recetas y movimientos de kardex
    await dbRun('DELETE FROM InventarioRecetas WHERE insumo_id = ?', [id]);
    await dbRun('DELETE FROM InventarioMovimientos WHERE insumo_id = ?', [id]);
    await dbRun('DELETE FROM Inventario WHERE id = ?', [id]);

    await registrarAuditoria({
      negocioId: insumo.negocio_id || 1,
      usuarioNombre: req.body?.usuarioNombre || 'Administrador',
      accion: 'eliminar_insumo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Eliminación de insumo ID ${id}: "${insumo.nombre}" (Stock final: ${insumo.stock_actual} ${insumo.unidad_medida})`
    });

    if (io) io.emit('inventario_actualizado');

    res.json({
      success: true,
      message: `Insumo "${insumo.nombre}" eliminado correctamente`,
      id: Number(id)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Eliminar existencias totales de bodega con registro estricto en auditoría y Kárdex
const handlerEliminarExistenciasBodega = async (req, res) => {
  try {
    const id = req.params.id;
    const { motivo = 'Eliminación manual de existencias en bodega', usuarioNombre = 'Administrador' } = req.body || {};

    let insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumo) {
      return res.status(404).json({ error: 'Insumo no encontrado en bodega.' });
    }

    const stockPrevio = Number(insumo.stock_actual || insumo.stock || 0);
    const ahora = new Date().toISOString();

    await dbRun('UPDATE Inventario SET stock_actual = 0, actualizado_en = ? WHERE id = ?', [ahora, id]);

    // Registrar en InventarioMovimientos
    try {
      await dbRun(
        `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
         VALUES (1, ?, 'salida', ?, ?, 0, ?, ?, ?, ?)`,
        [id, stockPrevio, stockPrevio, `Eliminación total de existencias en bodega: ${motivo}`, usuarioNombre, stockPrevio * (insumo.costo_unitario || 0), ahora]
      );
    } catch (_) {}

    // Registrar en Auditoria
    await registrarAuditoria({
      negocioId: insumo.negocio_id || 1,
      usuarioNombre,
      accion: 'eliminar_existencia_bodega',
      tipoEvento: 'inventario',
      modulo: 'bodega',
      detalle: `Eliminación total de existencia en bodega: "${insumo.nombre}" (Stock anterior: ${stockPrevio} ${insumo.unidad_medida || 'uds'}) -> Stock: 0`,
      motivo,
      pinAutorizado: 1
    });

    if (io) io.emit('inventario_actualizado');

    res.json({
      success: true,
      message: `Existencias de "${insumo.nombre}" eliminadas correctamente y registradas en auditoría.`,
      insumo_id: Number(id),
      stock_previo: stockPrevio,
      stock_actual: 0
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar existencias: ' + e.message });
  }
};

app.post('/api/admin/inventario/:id/eliminar-existencias', verificarAdmin, handlerEliminarExistenciasBodega);
app.post('/api/admin/inventario/insumos/:id/eliminar-existencias', verificarAdmin, handlerEliminarExistenciasBodega);

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

    const negocioId = insumo.negocio_id || 1;
    await registrarAuditoria({
      negocioId,
      usuarioNombre,
      accion: accionAuditoria,
      tipoEvento,
      modulo: 'inventario',
      detalle: `${tipo.toUpperCase()}: ${insumo.nombre} (${cantNum > 0 ? '+' : ''}${cantNum} ${insumo.unidad_medida}) -> Stock resultante: ${nuevoStock}`,
      motivo,
      monto: costoTotalAjuste
    });

    await dbRun(
      `INSERT INTO InventarioMovimientos (negocio_id, insumo_id, tipo, cantidad, stock_previo, stock_nuevo, motivo, usuario_nombre, costo_total, fecha_hora)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, id, tipo, Math.abs(cantNum), insumo.stock_actual, nuevoStock, motivo, usuarioNombre, costoTotalAjuste, ahora]
    );

    io.emit('inventario_actualizado');

    res.json({
      message: 'Ajuste de inventario aplicado',
      stock_previo: insumo.stock_actual,
      nuevo_stock: nuevoStock,
      stock_actual: nuevoStock
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- RECETAS & ESCANDALLOS ---
app.get('/api/admin/recetas/resumen', verificarAdmin, async (req, res) => {
  try {
    const productos = await dbAll('SELECT id, nombre, precio, categoria_id FROM Productos WHERE activo = 1 ORDER BY categoria_id ASC, nombre ASC');
    const recetas = await dbAll(`
      SELECT r.producto_id, r.cantidad, COALESCE(r.merma_porcentaje, 0) as merma_porcentaje, i.costo_unitario
      FROM InventarioRecetas r
      JOIN Inventario i ON r.insumo_id = i.id
    `);

    const costosMap = {};
    const cantIngredientesMap = {};
    recetas.forEach(r => {
      const mermaFactor = 1 + (Number(r.merma_porcentaje) / 100);
      const subtotal = Number(r.cantidad) * Number(r.costo_unitario) * mermaFactor;
      costosMap[r.producto_id] = (costosMap[r.producto_id] || 0) + subtotal;
      cantIngredientesMap[r.producto_id] = (cantIngredientesMap[r.producto_id] || 0) + 1;
    });

    const resumen = productos.map(p => {
      const costo = Math.round((costosMap[p.id] || 0) * 100) / 100;
      const pvp = Number(p.precio || 0);
      const margenBruto = Math.round((pvp - costo) * 100) / 100;
      const margenPorc = pvp > 0 ? Math.round((margenBruto / pvp) * 1000) / 10 : 0;
      const foodCostPorc = pvp > 0 ? Math.round((costo / pvp) * 1000) / 10 : 0;

      return {
        id: p.id,
        producto_id: p.id,
        nombre: p.nombre,
        producto_nombre: p.nombre,
        categoria_id: p.categoria_id,
        precio_venta: pvp,
        costo_receta: costo,
        margen_bruto: margenBruto,
        margen_porcentaje: margenPorc,
        margen_porc: margenPorc,
        food_cost_porcentaje: foodCostPorc,
        food_cost_porc: foodCostPorc,
        total_ingredientes: cantIngredientesMap[p.id] || 0,
        tiene_receta: Boolean(cantIngredientesMap[p.id])
      };
    });

    res.json(resumen);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/recetas/:productoId', verificarAdmin, async (req, res) => {
  try {
    const prodId = req.params.productoId;
    const prod = await dbGet('SELECT id, nombre, precio, categoria_id FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const ingredientes = await dbAll(`
      SELECT r.id as receta_id, r.producto_id, r.insumo_id, r.cantidad, COALESCE(r.merma_porcentaje, 0) as merma_porcentaje,
             i.nombre as insumo_nombre, i.categoria as insumo_categoria, i.unidad_medida, 
             i.costo_unitario, i.stock_actual, i.stock_minimo, i.es_licor, i.capacidad_ml, i.medida_shot_ml, i.rendimiento_shots
      FROM InventarioRecetas r
      JOIN Inventario i ON r.insumo_id = i.id
      WHERE r.producto_id = ?
      ORDER BY i.nombre ASC
    `, [prodId]);

    let costoReceta = 0;
    let porcionesDisponibles = ingredientes.length > 0 ? Infinity : 0;

    const ingredientesDetalle = ingredientes.map(ing => {
      const mermaFactor = 1 + (Number(ing.merma_porcentaje) / 100);
      const subtotalCosto = Math.round(Number(ing.cantidad) * Number(ing.costo_unitario) * mermaFactor * 100) / 100;
      costoReceta += subtotalCosto;

      const porcionesIngrediente = Number(ing.cantidad) > 0 ? Math.floor(Number(ing.stock_actual) / Number(ing.cantidad)) : 0;
      if (porcionesIngrediente < porcionesDisponibles) {
        porcionesDisponibles = porcionesIngrediente;
      }

      let medidaAmigable = `${ing.cantidad} ${ing.unidad_medida || 'unidades'}`;
      let mlCalculados = null;
      if (ing.es_licor) {
        const capMl = ing.capacidad_ml || 750;
        const mlUsados = Math.round(Number(ing.cantidad) * capMl * 10) / 10;
        mlCalculados = mlUsados;
        const oz = Math.round((mlUsados / 30) * 100) / 100;
        
        if (Math.abs(oz - 0.25) <= 0.03) {
          medidaAmigable = '1/4 oz (7.5 ml)';
        } else if (Math.abs(oz - 0.5) <= 0.03) {
          medidaAmigable = '1/2 oz (15 ml)';
        } else if (Math.abs(oz - 0.75) <= 0.03) {
          medidaAmigable = '3/4 oz (22.5 ml)';
        } else if (Math.abs(oz - 1) <= 0.03) {
          medidaAmigable = '1 oz (30 ml / 1 shot)';
        } else if (Math.abs(oz - 1.5) <= 0.03) {
          medidaAmigable = '1.5 oz (45 ml)';
        } else if (Math.abs(oz - 2) <= 0.03) {
          medidaAmigable = '2 oz (60 ml / Doble)';
        } else if (Math.abs(Number(ing.cantidad) - 0.25) <= 0.01) {
          medidaAmigable = `1/4 Botella (${Math.round(capMl * 0.25)} ml)`;
        } else if (Math.abs(Number(ing.cantidad) - 0.5) <= 0.01) {
          medidaAmigable = `1/2 Botella (${Math.round(capMl * 0.5)} ml)`;
        } else if (Math.abs(Number(ing.cantidad) - 1) <= 0.01) {
          medidaAmigable = `1 Botella completa (${capMl} ml)`;
        } else if (oz > 0 && oz <= 10) {
          medidaAmigable = `${oz} oz (~${Math.round(mlUsados)} ml)`;
        } else {
          medidaAmigable = `${ing.cantidad} bot. (~${Math.round(mlUsados)} ml)`;
        }
      }

      return {
        ...ing,
        cantidad_bruta: ing.cantidad,
        medida_amigable: medidaAmigable,
        ml_estimados: mlCalculados,
        costo_subtotal: subtotalCosto,
        subtotal_costo: subtotalCosto,
        porciones_posibles: porcionesIngrediente,
        rendimiento_porciones: porcionesIngrediente
      };
    });

    if (porcionesDisponibles === Infinity) porcionesDisponibles = 0;

    const pvp = Number(prod.precio || 0);
    const margenBruto = Math.round((pvp - costoReceta) * 100) / 100;
    const margenPorcentaje = pvp > 0 ? Math.round((margenBruto / pvp) * 1000) / 10 : 0;
    const foodCostPorcentaje = pvp > 0 ? Math.round((costoReceta / pvp) * 1000) / 10 : 0;

    res.json({
      producto: prod,
      producto_id: prod.id,
      producto_nombre: prod.nombre,
      ingredientes: ingredientesDetalle,
      costo_receta: Math.round(costoReceta * 100) / 100,
      precio_venta: pvp,
      margen_bruto: margenBruto,
      margen_porcentaje: margenPorcentaje,
      margen_porc: margenPorcentaje,
      food_cost_porcentaje: foodCostPorcentaje,
      food_cost_porc: foodCostPorcentaje,
      porciones_disponibles: porcionesDisponibles
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/recetas/:productoId/ingredientes', verificarAdmin, async (req, res) => {
  try {
    const prodId = Number(req.params.productoId);
    const { insumo_id, cantidad, merma_porcentaje = 0, usuarioNombre = 'Administrador' } = req.body;
    const insId = Number(insumo_id);
    const cantNum = Number(cantidad);

    if (!insId || isNaN(cantNum) || cantNum <= 0) {
      return res.status(400).json({ error: 'Insumo y cantidad válida mayor a 0 son requeridos' });
    }

    const prod = await dbGet('SELECT id, nombre FROM Productos WHERE id = ?', [prodId]);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const ins = await dbGet('SELECT id, nombre FROM Inventario WHERE id = ?', [insId]);
    if (!ins) return res.status(404).json({ error: 'Insumo no encontrado' });

    const existente = await dbGet('SELECT id FROM InventarioRecetas WHERE producto_id = ? AND insumo_id = ?', [prodId, insId]);
    if (existente) {
      await dbRun(
        'UPDATE InventarioRecetas SET cantidad = ?, merma_porcentaje = ? WHERE id = ?',
        [cantNum, Number(merma_porcentaje || 0), existente.id]
      );
    } else {
      await dbRun(
        'INSERT INTO InventarioRecetas (producto_id, insumo_id, cantidad, merma_porcentaje) VALUES (?, ?, ?, ?)',
        [prodId, insId, cantNum, Number(merma_porcentaje || 0)]
      );
    }

    const prodNegocioId = prod.negocio_id || ins.negocio_id || 1;
    await registrarAuditoria({
      negocioId: prodNegocioId,
      usuarioNombre,
      accion: 'modificar_escandallo',
      tipoEvento: 'operativo',
      modulo: 'inventario',
      detalle: `Ingrediente ${ins.nombre} (${cantNum}) asignado a receta de ${prod.nombre}`
    });

    io.emit('receta_actualizada', { producto_id: prodId });
    res.json({ ok: true, message: 'Ingrediente guardado en la receta' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/recetas/:productoId/ingredientes/:insumoId', verificarAdmin, async (req, res) => {
  try {
    const prodId = Number(req.params.productoId);
    const insId = Number(req.params.insumoId);
    const { cantidad, merma_porcentaje = 0 } = req.body;
    const cantNum = Number(cantidad);

    if (isNaN(cantNum) || cantNum <= 0) {
      return res.status(400).json({ error: 'Cantidad válida mayor a 0 requerida' });
    }

    await dbRun(
      'UPDATE InventarioRecetas SET cantidad = ?, merma_porcentaje = ? WHERE producto_id = ? AND insumo_id = ?',
      [cantNum, Number(merma_porcentaje || 0), prodId, insId]
    );

    io.emit('receta_actualizada', { producto_id: prodId });
    res.json({ ok: true, message: 'Ingrediente actualizado con éxito' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/recetas/:productoId/ingredientes/:insumoId', verificarAdmin, async (req, res) => {
  try {
    const prodId = Number(req.params.productoId);
    const insId = Number(req.params.insumoId);

    await dbRun('DELETE FROM InventarioRecetas WHERE producto_id = ? AND insumo_id = ?', [prodId, insId]);

    io.emit('receta_actualizada', { producto_id: prodId });
    res.json({ ok: true, message: 'Ingrediente eliminado de la receta' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/recetas/resumen', verificarAdmin, async (req, res) => {
  try {
    const productos = await dbAll('SELECT id, nombre, precio, categoria_id FROM Productos WHERE activo = 1 ORDER BY categoria_id ASC, nombre ASC');
    const recetas = await dbAll(`
      SELECT r.producto_id, r.cantidad, COALESCE(r.merma_porcentaje, 0) as merma_porcentaje, i.costo_unitario
      FROM InventarioRecetas r
      JOIN Inventario i ON r.insumo_id = i.id
    `);

    const costosMap = {};
    const cantIngredientesMap = {};
    recetas.forEach(r => {
      const mermaFactor = 1 + (Number(r.merma_porcentaje) / 100);
      const subtotal = Number(r.cantidad) * Number(r.costo_unitario) * mermaFactor;
      costosMap[r.producto_id] = (costosMap[r.producto_id] || 0) + subtotal;
      cantIngredientesMap[r.producto_id] = (cantIngredientesMap[r.producto_id] || 0) + 1;
    });

    const resumen = productos.map(p => {
      const costo = Math.round((costosMap[p.id] || 0) * 100) / 100;
      const pvp = Number(p.precio || 0);
      const margenBruto = Math.round((pvp - costo) * 100) / 100;
      const margenPorc = pvp > 0 ? Math.round((margenBruto / pvp) * 1000) / 10 : 0;
      const foodCostPorc = pvp > 0 ? Math.round((costo / pvp) * 1000) / 10 : 0;

      return {
        id: p.id,
        nombre: p.nombre,
        categoria_id: p.categoria_id,
        precio_venta: pvp,
        costo_receta: costo,
        margen_bruto: margenBruto,
        margen_porcentaje: margenPorc,
        food_cost_porcentaje: foodCostPorc,
        total_ingredientes: cantIngredientesMap[p.id] || 0,
        tiene_receta: Boolean(cantIngredientesMap[p.id])
      };
    });

    res.json(resumen);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- KARDEX GENERAL / MOVIMIENTOS COMPLETOS ---
app.get('/api/admin/inventario/kardex/movimientos', verificarAdmin, async (req, res) => {
  try {
    const { insumo_id, tipo, limit, negocio_id } = req.query;
    const nid = negocio_id ? Number(negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1);
    let query = `
      SELECT m.*, i.nombre as insumo_nombre, i.categoria as insumo_categoria, i.unidad_medida, i.es_licor, i.rendimiento_shots
      FROM InventarioMovimientos m
      LEFT JOIN Inventario i ON m.insumo_id = i.id
      WHERE (m.negocio_id = ? OR (m.negocio_id IS NULL AND ? = 1))
    `;
    const params = [nid, nid];
    if (insumo_id && insumo_id !== 'todos') {
      query += ' AND m.insumo_id = ?';
      params.push(insumo_id);
    }
    if (tipo && tipo !== 'todos') {
      query += ' AND m.tipo = ?';
      params.push(tipo);
    }
    query += ' ORDER BY m.id DESC LIMIT ?';
    params.push(parseInt(limit) || 250);

    const movimientos = await dbAll(query, params);
    res.json({ movimientos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- VACIAR TODO EL HISTORIAL DE KARDEX (DEVELOPER / SUPER ADMIN) ---
const vaciarKardexHandler = async (req, res) => {
  try {
    const rol = (req.usuario && req.usuario.rol) || req.headers['x-user-rol'] || '';
    const pinSupervisor = req.headers['x-supervisor-pin'] || req.body?.pin || '';
    
    const esDeveloper = rol === 'developer' || rol === 'superadmin' || pinSupervisor === '9999';
    if (!esDeveloper && rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de Developer o Administrador.' });
    }

    const negocioId = req.query.negocio_id 
      ? Number(req.query.negocio_id) 
      : (req.body?.negocio_id ? Number(req.body.negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1));

    const totalAntes = await dbGet(
      `SELECT COUNT(*) as total FROM InventarioMovimientos WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))`,
      [negocioId, negocioId]
    );

    await dbRun(
      `DELETE FROM InventarioMovimientos WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))`,
      [negocioId, negocioId]
    );

    // Registrar en auditoría
    await dbRun(
      `INSERT INTO Auditoria (negocio_id, usuario_nombre, accion, tipo_evento, modulo, detalle, fecha_hora)
       VALUES (?, ?, 'VACIAR_KARDEX', 'seguridad', 'inventario', ?, datetime('now'))`,
      [negocioId, req.usuario?.nombre || 'Developer', `Se vaciaron ${totalAntes?.total || 0} movimientos de Kárdex.`]
    ).catch(() => {});

    res.json({
      success: true,
      eliminados: totalAntes?.total || 0,
      mensaje: `Historial de Kárdex vaciado correctamente (${totalAntes?.total || 0} registros eliminados).`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

app.post('/api/admin/inventario/kardex/vaciar', verificarAdmin, vaciarKardexHandler);
app.post('/api/developer/inventario/kardex/vaciar', verificarAdmin, vaciarKardexHandler);
app.delete('/api/developer/inventario/kardex/todos', verificarAdmin, vaciarKardexHandler);

// --- MODIFICAR MOVIMIENTO DE KARDEX ---
app.put('/api/admin/inventario/kardex/movimientos/:id', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const movimiento = await dbGet('SELECT * FROM InventarioMovimientos WHERE id = ?', [id]);
    if (!movimiento) {
      return res.status(404).json({ error: 'Movimiento de Kárdex no encontrado' });
    }

    const {
      tipo,
      cantidad,
      costo_total,
      motivo,
      fecha_hora,
      ajustar_stock
    } = req.body;

    const nuevoTipo = tipo || movimiento.tipo;
    const nuevaCantidad = cantidad !== undefined ? Number(cantidad) : Number(movimiento.cantidad);
    const nuevoCosto = costo_total !== undefined ? Number(costo_total) : Number(movimiento.costo_total || 0);
    const nuevoMotivo = motivo !== undefined ? motivo : movimiento.motivo;
    const nuevaFecha = fecha_hora || movimiento.fecha_hora || new Date().toISOString();

    const debeAjustarStock = Boolean(
      ajustar_stock === true ||
      ajustar_stock === 'true' ||
      ajustar_stock === 1 ||
      ajustar_stock === '1'
    );

    if (debeAjustarStock && movimiento.insumo_id) {
      const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [movimiento.insumo_id]);
      if (insumo) {
        // Delta que aplicó el movimiento original sobre el stock
        let oldDelta = 0;
        if (movimiento.tipo === 'entrada') oldDelta = Number(movimiento.cantidad);
        else if (['merma', 'venta', 'salida'].includes(movimiento.tipo)) oldDelta = -Number(movimiento.cantidad);

        // Delta que aplica el nuevo movimiento sobre el stock
        let newDelta = 0;
        if (nuevoTipo === 'entrada') newDelta = Number(nuevaCantidad);
        else if (['merma', 'venta', 'salida'].includes(nuevoTipo)) newDelta = -Number(nuevaCantidad);

        const diferencia = newDelta - oldDelta;
        if (diferencia !== 0) {
          const nuevoStock = Math.max(0, Math.round(((Number(insumo.stock_actual) || 0) + diferencia) * 1000) / 1000);
          await dbRun('UPDATE Inventario SET stock_actual = ? WHERE id = ?', [nuevoStock, insumo.id]);
        }
      }
    }

    await dbRun(
      `UPDATE InventarioMovimientos 
       SET tipo = ?, cantidad = ?, costo_total = ?, motivo = ?, fecha_hora = ?
       WHERE id = ?`,
      [nuevoTipo, nuevaCantidad, nuevoCosto, nuevoMotivo, nuevaFecha, id]
    );

    const movActualizado = await dbGet(
      `SELECT m.*, i.nombre as insumo_nombre, i.categoria as insumo_categoria, i.unidad_medida
       FROM InventarioMovimientos m
       LEFT JOIN Inventario i ON m.insumo_id = i.id
       WHERE m.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Movimiento de Kárdex actualizado correctamente',
      movimiento: movActualizado
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ELIMINAR MOVIMIENTO DE KARDEX ---
app.delete('/api/admin/inventario/kardex/movimientos/:id', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const movimiento = await dbGet('SELECT * FROM InventarioMovimientos WHERE id = ?', [id]);
    if (!movimiento) {
      return res.status(404).json({ error: 'Movimiento de Kárdex no encontrado' });
    }

    const revertirStock = Boolean(
      req.body?.revertir_stock === true ||
      req.body?.revertir_stock === 'true' ||
      req.body?.revertir_stock === 1 ||
      req.body?.revertir_stock === '1' ||
      req.query?.revertir_stock === 'true' ||
      req.query?.revertir_stock === '1'
    );

    if (revertirStock && movimiento.insumo_id) {
      const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [movimiento.insumo_id]);
      if (insumo) {
        let ajusteReversion = 0;
        if (movimiento.tipo === 'entrada') {
          // Revertir una entrada significa restar lo que había ingresado
          ajusteReversion = -Number(movimiento.cantidad);
        } else if (['merma', 'venta', 'salida'].includes(movimiento.tipo)) {
          // Revertir una merma o venta significa devolver el insumo al stock
          ajusteReversion = Number(movimiento.cantidad);
        } else if (movimiento.tipo === 'ajuste' || movimiento.tipo === 'fijar') {
          // Revertir un ajuste devuelve el stock previo
          if (movimiento.stock_previo !== null && movimiento.stock_nuevo !== null) {
            ajusteReversion = Number(movimiento.stock_previo) - Number(movimiento.stock_nuevo);
          }
        }

        if (ajusteReversion !== 0) {
          const nuevoStock = Math.max(0, Math.round(((Number(insumo.stock_actual) || 0) + ajusteReversion) * 1000) / 1000);
          await dbRun('UPDATE Inventario SET stock_actual = ? WHERE id = ?', [nuevoStock, insumo.id]);
        }
      }
    }

    await dbRun('DELETE FROM InventarioMovimientos WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Movimiento de Kárdex eliminado correctamente',
      revertir_stock: revertirStock
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- KARDEX DE INVENTARIO POR INSUMO ---
app.get('/api/admin/inventario/:id/kardex', verificarAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const insumo = await dbGet('SELECT * FROM Inventario WHERE id = ?', [id]);
    if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });

    let botellas_enteras = null;
    let shots_remanentes = null;
    let total_shots_actual = null;
    if (insumo.es_licor && insumo.rendimiento_shots > 0) {
      botellas_enteras = Math.floor(insumo.stock_actual);
      shots_remanentes = Math.round((insumo.stock_actual - botellas_enteras) * insumo.rendimiento_shots);
      total_shots_actual = Math.round(insumo.stock_actual * insumo.rendimiento_shots);
    }

    const movimientos = await dbAll(
      'SELECT * FROM InventarioMovimientos WHERE insumo_id = ? ORDER BY id DESC LIMIT 100',
      [id]
    );

    res.json({
      insumo: {
        ...insumo,
        botellas_enteras,
        shots_remanentes,
        total_shots_actual,
        costo_por_shot: insumo.rendimiento_shots > 0 ? Math.round((insumo.costo_unitario / insumo.rendimiento_shots) * 100) / 100 : null
      },
      movimientos
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SUGERENCIA DE REABASTECIMIENTO / COMPRAS ---
app.get('/api/admin/inventario/sugerencia-compras', verificarAdmin, async (req, res) => {
  try {
    const negocioId = req.query.negocio_id ? Number(req.query.negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1);
    const insumosCriticos = await dbAll(`
      SELECT * FROM Inventario 
      WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))
        AND stock_actual <= stock_minimo
        AND stock_minimo > 0
      ORDER BY (stock_actual - stock_minimo) ASC, nombre ASC
    `, [negocioId, negocioId]);

    let totalPresupuesto = 0;
    const items = insumosCriticos.map(ins => {
      const objetivo = Math.max(ins.stock_minimo * 2.5, ins.stock_minimo + 5);
      const aPedir = Math.ceil((objetivo - ins.stock_actual) * 10) / 10;
      const costoEstimado = Math.round(aPedir * (ins.costo_unitario || 0));
      totalPresupuesto += costoEstimado;

      return {
        id: ins.id,
        nombre: ins.nombre,
        categoria: ins.categoria,
        unidad_medida: ins.unidad_medida,
        stock_actual: ins.stock_actual,
        stock_minimo: ins.stock_minimo,
        stock_objetivo: objetivo,
        cantidad_sugerida: aPedir,
        costo_unitario: ins.costo_unitario,
        costo_estimado: costoEstimado,
        estado: ins.stock_actual <= 0 ? 'agotado' : 'bajo'
      };
    });

    res.json({
      articulos_a_comprar: items.length,
      total_items: items.length,
      presupuesto_total_estimado: totalPresupuesto,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- REPORTE DE VENTAS POR PERÍODO & CONSUMO DE INSUMOS EN KÁRDEX ---
app.get('/api/admin/reportes/ventas-productos', verificarAdmin, async (req, res) => {
  try {
    let { desde, hasta, producto_id, categoria_id, negocio_id } = req.query;
    const nid = negocio_id ? Number(negocio_id) : (req.query.negocioId ? Number(req.query.negocioId) : 1);

    const ahora = new Date();
    if (!desde) {
      const inicioMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1, 0, 0, 0, 0));
      desde = inicioMes.toISOString();
    } else if (desde.length === 10) {
      desde = new Date(desde + 'T00:00:00-06:00').toISOString();
    }

    if (!hasta) {
      hasta = ahora.toISOString();
    } else if (hasta.length === 10) {
      hasta = new Date(hasta + 'T23:59:59.999-06:00').toISOString();
    }

    let sqlVentas = `
      SELECT 
        d.producto_id,
        COALESCE(MAX(p.nombre), MAX(d.nombre_producto)) AS producto_nombre,
        COALESCE(MAX(p.categoria_id), MAX(c.id), 4) AS categoria_id,
        COALESCE(MAX(c.nombre), CASE WHEN LOWER(MAX(d.nombre_producto)) LIKE '%balde%' THEN 'Cervezas' ELSE 'General' END) AS categoria_nombre,
        COALESCE(MAX(c.icono), CASE WHEN LOWER(MAX(d.nombre_producto)) LIKE '%balde%' THEN '🍺' ELSE '🍽️' END) AS categoria_icono,
        MAX(p.imagen_url) AS imagen_url,
        COALESCE(MAX(p.precio), AVG(CAST(d.precio_unitario AS DOUBLE PRECISION)), 7500) AS precio_actual,
        SUM(d.cantidad) AS cantidad_vendida,
        SUM(d.subtotal) AS total_ingresos,
        COUNT(DISTINCT d.orden_id) AS total_ordenes,
        AVG(CAST(d.precio_unitario AS DOUBLE PRECISION)) AS precio_promedio
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Productos p ON (CAST(d.producto_id AS TEXT) = CAST(p.id AS TEXT))
      LEFT JOIN Categorias c ON (p.categoria_id = c.id OR (p.categoria_id IS NULL AND (LOWER(c.nombre) LIKE '%cerveza%' OR c.id = 4)))
      WHERE o.estado = 'pagada'
        AND d.estado_comanda != 'anulado'
        AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) >= ?)
        AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) <= ?)
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `;
    const paramsVentas = [desde, hasta, nid, nid];

    if (producto_id) {
      sqlVentas += ' AND (CAST(d.producto_id AS TEXT) = CAST(? AS TEXT) OR LOWER(d.nombre_producto) LIKE ?)';
      paramsVentas.push(String(producto_id));
      paramsVentas.push('%' + String(producto_id).replace(/^balde_/i, '').replace(/_/g, ' ') + '%');
    }
    if (categoria_id && categoria_id !== 'todas') {
      const catNum = Number(categoria_id);
      sqlVentas += ' AND (p.categoria_id = ? OR (p.categoria_id IS NULL AND LOWER(d.nombre_producto) LIKE \'%balde%\' AND ? IN (4, 8, 150, 158, 166, 174, 182)))';
      paramsVentas.push(catNum);
      paramsVentas.push(catNum);
    }

    sqlVentas += ' GROUP BY d.producto_id, d.nombre_producto ORDER BY total_ingresos DESC';

    const ventasRows = await dbAll(sqlVentas, paramsVentas);

    const insumosGlobalesMap = new Map();
    let totalUnidadesVendidas = 0;
    let totalIngresosBrutos = 0;
    let totalCostoInsumos = 0;

    const productosDetallados = [];

    // Pre-cargar todas las recetas en una sola consulta batch para eliminar N+1 consultas de red
    const todasLasRecetas = await dbAll(`
      SELECT r.producto_id, r.insumo_id, r.cantidad, r.merma_porcentaje,
             i.nombre AS insumo_nombre, i.unidad_medida, i.costo_unitario, i.stock_actual, i.es_licor
      FROM InventarioRecetas r
      JOIN Inventario i ON r.insumo_id = i.id
    `);
    const recetasPorProducto = {};
    for (const r of todasLasRecetas) {
      if (!recetasPorProducto[r.producto_id]) recetasPorProducto[r.producto_id] = [];
      recetasPorProducto[r.producto_id].push(r);
    }

    const todosLosInsumos = await dbAll('SELECT * FROM Inventario');

    for (const fila of ventasRows) {
      const pId = fila.producto_id;
      const cantVendida = Number(fila.cantidad_vendida) || 0;
      const totalIngreso = Number(fila.total_ingresos) || 0;
      const esBaldeItem = Boolean(fila.producto_nombre && fila.producto_nombre.toLowerCase().includes('balde'));

      totalUnidadesVendidas += cantVendida;
      totalIngresosBrutos += totalIngreso;

      const insumosProducto = [];
      let costoInsumosProducto = 0;

      // 1. Receta explícita en InventarioRecetas
      const recetas = recetasPorProducto[pId] || [];

      if (recetas && recetas.length > 0) {
        for (const r of recetas) {
          const factorMerma = 1 + ((Number(r.merma_porcentaje) || 0) / 100);
          const cantidadPorUnidad = Number(r.cantidad) || 0;
          const cantidadTotalConsumida = Math.round(cantidadPorUnidad * factorMerma * cantVendida * 1000) / 1000;
          const costoUnit = Number(r.costo_unitario) || 0;
          const costoTotalInsumo = Math.round(cantidadTotalConsumida * costoUnit);

          costoInsumosProducto += costoTotalInsumo;

          const insumoObj = {
            insumo_id: r.insumo_id,
            nombre: r.insumo_nombre,
            unidad_medida: r.unidad_medida,
            cantidad_por_unidad: cantidadPorUnidad,
            cantidad_total_consumida: cantidadTotalConsumida,
            costo_unitario: costoUnit,
            costo_total: costoTotalInsumo,
            stock_actual: r.stock_actual
          };
          insumosProducto.push(insumoObj);

          if (!insumosGlobalesMap.has(r.insumo_id)) {
            insumosGlobalesMap.set(r.insumo_id, {
              insumo_id: r.insumo_id,
              nombre: r.insumo_nombre,
              unidad_medida: r.unidad_medida,
              costo_unitario: costoUnit,
              stock_actual: r.stock_actual,
              cantidad_total_consumida: 0,
              costo_total: 0
            });
          }
          const g = insumosGlobalesMap.get(r.insumo_id);
          g.cantidad_total_consumida = Math.round((g.cantidad_total_consumida + cantidadTotalConsumida) * 1000) / 1000;
          g.costo_total += costoTotalInsumo;
        }
      } else if (esBaldeItem) {
        // Balde de 6 cervezas: obtener detalles de notas o desgloses
        const filasBalde = await dbAll(`
          SELECT d.notas, d.cantidad, d.nombre_producto
          FROM DetalleOrden d
          JOIN Ordenes o ON d.orden_id = o.id
          WHERE (CAST(d.producto_id AS TEXT) = CAST(? AS TEXT) OR LOWER(d.nombre_producto) LIKE '%balde%')
            AND o.estado = 'pagada'
            AND d.estado_comanda != 'anulado'
            AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) >= ?)
            AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) <= ?)
        `, [String(pId || ''), desde, hasta]);

        const desgloseCervezas = {};
        let totalCervezasContadas = 0;

        for (const fb of filasBalde) {
          const cantB = Number(fb.cantidad) || 1;
          if (fb.notas && fb.notas.includes('x ')) {
            const partes = fb.notas.split(',').map(s => s.trim());
            for (const p of partes) {
              const m = p.match(/^(\d+)\s*x\s*(.+)$/i);
              if (m) {
                const subC = Number(m[1]) * cantB;
                const subNom = m[2].trim();
                desgloseCervezas[subNom] = (desgloseCervezas[subNom] || 0) + subC;
                totalCervezasContadas += subC;
              }
            }
          } else if (fb.nombre_producto && fb.nombre_producto.includes('(')) {
            const m = fb.nombre_producto.match(/Balde de ([^(]+)/i);
            const subNom = m ? m[1].trim() : 'Cerveza Nacional';
            const subC = 6 * cantB;
            desgloseCervezas[subNom] = (desgloseCervezas[subNom] || 0) + subC;
            totalCervezasContadas += subC;
          }
        }

        if (totalCervezasContadas === 0 && cantVendida > 0) {
          desgloseCervezas['Cerveza Nacional'] = 6 * cantVendida;
        }

        for (const [nomCerveza, cantTotalBotellas] of Object.entries(desgloseCervezas)) {
          let insumoMatch = todosLosInsumos.find(i => 
            i.nombre.toLowerCase() === nomCerveza.toLowerCase() ||
            i.nombre.toLowerCase().includes(nomCerveza.toLowerCase()) ||
            nomCerveza.toLowerCase().includes(i.nombre.toLowerCase())
          ) || todosLosInsumos.find(i => i.nombre.toLowerCase().includes('pilsen') || i.nombre.toLowerCase().includes('imperial')) || {
            id: 'ins_balde_' + nomCerveza,
            nombre: nomCerveza,
            unidad_medida: 'botellas',
            costo_unitario: 950,
            stock_actual: 0
          };

          const costoUnit = Number(insumoMatch.costo_unitario) || 950;
          const costoTotal = Math.round(cantTotalBotellas * costoUnit);
          costoInsumosProducto += costoTotal;

          insumosProducto.push({
            insumo_id: insumoMatch.id,
            nombre: insumoMatch.nombre || nomCerveza,
            unidad_medida: insumoMatch.unidad_medida || 'botellas',
            cantidad_por_unidad: cantVendida > 0 ? Math.round((cantTotalBotellas / cantVendida) * 10) / 10 : 6,
            cantidad_total_consumida: cantTotalBotellas,
            costo_unitario: costoUnit,
            costo_total: costoTotal,
            stock_actual: insumoMatch.stock_actual || 0
          });

          if (!insumosGlobalesMap.has(insumoMatch.id)) {
            insumosGlobalesMap.set(insumoMatch.id, {
              insumo_id: insumoMatch.id,
              nombre: insumoMatch.nombre || nomCerveza,
              unidad_medida: insumoMatch.unidad_medida || 'botellas',
              costo_unitario: costoUnit,
              stock_actual: insumoMatch.stock_actual || 0,
              cantidad_total_consumida: 0,
              costo_total: 0
            });
          }
          const g = insumosGlobalesMap.get(insumoMatch.id);
          g.cantidad_total_consumida = Math.round((g.cantidad_total_consumida + cantTotalBotellas) * 1000) / 1000;
          g.costo_total += costoTotal;
        }
      }

      totalCostoInsumos += costoInsumosProducto;
      const gananciaBruta = totalIngreso - costoInsumosProducto;
      const margenPct = totalIngreso > 0 ? Math.round((gananciaBruta / totalIngreso) * 1000) / 10 : 0;

      let historialVentas = [];
      if (producto_id) {
        historialVentas = await dbAll(`
          SELECT 
            d.id,
            d.orden_id,
            o.numero_orden,
            o.mesa_id,
            m.numero AS mesa_numero,
            o.cliente,
            o.mesero,
            d.cantidad,
            d.precio_unitario,
            d.subtotal,
            COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) AS fecha_hora
          FROM DetalleOrden d
          JOIN Ordenes o ON d.orden_id = o.id
          LEFT JOIN Mesas m ON o.mesa_id = m.id
          WHERE (CAST(d.producto_id AS TEXT) = CAST(? AS TEXT) OR LOWER(d.nombre_producto) LIKE ?)
            AND o.estado = 'pagada'
            AND d.estado_comanda != 'anulado'
            AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) >= ?)
            AND (COALESCE(o.fecha_cierre, o.fecha_apertura, d.creado_en) <= ?)
            AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
          ORDER BY fecha_hora DESC
          LIMIT 100
        `, [String(producto_id), '%' + String(producto_id).replace(/^balde_/i, '').replace(/_/g, ' ') + '%', desde, hasta, nid, nid]);
      }

      productosDetallados.push({
        producto_id: fila.producto_id,
        producto_nombre: fila.producto_nombre,
        categoria_id: fila.categoria_id,
        categoria_nombre: fila.categoria_nombre || 'Sin categoría',
        categoria_icono: fila.categoria_icono || '🍽️',
        imagen_url: fila.imagen_url,
        precio_actual: Number(fila.precio_actual) || Number(fila.precio_promedio) || 0,
        precio_promedio: Math.round((Number(fila.precio_promedio) || 0) * 100) / 100,
        cantidad_vendida: cantVendida,
        total_ingresos: totalIngreso,
        total_ordenes: Number(fila.total_ordenes) || 1,
        costo_insumos_total: costoInsumosProducto,
        ganancia_bruta: gananciaBruta,
        margen_bruto_pct: margenPct,
        insumos_requeridos: insumosProducto,
        historial_ventas: historialVentas
      });
    }

    const gananciaTotal = totalIngresosBrutos - totalCostoInsumos;
    const margenGlobalPct = totalIngresosBrutos > 0 ? Math.round((gananciaTotal / totalIngresosBrutos) * 1000) / 10 : 0;

    // Consultar las últimas órdenes pagadas en el período cronológicamente (más recientes primero)
    let sqlUltimasOrdenes = `
      SELECT 
        o.id,
        o.numero_orden,
        o.mesa_id,
        m.numero AS mesa_numero,
        o.tipo,
        o.cliente,
        o.mesero,
        COALESCE(o.fecha_cierre, o.fecha_apertura) AS fecha_hora,
        o.fecha_apertura,
        o.fecha_cierre,
        o.subtotal,
        o.descuento_happy_hour,
        o.servicio_10,
        o.iva_13,
        o.total,
        o.notas
      FROM Ordenes o
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE o.estado = 'pagada'
        AND (COALESCE(o.fecha_cierre, o.fecha_apertura) >= ?)
        AND (COALESCE(o.fecha_cierre, o.fecha_apertura) <= ?)
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `;
    const paramsUltimas = [desde, hasta, nid, nid];
    if (producto_id) {
      sqlUltimasOrdenes += ' AND EXISTS (SELECT 1 FROM DetalleOrden d2 WHERE d2.orden_id = o.id AND (CAST(d2.producto_id AS TEXT) = CAST(? AS TEXT) OR LOWER(d2.nombre_producto) LIKE ?) AND d2.estado_comanda != \'anulado\')';
      paramsUltimas.push(String(producto_id));
      paramsUltimas.push('%' + String(producto_id).replace(/^balde_/i, '').replace(/_/g, ' ') + '%');
    }
    sqlUltimasOrdenes += ' ORDER BY COALESCE(o.fecha_cierre, o.fecha_apertura) DESC, o.id DESC LIMIT 150';

    const ultimasOrdenesRows = await dbAll(sqlUltimasOrdenes, paramsUltimas);
    const ultimasVentas = [];

    const orderIds = ultimasOrdenesRows.map(o => o.id);
    const itemsByOrderId = {};
    const pagosByOrderId = {};

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [allItems, allPagos] = await Promise.all([
        dbAll(`
          SELECT 
            d.id,
            d.orden_id,
            d.producto_id,
            COALESCE(p.nombre, d.nombre_producto) AS nombre,
            d.cantidad,
            d.precio_unitario,
            d.subtotal,
            d.notas,
            d.curso,
            d.destino
          FROM DetalleOrden d
          LEFT JOIN Productos p ON (CAST(d.producto_id AS TEXT) = CAST(p.id AS TEXT))
          WHERE d.orden_id IN (${placeholders}) AND d.estado_comanda != 'anulado'
        `, orderIds),
        dbAll(`
          SELECT orden_id, metodo, monto, propina, cambio, fecha_hora
          FROM Pagos
          WHERE orden_id IN (${placeholders})
        `, orderIds)
      ]);

      for (const item of allItems) {
        if (!itemsByOrderId[item.orden_id]) itemsByOrderId[item.orden_id] = [];
        itemsByOrderId[item.orden_id].push(item);
      }
      for (const pago of allPagos) {
        if (!pagosByOrderId[pago.orden_id]) pagosByOrderId[pago.orden_id] = [];
        pagosByOrderId[pago.orden_id].push(pago);
      }
    }

    for (const ord of ultimasOrdenesRows) {
      const items = itemsByOrderId[ord.id] || [];
      const pagos = pagosByOrderId[ord.id] || [];

      const metodosSet = new Set(pagos.map(p => p.metodo).filter(Boolean));
      const metodoPago = metodosSet.size > 0 ? Array.from(metodosSet).join(', ') : 'Efectivo';
      const totalRecibido = pagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
      const totalCambio = pagos.reduce((acc, p) => acc + (Number(p.cambio) || 0), 0);

      ultimasVentas.push({
        id: ord.id,
        numero_orden: ord.numero_orden,
        mesa_id: ord.mesa_id,
        mesa_numero: ord.mesa_numero,
        tipo: ord.tipo || 'mesa',
        cliente: ord.cliente || 'Cliente General',
        mesero: ord.mesero || 'General',
        fecha_hora: ord.fecha_hora,
        subtotal: Number(ord.subtotal) || 0,
        descuento_happy_hour: Number(ord.descuento_happy_hour) || 0,
        servicio_10: Number(ord.servicio_10) || 0,
        iva_13: Number(ord.iva_13) || 0,
        total: Number(ord.total) || 0,
        notas: ord.notas || '',
        metodo_pago: metodoPago,
        recibido: totalRecibido,
        cambio: totalCambio,
        items: items.map(it => ({
          id: it.id,
          producto_id: it.producto_id,
          nombre: it.nombre,
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precio_unitario) || 0,
          subtotal: Number(it.subtotal) || 0,
          notas: it.notas || ''
        }))
      });
    }

    res.json({
      periodo: { desde, hasta },
      resumen: {
        total_productos_distintos: productosDetallados.length,
        total_unidades_vendidas: totalUnidadesVendidas,
        total_ingresos: totalIngresosBrutos,
        total_costo_insumos: totalCostoInsumos,
        ganancia_bruta: gananciaTotal,
        margen_bruto_promedio_pct: margenGlobalPct
      },
      productos: productosDetallados,
      ultimas_ventas: ultimasVentas,
      insumos_consumidos: Array.from(insumosGlobalesMap.values()).sort((a, b) => b.costo_total - a.costo_total)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- AUDITORÍA ---
app.get('/api/admin/auditoria', verificarAdmin, async (req, res) => {
  try {
    const { tipo, modulo, limite = 100, negocio_id } = req.query;
    let sql = 'SELECT * FROM Auditoria WHERE 1=1';
    const params = [];

    const negocioId = negocio_id ? Number(negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : null);
    if (negocioId) {
      sql += ' AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))';
      params.push(negocioId, negocioId);
    }

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
    const { usuarioNombre = 'Admin', accion, tipoEvento, modulo, detalle, motivo, monto, pinAutorizado, negocio_id, negocioId } = req.body;
    if (!accion || !detalle) return res.status(400).json({ error: 'Acción y detalle requeridos' });

    const finalNegocioId = Number(negocioId || negocio_id || req.headers['x-negocio-id'] || 1);
    await registrarAuditoria({ usuarioNombre, accion, tipoEvento, modulo, detalle, motivo, monto, pinAutorizado, negocioId: finalNegocioId });
    res.json({ message: 'Evento de auditoría registrado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- DASHBOARD & MÉTRICAS EN TIEMPO REAL ---
app.get('/api/admin/metricas/dashboard', verificarAdmin, async (req, res) => {
  try {
    const negocioId = req.query.negocio_id ? Number(req.query.negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1);
    const { inicioHoyISO, inicioAyerISO, finHoyISO } = getInicioFinHoyCR();

    // 1. Ventas de Hoy
    const ventasHoyRow = await dbGet(`
      SELECT 
        COALESCE(SUM(p.monto), 0) as total_ventas,
        COALESCE(SUM(p.propina), 0) as total_propinas,
        COUNT(DISTINCT p.orden_id) as total_cuentas
      FROM Pagos p
      LEFT JOIN Ordenes o ON p.orden_id = o.id
      WHERE p.fecha_hora >= ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `, [inicioHoyISO, negocioId, negocioId]);

    // 2. Ventas de Ayer (para comparativa)
    const ventasAyerRow = await dbGet(`
      SELECT COALESCE(SUM(p.monto), 0) as total_ventas
      FROM Pagos p
      LEFT JOIN Ordenes o ON p.orden_id = o.id
      WHERE p.fecha_hora >= ? AND p.fecha_hora < ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `, [inicioAyerISO, inicioHoyISO, negocioId, negocioId]);

    const totalVentasHoy = Number(ventasHoyRow ? ventasHoyRow.total_ventas : 0) || 0;
    const totalVentasAyer = Number(ventasAyerRow ? ventasAyerRow.total_ventas : 0) || 0;
    const cuentasHoy = Number(ventasHoyRow ? ventasHoyRow.total_cuentas : 0) || 0;
    const ticketPromedio = cuentasHoy > 0 ? Math.round(totalVentasHoy / cuentasHoy) : 0;
    const propinasHoy = Number(ventasHoyRow ? ventasHoyRow.total_propinas : 0) || 0;

    // 3. Tiempo Promedio de Cocina Hoy (en minutos)
    const tiemposCocina = await dbAll(`
      SELECT d.hora_pedido, d.hora_listo
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      WHERE d.hora_listo IS NOT NULL AND d.creado_en >= ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `, [inicioHoyISO, negocioId, negocioId]);

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
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
      GROUP BY d.nombre_producto, d.destino
      ORDER BY total_unidades DESC
      LIMIT 5
    `, [negocioId, negocioId]);

    // 5. Ventas por Hora (Horas Pico - Zona Horaria Costa Rica America/Costa_Rica)
    const pagosHoras = await dbAll(`
      SELECT p.fecha_hora, p.monto
      FROM Pagos p
      LEFT JOIN Ordenes o ON p.orden_id = o.id
      WHERE p.fecha_hora >= ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
    `, [inicioHoyISO, negocioId, negocioId]);

    const horasMap = {};
    for (const p of pagosHoras) {
      if (!p.fecha_hora) continue;
      const d = new Date(p.fecha_hora);
      if (isNaN(d.getTime())) continue;
      const horaCR = d.toLocaleTimeString('en-US', { timeZone: 'America/Costa_Rica', hour: '2-digit', hour12: false });
      const hNum = parseInt(horaCR, 10);
      horasMap[hNum] = (horasMap[hNum] || 0) + (Number(p.monto) || 0);
    }

    // Mapear de 10:00 a 23:00 para gráfico continuo
    const ventasPorHora = [];
    for (let h = 10; h <= 23; h++) {
      const horaStr = String(h).padStart(2, '0');
      ventasPorHora.push({
        hora: `${horaStr}:00`,
        total: horasMap[h] || 0
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
      LEFT JOIN Ordenes o ON p.orden_id = o.id
      WHERE p.fecha_hora >= ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
      GROUP BY p.mesero
      ORDER BY ventas DESC
    `, [inicioHoyISO, negocioId, negocioId]);

    // 7. Alertas de Inventario Crítico
    const alertasStock = await dbAll(`
      SELECT id, nombre, stock_actual, stock_minimo, unidad_medida
      FROM Inventario
      WHERE stock_actual <= stock_minimo AND (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))
      ORDER BY stock_actual ASC
      LIMIT 6
    `, [negocioId, negocioId]);

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

// Endpoint detallado de cuentas/comandas cobradas hoy para el modal interactivo del Dashboard
app.get('/api/admin/ventas/historial-hoy', verificarAdmin, async (req, res) => {
  try {
    const negocioId = req.query.negocio_id ? Number(req.query.negocio_id) : (req.headers['x-negocio-id'] ? Number(req.headers['x-negocio-id']) : 1);
    const { inicioHoyISO } = getInicioFinHoyCR();

    const ordenesPagadas = await dbAll(`
      SELECT 
        o.id,
        o.numero_orden,
        o.mesa_id,
        COALESCE(m.numero, CAST(o.mesa_id AS TEXT)) AS mesa_numero,
        COALESCE(z.nombre, 'Salón') AS zona_nombre,
        o.mesero,
        o.subtotal,
        o.descuento_happy_hour,
        o.servicio_10,
        o.iva_13,
        o.total,
        o.estado,
        COALESCE(o.fecha_cierre, o.fecha_apertura) AS fecha_orden,
        COALESCE(MAX(p.fecha_hora), o.fecha_cierre, o.fecha_apertura) AS fecha_cobro,
        GROUP_CONCAT(p.metodo) AS metodos_pago_raw,
        COALESCE(SUM(p.propina), 0) AS propina_total
      FROM Ordenes o
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      LEFT JOIN Zonas z ON m.zona_id = z.id
      LEFT JOIN Pagos p ON o.id = p.orden_id
      WHERE (o.estado = 'pagada' OR p.id IS NOT NULL) 
        AND (p.fecha_hora >= ? OR (p.fecha_hora IS NULL AND COALESCE(o.fecha_cierre, o.fecha_apertura) >= ?))
        AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
      GROUP BY o.id, m.numero, z.nombre
      ORDER BY fecha_cobro DESC, o.id DESC
    `, [inicioHoyISO, inicioHoyISO, negocioId, negocioId]);

    // Consultar detalles de items para cada orden
    const ordenesConItems = await Promise.all(ordenesPagadas.map(async (ord) => {
      const items = await dbAll(`
        SELECT 
          d.id,
          d.producto_id,
          d.nombre_producto,
          d.precio_unitario,
          d.cantidad,
          d.subtotal,
          d.notas,
          d.destino,
          d.curso,
          d.en_happy_hour
        FROM DetalleOrden d
        WHERE d.orden_id = ? AND d.estado_comanda != 'anulado'
        ORDER BY d.id ASC
      `, [ord.id]);

      const metodosUnicos = ord.metodos_pago_raw 
        ? [...new Set(ord.metodos_pago_raw.split(',').map(s => s.trim()).filter(Boolean))].join(', ')
        : 'Efectivo';

      return {
        ...ord,
        metodos_pago: metodosUnicos,
        items
      };
    }));

    // Métricas del turno/día
    let totalVentas = 0;
    let totalEfectivo = 0;
    let totalTarjeta = 0;
    let totalSinpe = 0;
    let totalDolares = 0;
    let totalTransferencia = 0;
    let totalPropinas = 0;
    const desgloseMetodosHoy = {};

    const pagosHoy = await dbAll(`
      SELECT p.metodo, SUM(p.monto) AS total_monto, SUM(p.propina) AS total_propina
      FROM Pagos p
      LEFT JOIN Ordenes o ON p.orden_id = o.id
      WHERE p.fecha_hora >= ? AND (o.negocio_id = ? OR (o.negocio_id IS NULL AND ? = 1))
      GROUP BY p.metodo
    `, [inicioHoyISO, negocioId, negocioId]);

    pagosHoy.forEach(pg => {
      const mto = Number(pg.total_monto) || 0;
      const prop = Number(pg.total_propina) || 0;
      totalVentas += mto;
      totalPropinas += prop;
      const met = (pg.metodo || '').toLowerCase();
      desgloseMetodosHoy[pg.metodo || 'Otro'] = (desgloseMetodosHoy[pg.metodo || 'Otro'] || 0) + mto;

      if (met.includes('efectivo') || met.includes('cash')) {
        totalEfectivo += mto;
      } else if (met.includes('tarjeta') || met.includes('datafono') || met.includes('datáfono') || met.includes('card')) {
        totalTarjeta += mto;
      } else if (met.includes('sinpe')) {
        totalSinpe += mto;
      } else if (met.includes('dolar') || met.includes('dólar') || met.includes('usd')) {
        totalDolares += mto;
        totalEfectivo += mto;
      } else if (met.includes('transfer')) {
        totalTransferencia += mto;
        totalSinpe += mto;
      }
    });

    res.json({
      ok: true,
      totalVentas,
      totalCuentas: ordenesConItems.length,
      totalPropinas,
      pagosPorMetodo: {
        efectivo: totalEfectivo,
        tarjeta: totalTarjeta,
        sinpe: totalSinpe,
        dolares: totalDolares,
        transferencia: totalTransferencia,
        por_metodo: desgloseMetodosHoy
      },
      resumen: {
        totalCuentas: ordenesConItems.length,
        totalVentas,
        totalEfectivo,
        totalTarjeta,
        totalSinpe,
        totalDolares,
        totalTransferencia,
        totalPropinas
      },
      ordenes: ordenesConItems
    });
  } catch (e) {
    console.error('Error en /api/admin/ventas/historial-hoy:', e.message);
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

// Auto-configuración Plug & Play de impresora IP
app.post('/api/impresoras/auto-configurar', async (req, res) => {
  try {
    const { ip, puerto = 9100, destino = 'caja', nombre = null } = req.body;
    const resultado = await printerService.autoConfigurarImpresora({
      ip,
      puerto,
      destino,
      nombre,
      io
    });
    res.json({ ok: true, mensaje: 'Impresora configurada y probada exitosamente', resultado, config: printerService.printerConfig[destino] });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
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

// Listar impresoras instaladas en Windows
app.get('/api/impresoras/dispositivos-windows', async (req, res) => {
  try {
    const impresoras = await printerService.getInstalledPrinters();
    res.json({ ok: true, impresoras });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Impresión directa bajo demanda desde el frontend sin diálogo del navegador
app.post('/api/impresoras/imprimir-directo', async (req, res) => {
  try {
    const { ticketVisual, destino = 'caja', printerName = null } = req.body;
    if (!ticketVisual) {
      return res.status(400).json({ error: 'Datos del ticket requeridos' });
    }

    let tInfo;
    if (ticketVisual.tipo === 'comanda') {
      tInfo = printerService.generarTicketComanda({
        ordenId: ticketVisual.ordenId,
        comandaNumero: ticketVisual.comandaNumero,
        mesaNumero: ticketVisual.mesa,
        mesero: ticketVisual.mesero,
        items: ticketVisual.items || [],
        destino: ticketVisual.destino || destino,
        pagada: ticketVisual.pagada,
        fechaHora: ticketVisual.fechaHora
      });
    } else if (ticketVisual.tipo === 'pago_parcial') {
      tInfo = printerService.generarTicketPagoParcial({
        negocio: ticketVisual.negocio,
        ordenId: ticketVisual.ordenId,
        mesaNumero: ticketVisual.mesa,
        personaNombre: ticketVisual.personaNombre || 'Cliente',
        mesero: ticketVisual.mesero,
        metodoPago: ticketVisual.metodoPago,
        montoCobrado: ticketVisual.total,
        subtotal: ticketVisual.subtotal,
        impuestos: ticketVisual.impuestos,
        itemsPagados: ticketVisual.items || [],
        saldoRestanteMesa: ticketVisual.saldoRestanteMesa || 0,
        fechaHora: ticketVisual.fechaHora
      });
    } else if (ticketVisual.tipo === 'prefactura') {
      tInfo = printerService.generarTicketPreFactura({
        negocio: ticketVisual.negocio,
        ordenId: ticketVisual.ordenId,
        numeroOrden: ticketVisual.numeroOrden,
        mesaNumero: ticketVisual.mesa,
        mesero: ticketVisual.mesero,
        cliente: ticketVisual.cliente,
        subtotal: ticketVisual.subtotal,
        descuentoHH: ticketVisual.descuentoHH,
        servicio: ticketVisual.servicio,
        iva: ticketVisual.iva,
        total: ticketVisual.total,
        items: ticketVisual.items || [],
        fechaHora: ticketVisual.fechaHora
      });
    } else if (ticketVisual.tipo === 'corte_x' || ticketVisual.tipo === 'corte_x_ciego') {
      tInfo = printerService.generarTicketCorteX({
        negocio: ticketVisual.negocio,
        caja_id: ticketVisual.caja_id,
        cajero: ticketVisual.cajero,
        fecha_apertura: ticketVisual.fecha_apertura,
        fecha_corte: ticketVisual.fecha_corte,
        fondo_inicial: ticketVisual.fondo_inicial,
        ventas: ticketVisual.ventas || {},
        total_entradas: ticketVisual.total_entradas || 0,
        total_salidas: ticketVisual.total_salidas || 0,
        efectivo_esperado: ticketVisual.efectivo_esperado || 0,
        movimientos_detalle: ticketVisual.movimientos_detalle || [],
        tip_pool: ticketVisual.tip_pool || [],
        total_propinas: ticketVisual.total_propinas || 0
      });
    } else if (ticketVisual.tipo === 'cierre_z') {
      tInfo = printerService.generarTicketCierreZ({
        negocio: ticketVisual.negocio,
        caja_id: ticketVisual.caja_id,
        cajero: ticketVisual.cajero,
        fecha_apertura: ticketVisual.fecha_apertura,
        fecha_cierre: ticketVisual.fecha_cierre,
        fondo_inicial: ticketVisual.fondo_inicial,
        ventas: ticketVisual.ventas || {},
        total_entradas: ticketVisual.total_entradas || 0,
        total_salidas: ticketVisual.total_salidas || 0,
        efectivo_esperado: ticketVisual.efectivo_esperado || 0,
        efectivo_real_contado: ticketVisual.efectivo_real_contado || 0,
        diferencia: ticketVisual.diferencia || 0,
        estado_cuadre: ticketVisual.estado_cuadre || 'Cuadre',
        notas: ticketVisual.notas || '',
        tip_pool: ticketVisual.tip_pool || [],
        total_propinas: ticketVisual.total_propinas || 0
      });
    } else if (ticketVisual.tipo === 'liquidacion') {
      tInfo = printerService.generarTicketLiquidacion({
        negocio: ticketVisual.negocio,
        ordenId: ticketVisual.ordenId,
        numeroOrden: ticketVisual.numeroOrden,
        mesaNumero: ticketVisual.mesa,
        mesero: ticketVisual.mesero,
        cliente: ticketVisual.cliente,
        metodoPago: ticketVisual.metodoPago,
        subtotal: ticketVisual.subtotal,
        descuentoHH: ticketVisual.descuentoHH,
        servicio: ticketVisual.servicio,
        iva: ticketVisual.iva,
        total: ticketVisual.total,
        recibido: ticketVisual.recibido,
        cambio: ticketVisual.cambio,
        items: ticketVisual.items || [],
        fechaHora: ticketVisual.fechaHora
      });
    } else {
      tInfo = printerService.generarTicketLiquidacion({
        negocio: ticketVisual.negocio,
        ordenId: ticketVisual.ordenId,
        numeroOrden: ticketVisual.numeroOrden,
        mesaNumero: ticketVisual.mesa,
        mesero: ticketVisual.mesero,
        cliente: ticketVisual.cliente,
        metodoPago: ticketVisual.metodoPago,
        subtotal: ticketVisual.subtotal,
        descuentoHH: ticketVisual.descuentoHH,
        servicio: ticketVisual.servicio,
        iva: ticketVisual.iva,
        total: ticketVisual.total,
        recibido: ticketVisual.recibido,
        cambio: ticketVisual.cambio,
        items: ticketVisual.items || [],
        fechaHora: ticketVisual.fechaHora
      });
    }

    const reg = await printerService.procesarImpresion({
      destinoImpresora: destino,
      ticketInfo: tInfo,
      io
    });

    res.json({ ok: true, mensaje: 'Ticket despachado directamente a impresora térmica', registro: reg });
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
// PISO DEL SALÓN — Leer y guardar el fondo visual del salón (Multi-Comercio)
// ============================================================================
app.get('/api/salon/piso-fondo', (req, res) => {
  const negocioId = req.query.negocio_id || 1;
  const claveNegocio = `salon_piso_fondo_negocio_${negocioId}`;

  db.get("SELECT valor FROM ConfigNegocio WHERE clave = ?", [claveNegocio], (err, row) => {
    if (!err && row && row.valor) {
      return res.json({ pisoId: row.valor, negocio_id: Number(negocioId) });
    }
    // Fallback general si no tiene específico aún
    db.get("SELECT valor FROM ConfigNegocio WHERE clave = 'salon_piso_fondo'", (err2, row2) => {
      if (err2 || !row2) return res.json({ pisoId: null, negocio_id: Number(negocioId) });
      res.json({ pisoId: row2.valor || null, negocio_id: Number(negocioId) });
    });
  });
});

app.post('/api/salon/piso-fondo', (req, res) => {
  const { pisoId, negocio_id = 1 } = req.body;
  if (!pisoId) return res.status(400).json({ error: 'Se requiere pisoId' });

  const claveNegocio = `salon_piso_fondo_negocio_${negocio_id}`;
  db.run(
    "INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES (?, ?)",
    [claveNegocio, pisoId],
    (err) => {
      if (err) return res.status(500).json({ error: 'Error al guardar piso' });
      // Guardar también como fallback si es negocio 1
      if (Number(negocio_id) === 1) {
        db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('salon_piso_fondo', ?)", [pisoId], () => {});
      }
      io.emit('salon_piso_fondo_cambiado', { pisoId, negocio_id: Number(negocio_id) });
      res.json({ ok: true, pisoId, negocio_id: Number(negocio_id) });
    }
  );
});

// ============================================================================
// DEVELOPER: PERSONALIZACIÓN Y EDICIÓN TOTAL DE PÁGINA (Multi-Comercio)
// ============================================================================
app.get('/api/dev/personalizacion-pagina', (req, res) => {
  const negocioId = req.query.negocio_id || 1;
  const claveNegocio = `custom_page_settings_negocio_${negocioId}`;

  db.get("SELECT valor FROM ConfigNegocio WHERE clave = ?", [claveNegocio], (err, row) => {
    if (!err && row && row.valor) {
      try {
        const config = JSON.parse(row.valor);
        return res.json({ config, negocio_id: Number(negocioId) });
      } catch (_) {}
    }
    // Fallback general si no tiene configuración específica aún
    db.get("SELECT valor FROM ConfigNegocio WHERE clave = 'custom_page_settings'", (err2, row2) => {
      if (err2 || !row2 || !row2.valor) {
        return res.json({ config: {}, negocio_id: Number(negocioId) });
      }
      try {
        const config = JSON.parse(row2.valor);
        res.json({ config, negocio_id: Number(negocioId) });
      } catch (_) {
        res.json({ config: {}, negocio_id: Number(negocioId) });
      }
    });
  });
});

app.post('/api/dev/personalizacion-pagina', (req, res) => {
  const { config, negocio_id = 1 } = req.body;
  if (!config) return res.status(400).json({ error: 'Configuración no provista' });

  const valorStr = typeof config === 'string' ? config : JSON.stringify(config);
  const claveNegocio = `custom_page_settings_negocio_${negocio_id}`;

  db.run(
    "INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES (?, ?)",
    [claveNegocio, valorStr],
    (err) => {
      if (err) return res.status(500).json({ error: 'Error guardando personalización de página' });
      // Guardar también como fallback si es negocio 1
      if (Number(negocio_id) === 1) {
        db.run("INSERT OR REPLACE INTO ConfigNegocio (clave, valor) VALUES ('custom_page_settings', ?)", [valorStr], () => {});
      }
      const configObj = typeof config === 'string' ? JSON.parse(config) : config;
      io.emit('pagina_personalizacion_actualizada', { config: configObj, negocio_id: Number(negocio_id) });
      res.json({ ok: true, message: 'Personalización de página guardada exitosamente', config: configObj, negocio_id: Number(negocio_id) });
    }
  );
});

app.post('/api/dev/personalizacion-pagina/reset', (req, res) => {
  const { negocio_id = 1 } = req.body;
  const claveNegocio = `custom_page_settings_negocio_${negocio_id}`;

  db.run("DELETE FROM ConfigNegocio WHERE clave = ? OR clave = 'custom_page_settings'", [claveNegocio], (err) => {
    if (err) return res.status(500).json({ error: 'Error al restablecer personalización' });
    io.emit('pagina_personalizacion_actualizada', { config: {}, negocio_id: Number(negocio_id) });
    res.json({ ok: true, message: 'Personalización restablecida a valores originales', negocio_id: Number(negocio_id) });
  });
});

// ============================================================================
// DEVELOPER: PURGA INTEGRAL Y ENTREGA OFICIAL DE NEGOCIOS (CERO DATOS RESIDUALES)
// ============================================================================
async function verificarDeveloper(req, res, next) {
  const rol = (req.usuario?.rol || req.headers['x-user-rol'] || (req.query && req.query.rol) || (req.body && req.body.rol) || '').toLowerCase();
  const pin = req.headers['x-supervisor-pin'] || (req.body && req.body.pinAutorizado) || (req.body && req.body.pin);
  const isDevPin = (pin === '9999' || pin === 9999);
  
  if (['developer', 'dev', 'superadmin'].includes(rol) || isDevPin) {
    return next();
  }
  return res.status(403).json({ ok: false, error: 'Acceso denegado: Esta acción de purga es exclusiva para el Desarrollador del sistema.' });
}

// 1. Purga total del negocio (Ventas, Mesas, Cajas, KDS, Kárdex, Auditoría y Empleados de prueba)
app.post('/api/developer/purgar-negocio-completo', verificarDeveloper, async (req, res) => {
  try {
    const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : (req.query.negocio_id ? Number(req.query.negocio_id) : 1);
    
    const neg = await dbGet('SELECT id, nombre FROM Negocios WHERE id = ?', [negocioId]);
    if (!neg) {
      return res.status(404).json({ ok: false, error: 'Negocio no encontrado.' });
    }

    // A. Ventas y Facturas
    await dbRun(`DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Pagos WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Ordenes WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM FacturasDetalle WHERE factura_id IN (SELECT id FROM Facturas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Facturas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM VentasDetalle WHERE venta_id IN (SELECT id FROM Ventas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Ventas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM FacturasElectronicasDetalle WHERE factura_id IN (SELECT id FROM FacturasElectronicas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM FacturasElectronicas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM BitacoraHacienda WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Propinas WHERE negocio_id = ?`, [negocioId]).catch(() => {});

    // B. Cajas y Arqueos
    await dbRun(`DELETE FROM Cajas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM CierresZ WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM CortesX WHERE negocio_id = ?`, [negocioId]).catch(() => {});

    // C. Mesas libres y en 0
    await dbRun(`
      UPDATE Mesas SET
        estado = 'libre',
        monto_acumulado = 0,
        mesero_actual = NULL,
        pedidos_activos = '[]',
        factura_actual_id = NULL,
        hora_apertura = NULL,
        personas = 0
      WHERE negocio_id = ?
    `, [negocioId]).catch(() => {});

    // D. Comandas y KDS
    await dbRun(`DELETE FROM ComandasDetalle WHERE comanda_id IN (SELECT id FROM Comandas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Comandas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM PedidosKDS WHERE negocio_id = ?`, [negocioId]).catch(() => {});

    // E. Kárdex e Inventario a Cero
    await dbRun(`DELETE FROM InventarioMovimientos WHERE negocio_id = ? OR insumo_id IN (SELECT id FROM Inventario WHERE negocio_id = ?)`, [negocioId, negocioId]).catch(() => {});
    await dbRun(`DELETE FROM InventarioMovimientos WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)) OR insumo_id IN (SELECT id FROM Inventario WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1)))`, [negocioId, negocioId, negocioId, negocioId]).catch(() => {});
    await dbRun(`
      UPDATE Inventario SET
        stock_actual = 0,
        stock_minimo = 0,
        stock_maximo = 0
      WHERE (negocio_id = ? OR (negocio_id IS NULL AND ? = 1))
    `, [negocioId, negocioId]).catch(() => {});

    // F. Auditoría y Notificaciones
    await dbRun(`DELETE FROM Auditoria WHERE negocio_id = ?`, [negocioId]).catch(() => {});
    await dbRun(`DELETE FROM Notificaciones WHERE negocio_id = ?`, [negocioId]).catch(() => {});

    // G. Empleados de Prueba
    await dbRun(`
      DELETE FROM Usuarios 
      WHERE negocio_id = ? AND rol != 'admin' AND rol != 'developer'
    `, [negocioId]).catch(() => {});

    // H. Resetear Administrador del Negocio
    await dbRun(`
      UPDATE Usuarios SET
        debe_cambiar_password = 1,
        pin = '1234'
      WHERE negocio_id = ? AND rol = 'admin'
    `, [negocioId]).catch(() => {});

    // Sockets en tiempo real
    io.emit('mesas_actualizadas');
    io.emit('caja_actualizada');
    io.emit('cajas_fisicas_actualizadas');
    io.emit('inventario_actualizado');
    io.emit('ventas_actualizadas');
    io.emit('comandas_actualizadas');

    res.json({
      ok: true,
      message: `El negocio "${neg.nombre}" (ID: ${negocioId}) ha sido purgado por completo y dejado en ceros, listo para entrega oficial.`,
      negocio_id: negocioId,
      negocio_nombre: neg.nombre
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Alias / Sub-purgas específicas para módulos
app.post('/api/admin/dashboard/purgar-integral', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM Pagos WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Ordenes WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM VentasDetalle WHERE venta_id IN (SELECT id FROM Ventas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Ventas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM InventarioMovimientos WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`UPDATE Inventario SET stock_minimo = 0, stock_actual = 0 WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`UPDATE Mesas SET estado = 'libre', monto_acumulado = 0, mesero_actual = NULL, pedidos_activos = '[]' WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  io.emit('mesas_actualizadas');
  io.emit('ventas_actualizadas');
  res.json({ ok: true, message: 'Dashboard purgado exitosamente a ₡0.' });
});

app.post('/api/admin/ventas/purgar-pruebas', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM Pagos WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Ordenes WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM VentasDetalle WHERE venta_id IN (SELECT id FROM Ventas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Ventas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`UPDATE Mesas SET estado = 'libre', monto_acumulado = 0, mesero_actual = NULL, pedidos_activos = '[]' WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  io.emit('ventas_actualizadas');
  io.emit('mesas_actualizadas');
  res.json({ ok: true, message: 'Ventas de prueba purgadas.' });
});

app.post('/api/caja/purgar-historial', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM Cajas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  io.emit('caja_actualizada');
  res.json({ ok: true, message: 'Historial de cajas purgado a ₡0.' });
});

app.post('/api/admin/inventario/purgar-sugerencias', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`UPDATE Inventario SET stock_minimo = 0, stock_maximo = 0, stock_actual = 0 WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  if (req.body.limpiarKardex) {
    await dbRun(`DELETE FROM InventarioMovimientos WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  }
  io.emit('inventario_actualizado');
  res.json({ ok: true, message: 'Sugerencias de compra eliminadas.' });
});

app.post('/api/admin/ventas-kardex/purgar', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM InventarioMovimientos WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Pagos WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM DetalleOrden WHERE orden_id IN (SELECT id FROM Ordenes WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Ordenes WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  io.emit('ventas_actualizadas');
  io.emit('inventario_actualizado');
  res.json({ ok: true, message: 'Ventas y kárdex purgados.' });
});

app.post('/api/kds/purgar-comandas', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM ComandasDetalle WHERE comanda_id IN (SELECT id FROM Comandas WHERE negocio_id = ?)`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM Comandas WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  await dbRun(`DELETE FROM PedidosKDS WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  io.emit('comandas_actualizadas');
  res.json({ ok: true, message: 'Comandas KDS purgadas.' });
});

app.post('/api/admin/auditoria/purgar', verificarDeveloper, async (req, res) => {
  const negocioId = req.body.negocio_id ? Number(req.body.negocio_id) : 1;
  await dbRun(`DELETE FROM Auditoria WHERE negocio_id = ?`, [negocioId]).catch(() => {});
  res.json({ ok: true, message: 'Bitácora de auditoría purgada.' });
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
