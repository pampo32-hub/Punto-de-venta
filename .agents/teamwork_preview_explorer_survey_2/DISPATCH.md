# Dispatch Assignment: Explorer Survey 2 - Business Logic: Comandas, KDS & Happy Hour

Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2
Workspace Directory: C:\Users\Juan\punto-de-venta
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md

## Objective
Survey the GastroBar Pro codebase to investigate specific business logic, data models, state stores, and calculation engines for:
1. Comandas & KDS (R1 & R2):
   - How are kitchen items vs non-kitchen items (food vs beverages/others) identified? Is there a category, department, or boolean flag?
   - How are orders/items sent to kitchen? How is sent status tracked (`sentToKitchen`, `pendingKitchen`, timestamps, etc.)?
   - How are KDS status updates dispatched? How do "listo" / ready states map to table states?
   - Where are table states defined (e.g. `libre`, `ocupada`, `esperando`, `activa`, color Azul, etc.)?
   - How are timestamps and elapsed wait time calculated? How are partial deliveries tracked when only some dishes are marked ready?
2. Happy Hour (R3):
   - Where is Happy Hour state stored and managed (time windows, days, manual toggles, active state)?
   - How are 2x1 promotions and percentage/amount discounts currently calculated? Why are they broken or inconsistent between menu, catalog, and ticket?
   - How does timer/auto-expiration work currently (or why is it missing)?

## Output Requirements
Write a comprehensive report to `C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2\analysis.md` and a self-contained `handoff.md`. Include exact line references, data schemas, calculation edge cases, and step-by-step implementation recommendations.

## 2026-09-03T09:22:48Z
You are Explorer 2 for the Survey phase of the GastroBar Pro project.
Working Directory: C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2
Workspace Directory: C:\Users\Juan\punto-de-venta
Task Assignment: Read C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2\DISPATCH.md
Original Request: Read C:\Users\Juan\punto-de-venta\.agents\ORIGINAL_REQUEST.md

Follow all instructions in DISPATCH.md and ORIGINAL_REQUEST.md.
Investigate business logic, data models, state stores, and calculation engines for:
1. Comandas & KDS (R1, R2): Food vs beverages classification, sentToKitchen tracking, KDS status transitions, wait times, partial deliveries, table states and colors.
2. Happy Hour (R3): Promotions, 2x1 calculation, pricing in catalog vs ticket, manual activation and auto-expiration timer logic.
Write your findings to C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2\analysis.md and write a complete handoff to C:\Users\Juan\punto-de-venta\.agents\teamwork_preview_explorer_survey_2\handoff.md.
Update your progress.md regularly. When finished, send a message to parent notifying that your report is ready.
