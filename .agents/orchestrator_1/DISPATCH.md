## 2026-09-03T09:21:49Z

You are the Project Orchestrator for this task.

Working Directory: C:\Users\Juan\punto-de-venta\.agents\orchestrator_1
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md

Task summary:
Implementación de lógica avanzada de comandas, estados de cocina con entregas parciales y tiempos de espera, corrección y automatización de Happy Hour, y sistema interactivo de arrastrar para Mover, Unir y Separar mesas con trazabilidad por mesa en GastroBar Pro (Punto de Venta).

Requirements to implement and verify:
1. R1: Lógica Dinámica de Comandas ("Enviar a Cocina" vs "Guardar")
   - Botón solo dice "🔥 Enviar a Cocina" si existen ítems nuevos de alimentos/cocina no enviados aún a preparación.
   - Si solo se agregan bebidas u otros productos que no van a cocina, el botón dice "💾 Guardar".
   - Si posteriormente se agregan platillos pendientes de enviar a cocina, el botón vuelve a "🔥 Enviar a Cocina".

2. R2: Estados de KDS, Entregas Parciales y Tiempos de Espera
   - Cuando todas las comandas de cocina de una mesa se marquen como "Listas", la mesa pasa a estado Activa (color Azul).
   - Si la mesa tiene platillos en preparación: tooltip/indicador con el detalle de lo que espera y tiempo transcurrido desde la primera comanda (ej: "Esperando hace 12 min").
   - Si tenía múltiples platillos y cocina solo ha marcado listos una parte, estado "Esperando Parcial" y tooltip lista ÚNICAMENTE los platillos pendientes de entrega.

3. R3: Activación y Desactivación Inteligente de Happy Hour
   - Corregir la aplicación de Happy Hour (2x1 y descuentos) para que se refleje correctamente en precios y catálogo del menú y ticket.
   - Activación manual con un clic, pero si se alcanza la hora programada de fin de Happy Hour, auto-desactivar sin intervención manual.

4. R4: Mover, Unir y Separar Mesas mediante Drag & Drop (Gestos Táctiles y Ratón)
   - Mapa de salón: long-press / arrastre con ratón y pantallas táctiles.
   - Unir Mesas: arrastrar sobre mesa ocupada -> confirmación "¿Deseas unir la Mesa X con la Mesa Y? [Sí] [No]".
   - Mover Mesa: arrastrar sobre mesa vacía -> confirmación "¿Deseas mover la Mesa X a la Mesa Y? [Sí] [No]".
   - Separar Mesas (Deshacer): long-press sobre mesa unida muestra opción "Separar Mesas", restaurando cuentas y consumos separados a su estado previo.
   - Trazabilidad de ítems en cuenta unida: comanda, desglose y factura muestran claramente al lado de cada producto a qué mesa original pertenece (ej. `[Mesa 1] Hamburguesa`, `[Mesa 2] Corona`).

Acceptance Criteria:
Comandero & Flujo de Cocina:
- [ ] El botón conmuta entre `🔥 Enviar a Cocina` y `💾 Guardar` según la presencia de ítems de cocina no enviados.
- [ ] Al despachar el último platillo en el KDS, la mesa se actualiza a color Azul (`activa`).
- [ ] En mesas en espera, el hover/tooltip muestra el tiempo transcurrido y la lista exacta de platillos pendientes de despacho.
- [ ] Si se entregan platillos parcialmente, la mesa refleja estado parcial y el tooltip excluye los platillos ya entregados.
Happy Hour:
- [ ] Los precios y promociones 2x1 se calculan y aplican correctamente en el menú y ticket.
- [ ] Se puede activar manualmente y se auto-desactiva al cumplirse el horario límite.
Mover, Unir y Separar Mesas:
- [ ] Gesto de pulsación larga / arrastre funciona tanto con ratón como en pantallas táctiles.
- [ ] Soltar en mesa ocupada pide confirmación para Unir.
- [ ] Soltar en mesa vacía pide confirmación para Mover.
- [ ] Opción de Separar Mesas restaura cuentas separadas intactas.
- [ ] El ticket de mesas unidas etiqueta cada producto con su mesa de origen.
