# E2E Test Infra: GastroBar Pro

## Test Philosophy
- Opaque-box, requirement-driven. Derived from ORIGINAL_REQUEST.md.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing.
- Test runner: Built-in `node:test` and `node:assert` (compatible with Node 24, 0 dependencies).

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Dynamic Comandas ("Enviar a Cocina" vs "Guardar") | ORIGINAL_REQUEST §R1 | ≥5 | ≥5 | ✓ |
| 2 | KDS Table States, Partial Deliveries & Wait Tooltips | ORIGINAL_REQUEST §R2 | ≥5 | ≥5 | ✓ |
| 3 | Happy Hour Pricing & Auto-Expiration | ORIGINAL_REQUEST §R3 | ≥5 | ≥5 | ✓ |
| 4 | Table Drag & Drop, Move, Merge, Split & Traceability | ORIGINAL_REQUEST §R4 | ≥5 | ≥5 | ✓ |

## Test Architecture
- Test runner: `node --test`
- Test files directory: `test/e2e/`
- Test helper utilities: `test/helpers/test-server.js` (spins up server on port 0 with ephemeral DB/tables)
- Verification assertions: HTTP fetch API and Socket.IO client checks against real server responses and state transitions.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Full Dining Cycle: Drinks first, Food later, Partial delivery in KDS, Final comanda, Table to Blue 'activa' | F1, F2, F4, F5, F6 | High |
| 2 | Happy Hour Transition: Drinks ordered during HH (2x1 applied), clock advances past HH end, next drinks full price | F7, F8, F9 | Medium |
| 3 | Table Migration: Guest moves from Table 1 to vacant Table 3; orders and status follow seamlessly | F12 | Medium |
| 4 | Large Group Table Merge & Item Origin Verification: Table 2 merges into Table 4, tickets show [Mesa 2] and [Mesa 4] | F11, F13 | High |
| 5 | Merge Error & Undo Separation: Table 5 erroneously merged into Table 6; Separar Mesas called; both accounts restored intact | F11, F13, F14 | High |

## Coverage Thresholds
- Tier 1: ≥5 test cases per feature (≥20 test cases)
- Tier 2: ≥5 boundary/edge test cases per feature (≥20 test cases)
- Tier 3: Major feature interaction tests (≥10 test cases)
- Tier 4: ≥5 realistic end-to-end workload application scenarios
- **Total Minimum: ≥55 E2E test cases**
