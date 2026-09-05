# Walkthrough: Buscador Inteligente, Homologación de Categorías y Auto-conversión a Insumo con Similitud ≥ 95%

**Módulo:** Catálogo de Productos y Entrada de Mercadería  
**Fecha:** Septiembre 2026  
**Commit:** `fd360bf`  

---

## 1. Resumen de la Implementación
Se optimizó el flujo de abastecimiento y catálogo comercial incorporando un buscador en tiempo real en entradas de mercadería, sincronización de categorías oficiales y la creación automática de insumos en Kárdex al dar de alta un producto comercial, respaldada por un algoritmo de detección de similitud al 95%.

---

## 2. Componentes Clave

### A. Buscador Inteligente en Entrada de Mercadería
- Campo `#txtBuscarInsumoAjuste` con botón de limpieza inmediata `✕`.
- Filtrado al vuelo por nombre, categoría y unidad de medida.
- Muestra el stock actual y la categoría del insumo seleccionado, adaptando la unidad dinámicamente.

### B. Homologación de Categorías en Insumos
- El selector `#selectNuevoInsumoCat` carga dinámicamente las categorías oficiales del menú comercial (`estado.categorias`) con sus iconos representativos.
- Incluye la opción rápida `➕ + Nueva Categoría...` con campo desplegable.

### C. Auto-Conversión de Producto a Insumo en Kárdex
- Casilla interactiva `✨ Convertir automáticamente en Insumo en Kárdex (si no existe aún)`.
- Configuración de Unidad de Medida, Stock Inicial y Costo Unitario.
- Registra el insumo en bodega mediante `POST /api/admin/inventario` y vincula el producto como descuento 1 a 1 (`unidad`) de forma inmediata.

### D. Detección Inteligente de Similitud al 95%
- Algoritmo difuso que combina distancia Levenshtein y coeficiente de Dice sobre bigramas.
- Alerta interactiva ámbar con opciones para usar insumo existente o continuar creando uno independiente.

---

## 3. Pruebas y Cobertura
- Suite **Tier 10** en `test/e2e/tier10-insumo-conversion-similitud.test.js` aprobada al 100%.
