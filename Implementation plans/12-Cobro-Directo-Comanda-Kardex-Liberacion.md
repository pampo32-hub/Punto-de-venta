# Plan de Implementación: Cobro Directo de Comanda con Descuento Inmediato en Kárdex y Liberación de Mesa

**Estado:** ✅ Implementado y Verificado  
**Fecha:** Septiembre 2026  
**Commit:** `aa82c7b`  

---

## 🎯 Objetivo
Permitir el flujo express de cobranza en barra y cajas rápidas donde el cajero o salonero ingresa los ítems en pantalla y presiona directamente **`💰 Cobrar`** sin necesidad de presionar previamente *Guardar Comanda*, asegurando que los ítems se registren en la base de datos, se descuente el inventario/recetas de Kárdex, se emita el tiquete y la mesa quede liberada de forma atómica.

---

## 🏗️ Flujo de Cobro Directo Atómico

```mermaid
sequenceDiagram
    autonumber
    actor Cajero as 👨‍💼 Cajero / Salonero
    participant UI as 🖥️ Modal de Cobro Express
    participant Server as 🌐 Backend (server.js / procesarCobroOrden)
    participant Kardex as 📚 Motor de Kárdex & Recetas
    participant DB as 💾 Base de Datos SQLite (Pagos, Ordenes, Mesas)

    Cajero->>UI: Selecciona productos + Clic en "💰 Cobrar"
    UI->>Server: POST /api/ordenes/directo/cobrar { mesaId, items, metodo, monto }
    Server->>DB: Crea Orden si no existía (ORD-XXXX)
    Server->>DB: Inserta DetalleOrden con estado 'pagado'
    Server->>Kardex: descontarInventarioPorItems(items)
    Kardex->>DB: Registra Asientos en InventarioKardex
    Server->>DB: Inserta registro en tabla Pagos (caja_id, metodo, monto)
    Server->>DB: UPDATE Ordenes SET estado='pagada', fecha_cierre=NOW()
    Server->>DB: UPDATE Mesas SET estado='libre'
    Server->>UI: Retorna OK + Tiquete formateado para impresora
    UI->>Cajero: Muestra confirmación y libera la mesa en el salón
```

---

## 🧪 Validación y Pruebas
- Verificado en flujo express de mostrador y barra.
- Verificado descuento proporcional de shots y botellas completas.
- Verificado el cierre automático de órdenes huérfanas y liberación de mesas.
