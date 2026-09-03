# Dispatch Assignment: Explorer M1.1 - Frontend Dynamic Comandero Button (R1)

Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_1
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md
Master Plan: Read C:\Users\Juan\punto-de-venta\.agents\orchestrator_1\PROJECT.md

## Scope & Objective
Investigate the frontend Comandero button mechanics for Milestone 1 (R1):
1. How `actualizarBotonEnviarComanda()` in `public/app.js` interacts with `estado.mesaActiva.items`.
2. Ensure it strictly checks for unsent kitchen items: `!it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))`.
3. Verify button transitions when:
   - Initial state (empty table)
   - Only drinks are added -> "💾 Guardar"
   - Food is added -> "🔥 Enviar a Cocina"
   - Food is sent -> all items marked `enviado: true` -> button toggles to "💾 Guardar"
   - Table is reopened later and drinks are added -> stays "💾 Guardar"
   - Additional food item is added -> flips back to "🔥 Enviar a Cocina"
4. Verify click handling on `btnEnviarComandaCocina` in `public/app.js`: if only saving drinks, what message/toast is shown? Does it save without triggering "¡Comanda enviada a cocina!" toast?

Write your findings to `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_1\analysis.md` and complete `handoff.md`.
