const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    // 1. Zonas del local
    db.run(`CREATE TABLE IF NOT EXISTS Zonas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL
    )`);

    // 2. Mesas (con soporte para coordenadas del editor drag & drop y forma)
    db.run(`CREATE TABLE IF NOT EXISTS Mesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      zona_id INTEGER,
      capacidad INTEGER DEFAULT 4,
      estado TEXT DEFAULT 'libre', -- libre, ocupada, esperando, cuenta
      mesero TEXT,
      x INTEGER DEFAULT 40,
      y INTEGER DEFAULT 40,
      forma TEXT DEFAULT 'square', -- square, round
      FOREIGN KEY(zona_id) REFERENCES Zonas(id)
    )`);

    // Migraciones seguras para Mesas (por si ya existía la tabla sin x, y, forma)
    db.run("ALTER TABLE Mesas ADD COLUMN x INTEGER DEFAULT 40", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN y INTEGER DEFAULT 40", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN forma TEXT DEFAULT 'square'", () => {});

    // 3. Categorías
    db.run(`CREATE TABLE IF NOT EXISTS Categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      icono TEXT,
      destino TEXT DEFAULT 'cocina' -- cocina, barra
    )`);

    // 4. Productos (con soporte para 86 List / agotado, curso y happy hour)
    db.run(`CREATE TABLE IF NOT EXISTS Productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria_id INTEGER,
      codigo TEXT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      descripcion TEXT,
      destino TEXT DEFAULT 'cocina',
      curso INTEGER DEFAULT 2, -- 1: Entrada, 2: Fuerte, 3: Postre
      happy_hour INTEGER DEFAULT 0,
      agotado INTEGER DEFAULT 0,
      activo INTEGER DEFAULT 1,
      FOREIGN KEY(categoria_id) REFERENCES Categorias(id)
    )`);

    // Migraciones seguras para Productos
    db.run("ALTER TABLE Productos ADD COLUMN curso INTEGER DEFAULT 2", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN happy_hour INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Productos ADD COLUMN agotado INTEGER DEFAULT 0", () => {});

    // 5. Cajas / Turnos
    db.run(`CREATE TABLE IF NOT EXISTS Cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cajero TEXT NOT NULL,
      fecha_apertura TEXT NOT NULL,
      monto_inicial REAL DEFAULT 0,
      fecha_cierre TEXT,
      monto_final_efectivo REAL DEFAULT 0,
      total_ventas_efectivo REAL DEFAULT 0,
      total_ventas_tarjeta REAL DEFAULT 0,
      total_ventas_sinpe REAL DEFAULT 0,
      estado TEXT DEFAULT 'abierta' -- abierta, cerrada
    )`);

    // 6. Movimientos de Caja (Entradas / Salidas de efectivo)
    db.run(`CREATE TABLE IF NOT EXISTS MovimientosCaja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caja_id INTEGER,
      tipo TEXT NOT NULL, -- entrada, salida
      monto REAL NOT NULL,
      concepto TEXT NOT NULL,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(caja_id) REFERENCES Cajas(id)
    )`);

    // 7. Órdenes / Cuentas
    db.run(`CREATE TABLE IF NOT EXISTS Ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_orden TEXT NOT NULL,
      mesa_id INTEGER,
      tipo TEXT DEFAULT 'mesa', -- mesa, barra, para_llevar
      cliente TEXT DEFAULT 'Cliente General',
      mesero TEXT NOT NULL,
      fecha_apertura TEXT NOT NULL,
      fecha_cierre TEXT,
      estado TEXT DEFAULT 'abierta', -- abierta, esperando, cuenta_pedida, pagada, cancelada
      subtotal REAL DEFAULT 0,
      descuento_happy_hour REAL DEFAULT 0,
      servicio_10 REAL DEFAULT 0,
      iva_13 REAL DEFAULT 0,
      total REAL DEFAULT 0,
      notas TEXT,
      FOREIGN KEY(mesa_id) REFERENCES Mesas(id)
    )`);

    db.run("ALTER TABLE Ordenes ADD COLUMN descuento_happy_hour REAL DEFAULT 0", () => {});

    // 8. Detalle de Órdenes (Comandas con cursos de cocina)
    db.run(`CREATE TABLE IF NOT EXISTS DetalleOrden (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      nombre_producto TEXT NOT NULL,
      precio_unitario REAL NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL,
      notas TEXT,
      curso INTEGER DEFAULT 2, -- 1: Entrada, 2: Fuerte, 3: Postre
      destino TEXT DEFAULT 'cocina', -- cocina, barra
      estado_comanda TEXT DEFAULT 'pendiente', -- pendiente, preparando, listo, servido, anulado
      hora_pedido TEXT NOT NULL,
      hora_listo TEXT,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(producto_id) REFERENCES Productos(id)
    )`);

    db.run("ALTER TABLE DetalleOrden ADD COLUMN curso INTEGER DEFAULT 2", () => {});

    // 9. Pagos
    db.run(`CREATE TABLE IF NOT EXISTS Pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      caja_id INTEGER,
      mesero TEXT,
      metodo TEXT NOT NULL, -- Efectivo, Tarjeta, SINPE, Mixto
      monto REAL NOT NULL,
      propina REAL DEFAULT 0,
      cambio REAL DEFAULT 0,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(caja_id) REFERENCES Cajas(id)
    )`);

    db.run("ALTER TABLE Pagos ADD COLUMN mesero TEXT", () => {});

    // 10. Auditoría de Anulaciones con PIN de Seguridad
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
      tipo_documento TEXT DEFAULT 'FE', -- FE (Factura Electrónica), TE (Tiquete)
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

    // Sembrar catálogo inicial si no hay datos
    db.get('SELECT COUNT(*) as count FROM Zonas', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        console.log('🌱 Sembrando datos iniciales en la base de datos...');

        // Zonas
        db.run("INSERT INTO Zonas (nombre) VALUES ('Salón Principal'), ('Barra / Bar'), ('Terraza al Aire Libre'), ('Zona VIP')");

        // Mesas iniciales con posiciones y formas
        const mesas = [
          { num: 'Mesa 1', zona: 1, cap: 4, x: 40, y: 40, forma: 'square' },
          { num: 'Mesa 2', zona: 1, cap: 4, x: 220, y: 40, forma: 'square' },
          { num: 'Mesa 3', zona: 1, cap: 6, x: 400, y: 40, forma: 'round' },
          { num: 'Mesa 4', zona: 1, cap: 2, x: 40, y: 220, forma: 'square' },
          { num: 'Barra 1', zona: 2, cap: 1, x: 620, y: 40, forma: 'round' },
          { num: 'Barra 2', zona: 2, cap: 1, x: 620, y: 190, forma: 'round' },
          { num: 'Terraza 1', zona: 3, cap: 4, x: 220, y: 220, forma: 'square' },
          { num: 'Mesa VIP', zona: 4, cap: 8, x: 400, y: 220, forma: 'square' }
        ];
        mesas.forEach(m => {
          db.run('INSERT INTO Mesas (numero, zona_id, capacidad, x, y, forma) VALUES (?, ?, ?, ?, ?, ?)',
            [m.num, m.zona, m.cap, m.x, m.y, m.forma]
          );
        });

        // Categorías
        const cats = [
          { nom: 'Bebidas & Cervezas', icono: '🍺', destino: 'barra' },
          { nom: 'Coctelería & Tragos', icono: '🍸', destino: 'barra' },
          { nom: 'Bocas & Entradas', icono: '🍤', destino: 'cocina' },
          { nom: 'Platos Fuertes', icono: '🥩', destino: 'cocina' },
          { nom: 'Hamburguesas & Snacks', icono: '🍔', destino: 'cocina' },
          { nom: 'Postres & Cafetería', icono: '☕', destino: 'cocina' }
        ];
        cats.forEach(c => {
          db.run('INSERT INTO Categorias (nombre, icono, destino) VALUES (?, ?, ?)', [c.nom, c.icono, c.destino]);
        });

        // Catálogo de Productos
        const prods = [
          { cat: 1, cod: 'BEB01', nom: 'Imperial Regular', pre: 1800, des: 'barra', cur: 1, hh: 1 },
          { cat: 1, cod: 'BEB02', nom: 'Pilsen', pre: 1800, des: 'barra', cur: 1, hh: 1 },
          { cat: 1, cod: 'BEB03', nom: 'Corona Extra', pre: 2500, des: 'barra', cur: 1, hh: 0 },
          { cat: 1, cod: 'BEB04', nom: 'Refresco Natural', pre: 1600, des: 'barra', cur: 1, hh: 0 },
          { cat: 2, cod: 'COC01', nom: 'Mojito Clásico Cubano', pre: 3800, des: 'barra', cur: 1, hh: 1 },
          { cat: 2, cod: 'COC02', nom: 'Margarita Tradicional', pre: 4200, des: 'barra', cur: 1, hh: 0 },
          { cat: 2, cod: 'COC03', nom: 'Gin Tonic Flor de Caña', pre: 4500, des: 'barra', cur: 1, hh: 0 },
          { cat: 3, cod: 'ENT01', nom: 'Chifrijo Tradicional', pre: 4500, des: 'cocina', cur: 1, hh: 0 },
          { cat: 3, cod: 'ENT02', nom: 'Alitas BBQ / Búfalo (8 uds)', pre: 4900, des: 'cocina', cur: 1, hh: 0 },
          { cat: 3, cod: 'ENT03', nom: 'Patacones con Carne Mechada', pre: 4200, des: 'cocina', cur: 1, hh: 0 },
          { cat: 3, cod: 'ENT04', nom: 'Ceviche Mixto con Aguacate', pre: 4800, des: 'cocina', cur: 1, hh: 0 },
          { cat: 4, cod: 'PLA01', nom: 'Corte Rib Eye 350g', pre: 12500, des: 'cocina', cur: 2, hh: 0 },
          { cat: 4, cod: 'PLA02', nom: 'Arroz con Mariscos a la Tica', pre: 7500, des: 'cocina', cur: 2, hh: 0 },
          { cat: 5, cod: 'HAM01', nom: 'Hamburguesa Doble Bacon-Cheddar', pre: 5500, des: 'cocina', cur: 2, hh: 0 },
          { cat: 5, cod: 'HAM02', nom: 'Sandwich de Pollo Crispy', pre: 4800, des: 'cocina', cur: 2, hh: 0 },
          { cat: 6, cod: 'POS01', nom: 'Tres Leches Artesanal', pre: 2800, des: 'cocina', cur: 3, hh: 0 },
          { cat: 6, cod: 'POS02', nom: 'Café Espresso Doble', pre: 1400, des: 'cocina', cur: 3, hh: 0 }
        ];
        prods.forEach(p => {
          db.run('INSERT INTO Productos (categoria_id, codigo, nombre, precio, destino, curso, happy_hour) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [p.cat, p.cod, p.nom, p.pre, p.des, p.cur, p.hh]
          );
        });

        // Apertura de caja inicial
        const hoy = new Date().toISOString();
        db.run('INSERT INTO Cajas (cajero, fecha_apertura, monto_inicial, estado) VALUES (?, ?, ?, ?)',
          ['Juan Jival', hoy, 50000, 'abierta']
        );

        console.log('✅ Base de datos configurada y sembrada.');
      }
    });
  });
}

initDb();

module.exports = db;
