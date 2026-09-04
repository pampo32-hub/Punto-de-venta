const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.POS_DB_PATH || path.join(__dirname, 'pos.db');
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
    db.run("ALTER TABLE Mesas ADD COLUMN ancho INTEGER DEFAULT 130", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN alto INTEGER DEFAULT 120", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN transferida_de TEXT", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN piso INTEGER DEFAULT 1", () => {});
    db.run("ALTER TABLE Mesas ADD COLUMN pidio_cuenta_qr INTEGER DEFAULT 0", () => {});
    db.run("ALTER TABLE Zonas ADD COLUMN negocio_id INTEGER DEFAULT 1", () => {});
    db.run("INSERT OR IGNORE INTO Zonas (id, nombre) VALUES (5, 'Segundo Piso')", () => {});

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
    db.run("ALTER TABLE Ordenes ADD COLUMN transferida_de TEXT", () => {});

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
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);

    // 15. Escandallo / Recetas de Productos
    db.run(`CREATE TABLE IF NOT EXISTS InventarioRecetas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      insumo_id INTEGER NOT NULL,
      cantidad REAL NOT NULL DEFAULT 1,
      FOREIGN KEY(producto_id) REFERENCES Productos(id),
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
      fecha_hora TEXT NOT NULL,
      FOREIGN KEY(negocio_id) REFERENCES Negocios(id)
    )`);

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
          db.run(
            `INSERT INTO Inventario (negocio_id, nombre, categoria, unidad_medida, stock_actual, stock_minimo, costo_unitario, producto_id, actualizado_en)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ins.nombre, ins.categoria, ins.unidad, ins.stock, ins.min, ins.costo, ins.prodId, ahora]
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

    // Sembrar / Actualizar las 6 Categorías Oficiales
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
         ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, icono=excluded.icono, destino=excluded.destino`,
        [cat.id, cat.nombre, cat.icono, cat.destino]
      );
    });

    // Catálogo completo de 100+ productos costarricenses
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
      { cat: 3, nombre: 'Tres leches tradicional', precio: 2800, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Cuatro leches', precio: 3000, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Arroz con leche', precio: 2500, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Flan de coco', precio: 2600, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Flan de caramelo', precio: 2600, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Torta chilena', precio: 3000, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Cajeta de coco', precio: 1800, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Cajeta de leche', precio: 1800, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Pie de limón', precio: 2800, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Tamal de masa asado', precio: 2500, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Granizado / Copo tradicional', precio: 2500, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Churchilleta', precio: 2800, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Empanaditas dulces de chiverre', precio: 2200, destino: 'cocina', curso: 3 },
      { cat: 3, nombre: 'Prestiños con miel de caña', precio: 2500, destino: 'cocina', curso: 3 },

      // 4. Cervezas (cat: 4)
      { cat: 4, nombre: 'Imperial Regular', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/imperial_regular.jpg' },
      { cat: 4, nombre: 'Imperial Light', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/imperial_light.jpg' },
      { cat: 4, nombre: 'Imperial Silver', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/imperial_silver.jpg' },
      { cat: 4, nombre: 'Imperial Ultra', precio: 2000, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/imperial_ultra.jpg' },
      { cat: 4, nombre: 'Pilsen', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/pilsen.jpg' },
      { cat: 4, nombre: 'Pilsen 6.0', precio: 2000, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/pilsen_6_0.jpg' },
      { cat: 4, nombre: 'Bavaria Gold', precio: 2200, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/bavaria_gold.jpg' },
      { cat: 4, nombre: 'Bavaria Light', precio: 2200, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/bavaria_light.jpg' },
      { cat: 4, nombre: 'Bavaria Dark', precio: 2200, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/bavaria_dark.jpg' },
      { cat: 4, nombre: 'Bavaria Masters', precio: 2500, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/bavaria_masters.jpg' },
      { cat: 4, nombre: 'Rock Ice', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/rock_ice.jpg' },
      { cat: 4, nombre: 'Rock Ice Limo-Ness', precio: 1800, destino: 'barra', curso: 1, imagen_url: '/img/cervezas/rock_limon_sal.jpg' },
      { cat: 4, nombre: 'Cerveza Artesanal Treintaycinco', precio: 3500, destino: 'barra', curso: 1 },
      { cat: 4, nombre: 'Cerveza Artesanal Costa Rica Beer Factory', precio: 3500, destino: 'barra', curso: 1 },
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
      { cat: 6, nombre: 'Café chorreado tradicional', precio: 1500, destino: 'barra', curso: 1 },
      { cat: 6, nombre: 'Café con leche estilo tico', precio: 1800, destino: 'barra', curso: 1 },
      { cat: 6, nombre: 'Agua de pipa natural', precio: 1800, destino: 'barra', curso: 1 }
    ];

    productosOficiales.forEach(prod => {
      db.get('SELECT id, imagen_url FROM Productos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))', [prod.nombre], (err, existing) => {
        const imgUrlFinal = prod.imagen_url || (existing ? existing.imagen_url : null);
        if (!err && existing) {
          db.run(
            `UPDATE Productos SET categoria_id = ?, precio = ?, destino = ?, curso = ?, imagen_url = ?, activo = 1 WHERE id = ?`,
            [prod.cat, prod.precio, prod.destino, prod.curso, imgUrlFinal, existing.id]
          );
        } else if (!err && !existing) {
          db.run(
            `INSERT INTO Productos (negocio_id, categoria_id, nombre, precio, destino, curso, imagen_url, activo, agotado, happy_hour)
             VALUES (1, ?, ?, ?, ?, ?, ?, 1, 0, 0)`,
            [prod.cat, prod.nombre, prod.precio, prod.destino, prod.curso, imgUrlFinal]
          );
        }
      });
    });

    // Mapear productos anteriores a sus nuevas categorías correctas
    db.run("UPDATE Productos SET categoria_id = 4 WHERE LOWER(nombre) LIKE '%imperial%' OR LOWER(nombre) LIKE '%pilsen%' OR LOWER(nombre) LIKE '%corona%' OR LOWER(nombre) LIKE '%bavaria%' OR LOWER(nombre) LIKE '%rock ice%' OR LOWER(nombre) LIKE '%cerveza%'");
    db.run("UPDATE Productos SET imagen_url = '/img/cervezas/imperial_regular.jpg' WHERE LOWER(nombre) = 'imperial regular'");
    db.run("UPDATE Productos SET imagen_url = '/img/cervezas/pilsen.jpg' WHERE LOWER(nombre) = 'pilsen'");
    db.run("UPDATE Productos SET categoria_id = 5 WHERE LOWER(nombre) LIKE '%mojito%' OR LOWER(nombre) LIKE '%margarita%' OR LOWER(nombre) LIKE '%gin tonic%' OR LOWER(nombre) LIKE '%chiliguaro%' OR LOWER(nombre) LIKE '%guaro%' OR LOWER(nombre) LIKE '%coctel%' OR LOWER(nombre) LIKE '%shot%'");
    db.run("UPDATE Productos SET categoria_id = 6 WHERE LOWER(nombre) LIKE '%fresco%' OR LOWER(nombre) LIKE '%refresco%' OR LOWER(nombre) LIKE '%café%' OR LOWER(nombre) LIKE '%cafe%' OR LOWER(nombre) LIKE '%agua%' OR LOWER(nombre) LIKE '%horchata%' OR LOWER(nombre) LIKE '%resbaladera%'");
    db.run("UPDATE Productos SET categoria_id = 2 WHERE LOWER(nombre) LIKE '%patacon%' OR LOWER(nombre) LIKE '%yuca%' OR LOWER(nombre) LIKE '%chorreada%' OR LOWER(nombre) LIKE '%ceviche%' OR LOWER(nombre) LIKE '%empanada%' OR LOWER(nombre) LIKE '%tamal%' OR LOWER(nombre) LIKE '%alita%' OR LOWER(nombre) LIKE '%caldosa%'");
    db.run("UPDATE Productos SET categoria_id = 3 WHERE LOWER(nombre) LIKE '%tres leches%' OR LOWER(nombre) LIKE '%flan%' OR LOWER(nombre) LIKE '%torta chilena%' OR LOWER(nombre) LIKE '%cajeta%' OR LOWER(nombre) LIKE '%granizado%' OR LOWER(nombre) LIKE '%copo%' OR LOWER(nombre) LIKE '%pie%'");
    db.run("UPDATE Productos SET categoria_id = 1 WHERE categoria_id NOT IN (1,2,3,4,5,6) OR LOWER(nombre) LIKE '%casado%' OR LOWER(nombre) LIKE '%arroz con%' OR LOWER(nombre) LIKE '%chifrijo%' OR LOWER(nombre) LIKE '%sopa%' OR LOWER(nombre) LIKE '%gallo%' OR LOWER(nombre) LIKE '%vigorón%' OR LOWER(nombre) LIKE '%hamburguesa%' OR LOWER(nombre) LIKE '%rib eye%' OR LOWER(nombre) LIKE '%sandwich%' OR LOWER(nombre) LIKE '%sándwich%'");
    db.run("UPDATE Productos SET agotado = 0 WHERE codigo = 'BEB01' OR LOWER(nombre) = 'imperial regular'");
    console.log('🌱 Menú completo y categorías oficiales sembrados/sincronizados.');
  });
}

initDb();

module.exports = db;

