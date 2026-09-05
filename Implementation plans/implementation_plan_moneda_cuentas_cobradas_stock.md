# Plan de Implementación: Formato Monetario ₡ 50.000, Modal de Cuentas Cobradas y Alertas de Inventario Crítico

Este plan detalla las correcciones solicitadas para estandarizar la visualización de montos en toda la plataforma, habilitar el desglose interactivo de ventas diarias desde el Dashboard Ejecutivo y eliminar el texto `undefined` en las notificaciones de stock crítico.

---

## 📌 Requerimientos del Usuario

1. **Formato Monetario Global (`₡ 50.000`)**:
   - Aplicar en **toda la aplicación** (Dashboard Ejecutivo, Panel Admin, Salón y Mesas, Comandero, Split Bills, Caja, KDS, Facturación Express, Kárdex e Inventario, y Vista Móvil de Cliente) el formato estándar con símbolo `₡`, espacio, punto (`.`) como separador de miles y **sin decimales** (ej: `₡ 50.000`, `₡ 1.033.200`, `₡ 0`).
2. **Dashboard Ejecutivo — Cuentas Cobradas Clicable**:
   - En la tarjeta KPI **"Cuentas Cobradas"** (`#kpiCuentasCobradas` y `#devKpiCuentasCobradas`), habilitar comportamiento interactivo (cursor pointer, hover visual y evento click) para abrir un modal con el registro completo de las comandas y órdenes cobradas en el día.
   - El modal incluirá: buscador en tiempo real, resumen de totales (total cobrado, efectivo, tarjeta, SINPE, propina), tabla con N° de orden, mesa, mesero, hora de cobro, método de pago, desglose (subtotal, IVA 13%, servicio 10%, total) y un botón interactivo para desplegar los platillos/bebidas consumidos en cada comanda.
3. **Corrección de Alerta de Inventario Crítico (`undefined`)**:
   - Corregir el evento Socket.io y el handler del frontend para que las alertas de stock bajo/crítico al enviar una comanda muestren claramente el nombre del insumo o producto (ej: `⚠️ ¡Alerta de Inventario! El insumo "Pilsen Regular" alcanzó stock crítico (0 bot. restantes).`) en lugar de decir `undefined`.
4. **Verificación Permanente de Login para Todos los Roles**:
   - Validar que tras todos los cambios continúe funcionando de forma impecable el inicio de sesión de todos los roles (`admin`, `carlos`, `cajero`, `dev`).

---

## 🛠️ Cambios Propuestos

### 1. Formateo de Moneda Global
#### [MODIFY] [`public/app.js`](file:///c:/Users/Juan/punto-de-venta/public/app.js)
- Actualizar `formatCRC(num)` y `formatCRCSinDecimales(num)`:
  ```javascript
  function formatCRC(num) {
    const val = Math.round(Number(num) || 0);
    return '₡ ' + val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function formatCRCSinDecimales(num) {
    return formatCRC(num);
  }
  ```
- Reemplazar todas las ocurrencias directas de `.toLocaleString()` huérfanas en el reporte de ventas, inventario, kárdex y previews para que usen `formatCRC()`.

#### [MODIFY] [`public/cliente.html`](file:///c:/Users/Juan/punto-de-venta/public/cliente.html)
- Actualizar `formatCRC(num)` en `cliente.html` con la misma regla de punto de miles `₡ 50.000`.
- Limpiar los placeholders estáticos (`₡ 0.00` -> `₡ 0`).

#### [MODIFY] [`public/index.html`](file:///c:/Users/Juan/punto-de-venta/public/index.html)
- Limpiar todos los placeholders estáticos restantes que tenían `₡ 0.00` o `₡ 50,000` a `₡ 0` y `₡ 50.000` (KPIs de ventas, ticket promedio, previews de menú, etc.).

---

