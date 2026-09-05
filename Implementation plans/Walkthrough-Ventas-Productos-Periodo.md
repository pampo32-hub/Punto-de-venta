# Walkthrough: Reporte de Ventas por Producto, Período y Consumo de Insumos en Kárdex 2026

**Módulo:** Control de Inventario y Escandallos 2026  
**Ubicación:** Subpestaña `📊 Ventas & Rendimiento` (a la derecha de `🛒 Sugerencia de Compras`)  
**Fecha:** Septiembre 2026  

---

## 1. Resumen de la Implementación
Se integró un panel analítico completo dentro del módulo de inventario que permite a la administración consultar el volumen de ventas, ingresos brutos, costo de materias primas y margen de utilidad de cada platillo y bebida en cualquier período de fechas seleccionado.

---

## 2. Componentes Clave

### A. Buscador Predictivo Inteligente
- Búsqueda reactiva en tiempo real mientras el usuario escribe en `#txtBuscarVentaProd`.
- Menú desplegable con fotos de platillos, categorías y precios de venta.
- Filtro individualizado con opción de limpieza instantánea mediante botón `✕`.

### B. Presets de Fechas de 1 Clic
- Botones de selección rápida: **Hoy**, **Ayer**, **Esta Semana**, **Este Mes** y **Últimos 30 días**.
- Selectores de rango personalizado (**Desde** / **Hasta**) para análisis históricos.

### C. Métricas Financieras (KPIs)
- **Unidades Vendidas**: Volumen total de unidades servidas.
- **Ingresos Totales (₡)**: Facturación bruta generada.
- **Costo de Insumos (₡)**: Valor contable de las materias primas consumidas según escandallos.
- **Margen Bruto (%)**: Porcentaje real de ganancia bruta sobre los ingresos.

### D. Modal de Insumos Deducidos en Kárdex
- Botón **`🧪 Ver Insumos Deducidos`** en cada fila de la tabla.
- Desglose exacto de ingredientes por porción, cantidad bruta consumida en el período, costo total y **Stock Actual Remanente** en bodega.
- Tabla con el historial cronológico de órdenes pagadas que generaron las salidas.

### E. Exportación e Impresión
- **Descargar Excel (CSV)**: Archivo estructurado con codificación UTF-8 BOM para apertura perfecta en Excel.
- **Imprimir / PDF**: Plantilla formal con diseño corporativo *GastroBar Fuego & Brasas*, tabla de KPIs e inventario global de insumos consumidos.

---

## 3. Pruebas y Cobertura
- Suite **Tier 15** implementada en `test/e2e/tier15-ventas-productos-periodo.test.js` con 5 / 5 pruebas aprobadas.
- Cobertura global del sistema: **119 pruebas en 25 suites al 100%**.
