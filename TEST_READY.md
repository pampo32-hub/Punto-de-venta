# TEST READY: GastroBar Pro E2E Test Suite (Tiers 1 - 4)

## 1. Executive Summary

A comprehensive, opaque-box, requirement-driven End-to-End (E2E) testing suite has been established for **GastroBar Pro**, covering all requirements from `ORIGINAL_REQUEST.md` and the master specification in `PROJECT.md`.

- **Total Test Cases**: **58 tests** (Exceeds required threshold of ≥55).
- **Execution Engine**: Node.js built-in `node:test` and `node:assert` (Zero dependencies, Node 24 compatible).
- **Pass Rate**: **100% (58 / 58 passing)**.
- **Execution Time**: ~3.1 seconds.
- **Test Infrastructure**: Ephemeral test server manager with port negotiation and database lifecycle management in `test/helpers/test-server.js`.

---

## 2. Command to Run

Execute the complete suite via npm:
```powershell
npm test
```
Or directly using Node's test runner:
```powershell
node --test --test-concurrency=1 test/e2e/*.test.js
```

To run individual test tiers:
```powershell
# Tier 1: Feature Coverage (21 tests)
node --test test/e2e/tier1-features.test.js

# Tier 2: Boundary & Corner Cases (20 tests)
node --test test/e2e/tier2-boundaries.test.js

# Tier 3: Cross-Feature Combinations (11 tests)
node --test test/e2e/tier3-combinations.test.js

# Tier 4: Real-World Scenarios (6 tests)
node --test test/e2e/tier4-scenarios.test.js
```

---

## 3. Coverage Inventory by Tier

| Tier | Description | Target | Implemented | Passing | File Path |
|------|-------------|:------:|:-----------:|:-------:|-----------|
| **Tier 1** | Primary Feature Coverage (R1 - R4) | ≥20 | **21** | 21/21 | `test/e2e/tier1-features.test.js` |
| **Tier 2** | Boundary, Error & Stress Testing | ≥20 | **20** | 20/20 | `test/e2e/tier2-boundaries.test.js` |
| **Tier 3** | Cross-Feature Combinations & Pairwise | ≥10 | **11** | 11/11 | `test/e2e/tier3-combinations.test.js` |
| **Tier 4** | Real-World Restaurant Workloads | ≥5 | **6** | 6/6 | `test/e2e/tier4-scenarios.test.js` |
| **Total** | Full E2E Test Suite | **≥55** | **58** | **58/58 (100%)** | |

---

## 4. Feature Mapping Matrix

### Feature 1 (R1): Lógica Dinámica de Comandas ("Enviar a Cocina" vs "Guardar")
- **T1.1**: Displays `"🔥 Enviar a Cocina"` when unsent kitchen food items are present (`tieneNuevosCocina = true`).
- **T1.2**: Displays `"💾 Guardar"` when order contains exclusively bar/beverage items.
- **T1.3**: Switches to `"💾 Guardar"` on already sent food tables when only drinks are added.
- **T1.4**: Switches back to `"🔥 Enviar a Cocina"` when new kitchen food items are added to active table.
- **T1.5**: `POST /api/comandas/enviar` creates order and transitions table to `'esperando'`.
- **T1.6**: `POST /api/comandas/enviar` saves bar items without errors.
- **T2.1**: Rejects empty items array with `400 Bad Request`.
- **T2.2**: Items with quantity 0 or missing are handled cleanly.
- **T2.3**: Order where 100% of items are already sent evaluates to `"💾 Guardar"`.
- **T2.4**: Mixed course items (curso 1 entrada, curso 2 fuerte, curso 4 postre) correctly identify kitchen destination.
- **T2.5**: Rapid consecutive comanda submissions append to existing active order without duplicate order creation.

### Feature 2 (R2): Estados de KDS, Entregas Parciales y Tiempos de Espera
- **T1.7**: Table evaluates to `'esperando'` when all kitchen items are pending/preparing.
- **T1.8**: Table evaluates to `'esperando_parcial'` when part of dishes are ready and others pending.
- **T1.9**: Table evaluates to `'activa'` (Blue) when 100% of kitchen dishes are marked `'listo'`.
- **T1.10**: Wait tooltip calculates elapsed minutes from `primera_comanda_hora` (`⏱️ Esperando hace X min`).
- **T1.11**: Wait tooltip lists exclusively pending dishes, omitting completed items.
- **T1.12**: `POST /api/kds/:detalleId/estado` updates dish state and records `hora_listo`.
- **T2.6**: Table with only bar items evaluates to `'abierta'`, never `'esperando'`.
- **T2.7**: Single kitchen item tables transition directly from `'esperando'` to `'activa'`.
- **T2.8**: Out-of-order KDS dispatch maintains strictly accurate pending items list.
- **T2.9**: Wait time boundary: 0 minutes elapsed formats cleanly as `"⏱️ Esperando hace 0 min"`.
- **T2.10**: Multiple kitchen orders at different times calculate wait time from the earliest order.