### 2. Backend: Endpoint de Cuentas Cobradas del Día y Alertas de Stock
#### [MODIFY] [`server.js`](file:///c:/Users/Juan/punto-de-venta/server.js)
- **Endpoint `GET /api/admin/ventas/historial-hoy`**:
  - Consulta todas las órdenes pagadas del día de hoy con sus pagos asociados (`Pagos`), detalle de ítems (`DetalleOrden`), mesa y mesero.
  - Retorna `{ ok: true, totalVentas, totalCuentas, pagosPorMetodo, ordenes: [...] }`.
- **Emisión de Alerta de Stock**:
  - En `descontarInventarioPorItems`, incluir en el objeto emitido `insumo: insumo.nombre`, `nombre: insumo.nombre`, `unidad: insumo.unidad || 'uds'`, asegurando que todos los campos requeridos por el frontend estén completos.

---

### 3. Frontend: Modal de Cuentas Cobradas del Día
#### [MODIFY] [`public/index.html`](file:///c:/Users/Juan/punto-de-venta/public/index.html)
- Añadir modal `#modalHistorialCuentasCobradas` (con `z-index: 100050`):
  - Cabecera con título `🧾 Registro de Cuentas Cobradas Hoy`, fecha actual y buscador inteligente.
  - Barra de resumen con mini-KPIs: Total Cobrado, Efectivo, Tarjeta, SINPE y Propinas.
  - Tabla responsive con acordeón desplegable para ver los platillos de cada orden.
- Añadir estilos de interacción (`cursor: pointer;`, `transition: transform 0.15s;`) y llamadas `onclick="abrirModalCuentasCobradasHoy()"` en las tarjetas de KPI `#kpiCuentasCobradas` y `#devKpiCuentasCobradas`.

#### [MODIFY] [`public/app.js`](file:///c:/Users/Juan/punto-de-venta/public/app.js)
- Implementar funciones `window.abrirModalCuentasCobradasHoy()`, `renderizarTablaCuentasCobradas(ordenes)`, `filtrarCuentasCobradas(query)`, `toggleDetalleComandaCobrada(ordenId)` y `cerrarModalCuentasCobradas()`.
- Corregir el listener `socket.on('inventario_alerta_stock')` para manejar de forma robusta `d.insumo || d.nombre` y `d.unidad`.
- Incrementar versión en etiqueta de script a `app.js?v=2.9.9`.

#### [MODIFY] [`public/sw.js`](file:///c:/Users/Juan/punto-de-venta/public/sw.js)
- Actualizar versión de Service Worker a `pos-static-v20`.

---

## 🧪 Plan de Verificación

### Pruebas Automatizadas
1. **Verificación de Sintaxis**: Ejecutar `node --check` en todos los archivos JS.
2. **Suite Completa de Pruebas (Tier 1 a Tier 16)**: Ejecutar `npm.cmd test` verificando que los 122 tests pasen al 100%.
3. **Nuevo Test de Integración**: Añadir verificación del endpoint `GET /api/admin/ventas/historial-hoy` y consistencia del payload de alerta de stock.

### Pruebas E2E en Navegador Real (Chrome CDP)
1. **Comprobación de Formato de Moneda**:
   - Abrir Salón, Comandero, Caja y Reportes; comprobar mediante JavaScript que todos los montos sigan la expresión regular `/^₡\s\d{1,3}(\.\d{3})*$/` (punto en miles, sin comas ni decimales).
2. **Prueba Interactiva del KPI Cuentas Cobradas**:
   - Iniciar sesión como `admin`, navegar al Dashboard Ejecutivo, hacer clic en la tarjeta "Cuentas Cobradas".
   - Validar que el modal `#modalHistorialCuentasCobradas` se abra en primer plano (`z-index: 100050`), muestre la lista de comandas cobradas y permita filtrar en tiempo real.
3. **Prueba de Alerta de Stock Crítico**:
   - Enviar comanda que reduzca stock a crítico y verificar que la notificación emergente contenga el nombre exacto del insumo y no diga `undefined`.
4. **Verificación de Login en Todos los Roles**:
   - Probar inicio de sesión para `admin`, `carlos`, `cajero` y `dev`.
   - Capturar capturas de pantalla de evidencia en el directorio de artefactos.
