# Original User Request

## 2026-09-03T09:21:09Z

Implementación de lógica avanzada de comandas, estados de cocina con entregas parciales y tiempos de espera, corrección y automatización de Happy Hour, y sistema interactivo de arrastrar para Mover, Unir y Separar mesas con trazabilidad por mesa en GastroBar Pro (Punto de Venta).

Working directory: C:\Users\Juan\punto-de-venta
Integrity mode: development

## Requirements

### R1. Lógica Dinámica de Comandas ("Enviar a Cocina" vs "Guardar")
- El botón solo debe mostrar **"🔥 Enviar a Cocina"** si existen ítems nuevos de alimentos/cocina no enviados aún a preparación.
- Si en una mesa ya enviada solo se agregan bebidas u otros productos que no van a cocina, el botón debe decir **"💾 Guardar"**.
- Si posteriormente se agregan nuevos platillos de comida pendientes de enviar a cocina, el botón debe volver a cambiar a **"🔥 Enviar a Cocina"**.

### R2. Estados de KDS, Entregas Parciales y Tiempos de Espera
- Cuando todas las comandas de cocina de una mesa se marquen como "Listas", la mesa debe pasar a estado **Activa (color Azul)** (indicando que los clientes ya tienen toda su comida).
- Si la mesa tiene platillos en preparación:
  - Al pasar el mouse encima (o tap en táctil) debe mostrar un tooltip/indicador con el detalle de lo que está esperando y el **tiempo transcurrido** desde que se envió la primera comanda (ej: *"Esperando hace 12 min"*).
  - Si la mesa tenía múltiples platillos (ej: 3) y cocina solo ha marcado listos una parte (ej: 2), la mesa debe mostrar estado **"Esperando Parcial"** y el tooltip debe listar **únicamente los platillos pendientes de entrega**.

### R3. Activación y Desactivación Inteligente de Happy Hour
- Corregir la aplicación de Happy Hour (2x1 y descuentos) para que se refleje correctamente en los precios y catálogo del menú y ticket.
- Permitir activación manual con un clic, pero si se alcanza la hora programada de fin de Happy Hour, el sistema debe desactivarlo automáticamente sin intervención manual.

### R4. Mover, Unir y Separar Mesas mediante Drag & Drop (Gestos Táctiles y Ratón)
- En el mapa del salón, al mantener presionado el clic o el dedo (long-press táctil) sobre una mesa, se activa el modo arrastrar.
- **Unir Mesas:** Si se arrastra y suelta sobre otra mesa que ya tiene cuenta (ocupada), debe mostrar un diálogo de confirmación: *"¿Deseas unir la Mesa X con la Mesa Y? [Sí] [No]"*.
- **Mover Mesa:** Si se arrastra y suelta sobre una mesa vacía, debe mostrar el diálogo: *"¿Deseas mover la Mesa X a la Mesa Y? [Sí] [No]"*.
- **Separar Mesas (Deshacer):** Si dos mesas fueron unidas por error, al mantener presionado sobre la mesa unida debe mostrar la opción de *"Separar Mesas"*, restaurando las cuentas y consumos separados a su estado original previo.
- **Trazabilidad de ítems en cuenta unida:** Cuando dos mesas están unidas, la comanda, desglose y factura deben mostrar claramente al lado de cada producto a qué mesa original pertenece (ej. `[Mesa 1] Hamburguesa`, `[Mesa 2] Corona`).

## Acceptance Criteria

### Comandero & Flujo de Cocina
- [ ] El botón conmuta entre `🔥 Enviar a Cocina` y `💾 Guardar` según la presencia de ítems de cocina no enviados.
- [ ] Al despachar el último platillo en el KDS, la mesa se actualiza a color Azul (`activa`).
- [ ] En mesas en espera, el hover/tooltip muestra el tiempo transcurrido y la lista exacta de platillos pendientes de despacho.
- [ ] Si se entregan platillos parcialmente, la mesa refleja estado parcial y el tooltip excluye los platillos ya entregados.

### Happy Hour
- [ ] Los precios y promociones 2x1 se calculan y aplican correctamente en el menú y ticket.
- [ ] Se puede activar manualmente y se auto-desactiva al cumplirse el horario límite.

### Mover, Unir y Separar Mesas
- [ ] Gesto de pulsación larga / arrastre funciona tanto con ratón como en pantallas táctiles.
- [ ] Soltar en mesa ocupada pide confirmación para Unir.
- [ ] Soltar en mesa vacía pide confirmación para Mover.
- [ ] Opción de Separar Mesas restaura cuentas separadas intactas.
- [ ] El ticket de mesas unidas etiqueta cada producto con su mesa de origen.
