# Project: GastroBar Pro - Advanced Comandas, KDS, Happy Hour & Table Management

## Architecture
- **Tech Stack**: Node.js (v24.20.0), Express 5, SQLite3, Socket.IO, Vanilla JavaScript (ES6+), CSS3, HTML5.
- **Testing Engine**: Built-in `node:test` and `node:assert` runner (zero external dependencies, fast sub-second execution).
- **Client Components**:
  - Comandero & Order Engine (`public/app.js`, `public/index.html`): Manages active table, item additions, destination tagging (`cocina` vs `barra`), order submission.
  - Floor Map / Salón View (`public/app.js`, `public/styles.css`): Displays tables, status badges, hover/tap wait-time tooltips, pointer-events drag & drop engine.
  - KDS / Kitchen View (`public/app.js`, `public/index.html`): Kitchen display for order preparation and dispatch (`pendiente`, `preparando`, `listo`).
  - Happy Hour Engine (`public/app.js`, `public/styles.css`): Catalog 2x1 badges, ticket discount calculation, automated schedule auto-expiration timer.
- **Server Endpoints & Sockets**:
  - `server.js`: REST API and Socket.IO events for tables, orders, comandas, KDS, Happy Hour.
  - `database.js`: SQLite schema, migration scripts, and initial data seeding.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Dynamic Comanda Button | Button toggles between "🔥 Enviar a Cocina" and "💾 Guardar" based strictly on unsent kitchen items | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Comanda State Reset | Adding new food items after saving returns button to "🔥 Enviar a Cocina" | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Test Harness & Server Export | Refactor server.js for ephemeral test ports and configure `node:test` runner in package.json | M1 | Explorer 3 Survey |
| F4 | KDS Table State Transition | When all kitchen items are marked "Listo", table transitions to "activa" (Blue) | M2 | ORIGINAL_REQUEST §R2 |
| F5 | Elapsed Wait Time Tooltip | Table card hover/tap tooltip shows elapsed minutes since first comanda ("Esperando hace X min") | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Partial Delivery Tracking | When only part of dishes are ready, table transitions to "esperando_parcial" and tooltip lists ONLY pending dishes | M2 | ORIGINAL_REQUEST §R2 |
| F7 | Happy Hour Database & Catalog 2x1 | Seed happy_hour = 1 in database and render 2x1 promo badges in catalog | M3 | ORIGINAL_REQUEST §R3 |
| F8 | Happy Hour Pricing Calculation | Harmonize ticket and server 2x1 calculations using `p.happy_hour` flag | M3 | ORIGINAL_REQUEST §R3 |
| F9 | Happy Hour Auto-Expiration | Auto-deactivate Happy Hour when reaching scheduled end time without manual intervention | M3 | ORIGINAL_REQUEST §R3 |
| F10 | Pointer Drag & Drop (Mouse & Touch) | Long-press (>400ms) with 10px jitter tolerance to drag tables on floor map | M4 | ORIGINAL_REQUEST §R4 |
| F11 | Unir Mesas (Merge) with Confirmation | Drag onto occupied table shows confirmation "¿Deseas unir la Mesa X con la Mesa Y? [Sí] [No]" | M4 | ORIGINAL_REQUEST §R4 |
| F12 | Mover Mesa (Move) with Confirmation | Drag onto empty table shows confirmation "¿Deseas mover la Mesa X a la Mesa Y? [Sí] [No]" | M4 | ORIGINAL_REQUEST §R4 |
| F13 | Table Item Traceability | Items in merged table orders/tickets/bills display origin tag: `[Mesa X] Producto` | M4 | ORIGINAL_REQUEST §R4 |
| F14 | Separar Mesas (Undo Merge) | Long-press on merged table offers "Separar Mesas" restoring split accounts and consumptions intact | M4 | ORIGINAL_REQUEST §R4 |
| F15 | E2E Opaque-box Test Suite | Comprehensive 4-Tier test suite covering all features, boundaries, combinations, and workflows | E2E | ORIGINAL_REQUEST & Dual Track |
| F16 | Adversarial Hardening (Tier 5) | White-box stress testing, gap analysis, and edge case resilience | M5 | Project Pattern Phase 2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite Track | Design and implement complete 4-tier opaque-box test suite (Tiers 1-4) published to TEST_READY.md | none | DONE |
| M1 | Dynamic Comandas & Test Foundation | F1, F2, F3: Dynamic button toggle, unsent item tracking, and node:test infrastructure | none | DONE |
| M2 | KDS States, Partial Deliveries & Wait Tooltips | F4, F5, F6: KDS readiness dispatch, blue "activa" state, "esperando_parcial", and wait-time tooltip | M1 | DONE |
| M3 | Happy Hour Fixes & Auto-Expiration | F7, F8, F9: Database seeding, unified 2x1 pricing calculation, automated clock auto-expiration | none (independent) | IN_PROGRESS |
| M4 | Drag & Drop Table Move, Merge, Split & Traceability | F10, F11, F12, F13, F14: Pointer drag & drop, move/merge confirmations, item provenance tags, unmerge endpoint | M1 | PLANNED |
| M5 | Final Acceptance & Adversarial Hardening | Pass 100% E2E test suite (Tiers 1-4) + Tier 5 Challenger adversarial hardening | E2E, M1, M2, M3, M4 | PLANNED |
