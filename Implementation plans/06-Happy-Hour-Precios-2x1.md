# Plan de Implementación: Happy Hour 2x1 y Horarios Automatizados

**Estado:** ✅ Implementado y Verificado  
**Fecha:** Septiembre 2026  

---

## 🎯 Objetivo
Gestionar promociones 2x1 en cervezas y cócteles durante horarios programados (ej. 16:00 a 19:00), con cálculo exacto de descuentos en cantidades pares e impares, auto-expiración en tiempo real por el servidor y preservación de precios originales en la comida.

---

## ⚙️ Reglas de Negocio Implementadas

1. **Fórmula 2x1 para Cantidades Impares y Pares**:
   - Por cada 2 unidades de un producto participante, 1 unidad es gratis:  
     `descuento = Math.floor(cantidad / 2) * precio_unitario`
   - Cantidad 1: 0 gratis.
   - Cantidad 2: 1 gratis.
   - Cantidad 3: 1 gratis (paga 2).
   - Cantidad 4: 2 gratis (paga 2).
   - Cantidad 5: 2 gratis (paga 3).
2. **Exclusión de Alimentos**:
   - Los platillos y entradas nunca reciben descuento 2x1, incluso si el Happy Hour está activo.
3. **Servidor como Fuente de Verdad**:
   - El estado activo de Happy Hour se evalúa en el backend comparando la hora del servidor con el rango horario configurado en `ConfigNegocio`.
   - Auto-expiración por cronómetro en `server.js` cada minuto.
   - Notificación instantánea vía Socket.io a todas las pantallas (`happy_hour_cambio`).

---

## 📁 Archivos Modificados
- `server.js`: Configuración en `ConfigNegocio`, recálculo en `Ordenes.descuento_happy_hour`, sincronización vía Socket.io.
- `public/app.js`: Badge `🍸 2x1` en tarjetas de catálogo, desglose de descuento en el ticket.

---

## 🧪 Pruebas Automatizadas
- `test/e2e/tier1-features.test.js`: `T1.13` a `T1.17`.
- `test/e2e/tier2-boundaries.test.js`: `T2.11` a `T2.15`.
- `test/e2e/tier3-combinations.test.js`: `T3.1`, `T3.5`, `T3.11`.
- `test/e2e/tier4-scenarios.test.js`: `T4.2`.

