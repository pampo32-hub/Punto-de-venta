const bcrypt = require('bcryptjs');
const { dbRun, dbGet, dbAll } = require('./database');

async function crearNuevoRestaurante({
  nombreNegocio,
  slogan = 'Restaurante & Bar',
  moneda = 'CRC',
  telefono = '',
  direccion = '',
  adminUsuario,
  adminNombre,
  adminPassword,
  adminPin = '1234',
  clonarMenuMesas = true
}) {
  try {
    console.log(`\n🚀 Creando nuevo restaurante: "${nombreNegocio}"...`);

    // 1. Insertar Negocio
    const rNegocio = await dbRun(
      `INSERT INTO Negocios (nombre, slogan, logo_url, moneda, telefono, direccion, activo, plan_nombre, modulos_activos)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'Plan Full Tech 2026', 'all')`,
      [
        nombreNegocio.trim(),
        slogan.trim(),
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=150&auto=format&fit=crop&q=80',
        moneda.toUpperCase(),
        telefono,
        direccion
      ]
    );

    const negocioId = rNegocio.lastID;
    console.log(`✅ Negocio registrado con ID: ${negocioId}`);

    // 2. Crear Zonas y Mesas iniciales si se desea
    if (clonarMenuMesas) {
      const rZona = await dbRun(`INSERT INTO Zonas (negocio_id, nombre) VALUES (?, 'Salón Principal')`, [negocioId]);
      const zonaId = rZona.lastID;

      // Crear 6 mesas básicas
      for (let i = 1; i <= 6; i++) {
        await dbRun(
          `INSERT INTO Mesas (negocio_id, numero, zona_id, capacidad, estado, x, y, ancho, alto, forma, piso)
           VALUES (?, ?, ?, 4, 'libre', ?, ?, 130, 120, 'square', 1)`,
          [negocioId, `Mesa ${i}`, zonaId, 40 + ((i - 1) % 3) * 160, 40 + Math.floor((i - 1) / 3) * 150]
        );
      }

      // Crear Categorías básicas
      await dbRun(`INSERT INTO Categorias (negocio_id, nombre, icono, destino) VALUES (?, 'Comidas', 'fas fa-utensils', 'cocina')`, [negocioId]);
      await dbRun(`INSERT INTO Categorias (negocio_id, nombre, icono, destino) VALUES (?, 'Bebidas', 'fas fa-glass-martini-alt', 'bar')`, [negocioId]);

      console.log(`✅ Zonas, Mesas y Categorías base creadas.`);
    }

    // 2.1 Garantizar limpieza financiera a Cero Absoluto
    await dbRun('DELETE FROM Cajas WHERE negocio_id = ?', [negocioId]);
    await dbRun('DELETE FROM Ordenes WHERE negocio_id = ?', [negocioId]);

    // 3. Crear Usuario Administrador
    const permisosAdmin = JSON.stringify({
      salon: true,
      kds: true,
      caja: true,
      facturacion: true,
      empleados: true,
      catalogo: true,
      reportes: true,
      configuracion: true
    });

    const hashedPassword = await bcrypt.hash(adminPassword.trim(), 10);

    const rUser = await dbRun(
      `INSERT INTO Usuarios (negocio_id, usuario, nombre_completo, password, rol, genero, pin, permisos, activo, debe_cambiar_password)
       VALUES (?, ?, ?, ?, 'admin', 'M', ?, ?, 1, 0)`,
      [negocioId, adminUsuario.trim().toLowerCase(), adminNombre.trim(), hashedPassword, String(adminPin).trim(), permisosAdmin]
    );

    console.log(`\n🎉 ¡RESTAURANTE Y ADMIN CREADOS CON ÉXITO!`);
    console.log(`-----------------------------------------------`);
    console.log(`🏢 Negocio ID      : ${negocioId}`);
    console.log(`🏪 Nombre          : ${nombreNegocio}`);
    console.log(`👤 Usuario Admin   : ${adminUsuario.trim().toLowerCase()}`);
    console.log(`🔑 Contraseña      : ${adminPassword}`);
    console.log(`🔢 PIN de Acceso   : ${adminPin}`);
    console.log(`👑 Rol             : admin`);
    console.log(`-----------------------------------------------\n`);

    return { negocioId, usuarioId: rUser.lastID };
  } catch (error) {
    console.error(`❌ Error al crear restaurante:`, error.message);
    throw error;
  }
}

// Si se ejecuta directamente desde la terminal: node crear_restaurante.js "Mi Restaurante" "admin_rest" "MiClave123" "0000"
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log(`
Uso desde terminal:
  node crear_restaurante.js "<Nombre Restaurante>" "<Usuario Admin>" "<Contraseña>" [PIN opcional (def: 1234)] [Moneda (def: CRC)]

Ejemplo:
  node crear_restaurante.js "La Parrilla de Juan" "admin_juan" "Parrilla2026" "4444" "CRC"
    `);
    process.exit(0);
  }

  const [nombreNegocio, adminUsuario, adminPassword, adminPin = '1234', moneda = 'CRC'] = args;
  crearNuevoRestaurante({
    nombreNegocio,
    adminUsuario,
    adminNombre: `Admin ${nombreNegocio}`,
    adminPassword,
    adminPin,
    moneda
  }).then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { crearNuevoRestaurante };

