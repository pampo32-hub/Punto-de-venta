# Plan de Implementación: Personalizador Total & Editor Visual en Vivo

**Estado:** ✅ Implementado y Verificado  
**Commit:** `5dd4683`  
**Fecha:** Septiembre 2026  

---

## 🎯 Objetivo
Proporcionar a los administradores y desarrolladores la capacidad de personalizar visualmente el 100% de la interfaz del Punto de Venta directamente en vivo mediante un inspector visual (hacer clic en cualquier elemento, cambiar textos, colores, tipografía, bordes, rellenos, gradientes CSS complejos) y persistir los cambios por local comercial en SQLite.

---

## 🛠️ Arquitectura de la Solución

1. **Inspector Visual en Vivo (`#liveInspectorPanel`)**:
   - Permite seleccionar cualquier botón, barra, tarjeta o texto en la pantalla con un halo azul y overlay guía.
   - Selector único generado inteligentemente ignorando modales internos del sistema.
2. **Soporte Completo de Gradientes y Estilos Inline**:
   - Si el usuario introduce un gradiente (ej. `linear-gradient(...)`), se aplica a la propiedad `background` con `!important` y se limpia `background-image` para evitar que el CSS base lo anule.
3. **Inyección en `<head>` (`<style id="dynamicCustomStyles">`)**:
   - Para elementos que se destruyen y re-renderizan dinámicamente en el DOM (como tarjetas de mesas, filtros de zonas, tabs del menú), los estilos se inyectan como reglas CSS globales en el `<head>`, sobreviviendo a re-renderizados sin perderse.
4. **Persistencia por Negocio / Comercio**:
   - Cada local guarda su configuración en SQLite (`ConfiguracionVisual` / `ConfigNegocio`).

---

## 📁 Archivos Modificados
- `public/app.js`: Lógica de inspección, generación de selectores únicos (`obtenerSelectorUnico`), aplicación al DOM (`aplicarPersonalizacionAlDOM`) e inyección en `<head>`.
- `public/index.html`: Modal de inspector visual en vivo con controles de fondo, color de texto, tamaño de fuente, radio de borde, padding y CSS personalizado.
- `public/styles.css`: Estilos para el inspector flotante, halo de selección y badges de edición.
- `server.js`: Endpoints `GET /api/personalizacion/:negocioId` y `POST /api/personalizacion/:negocioId`.
