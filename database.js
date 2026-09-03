const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);

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

    // 5. Cajas / Turnos
    db.run(`CREATE TABLE IF NOT EXISTS Cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      negocio_id INTEGER DEFAULT 1,
      cajero TEXT NOT NULL,
      fecha_apertura TEXT NOT NULL,
      monto_inicial REAL DEFAULT 0,
      fecha_cierre TEXT,
      monto_final_efectivo REAL DEFAULT 0,
      total_ventas_efectivo REAL DEFAULT 0,
      total_ventas_tarjeta REAL DEFAULT 0,
      total_ventas_sinpe REAL DEFAULT 0,
      estado TEXT DEFAULT 'abierta'
    )`);
    db.run("ALTER TABLE Cajas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});

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
      usuario TEXT UNIQUE NOT NULL,
      nombre_completo TEXT NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL, -- developer, admin, cajero, salonero
      genero TEXT NOT NULL DEFAULT 'M', -- M = Hombre (Salonero), F = Mujer (Salonera)
      pin TEXT DEFAULT '1234',
      permisos TEXT DEFAULT '{"salon":true,"kds":true,"caja":true,"facturacion":true}',
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

    // Sembrar Negocio Inicial
    db.get('SELECT COUNT(*) as count FROM Negocios', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        db.run(`INSERT INTO Negocios (id, nombre, slogan, logo_url, moneda, telefono, direccion) 
          VALUES (1, 'GastroBar Fuego & Brasas', 'Restaurante, Bar & Lounge', 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=150&auto=format&fit=crop&q=80', 'CRC', '2222-3344', 'San José, Costa Rica')`);
        console.log('🌱 Negocio inicial creado.');
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
            [u.negocio_id, u.usuario, u.nombre, u.password, u.rol, u.genero, u.pin, u.permisos]
          );
        });
        console.log('🌱 Usuarios iniciales (dev, admin, cajero, carlos [M], sofia [F]) sembrados.');
      }
    });

    // Sembrar imágenes iniciales de alta calidad para los productos principales
    const fotosPlatillos = [
      { id: 1, cod: 'BEB01', img: 'https://images.unsplash.com/photo-1608270110398-319cf887cf45?w=300&auto=format&fit=crop&q=80' }, // Cerveza
      { id: 2, cod: 'BEB02', img: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=300&auto=format&fit=crop&q=80' }, // Pilsen
      { id: 3, cod: 'BEB03', img: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?w=300&auto=format&fit=crop&q=80' }, // Corona
      { id: 5, cod: 'COC01', img: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=300&auto=format&fit=crop&q=80' }, // Mojito
      { id: 6, cod: 'COC02', img: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=300&auto=format&fit=crop&q=80' }, // Margarita
      { id: 8, cod: 'ENT01', img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=300&auto=format&fit=crop&q=80' }, // Chifrijo
      { id: 9, cod: 'ENT02', img: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=300&auto=format&fit=crop&q=80' }, // Alitas
      { id: 11, cod: 'ENT04', img: 'https://images.unsplash.com/photo-1535400255456-984241443b29?w=300&auto=format&fit=crop&q=80' }, // Ceviche
      { id: 12, cod: 'PLA01', img: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=300&auto=format&fit=crop&q=80' }, // Rib Eye
      { id: 14, cod: 'HAM01', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300&auto=format&fit=crop&q=80' }, // Hamburguesa
      { id: 16, cod: 'POS01', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&auto=format&fit=crop&q=80' }  // Tres Leches
    ];

    fotosPlatillos.forEach(f => {
      db.run('UPDATE Productos SET imagen_url = ? WHERE codigo = ? OR id = ?', [f.img, f.cod, f.id]);
    });
  });
}

initDb();

module.exports = db;
