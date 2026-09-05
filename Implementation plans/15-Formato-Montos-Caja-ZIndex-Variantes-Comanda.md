# 15. Formato de Montos Enteros en Caja & Corrección de Capas Z-Index en Variantes de Comandero (2026)

## 📌 Resumen de la Solución
Se atendieron y resolvieron dos problemas críticos de visualización y experiencia de usuario en el POS:
1. **Formato de Montos en Caja y Moneda Nacional (₡ Colones)**: Los montos presentaban sufijos con dos decimales (`.00` / `,00`) que generaban confusión visual haciéndolos parecer millones cuando en realidad correspondían a miles (ej: ₡ 50,000.00 parecía 5,000,000). Se estandarizó la función `formatCRC` y los templates estáticos a enteros sin decimales (`minimumFractionDigits: 0, maximumFractionDigits: 0`).
2. **Submenús de Variantes de Casados y Arroces en Comandero**: Al hacer clic en "Solo Casado" o "Arroces Especiales" dentro de la comandera táctil, el modal `#modalSeleccionVariante` tenía `z-index: 99999` quedando oculto detrás del backdrop del comandero (`z-index: 100000`). Se elevó la jerarquía a `z-index: 100050`, permitiendo seleccionar casados y arroces directamente sobre la comanda abierta.
3. **Verificación Permanente de Login para Todos los Roles**: Se ejecutó la batería completa de pruebas E2E en navegador real garantizando el inicio de sesión exitoso de Admin POS, Salonero Carlos, Cajero y Developer Portal.

---

## 🛠️ Modificaciones Realizadas

### 1. `public/app.js` & `public/cliente.html`
- Modificada la función `formatCRC(num)` para redondear montos enteros con `Math.round()` y formatear en `es-CR` con `{ minimumFractionDigits: 0, maximumFractionDigits: 0 }`.

### 2. `public/index.html`
- Actualizado `#modalSeleccionVariante` con `style="z-index: 100050;"`.
- Actualizados submodales de comandero (`#modalPersonalizarBoton`, `#modalModificadores`, `#modalSplitQuickAdd`, `#modalAnulacion`, `#modalCobro`, `#modalSelectorPiso`, `#modalEditorElementoLive`) a `z-index: 100050`.
- Elevado modal de confirmación crítica `#modalConfirmacionAccion` a `z-index: 100100`.
- Eliminadas filas y botones duplicados en la vista de Caja y removidos los `.00` fijos en templates HTML.
- Actualizada etiqueta de cache-buster a `app.js?v=2.9.8`.

### 3. `public/sw.js`
- Actualizado caché estático a `pos-static-v19`.

### 4. `server.js`
- Protegida la inicialización asíncrona de `happyHourEstado` con `happyHourModificadoManualmente` para evitar race condition en tests automáticos.

---

## 📸 Evidencias
- `evidencia_variantes_1_casados.png`: Modal de casados desplegado sobre la comandera.
- `evidencia_variantes_2_arroces.png`: Modal de arroces especiales desplegado sobre la comandera.
- `evidencia_caja_sin_decimales.png`: Vista de caja limpia con montos enteros en colones.
