# Walkthrough: Cobro Directo de Comanda con Descuento Automático en Kárdex y Liberación de Mesa

**Módulo:** Cobro Express & Control de Salón  
**Fecha:** Septiembre 2026  
**Commit:** `aa82c7b`  

---

## 1. Resumen de la Implementación
Se habilitó la funcionalidad de cobro directo desde la pantalla del comandero, permitiendo que el cajero o salonero seleccione platillos y bebidas y proceda inmediatamente al pago (`💰 Cobrar`) sin obligar a guardar la comanda previamente.

---

## 2. Componentes Clave

### A. Endpoint Atómico de Cobro Directo
- `POST /api/ordenes/directo/cobrar`:
  - Recibe `mesaId`, `items`, `metodoPago`, `monto`, `propina` y `cambio`.
  - Crea o actualiza la orden activa en una sola transacción.
  - Inserta los ítems en `DetalleOrden` con estado `pagado`.
  - Invoca `descontarInventarioPorItems(items)` para deducir materias primas de bodega según escandallos.
  - Inserta el asiento en la tabla `Pagos`.
  - Actualiza la orden a `pagada` con marca temporal de cierre.
  - Libera la mesa inmediatamente en el salón (`estado = 'libre'`).

### B. Emisión de Tiquete Térmico 80mm
- Genera automáticamente el tiquete de cobro con desglose de impuestos, propina, cambio y método de pago listo para impresión directa en el puerto ESC/POS 9100.
