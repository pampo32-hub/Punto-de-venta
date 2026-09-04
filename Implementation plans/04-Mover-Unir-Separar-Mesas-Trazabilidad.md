# Plan de Implementación: Mover, Unir, Separar Mesas y Trazabilidad de Ítems

**Estado:** ✅ Implementado y Verificado  
**Fecha:** Septiembre 2026  

---

## 🎯 Objetivo
Permitir la reorganización fluida de clientes en el salón: mover mesas vacías a ocupadas, unir múltiples mesas en una cuenta unificada preservando la procedencia original de cada platillo (trazabilidad para división de cuentas posterior), y revertir uniones incluso si la mesa de origen original ha sido ocupada mientras tanto.

---

## ⚙️ Reglas de Negocio Implementadas

1. **Mover Mesa (`POST /api/mesas/mover`)**:
   - Transfiere la orden activa completa de la Mesa A a la Mesa B.
   - La Mesa A se reinicia a `libre` sin etiquetas residuales.
   - La Mesa B adquiere el estado, mesero, platillos y tiempos de espera de la Mesa A.

2. **Unir Mesas (`POST /api/mesas/unir`)**:
   - Agrupa la Mesa Secundaria dentro de la Mesa Principal.
   - Suma los totales y recalcula impuestos y servicio de forma consolidada.
   - Trazabilidad de platillos: marca los ítems transferidos con `origen_mesa_numero` y `origen_mesa_id` (ej. `[Mesa 8] Imperial`).
   - Almacena un snapshot de ambas mesas en la tabla `TableMerges` para permitir la separación exacta.

3. **Separar Mesas (`POST /api/mesas/separar`)**:
   - Restaura los platillos originales a la mesa secundaria.
   - **Manejo de conflicto si la mesa original está ocupada**: Si la mesa original fue tomada por otros comensales, el sistema solicita una mesa alternativa de destino disponible y restaura los ítems allí sin mezclar cuentas.

---

## 📁 Archivos Modificados
- `server.js`: Endpoints `/api/mesas/mover`, `/api/mesas/unir`, `/api/mesas/separar`.
- `public/app.js`: Interfaz interactiva de arrastrar y soltar (drag & drop) con tolerancia a jitter y pulsación larga, modal de selección de mesas unidas.
- `database.js`: Columnas `origen_mesa_numero`, `origen_mesa_id`, `unida_con`, `unida_a_mesa_id`, `TableMerges`.

---

## 🧪 Pruebas Automatizadas
- `test/e2e/tier1-features.test.js`: `T1.18` a `T1.21`.
- `test/e2e/tier4-scenarios.test.js`: `T4.3`, `T4.4`, `T4.5`.
- `test/e2e/tier5-occupied-split.test.js`: `T5.1` a `T5.4`.

