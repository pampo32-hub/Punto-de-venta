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

    // 2. Mesas
    db.run(`CREATE TABLE IF NOT EXISTS Mesas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL,
      zona_id INTEGER,
      capacidad INTEGER DEFAULT 4,
      estado TEXT DEFAULT 'libre', -- libre, ocupada, cuenta_pedida
      mesero TEXT,
      FOREIGN KEY(zona_id) REFERENCES Zonas(id)
    )`);

    // 3. Categorías
    db.run(`CREATE TABLE IF NOT EXISTS Categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      icono TEXT,
      destino TEXT DEFAULT 'cocina' -- cocina, barra
    )`);

    // 4. Productos
    db.run(`CREATE TABLE IF NOT EXISTS Productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria_id INTEGER,
      codigo TEXT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      descripcion TEXT,
      destino TEXT DEFAULT 'cocina',
      activo INTEGER DEFAULT 1,
      FOREIGN KEY(categoria_id) REFERENCES Categorias(id)
    )`);

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

    // 6. Movimientos de Caja (Entradas/Salidas menores)
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
      estado TEXT DEFAULT 'abierta', -- abierta, cuenta_pedida, pagada, cancelada
      subtotal REAL DEFAULT 0,
      servicio_10 REAL DEFAULT 0,
      iva_13 REAL DEFAULT 0,
      total REAL DEFAULT 0,
      notas TEXT,
      FOREIGN KEY(mesa_id) REFERENCES Mesas(id)
    )`);

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
      destino TEXT DEFAULT 'cocina', -- cocina, barra
      estado_comanda TEXT DEFAULT 'pendiente', -- pendiente, preparando, listo, servido
      hora_pedido TEXT NOT NULL,
      hora_listo TEXT,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(producto_id) REFERENCES Productos(id)
    )`);

    // 9. Pagos
    db.run(`CREATE TABLE IF NOT EXISTS Pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL,
      caja_id INTEGER,
      metodo TEXT NOT NULL, -- Efectivo, Tarjeta, SINPE
      monto REAL NOT NULL,
      propina REAL DEFAULT 0,
      cambio REAL DEFAULT 0,
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(orden_id) REFERENCES Ordenes(id),
      FOREIGN KEY(caja_id) REFERENCES Cajas(id)
    )`);

    // Sembrar datos iniciales si la tabla de Zonas está vacía
    db.get('SELECT COUNT(*) as count FROM Zonas', (err, row) => {
      if (!err && (!row || row.count === 0)) {
        console.log('🌱 Inicializando datos base para Restaurante / Bar...');

        // Zonas
        db.run("INSERT INTO Zonas (nombre) VALUES ('Salón Principal'), ('Barra / Bar'), ('Terraza'), ('Área VIP')");

        // Mesas
        const mesas = [
          { num: 'Mesa 1', zona: 1, cap: 4 }, { num: 'Mesa 2', zona: 1, cap: 4 },
          { num: 'Mesa 3', zona: 1, cap: 6 }, { num: 'Mesa 4', zona: 1, cap: 2 },
          { num: 'Barra 1', zona: 2, cap: 1 }, { num: 'Barra 2', zona: 2, cap: 1 },
          { num: 'Barra 3', zona: 2, cap: 1 }, { num: 'Barra 4', zona: 2, cap: 1 },
          { num: 'Terraza 1', zona: 3, cap: 4 }, { num: 'Terraza 2', zona: 3, cap: 4 },
          { num: 'Mesa VIP', zona: 4, cap: 8 }
        ];
        mesas.forEach(m => db.run('INSERT INTO Mesas (numero, zona_id, capacidad) VALUES (?, ?, ?)', [m.num, m.zona, m.cap]));

        // Categorías
        const cats = [
          { nom: 'Bebidas & Cervezas', icono: '🍺', destino: 'barra' },
          { nom: 'Coctelería & Tragos', icono: '🍸', destino: 'barra' },
          { nom: 'Bocas & Entradas', icono: '🍤', destino: 'cocina' },
          { nom: 'Platos Fuertes', icono: '🥩', destino: 'cocina' },
          { nom: 'Hamburguesas & Snacks', icono: '🍔', destino: 'cocina' },
          { nom: 'Postres & Café', icono: '☕', destino: 'cocina' }
        ];
        cats.forEach(c => db.run('INSERT INTO Categorias (nombre, icono, destino) VALUES (?, ?, ?)', [c.nom, c.icono, c.destino]));

        // Productos de muestra
        const prods = [
          { cat: 1, cod: 'BEB01', nom: 'Imperial Regular', pre: 1800, des: 'barra' },
          { cat: 1, cod: 'BEB02', nom: 'Pilsen', pre: 1800, des: 'barra' },
          { cat: 1, cod: 'BEB03', nom: 'Corona Extra', pre: 2500, des: 'barra' },
          { cat: 1, cod: 'BEB04', nom: 'Refresco Natural', pre: 1600, des: 'barra' },
          { cat: 2, cod: 'COC01', nom: 'Mojito Clásico', pre: 3800, des: 'barra' },
          { cat: 2, cod: 'COC02', nom: 'Margarita Tradicional', pre: 4200, des: 'barra' },
          { cat: 2, cod: 'COC03', nom: 'Gin Tonic Flor de Caña', pre: 4500, des: 'barra' },
          { cat: 3, cod: 'ENT01', nom: 'Chifrijo Tradicional', pre: 4500, des: 'cocina' },
          { cat: 3, cod: 'ENT02', nom: 'Alitas BBQ / Búfalo (8 uds)', pre: 4900, des: 'cocina' },
          { cat: 3, cod: 'ENT03', nom: 'Patacones con Carne Mechada', pre: 4200, des: 'cocina' },
          { cat: 3, cod: 'ENT04', nom: 'Ceviche Mixto con Aguacate', pre: 4800, des: 'cocina' },
          { cat: 4, cod: 'PLA01', nom: 'Corte Rib Eye 350g', pre: 12500, des: 'cocina' },
          { cat: 4, cod: 'PLA02', nom: 'Arroz con Mariscos a la Tica', pre: 7500, des: 'cocina' },
          { cat: 5, cod: 'HAM01', nom: 'Hamburguesa Doble Bacon-Cheddar', pre: 5500, des: 'cocina' },
          { cat: 5, cod: 'HAM02', nom: 'Sandwich de Pollo Crispy', pre: 4800, des: 'cocina' },
          { cat: 6, cod: 'POS01', nom: 'Tres Leches Artesanal', pre: 2800, des: 'cocina' },
          { cat: 6, cod: 'POS02', nom: 'Café Espresso Doble', pre: 1400, des: 'cocina' }
        ];
        prods.forEach(p => db.run('INSERT INTO Productos (categoria_id, codigo, nombre, precio, destino) VALUES (?, ?, ?, ?, ?)', [p.cat, p.cod, p.nom, p.pre, p.des]));

        // Caja abierta inicial
        const hoy = new Date().toISOString();
        db.run('INSERT INTO Cajas (cajero, fecha_apertura, monto_inicial, estado) VALUES (?, ?, ?, ?)', ['Cajero Turno 1', hoy, 50000, 'abierta']);

        console.log('✅ Base de datos SQLite lista con catálogo y mesas cargadas.');
      }
    });
  });
}

initDb();

module.exports = db;
