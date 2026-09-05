# 📚 Registro de Planes de Implementación y Walkthroughs — GastroBar POS

Esta carpeta contiene la documentación técnica completa, diagramas de arquitectura, planes de implementación y guías de recorrido (*walkthroughs*) de todos los módulos del sistema GastroBar POS:

---

## 📑 Índice de Planes de Implementación

| # | Documento | Área | Descripción Principal | Estado |
| :-: | :--- | :--- | :--- | :-: |
| **01** | [**01-Arquitectura-Offline-First.md**](./01-Arquitectura-Offline-First.md) | Conectividad / PWA | Resistencia total a caídas de internet con Service Worker, IndexedDB, Cola Outbox, sincronización en lote e idempotencia. | ✅ Listo |
| **02** | [**02-Temporizador-QR-Solicitud-Mesero.md**](./02-Temporizador-QR-Solicitud-Mesero.md) | Experiencia Móvil QR | Temporizador de 2 minutos, modo gray out y reactivación cíclica para solicitar la cuenta por QR. | ✅ Listo |
| **03** | [**03-Personalizador-Total-Editor-Visual.md**](./03-Personalizador-Total-Editor-Visual.md) | Consola SaaS / UI | Inspector visual en vivo, edición de estilos, soporte de gradientes CSS e inyección dinámica en `<head>`. | ✅ Listo |
| **04** | [**04-Mover-Unir-Separar-Mesas-Trazabilidad.md**](./04-Mover-Unir-Separar-Mesas-Trazabilidad.md) | Salón y Mesas | Reorganización de mesas, unión con trazabilidad de platillos (`[Mesa X]`) y separación con mesa alternativa. | ✅ Listo |
| **05** | [**05-KDS-Cocina-Comandas-Dinamicas.md**](./05-KDS-Cocina-Comandas-Dinamicas.md) | Cocina / KDS | Botón dinámico (*Enviar a Cocina* vs *Guardar*), estados de espera (`esperando_parcial`, `activa`) y tooltips. | ✅ Listo |
| **06** | [**06-Happy-Hour-Precios-2x1.md**](./06-Happy-Hour-Precios-2x1.md) | Facturación y Precios | Promociones 2x1 automatizadas con fórmula para cantidades impares y auto-expiración programada. | ✅ Listo |
| **07** | [**07-Arquitectura-Modular-SaaS-Licenciamiento.md**](./07-Arquitectura-Modular-SaaS-Licenciamiento.md) | SaaS & Licencias | Control granular de 11 módulos comerciales, planes por negocio y activación/desactivación dinámica. | ✅ Listo |
| **08** | [**08-Inventario-Recetas-Escandallos-Kardex.md**](./08-Inventario-Recetas-Escandallos-Kardex.md) | Inventario & Escandallos | Costeo con mermas, Food Cost %, Margen Bruto %, rendimiento de porciones y sugerencia de compras. | ✅ Listo |
| **09** | [**09-Control-Licores-Botellas-Shots.md**](./09-Control-Licores-Botellas-Shots.md) | Barra & Licores | Control dual de botellas y shots configurables (750ml, 1L, Magnum; shots 30ml, 45ml) con deducción fraccional. | ✅ Listo |
| **10** | [**10-Auto-Conversion-Insumo-Similitud-95.md**](./10-Auto-Conversion-Insumo-Similitud-95.md) | Inventario & Catálogo | Creación simultánea de producto e insumo en Kárdex con alerta inteligente de similitud difusa $\ge 95\%$. | ✅ Listo |
| **11** | [**11-Happy-Hour-Permanencia-Descuentos.md**](./11-Happy-Hour-Permanencia-Descuentos.md) | Facturación & Promos | Congelación de precios y persistencia de descuentos Happy Hour al cobrar mesas que excedieron el horario. | ✅ Listo |
| **12** | [**12-Cobro-Directo-Comanda-Kardex-Liberacion.md**](./12-Cobro-Directo-Comanda-Kardex-Liberacion.md) | Cobro Express | Cobro atómico directo desde el comandero con descuento automático en Kárdex y liberación inmediata de mesa. | ✅ Listo |
| **13** | [**13-Ventas-Productos-Periodo-Buscador-Kardex.md**](./13-Ventas-Productos-Periodo-Buscador-Kardex.md) | Ventas & Kárdex | Reporte de ventas por período, buscador predictivo, desglose de insumos de escandallo y exportación CSV/PDF. | ✅ Listo |

---

## 📖 Guías de Recorrido Visual (Walkthroughs)

- [**Walkthrough-Ventas-Productos-Periodo.md**](./Walkthrough-Ventas-Productos-Periodo.md): Recorrido detallado del panel de Ventas & Rendimiento en Inventario.
- [**Walkthrough-Auto-Conversion-Similitud-95.md**](./Walkthrough-Auto-Conversion-Similitud-95.md): Recorrido del buscador en entradas y auto-conversión a insumo.
- [**Walkthrough-Cobro-Directo-Kardex.md**](./Walkthrough-Cobro-Directo-Kardex.md): Recorrido del flujo de cobro directo express.

---

## 🧪 Validación y Pruebas Automatizadas
Todas las implementaciones cuentan con pruebas unitarias y E2E integradas:
```bash
npm test
```
**Resultado actual:** **119 pruebas ejecutadas y aprobadas al 100% en 25 suites.**
