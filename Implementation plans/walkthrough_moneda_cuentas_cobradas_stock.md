# Walkthrough: Formato de Moneda Global ₡ 50.000, Modal de Cuentas Cobradas y Alertas de Stock Crítico

Hemos completado e integrado con éxito todas las funcionalidades y correcciones solicitadas por el usuario:

1. **Formato Monetario Global (`₡ 50.000`)**: Estandarización de toda la aplicación (Dashboard Ejecutivo, Panel Admin, Salón y Mesas, Comandero, Split Bills, Caja, KDS, Facturación Express, Kárdex e Inventario, y Vista Móvil de Cliente) al formato oficial con punto de miles y sin decimales (`₡ 50.000`, `₡ 1.033.200`, `₡ 0`).
2. **Dashboard Ejecutivo — Cuentas Cobradas Interactivo**: La tarjeta KPI de Cuentas Cobradas (`#kpiCuentasCobradas` y `#devKpiCuentasCobradas`) ahora es clicable y abre un modal interactivo (`#modalHistorialCuentasCobradas`) con buscador en tiempo real, chips de totales (Total Cobrado, Cuentas Cerradas, Efectivo, Tarjeta, SINPE y Propinas) y desglose desplegable de platillos por comanda.
3. **Corrección de Notificación de Inventario Crítico**: Se solucionó la alerta que mostraba `undefined` al enviar comandas, mostrando ahora de forma precisa el nombre del insumo y la unidad (ej. `⚠️ ¡Alerta de Inventario! El insumo "Pilsen Regular" alcanzó stock crítico (0 bot. restantes).`).
4. **Verificación Permanente de Login para Todos los Roles**: Validado que todos los usuarios (`admin`, `carlos`, `cajero`, `dev`) inician sesión sin bloqueos ni errores de consola.

---

## 📸 Evidencias Visuales de Verificación

````carousel
![Pantalla de Inicio y Logins](/evidencia_1_pantalla_inicio_login.png)
<!-- slide -->
![Dashboard Admin con KPIs Formateados](/evidencia_2_admin_pos.png)
<!-- slide -->
![Modal de Cuentas Cobradas de Hoy](/evidencia_3_modal_cuentas_cobradas.png)
<!-- slide -->
![Desglose de Platillos por Comanda](/evidencia_4_detalle_platillos.png)
<!-- slide -->
![Alerta de Stock Crítico con Nombre de Insumo](/evidencia_5_alerta_stock_critico.png)
<!-- slide -->
![Login Salonero Carlos](/evidencia_6_login_carlos_salonero.png)
<!-- slide -->
![Login Portal Developer](/evidencia_7_portal_dev_login.png)
````

---

## 🛠️ Cambios Realizados

### 1. Frontend: Formato de Moneda Global y Limpieza de Decimales
- [`public/app.js`](file:///c:/Users/Juan/punto-de-venta/public/app.js):
  - Actualizado `formatCRC(num)` y `formatCRCSinDecimales(num)`:
    ```javascript
    function formatCRC(num) {
      const val = Math.round(Number(num) || 0);
      return '₡ ' + val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    ```
  - Reemplazadas todas las llamadas huérfanas `.toLocaleString()` por `formatCRC()`.
  - Asegurada la estabilidad del scope global convirtiendo variables de control a propiedades seguras en `window`.
- [`public/cliente.html`](file:///c:/Users/Juan/punto-de-venta/public/cliente.html):
  - Formato sincronizado a `₡ 50.000` con punto separador de miles.
- [`public/index.html`](file:///c:/Users/Juan/punto-de-venta/public/index.html):
  - Eliminados todos los placeholders estáticos con `.00` a `₡ 0`.
  - Añadido evento `onclick="abrirModalCuentasCobradasHoy()"` y estilo interactivo con cursor pointer en las tarjetas KPI de Cuentas Cobradas.
  - Creado el modal `#modalHistorialCuentasCobradas` (con `z-index: 100050`) con buscador en tiempo real, chips de totales y acordeón de platillos.
  - Actualizada la etiqueta del script a `app.js?v=2.9.9`.
- [`public/sw.js`](file:///c:/Users/Juan/punto-de-venta/public/sw.js):
  - Incrementada la versión de caché a `pos-static-v20`.

---

### 2. Backend: Endpoint de Cuentas Cobradas y Alertas de Stock
- [`server.js`](file:///c:/Users/Juan/punto-de-venta/server.js):
  - Creado endpoint `GET /api/admin/ventas/historial-hoy` con middleware `verificarAdmin`, retornando las órdenes pagadas de la jornada con sus pagos por método, propinas y detalle completo de platillos.
  - Enriquecido el payload del socket `inventario_alerta_stock` en `descontarInventarioPorItems` para incluir `insumo: insumo.nombre`, `nombre: insumo.nombre` y `unidad: insumo.unidad || 'uds'`.

---

### 3. Suite Automatizada de Pruebas
- [`test/e2e/tier17-cuentas-cobradas-historial.test.js`](file:///c:/Users/Juan/punto-de-venta/test/e2e/tier17-cuentas-cobradas-historial.test.js):
  - Test T17.1: Validación de seguridad por roles (403 para saloneros, 200 para administradores).
  - Test T17.2: Validación de cálculo y retorno de pagos por método, propinas y desglose de platillos.

---

## 🧪 Resultados de Verificación

1. **Pruebas Automatizadas Unitarias y E2E (Tiers 1 a 17)**:
   - Total de pruebas: **124 tests pasando al 100% en 27 suites** (0 fallos).
2. **Pruebas en Navegador Real (Chrome CDP Headless)**:
   - Formato monetario verificado en todo el DOM: `₡ 50.000`, `₡ 1.033.200`, `₡ 0`.
   - Cuentas cobradas: Modal abre fluidamente en primer plano con listado de órdenes y detalle de platillos.
   - Alerta de inventario: Muestra el nombre real del insumo sin `undefined`.
   - Inicios de sesión: Verificados con éxito para `admin`, `carlos` (salonero), `cajero` y `dev`.
