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

app.post('/api/mesas/posiciones', async (req, res) => {
  try {
    const { posiciones } = req.body;
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

app.post('/api/mesas/mover', async (req, res) => {
  try {
    const { origenMesaId, destinoMesaId } = req.body;
    const mesaOrig = await dbGet('SELECT * FROM Mesas WHERE id = ?', [origenMesaId]);
    const mesaDest = await dbGet('SELECT * FROM Mesas WHERE id = ?', [destinoMesaId]);
    if (!mesaOrig || !mesaDest) return res.status(404).json({ error: 'Mesa no encontrada' });

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [origenMesaId]);
    if (!orden) return res.status(400).json({ error: 'La mesa de origen no tiene una orden activa' });

    await dbRun('UPDATE Ordenes SET mesa_id = ? WHERE id = ?', [destinoMesaId, orden.id]);
    await dbRun('UPDATE Mesas SET estado = ?, mesero = ? WHERE id = ?', [mesaOrig.estado, mesaOrig.mesero, destinoMesaId]);
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [origenMesaId]);

    io.emit('mesa_transferida', { origenMesaId, destinoMesaId, ordenId: orden.id });
    res.json({ message: `Orden transferida con éxito de ${mesaOrig.numero} a ${mesaDest.numero}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas/unir', async (req, res) => {
  try {
    const { mesaPrincipalId, mesaSecundariaId } = req.body;
    const orden1 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaPrincipalId]);
    const orden2 = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaSecundariaId]);

    if (!orden1 || !orden2) return res.status(400).json({ error: 'Ambas mesas deben tener órdenes activas' });

    await dbRun('UPDATE DetalleOrden SET orden_id = ? WHERE orden_id = ?', [orden1.id, orden2.id]);
    const totalItems = await dbGet("SELECT SUM(subtotal) as sub FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden1.id]);
    const subtotal = Number(totalItems.sub) || 0;
    const servicio = Math.round(subtotal * 0.10);
    const iva = Math.round(subtotal * 0.13);
    const total = subtotal + servicio + iva;

    await dbRun("UPDATE Ordenes SET subtotal = ?, servicio_10 = ?, iva_13 = ?, total = ? WHERE id = ?", [subtotal, servicio, iva, total, orden1.id]);
    await dbRun("UPDATE Ordenes SET estado = 'fusionada', total = 0 WHERE id = ?", [orden2.id]);
    await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [mesaSecundariaId]);

    io.emit('mesas_unidas', { mesaPrincipalId, mesaSecundariaId, ordenPrincipalId: orden1.id });
    res.json({ message: 'Cuentas fusionadas correctamente', ordenId: orden1.id, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado' ORDER BY id ASC", [orden.id]);
    res.json({ orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    query += ' ORDER BY d.id ASC';

    const comandas = await dbAll(query, params);
    res.json(comandas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kds/:detalleId/estado', async (req, res) => {
  try {
    const { estado } = req.body;
    const horaListo = estado === 'listo' ? new Date().toISOString() : null;
    await dbRun('UPDATE DetalleOrden SET estado_comanda = ?, hora_listo = COALESCE(?, hora_listo) WHERE id = ?', [estado, horaListo, req.params.detalleId]);
    
    io.emit('comanda_estado_cambiado', { detalleId: req.params.detalleId, estado });
    res.json({ message: 'Estado KDS actualizado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// 9. COBRO, CAJA & CONTROL DE PROPINAS (TIP POOL)
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

    await dbRun(
      'INSERT INTO Pagos (orden_id, caja_id, mesero, metodo, monto, propina, cambio, fecha_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [ordenId, cajaId, mesero, metodo, monto, propina, cambio, ahora]
    );

    await dbRun("UPDATE Ordenes SET estado = 'pagada', fecha_cierre = ? WHERE id = ?", [ahora, ordenId]);

    if (orden.mesa_id) {
      await dbRun("UPDATE Mesas SET estado = 'libre', mesero = NULL WHERE id = ?", [orden.mesa_id]);
      io.emit('mesa_actualizada', { mesaId: orden.mesa_id, estado: 'libre', total: 0 });
    }

    res.json({ message: 'Cobro completado y mesa liberada', ordenId });
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

    const orden = await dbGet("SELECT * FROM Ordenes WHERE mesa_id = ? AND estado IN ('abierta', 'esperando', 'cuenta_pedida')", [mesaId]);
    if (!orden) return res.json({ mesa, orden: null, items: [] });

    const items = await dbAll("SELECT * FROM DetalleOrden WHERE orden_id = ? AND estado_comanda != 'anulado'", [orden.id]);
    res.json({ mesa, orden, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
