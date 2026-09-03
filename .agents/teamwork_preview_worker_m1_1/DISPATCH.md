# Dispatch Assignment: Worker M1 - Dynamic Comandas & Server Test Export

Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_worker_m1_1
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md
Master Project Plan: Read C:\Users\Juan\punto-de-venta\.agents\orchestrator_1\PROJECT.md
Explorer Findings to implement:
- Frontend Button: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_1\handoff.md and analysis.md
- Backend Dispatch: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_2\handoff.md and analysis.md
- Test Infra & Export: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_m1_3\handoff.md and analysis.md

## Scope & File Ownership
You have exclusive write ownership of:
- `public/app.js` (Comandero button toggle and click handler)
- `public/styles.css` (`.btn-btn-cmd.guardar` styling and `.mesa-render-card.abierta`)
- `public/index.html` (initial button class and text)
- `server.js` (`POST /api/comandas/enviar` logic and `require.main === module` export of `{ app, server, io }`)
- `package.json` (`"test": "node --test"` script)

## Tasks to Implement
1. **Frontend Button (R1)**:
   - In `public/app.js`, update `actualizarBotonEnviarComanda()`:
     `const tieneNuevosCocina = estado.mesaActiva.items.some(it => !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra')));`
     Toggle button between `'🔥 Enviar a Cocina'` (class `'btn-btn-cmd cocina'`) and `'💾 Guardar'` (class `'btn-btn-cmd guardar'`).
   - In `public/app.js`, update `#btnEnviarComandaCocina` click handler: evaluate `tieneNuevosCocina`, only sound kitchen bell if `tieneNuevosCocina === true`, show alert `'🔔 ¡Comanda enviada a cocina!'` vs `'💾 ¡Comanda guardada con éxito!'`, mark items `enviado = true`, and call `actualizarBotonEnviarComanda()`.
   - In `public/styles.css`, add `.btn-btn-cmd.guardar { background: var(--primary); color: #fff; }` and `.mesa-render-card.abierta { border-color: var(--primary); }` (or similar active card style).
   - In `public/index.html`, set `<button class="btn-btn-cmd guardar" id="btnEnviarComandaCocina">💾 Guardar</button>`.

2. **Backend Comandas (R1)**:
   - In `server.js`, refactor `POST /api/comandas/enviar`:
     - Inspect unsent items (`!it.id_detalle_existente && !it.enviado`).
     - Check if any unsent item has `destino === 'cocina' || (it.destino !== 'barra' && it.curso <= 3)`.
     - If `tieneNuevosCocina === true`: update `Ordenes.estado = 'esperando'` and `Mesas.estado = 'esperando'`. Emit `io.emit('nueva_comanda', { mesaId, ordenId, comandas: comandasCocina })`.
     - If `tieneNuevosCocina === false`: if new order, set `Ordenes.estado = 'abierta'`, and if mesa was `'libre'`, set `Mesas.estado = 'abierta'`. If mesa already had an active state, keep it. Do NOT emit `nueva_comanda`.
     - Always emit `io.emit('mesa_actualizada', { mesaId, estado: nuevoEstadoMesa, total })`.

3. **Server Export & Test Script (F3)**:
   - In `server.js`, wrap `server.listen(PORT, ...)` with `if (require.main === module)` at EOF and export `module.exports = { app, server, io };`.
   - In `package.json`, add `"test": "node --test"` to `"scripts"`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
Before submitting your handoff, you must:
1. Run `node --test` or `npm.cmd test` and verify that tests execute without syntax errors.
2. Run a verification command:
   `node -e "const { app, server, io } = require('./server'); if (!app || !server || !io) throw new Error('Export failed'); if (server.listening) throw new Error('Should not listen on require()'); console.log('PASS: server export verified'); process.exit(0);"`
3. Document all commands executed and verified outputs in your `handoff.md`.

## 2026-09-03T09:36:03Z
You are Worker M1 for Milestone 1 of GastroBar Pro.
Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_worker_m1_1
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md
Master Plan: Read C:\Users\Juan\punto-de-venta\.agents\orchestrator_1\PROJECT.md
Task Assignment: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_worker_m1_1\DISPATCH.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement the changes per DISPATCH.md across public/app.js, public/styles.css, public/index.html, server.js, and package.json.
Run tests and server verification commands. Write your handoff to C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_worker_m1_1\handoff.md and notify parent when complete.
