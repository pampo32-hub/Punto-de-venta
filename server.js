const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// WebSockets para tiempo real (KDS Cocina / Barra / Meseros)
io.on('connection', (socket) => {
  console.log('🔌 Terminal conectada (Socket ID):', socket.id);

  socket.on('disconnect', () => {
    console.log('🔌 Terminal desconectada:', socket.id);
  });
});

// Helper para consultas Promise con SQLite
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

// -------------------------------------------------------------
// ENDPOINTS DE MESAS Y ZONAS
// -------------------------------------------------------------
app.get('/api/mesas', async (req, res) => {
  try {
    const zonas = await dbAll('SELECT * FROM Zonas ORDER BY id ASC');
    const mesas = await dbAll(`
      SELECT m.*, o.id as orden_activa_id, o.numero_orden, o.total as orden_total, o.cliente
      FROM Mesas m
      LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'cuenta_pedida')
      ORDER BY m.id ASC
    `);
    res.json({ zonas, mesas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// ENDPOINTS DE MENÚ / CATÁLOGO
// -------------------------------------------------------------
app.get('/api/menu', async (req, res) => {
  try {
    const categorias = await dbAll('SELECT * FROM Categorias ORDER BY id ASC');
    const productos = await dbAll('SELECT * FROM Productos WHERE activo = 1 ORDER BY categoria_id ASC, nombre ASC');
    res.json({ categorias, productos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// ENDPOINTS DE ÓRDENES Y COMANDAS (PEDIDOS)
// -------------------------------------------------------------
// Obtener orden activa de una mesa
app.get('/api/ordenes/mesa/:mesaId', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? ORDER BY id ASC", [orden.id]);
    res.json({ orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enviar o actualizar comanda (Crear orden o agregar items)
app.post('/api/comandas/enviar', async (req, res) => {
  try {
    const { mesaId, mesero = 'Mesero 1', cliente = 'Cliente General', items = [], notas = '' } = req.body;
    if (!items.length) return res.status(400).json({ error: 'La orden no tiene productos' });

    let orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'cuenta_pedida')", [mesaId]);
    const ahora = new Date().toISOString();

    let ordenId;
    if (!orden) {
      // Crear nueva orden
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const r = await dbRun(
        `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
         VALUES (?, ?, ?, ?, ?, 'abierta')`,
        [numOrden, mesaId, cliente, mesero, ahora]
      );
      ordenId = r.lastID;
      await dbRun("UPDATE Mesas SET estado = 'ocupada', mesero = ? WHERE id = ?", [mesero, mesaId]);
    } else {
      ordenId = orden.id;
    }

    // Insertar items de comanda
    const nuevasComandas = [];
    for (const item of items) {
      const subtotal = item.precio * item.cantidad;
      const rItem = await dbRun(
        `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, destino, hora_pedido)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, item.id, item.nombre, item.precio, item.cantidad, subtotal, item.notas || '', item.destino || 'cocina', ahora]
      );
      nuevasComandas.push({
        id: rItem.lastID,
        orden_id: ordenId,
        nombre_producto: item.nombre,
        cantidad: item.cantidad,
        notas: item.notas,
        destino: item.destino || 'cocina',
        hora_pedido: ahora
      });
    }

    // Recalcular totales de la orden
    const totalItems = await dbGet("SELECT SUM(subtotal) as sub FROM DetalleOrden WHERE orden_id = ?", [ordenId]);
    const subtotal = Number(totalItems.sub) || 0;
    const servicio = Number((subtotal * 0.10).toFixed(2)); // 10% de servicio restaurante
    const iva = Number((subtotal * 0.13).toFixed(2));      // 13% IVA
    const total = subtotal + servicio + iva;

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?", [subtotal, servicio, iva, total, ordenId]);

    // Emitir eventos WebSockets a cocina, barra y meseros en tiempo real
    io.emit('nueva_comanda', { mesaId, ordenId, comandas: nuevasComandas });
    io.emit('mesa_actualizada', { mesaId, estado: 'ocupada' });

    res.json({ message: 'Comanda enviada con éxito', ordenId, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pedir cuenta de una mesa (marca la mesa en amarillo)
app.post('/api/ordenes/:id/pedir-cuenta', async (req, res) => {
  try {
    const ordenId = req.params.id;
    const orden = await dbGet("SELECT * FROM Ordenes WHERE id = ?", [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE id = ?", [ordenId]);
    if (orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = 'cuenta_pedida' WHERE id = ?", [orden.mesa_id]);
    }
    io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'cuenta_pedida' });
    res.json({ message: 'Cuenta pedida. Mesa en estado de cobro.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// PANTALLA DE COCINA / BARRA (KDS - Kitchen Display System)
// -------------------------------------------------------------
app.get('/api/kds', async (req, res) => {
  try {
    const destino = req.query.destino || 'cocina'; // cocina o barra
    const comandas = await dbAll(`
      SELECT d.*, o.numero_orden, o.mesa_id, m.numero as mesa_numero
      FROM DetalleOrden d
      JOIN Ordenes o ON d.orden_id = o.id
      LEFT JOIN Mesas m ON o.mesa_id = m.id
      WHERE d.destino = ? AND d.estado_comanda IN ('pendiente', 'preparando')
      ORDER BY d.id ASC
    `, [destino]);
    res.json(comandas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de preparación de un platillo en cocina/barra
app.post('/api/kds/:detalleId/estado', async (req, res) => {
  try {
    const { estado } = req.body; // 'preparando', 'listo', 'servido'
    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    await dbRun("UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?", [estado, horaListo, req.params.detalleId]);
    
    io.emit('comanda_estado_cambiado', { detalleId: req.params.detalleId, estado });
    res.json({ message: 'Estado actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// COBRO Y CAJA (Cierre de orden, cobro y apertura/cierre de turno)
// -------------------------------------------------------------
app.post('/api/ordenes/:id/cobrar', async (req, res) => {
  try {
    const ordenId = req.params.id;
    const { metodo = 'Efectivo', monto, propina = 0, cambio = 0 } = req.body;
    const ahora = new Date().toISOString();

    const orden = await dbGet("SELECT * FROM Ordenes WHERE id = ?", [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    // Obtener caja abierta
    const caja = await dbGet("SELECT * FROM Cajas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1");
    const cajaId = caja ? caja.id : null;

    // Registrar pago
    await dbRun(
      "INSERT INTO Pagos (orden_id, caja_id, metodo, monto, propina, cambio, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [ordenId, cajaId, metodo, monto, propina, cambio, ahora]
    );

    // Cerrar orden y liberar mesa
    await dbRun("UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ? WHERE id = ?", [ahora, ordenId]);
    if (orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'libre' });
    }

    res.json({ message: 'Cobro procesado exitosamente. Mesa liberada.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estado de la Caja actual y Reporte X / Z
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

    const movimientos = await dbAll("SELECT * FROM MovimientosCaja WHERE caja_id = ? ORDER BY id DESC", [caja.id]);

    res.json({ caja, ventas, movimientos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Iniciar Servidor
server.listen(PORT, () => {
  console.log('========================================================');
  console.log('🍔🍻 PUNTO DE VENTA (Restaurante & Bar) INICIADO');
  console.log('📍 Puerto: ' + PORT);
  console.log('🌐 URL Local: http://localhost:' + PORT);
  console.log('📱 Acceso Móvil / Tablet: http://<IP-DE-TU-PC>:' + PORT);
  console.log('========================================================');
});
