# Plan de Implementación: KDS de Cocina, Estados de Mesa y Botón de Comanda Dinámico

**Estado:** ✅ Implementado y Verificado  
**Fecha:** Septiembre 2026  

---

## 🎯 Objetivo
Automatizar el flujo de comandas entre el salón, cocina y barra: detección inteligente de platillos nuevos vs ítems ya enviados, cambio dinámico del botón de acción en el comandero, cálculo de estados de mesa en tiempo real según el avance en cocina y visualización de tiempos de espera con tooltips detallados.

---

## ⚙️ Reglas de Negocio Implementadas

1. **Botón de Comanda Dinámico**:
   - Si la comanda tiene productos nuevos con destino `cocina`: el botón muestra `🔔 Enviar Comanda a Cocina`.
   - Si la orden solo contiene bebidas de barra o ítems que no requieren cocina (o todos los ítems de cocina ya fueron despachados): el botón cambia automáticamente a `💾 Guardar Comanda`.
2. **Estados Dinámicos de Mesa en KDS**:
   - `esperando` (Naranja): Todos los platillos de cocina están en preparación/pendientes.
   - `esperando_parcial` (Amarillo): Algunos platillos de la mesa ya están listos pero aún faltan otros por salir.
   - `activa` (Azul): Todos los platillos de cocina de la orden fueron marcados como listos y entregados al comensal.
   - `abierta`: Mesa con consumo activo pero sin pedidos de cocina pendientes (ej. solo bebidas de barra).
3. **Tooltip de Espera en Vivo**:
   - Muestra los minutos transcurridos desde el pedido más antiguo (`⏱️ Esperando hace X min`).
   - Lista detalladamente los platillos que siguen pendientes, excluyendo los ya despachados.
4. **Enrutamiento por Cursos y Destinos**:
   - Entradas, platos fuertes y postres se enrutan a la pantalla KDS de cocina caliente o a la comanda térmica correspondiente.
   - Tragos, cócteles y cervezas se enrutan exclusivamente a la barra.

---

## 📁 Archivos Modificados
- `server.js`: Lógica en `ejecutarComanda`, `POST /api/comandas/enviar`, `POST /api/kds/:detalleId/estado`.
- `public/app.js`: Funciones `evaluarEstadoMesaKDS`, `formatearTooltipEspera`, `actualizarBotonEnviarComanda`.

---

## 🧪 Pruebas Automatizadas
- `test/e2e/tier1-features.test.js`: `T1.1` a `T1.12`.
- `test/e2e/tier2-boundaries.test.js`: `T2.1` a `T2.10`.
- `test/e2e/tier3-combinations.test.js`: `T3.2`, `T3.6`, `T3.7`.
