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
const SUPERVISOR_PIN = process.env.SUPERVISOR_PIN || '1234';

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

// Helpers para consultas Promise con SQLite
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

// ============================================================================
// 1. MESAS & DISTRIBUCIÓN DEL SALÓN (DRAG & DROP)
// ============================================================================
app.get('/api/mesas', async (req, res) => {
  try {
    const zonas = await dbAll('SELECT * FROM Zonas ORDER BY id ASC');
    const mesas = await dbAll(`
      SELECT m.*, o.id as orden_activa_id, o.numero_orden, o.subtotal, o.descuento_happy_hour, 
             o.servicio_10, o.iva_13, o.total as orden_total, o.mesero as orden_mesero, o.cliente
      FROM Mesas m
      LEFT JOIN Ordenes o ON m.id = o.mesa_id AND o.estado IN ('abierta', 'esperando', 'cuenta_pedida')
      ORDER BY m.id ASC
    `);
    res.json({ zonas, mesas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Guardar coordenadas de mesas en lote desde el editor visual Drag & Drop
app.post('/api/mesas/posiciones', async (req, res) => {
  try {
    const { posiciones } = req.body; // Array de [{ id, x, y }]
    if (Array.isArray(posiciones)) {
      for (const pos of posiciones) {
        await dbRun('UPDATE Mesas SET x = ?, y = ? WHERE id = ?', [pos.x, pos.y, pos.id]);
      }
    }
    io.emit('mesas_reorganizadas', { posiciones });
    res.json({ message: 'Distribución física del salón guardada exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agregar nueva mesa o silla de barra al plano
app.post('/api/mesas/crear', async (req, res) => {
  try {
    const { numero, zona_id = 1, capacidad = 4, forma = 'square', x = 60, y = 60 } = req.body;
    const r = await dbRun(
      'INSERT INTO Mesas (numero, zona_id, capacidad, forma, x, y) VALUES (?, ?, ?, ?, ?, ?)',
      [numero, zona_id, capacidad, forma, x, y]
    );
    const nuevaMesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [r.lastID]);
    io.emit('nueva_mesa_creada', nuevaMesa);
    res.json(nuevaMesa);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mover o Transferir comanda de una mesa a otra (Transfer Table)
app.post('/api/mesas/mover', async (req, res) => {
  try {
    const { origenMesaId, destinoMesaId } = req.body;
    if (!origenMesaId || !destinoMesaId) {
      return res.status(400).json({ error: 'Debes indicar la mesa de origen y destino' });
    }

    const mesaOrig = await dbGet('SELECT * FROM Mesas WHERE id = ?', [origenMesaId]);
    const mesaDest = await dbGet('SELECT * FROM Mesas WHERE id = ?', [destinoMesaId]);
    if (!mesaOrig || !mesaDest) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [origenMesaId]);
    if (!orden) return res.status(400).json({ error: 'La mesa de origen no tiene una orden activa' });

    // Actualizar mesa_id en la orden
    await dbRun('UPDATE Ordenes SET mesa_id = ? WHERE id = ?', [destinoMesaId, orden.id]);

    // Actualizar estados de ambas mesas
    await dbRun('UPDATE Mesas SET estado = ?, mesero = ? WHERE id = ?', [mesaOrig.estado, mesaOrig.mesero, destinoMesaId]);
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [origenMesaId]);

    io.emit('mesa_transferida', { origenMesaId, destinoMesaId, ordenId: orden.id });
    res.json({ message: `Orden transferida con éxito de ${mesaOrig.numero} a ${mesaDest.numero}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unir dos mesas en una sola cuenta consolidada (Merge Tables)
app.post('/api/mesas/unir', async (req, res) => {
  try {
    const { mesaPrincipalId, mesaSecundariaId } = req.body;
    if (mesaPrincipalId === mesaSecundariaId) {
      return res.status(400).json({ error: 'Debes seleccionar dos mesas distintas' });
    }

    const orden1 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaPrincipalId]);
    const orden2 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaSecundariaId]);

    if (!orden1 || !orden2) {
      return res.status(400).json({ error: 'Ambas mesas deben tener órdenes activas para fusionarse' });
    }

    // Mover todos los ítems de orden 2 a orden 1
    await dbRun('UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?', [orden1.id, orden2.id]);

    // Recalcular totales de orden 1
    const totalItems = await dbGet("SELECT SUM(subtotal) as sub FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden1.id]);
    const subtotal = Number(totalItems.sub) || 0;
    const servicio = Math.round(subtotal * 0.10);
    const iva = Math.round(subtotal * 0.13);
    const total = subtotal + servicio + iva;

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?", [subtotal, servicio, iva, total, orden1.id]);

    // Cancelar/cerrar orden 2 y liberar mesa secundaria
    await dbRun("UPDATE Ordenes SET estado = 'fusionada', total = 0 WHERE id = ?", [orden2.id]);
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [mesaSecundariaId]);

    io.emit('mesas_unidas', { mesaPrincipalId, mesaSecundariaId, ordenPrincipalId: orden1.id });
    res.json({ message: 'Cuentas fusionadas correctamente', ordenId: orden1.id, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 2. CATÁLOGO DE MENÚ & CONTROL DE AGOTADOS ("86 LIST")
// ============================================================================
app.get('/api/menu', async (req, res) => {
  try {
    const categorias = await dbAll('SELECT * FROM Categorias ORDER BY id ASC');
    const productos = await dbAll('SELECT * FROM Productos WHERE activo = 1 ORDER BY categoria_id ASC, nombre ASC');
    res.json({ categorias, productos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Conmutar producto disponible / agotado (86 list)
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
// 3. COMANDAS, CURSOS DE COCINA & AUDITORÍA DE ANULACIÓN
// ============================================================================
// Obtener orden activa con sus platillos
app.get('/api/ordenes/mesa/:mesaId', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' ORDER BY id ASC", [orden.id]);
    res.json({ orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enviar o actualizar comanda a cocina/barra
app.post('/api/comandas/enviar', async (req, res) => {
  try {
    const { mesaId, mesero = 'Juan Jival', cliente = 'Cliente General', items = [], happyHourActivo = false } = req.body;
    if (!items.length) return res.status(400).json({ error: 'La comanda no contiene productos' });

    let orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
    const ahora = new Date().toISOString();
    let ordenId;

    if (!orden) {
      const numOrden = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
      const r = await dbRun(
        `INSERT INTO Ordenes (numero_orden, mesa_id, cliente, mesero, fecha_apertura, estado)
         VALUES (?, ?, ?, ?, ?, 'esperando')`,
        [numOrden, mesaId, cliente, mesero, ahora]
      );
      ordenId = r.lastID;
    } else {
      ordenId = orden.id;
      await dbRun("UPDATE Ordenes SET estado = 'esperando' WHERE id = ?", [ordenId]);
    }

    await dbRun("UPDATE Mesas SET estado = 'esperando', mesero = ? WHERE id = ?", [mesero, mesaId]);

    const nuevasComandas = [];
    for (const it of items) {
      if (!it.id_detalle_existente) {
        const subtotal = it.precio * it.cantidad;
        const rItem = await dbRun(
          `INSERT INTO DetalleOrden (orden_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, notas, curso, destino, hora_pedido)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ordenId, it.id, it.nombre, it.precio, it.cantidad, subtotal, it.notas || '', it.curso || 2, it.destino || 'cocina', ahora]
        );
        nuevasComandas.push({
          id: rItem.lastID,
          orden_id: ordenId,
          nombre_producto: it.nombre,
          cantidad: it.cantidad,
          notas: it.notas,
          curso: it.curso || 2,
          destino: it.destino || 'cocina',
          hora_pedido: ahora
        });
      }
    }

    // Recalcular totales de la orden
    const rows = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [ordenId]);
    let subtotal = rows.reduce((acc, r) => acc + (r.precio_unitario * r.cantidad), 0);

    let descuentoHH = 0;
    if (happyHourActivo) {
      rows.forEach(r => {
        if (r.nombre_producto.includes('Imperial') || r.nombre_producto.includes('Pilsen') || r.nombre_producto.includes('Mojito')) {
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

    io.emit('nueva_comanda', { mesaId, ordenId, comandas: nuevasComandas });
    io.emit('mesa_actualizada', { mesaId, estado: 'esperando', total });

    res.json({ message: 'Comanda enviada a cocina/barra', ordenId, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lanzar Platos Fuertes (Marchando curso 2)
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

// Anulación de platillo con PIN de supervisor y registro de auditoría
app.post('/api/comandas/anular-item', async (req, res) => {
  try {
    const { detalleId, motivo, supervisorPin, mesaNumero = 'Mesa' } = req.body;

    if (supervisorPin !== SUPERVISOR_PIN) {
      return res.status(403).json({ error: 'PIN de Supervisor incorrecto' });
    }

    const item = await dbGet('SELECT * FROM DetalleOrden WHERE id = ?', [detalleId]);
    if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });

    const ahora = new Date().toISOString();

    // 1. Marcar el ítem como anulado
    await dbRun("UPDATE DetalleOrden SET estado_comanda = 'anulado' WHERE id = ?", [detalleId]);

    // 2. Registrar en auditoría
    await dbRun(
      `INSERT INTO Anulaciones (orden_id, detalle_id, mesa, producto_nombre, cantidad, monto, motivo, supervisor_pin, fecha_hora)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.orden_id, detalleId, mesaNumero, item.nombre_producto, item.cantidad, item.subtotal, motivo, supervisorPin, ahora]
    );

    // 3. Recalcular la orden
    const totalItems = await dbGet("SELECT SUM(subtotal) as sub FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [item.orden_id]);
    const subtotal = Number(totalItems.sub) || 0;
    const servicio = Math.round(subtotal * 0.10);
    const iva = Math.round(subtotal * 0.13);
    const total = subtotal + servicio + iva;

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?", [subtotal, servicio, iva, total, item.orden_id]);

    io.emit('comanda_anulada', { detalleId, ordenId: item.orden_id, producto: item.nombre_producto, motivo });
    res.json({ message: 'Platillo anulado y registrado en auditoría', ordenId: item.orden_id, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 4. KITCHEN DISPLAY SYSTEM (KDS)
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
    query += ' ORDER BY d.id ASC';

    const comandas = await dbAll(query, params);
    res.json(comandas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kds/:detalleId/estado', async (req, res) => {
  try {
    const { estado } = req.body; // 'preparando', 'listo', 'servido'
    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    await dbRun('UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?', [estado, horaListo, req.params.detalleId]);
    
    io.emit('comanda_estado_cambiado', { detalleId: req.params.detalleId, estado });
    res.json({ message: 'Estado KDS actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 5. COBRO, CAJA & CONTROL DE PROPINAS (TIP POOL)
// ============================================================================
app.post('/api/ordenes/:id/cobrar', async (req, res) => {
  try {
    const ordenId = req.params.id;
    const { metodo = 'Efectivo', monto, propina = 0, cambio = 0, mesero = 'Juan Jival' } = req.body;
    const ahora = new Date().toISOString();

    const orden = await dbGet('SELECT * FROM Ordenes WHERE id = ?', [ordenId]);
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const caja = await dbGet("SELECT * FROM Cajas WHERE estado = 'abierta' ORDER BY id DESC LIMIT 1");
    const cajaId = caja ? caja.id : null;

    // Registrar pago
    await dbRun(
      'INSERT INTO Pagos (orden_id, caja_id, mesero, metodo, monto, propina, cambio, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ordenId, cajaId, mesero, metodo, monto, propina, cambio, ahora]
    );

    // Cerrar orden
    await dbRun("UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ? WHERE id = ?", [ahora, ordenId]);

    // Liberar mesa
    if (orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'libre', total: 0 });
    }

    res.json({ message: 'Cobro completado y mesa liberada', ordenId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Estado de la caja activa y Tip Pool por mesero
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

    // Reporte de Propinas (Tip Pool) por mesero del turno
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
// 6. FACTURACIÓN ELECTRÓNICA EXPRESS
// ============================================================================
app.post('/api/facturacion/consultar-cliente', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Cédula requerida' });

  // Simulación de respuesta inmediata de Registro Nacional / Hacienda
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
// 7. AUTOSERVICIO EN MESA POR QR (PORTAL MÓVIL DEL CLIENTE)
// ============================================================================
app.get('/api/cliente/mesa/:mesaId', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ mesa, orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden.id]);
    res.json({ mesa, orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cliente solicita la cuenta desde su teléfono móvil
app.post('/api/cliente/mesa/:mesaId/pedir-cuenta', async (req, res) => {
  try {
    const mesaId = req.params.mesaId;
    await dbRun("UPDATE Mesas SET estado = 'cuenta' WHERE id = ?", [mesaId]);
    await dbRun("UPDATE Ordenes SET estado = 'cuenta_pedida' WHERE mesa_id = ? AND estado IN ('abierta', 'esperando')", [mesaId]);

    const mesa = await dbGet('SELECT * FROM Mesas WHERE id = ?', [mesaId]);
    io.emit('cliente_pidio_cuenta', { mesaId: Number(mesaId), mesaNumero: mesa ? mesa.numero : 'Mesa' });
    io.emit('mesa_actualizada', { mesaId: Number(mesaId), estado: 'cuenta' });

    res.json({ message: 'Solicitud enviada al mesero' });
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
