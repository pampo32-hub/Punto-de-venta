# Dispatch Assignment: Explorer Survey 3 - Testing Infrastructure & Table Management (R4)

Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md

## Objective
Survey the GastroBar Pro codebase to investigate:
1. Testing Infrastructure & Suite:
   - What test runner/framework is used (Vitest, Jest, Playwright, Cypress, etc.)?
   - What are the package.json scripts for building and testing (`npm test`, `npm run build`, etc.)?
   - What existing tests exist in the project, what do they cover, and how are they run?
   - How can we run new unit and E2E/integration tests reliably in this environment?
2. Table Drag & Drop, Merge, Move, Split & Traceability (R4):
   - How are tables modeled in state (id, number, status, orders, items, bill, merged tables)?
   - How does table moving or merging work currently (if any exists)?
   - How can drag & drop with long-press support both mouse and touch events cleanly?
   - How to track item provenance (which original table an item belongs to) when tables are merged?
   - How are bills/tickets/breakdowns formatted and printed/displayed, and where to inject `[Mesa X]` tags?
   - How to cleanly support "Separar Mesas" (undo merge) to restore split accounts/consumptions intact?

## Output Requirements
Write a comprehensive report to `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3\analysis.md` and a self-contained `handoff.md`. Include exact test commands, schema proposals for table merging/traceability, event handling strategies for touch/mouse drag & drop, and verification methods.

## 2026-09-03T09:22:48Z
You are Explorer 3 for the Survey phase of the GastroBar Pro project.
Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3
Workspace Directory: C:\Users\Juan\punto-de-venta
Task Assignment: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3\DISPATCH.md
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md

Follow all instructions in DISPATCH.md and ORIGINAL_REQUEST.md.
Investigate:
1. Testing infrastructure, runners, npm test/build scripts, existing test files, and how to set up robust unit and E2E tests for the requirements.
2. Table Management (R4): State modeling of tables, drag & drop (mouse + touch long-press), confirm dialogs for move vs merge, undo/split tables functionality, and per-item origin table traceability in orders/tickets/bills.
Write your findings to C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3\analysis.md and write a complete handoff to C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_3\handoff.md.
Update your progress.md regularly. When finished, send a message to parent notifying that your report is ready.
