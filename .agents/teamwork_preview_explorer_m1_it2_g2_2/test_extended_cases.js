const fs = require('fs');
const path = require('path');
const assert = require('assert');

let appCode = fs.readFileSync('public/app.js', 'utf8');
const isCRLF = appCode.includes('\r\n');

let targetOld = `  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo con foto para agregarlo con 1 toque.</div>';
    recalcularTotalesTicket();
    return;
  }`;
if (isCRLF) targetOld = targetOld.replace(/\n/g, '\r\n');

let replacementNew = `  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    if (list) list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo con foto para agregarlo con 1 toque.</div>';
    recalcularTotalesTicket();
    actualizarBotonEnviarComanda();
    const mobCountEl = document.getElementById('mobTicketCount');
    if (mobCountEl) mobCountEl.textContent = 0;
    return;
  }`;
if (isCRLF) replacementNew = replacementNew.replace(/\n/g, '\r\n');

const patchedCode = appCode.replace(targetOld, replacementNew);

function createTestEnv() {
  const elements = {};
  function getOrCreateEl(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: '',
        textContent: '',
        className: '',
        style: {},
        value: '',
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false
        },
        addEventListener: () => {}
      };
    }
    return elements[id];
  }

  const mockDoc = {
    getElementById: (id) => getOrCreateEl(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  const mockWindow = { alert: () => {}, confirm: () => true };
  const context = {
    window: mockWindow,
    document: mockDoc,
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    io: () => ({ on: () => {}, emit: () => {} }),
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    formatCRC: (v) => 'CRC ' + v,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
  };

  const fn = new Function(
    ...Object.keys(context),
    patchedCode + '; return { estado, actualizarBotonEnviarComanda, renderTicketItems, modificarCantidadTicket: window.modificarCantidadTicket, agregarAlTicketOneTap: window.agregarAlTicketOneTap, solicitarAnulacionItem: window.solicitarAnulacionItem };'
  );
  const runtime = fn(...Object.values(context));

  runtime.estado.productos = [
    { id: 1, nombre: 'Imperial Regular', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
    { id: 2, nombre: 'Pilsen', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
    { id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, destino: 'cocina', curso: 2, happyHour: 0 },
    { id: 9, nombre: 'Hamburguesa GastroBar', precio: 5200, destino: 'cocina', curso: 2, happyHour: 0 }
  ];

  return { runtime, elements };
}

console.log("Testing extended edge cases on proposed fix...");

// Test Case 1: Quantity decrement to 0 on food item
{
  const { runtime, elements } = createTestEnv();
  runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
  runtime.actualizarBotonEnviarComanda();
  runtime.agregarAlTicketOneTap(8); // Food
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');
  assert.strictEqual(elements['mobTicketCount'].textContent, 1);

  runtime.modificarCantidadTicket(0, -1); // 0 items
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['btnEnviarComandaCocina'].className, 'btn-btn-cmd guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 0);
  console.log("✅ Case 1: Decrement food to 0 passed");
}

// Test Case 2: Multi-quantity food decremented step-by-step
{
  const { runtime, elements } = createTestEnv();
  runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
  runtime.actualizarBotonEnviarComanda();
  runtime.agregarAlTicketOneTap(8);
  runtime.agregarAlTicketOneTap(8); // Qty = 2
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');
  assert.strictEqual(elements['mobTicketCount'].textContent, 2);

  runtime.modificarCantidadTicket(0, -1); // Qty = 1
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');
  assert.strictEqual(elements['mobTicketCount'].textContent, 1);

  runtime.modificarCantidadTicket(0, -1); // Qty = 0 -> deleted
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 0);
  console.log("✅ Case 2: Multi-qty food step-by-step decrement passed");
}

// Test Case 3: Mixed items, delete food -> Guardar, delete bar -> Guardar (0 items)
{
  const { runtime, elements } = createTestEnv();
  runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
  runtime.actualizarBotonEnviarComanda();
  runtime.agregarAlTicketOneTap(1); // Bar
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  runtime.agregarAlTicketOneTap(8); // Food
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');

  runtime.modificarCantidadTicket(1, -1); // Delete food
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 1);

  runtime.modificarCantidadTicket(0, -1); // Delete bar
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 0);
  console.log("✅ Case 3: Mixed items sequential deletion to 0 passed");
}

// Test Case 4: Multiple food items deleted in reverse order
{
  const { runtime, elements } = createTestEnv();
  runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
  runtime.actualizarBotonEnviarComanda();
  runtime.agregarAlTicketOneTap(8); // Food 1
  runtime.agregarAlTicketOneTap(9); // Food 2
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');
  assert.strictEqual(elements['mobTicketCount'].textContent, 2);

  runtime.modificarCantidadTicket(0, -1); // Delete Food 1
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');
  assert.strictEqual(elements['mobTicketCount'].textContent, 1);

  runtime.modificarCantidadTicket(0, -1); // Delete Food 2
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 0);
  console.log("✅ Case 4: Multiple food items reverse deletion passed");
}

// Test Case 5: Table switch / reset
{
  const { runtime, elements } = createTestEnv();
  runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
  runtime.actualizarBotonEnviarComanda();
  runtime.agregarAlTicketOneTap(8);
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '🔥 Enviar a Cocina');

  // Switch to Mesa 2 (empty)
  runtime.estado.mesaActiva = { id: 2, numero: '2', items: [], estado: 'libre' };
  runtime.renderTicketItems();
  assert.strictEqual(elements['btnEnviarComandaCocina'].innerHTML, '💾 Guardar');
  assert.strictEqual(elements['mobTicketCount'].textContent, 0);
  console.log("✅ Case 5: Table switch to empty table passed");
}

console.log("\nALL EXTENDED EDGE CASE TESTS PASSED!");