### Feature 3 (R3): Happy Hour Pricing & Auto-Expiration
- **T1.13**: Database flags: participating beers and cocktails have `happy_hour = 1`; food items have `0`.
- **T1.14**: 2x1 promotional pricing applies 1 free item per 2 units on promo products.
- **T1.15**: Non-participating food items receive 0 discount even when Happy Hour is active.
- **T1.16**: Inactive Happy Hour ignores 2x1 promo even on eligible beverages.
- **T1.17**: Auto-expiration triggers automatically when clock reaches scheduled end time (`hora_fin`).
- **T2.11**: Odd quantity promo purchases: 1=0 free, 3=1 free, 5=2 free, 7=3 free, 9=4 free.
- **T2.12**: Strict boundary comparison: `18:59:59` is active, `19:00:00` is expired.
- **T2.13**: High-volume mixed orders (10 products) compute penny-accurate subtotal, discounts, service, and IVA.
- **T2.14**: Quantity 0 items produce 0 discount without calculation errors.
- **T2.15**: Complimentary items (price 0) under Happy Hour produce 0 discount and 0 total.

### Feature 4 (R4): Mover, Unir, Separar Mesas y Trazabilidad de Ítems
- **T1.18**: `POST /api/mesas/mover` transfers active order to vacant table and frees origin table.
- **T1.19**: `POST /api/mesas/unir` merges two occupied tables and recalculates combined total.
- **T1.20**: Item origin formatting tags secondary table items as `[Mesa X] Producto`.
- **T1.21**: Pointer gesture thresholds: click (<400ms), drag activation (>400ms with <=10px jitter).
- **T2.16**: Move table fails with `400` when origin table has no active order.
- **T2.17**: Move table fails with `404` when destination table does not exist.
- **T2.18**: Merge tables fails with `400` when either table lacks an active order.
- **T2.19**: Self-merge requests (`mesaPrincipalId === mesaSecundariaId`) are rejected.
- **T2.20**: High-volume merges (25+ items) preserve 100% item origin provenance.

---

## 5. Tier 3: Cross-Feature Interactions
- **T3.1**: Happy Hour discounts combined with table merges.
- **T3.2**: Partial KDS delivery on merged tables with origin-tagged pending dishes.
- **T3.3**: Separating tables after partial kitchen dispatch restores one table as `'activa'` and other as `'esperando'`.
- **T3.4**: Dynamic comanda button toggles correctly after table migration.
- **T3.5**: Happy Hour auto-expiration occurs while table is in `'esperando_parcial'` without affecting kitchen status.
- **T3.6**: Merging an `'activa'` table with an `'esperando'` table evaluates unified table to `'esperando_parcial'`.
- **T3.7**: Adding only drinks to an `'esperando_parcial'` table keeps button as `"💾 Guardar"` and tooltip clean.
- **T3.8**: Moving an `'esperando_parcial'` table preserves pending kitchen items and elapsed wait timer.
- **T3.9**: Payment and table clearance of a merged table with Happy Hour discounts.
- **T3.10**: Undo separation after new items added to primary table: new items stay with primary table.
- **T3.11**: Merging two tables with 1 Happy Hour beer each creates an even pair for 2x1 savings.

---

## 6. Tier 4: Real-World Scenarios
- **T4.1 (Scenario 1)**: Full Dining Lifecycle: Initial drinks (`"💾 Guardar"`) -> Food order (`"🔥 Enviar a Cocina"`, table `'esperando'`) -> Kitchen completes appetizer (`'esperando_parcial'`, tooltip lists entree) -> Kitchen completes entree (table `'activa'`) -> Payment & clearance (`'libre'`).
- **T4.2 (Scenario 2)**: Happy Hour Transition: Drinks ordered at 18:45 (2x1 applied) -> Clock reaches 19:00 (HH auto-expires) -> Drinks ordered at 19:10 (full price) -> Grand total accurately combines promotional and full-price drinks.
- **T4.3 (Scenario 3)**: Table Migration: Table 10 guest orders food & drinks -> Moves to terrace Table 11 -> Table 10 immediately freed -> Table 11 inherits order, wait timer, and kitchen status.
- **T4.4 (Scenario 4)**: Large Group Merge & Origin Provenance: Table 9 (2 guests) and Table 11 (4 guests) merge -> Ticket displays `[Mesa 2]` for Table 11 items and clean names for Table 9 items -> Combined payment clears both tables.
- **T4.5 (Scenario 5)**: Merge Error & Undo Separation: Accidental merge between two tables -> "Separar Mesas" executed -> Both orders, item lines, and tables restored intact.
- **T4.6 (Scenario 6)**: Multi-Course Gourmet Dinner with Refills: Course 1 appetizers -> Drink refill (`"💾 Guardar"`) -> Course 2 entrees (`"🔥 Enviar a Cocina"`) -> Tip and payment calculation.

---

## 7. Artifact Index

- `test/helpers/test-server.js`: Ephemeral server, port allocator, database reset, and contract evaluators.
- `test/e2e/tier1-features.test.js`: Tier 1 Feature Coverage (21 tests).
- `test/e2e/tier2-boundaries.test.js`: Tier 2 Boundary & Corner Cases (20 tests).
- `test/e2e/tier3-combinations.test.js`: Tier 3 Cross-Feature Combinations (11 tests).
- `test/e2e/tier4-scenarios.test.js`: Tier 4 Real-World Workload Scenarios (6 tests).
- `package.json`: Configured with `"test": "node --test --test-concurrency=1 test/e2e/*.test.js"`.
- `TEST_READY.md`: This file.
