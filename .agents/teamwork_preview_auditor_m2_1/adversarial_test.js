const assert = require('assert');
const { evaluarEstadoMesaKDS, formatearTooltipEspera, formatearNombreItemConOrigen } = require('../../server.js');

console.log('--- ADVERSARIAL STRESS TEST SUITE (AUDITOR M2) ---');

// 1. Empty kitchen items
assert.strictEqual(evaluarEstadoMesaKDS([]), 'abierta', 'Empty items array must return abierta');
console.log('✓ Invariant 1 Passed: Empty items -> abierta');

// 2. Only bar/drink items
assert.strictEqual(
  evaluarEstadoMesaKDS([
    { destino: 'barra', estado_comanda: 'pendiente' },
    { destino: 'barra', estado_comanda: 'listo' }
  ]),
  'abierta',
  'Bar-only items must return abierta'
);
console.log('✓ Invariant 2 Passed: Bar-only items -> abierta');

// 3. Kitchen items with cursos
assert.strictEqual(
  evaluarEstadoMesaKDS([
    { destino: null, curso: 1, estado_comanda: 'pendiente' }
  ]),
  'esperando',
  'Course <= 3 without destino should be treated as kitchen'
);
console.log('✓ Invariant 3 Passed: Inferred course kitchen item -> esperando');

// 4. All kitchen items anulados
assert.strictEqual(
  evaluarEstadoMesaKDS([
    { destino: 'cocina', estado_comanda: 'anulado' },
    { destino: 'cocina', estado_comanda: 'anulado' }
  ]),
  'abierta',
  'All cancelled items must return abierta'
);
console.log('✓ Invariant 4 Passed: All cancelled kitchen items -> abierta');

// 5. Some ready, some anulado, zero pending
assert.strictEqual(
  evaluarEstadoMesaKDS([
    { destino: 'cocina', estado_comanda: 'listo' },
    { destino: 'cocina', estado_comanda: 'anulado' }
  ]),
  'activa',
  'Ready dishes with cancelled dishes (0 pending) must return activa'
);
console.log('✓ Invariant 5 Passed: Ready + cancelled (0 pending) -> activa');

// 6. Partial ready: 1 listo, 1 preparando, 1 pendiente
assert.strictEqual(
  evaluarEstadoMesaKDS([
    { destino: 'cocina', estado_comanda: 'listo' },
    { destino: 'cocina', estado_comanda: 'preparando' },
    { destino: 'cocina', estado_comanda: 'pendiente' }
  ]),
  'esperando_parcial',
  'Mixed ready and in-prep must return esperando_parcial'
);
console.log('✓ Invariant 6 Passed: Mixed ready and preparing -> esperando_parcial');

// 7. Tooltip with future timestamp (clock skew defense)
const futureTime = new Date(Date.now() + 60000).toISOString();
const tooltipFuture = formatearTooltipEspera(futureTime, ['Chifrijo Tradicional']);
assert.strictEqual(tooltipFuture.minutos, 0, 'Clock skew forward must clamp to 0 minutes');
assert.strictEqual(tooltipFuture.titulo, '⏱️ Esperando hace 0 min');
console.log('✓ Invariant 7 Passed: Clock skew forward clamped to 0 min');

// 8. Tooltip formatting with 15 minutes
const pastTime = new Date(Date.now() - 15 * 60000).toISOString();
const tooltipPast = formatearTooltipEspera(pastTime, ['Hamburguesa', 'Rib Eye']);
assert.strictEqual(tooltipPast.minutos, 15);
assert.strictEqual(tooltipPast.titulo, '⏱️ Esperando hace 15 min');
assert.deepStrictEqual(tooltipPast.items, ['Hamburguesa', 'Rib Eye']);
assert.ok(tooltipPast.tooltipText.includes('• Hamburguesa'));
assert.ok(tooltipPast.tooltipText.includes('• Rib Eye'));
console.log('✓ Invariant 8 Passed: 15-min elapsed tooltip matches spec');

// 9. Provenance tag formatting
assert.strictEqual(
  formatearNombreItemConOrigen({ nombre_producto: 'Chifrijo', origen_mesa_numero: 3 }, 1),
  '[Mesa 3] Chifrijo',
  'Merged dish from Mesa 3 on Mesa 1 must include [Mesa 3] tag'
);
assert.strictEqual(
  formatearNombreItemConOrigen({ nombre_producto: 'Corona', origen_mesa_numero: 1 }, 1),
  'Corona',
  'Native dish on Mesa 1 must not include tag'
);
console.log('✓ Invariant 9 Passed: Provenance formatting');

console.log('ALL ADVERSARIAL AUDIT INVARIANTS SATISFIED!');
