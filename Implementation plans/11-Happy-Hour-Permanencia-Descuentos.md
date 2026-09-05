# Plan de Implementación: Persistencia y Permanencia de Descuentos Happy Hour tras Expiración

**Estado:** ✅ Implementado y Verificado  
**Fecha:** Septiembre 2026  
**Tier de Pruebas:** Tier 11 (`test/e2e/tier11-happy-hour-permanence.test.js`)

---

## 🎯 Objetivo
Garantizar la regla contable y legal de hospitalidad: cualquier bebida o producto ordenado mientras la promoción Happy Hour (2x1 o precio especial) estaba activa debe mantener su precio promocional intacto al momento del cobro final o emisión de factura, incluso si la mesa permanece abierta y la hora programada del Happy Hour ya venció.

---

## 🏗️ Mecanismo de Congelación de Precios

```mermaid
graph TD
    OrderDuringHH["🍹 Pedido enviado durante Happy Hour (ej. 18:30)"] --> FlagItem["🏷️ DetalleOrden.en_happy_hour = 1\nprecio_unitario: ₡1,800 (congelado)"]
    TimePasses["⏳ Pasa el tiempo: 19:05 (Happy Hour finaliza)"] --> NextOrder["🍺 Nuevo pedido enviado a las 19:10"]
    NextOrder --> FlagNormal["🏷️ DetalleOrden.en_happy_hour = 0\nprecio_unitario regular: ₡1,800"]
    
    CheckBill["🧾 Se solicita la cuenta / Cobro (20:00)"] --> BillingCalc["⚙️ Algoritmo de Facturación:\n- Items con en_happy_hour=1 aplican 2x1 promo\n- Items posteriores cobran precio estándar"]
    BillingCalc --> CleanTicket["📄 Tiquete y Asiento contable exactos"]
```

---

## 🧪 Pruebas Automatizadas (Tier 11)
- `T11.1`: Las bebidas agregadas durante Happy Hour conservan el flag `en_happy_hour=1`.
- `T11.2`: La expiración del horario no altera el estado de los ítems existentes en mesas activas.
- `T11.3`: Los nuevos ítems ordenados post-expiración no reciben el beneficio promocional.
- `T11.4`: La finalización del pago preserva el descuento en el tiquete y los cierres de caja.
