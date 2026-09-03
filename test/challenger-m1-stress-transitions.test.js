const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function createClientEnvironment() {
  const appCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const elements = {};

  function getOrCreateEl(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        innerHTML: '',
        textContent: '',
        className: '',
        style: {},
        classList: {
          add: (cls) => {
            if (!elements[id].classList.contains(cls)) {
              elements[id].className = (elements[id].className + ' ' + cls).trim();
            }
          },
          remove: (cls) => {
            elements[id].className = elements[id].className.replace(new RegExp(`\\b${cls}\\b`, 'g'), '').trim();
          },
          contains: (cls) => elements[id].className.split(/\s+/).includes(cls)
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

  const mockWindow = {
    alert: () => {},
    confirm: () => true
  };

  const context = {
    window: mockWindow,
    document: mockDoc,
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    io: () => ({ on: () => {}, emit: () => {} }),
    alert: () => {},
    confirm: () => true,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    formatCRC: (v) => '₡ ' + v,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
  };

  const fn = new Function(
    ...Object.keys(context),
    appCode + '; return { estado, actualizarBotonEnviarComanda, renderTicketItems, modificarCantidadTicket: window.modificarCantidadTicket, agregarAlTicketOneTap: window.agregarAlTicketOneTap, solicitarAnulacionItem: window.solicitarAnulacionItem };'
  );
  const runtime = fn(...Object.values(context));

  runtime.estado.productos = [
    { id: 1, nombre: 'Imperial Regular', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
    { id: 2, nombre: 'Pilsen', precio: 1500, destino: 'barra', curso: 2, happyHour: 0 },
    { id: 3, nombre: 'Mojito Cubano', precio: 3500, destino: 'barra', curso: 2, happyHour: 1 },
    { id: 8, nombre: 'Chifrijo Tradicional', precio: 4500, destino: 'cocina', curso: 2, happyHour: 0 },
    { id: 9, nombre: 'Hamburguesa GastroBar', precio: 5200, destino: 'cocina', curso: 2, happyHour: 0 },
    { id: 10, nombre: 'Ceviche Mixto', precio: 4800, destino: 'cocina', curso: 1, happyHour: 0 }
  ];

  return { runtime, elements };
}

describe('Challenger 1 Stress Harness: Client Ticket State Transitions', () => {

  describe('Suite 1: Fundamental State Transitions (Add Food, Delete Food to 0, Add Drinks, Delete Drinks, Mixed)', () => {
    it('1.1: Add Food -> displays "🔥 Enviar a Cocina"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');

      runtime.agregarAlTicketOneTap(8); // Chifrijo (food)
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(btn.className, 'btn-btn-cmd cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 1);
    });

    it('1.2: Delete Food to 0 -> toggles to "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(8);
      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');

      runtime.modificarCantidadTicket(0, -1);
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 0);
    });

    it('1.3: Add Drinks -> displays "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Imperial (drink)
      runtime.agregarAlTicketOneTap(2); // Pilsen (drink)

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 2);
    });

    it('1.4: Delete Drinks to 0 -> displays "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1);
      runtime.modificarCantidadTicket(0, -1);

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 0);
    });

    it('1.5: Add Mixed (Food + Drinks) -> displays "🔥 Enviar a Cocina"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Drink
      runtime.agregarAlTicketOneTap(8); // Food

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(btn.className, 'btn-btn-cmd cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 2);
    });

    it('1.6: Delete Mixed: delete food leaving drinks -> displays "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Drink at idx 0
      runtime.agregarAlTicketOneTap(8); // Food at idx 1

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');

      runtime.modificarCantidadTicket(1, -1); // Remove food
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 1);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 1);
    });

    it('1.7: Delete Remaining Drinks to 0 -> displays "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Drink at idx 0
      runtime.agregarAlTicketOneTap(8); // Food at idx 1
      runtime.modificarCantidadTicket(1, -1); // Remove food -> Drink remains
      runtime.modificarCantidadTicket(0, -1); // Remove drink -> 0 items

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 0);
    });

    it('1.8: Add Mixed: delete drinks leaving food -> remains "🔥 Enviar a Cocina"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Drink at idx 0
      runtime.agregarAlTicketOneTap(8); // Food at idx 1

      runtime.modificarCantidadTicket(0, -1); // Remove drink

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(btn.className, 'btn-btn-cmd cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 1);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 1);
    });

    it('1.9: Delete remaining Food to 0 -> toggles to "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();

      runtime.agregarAlTicketOneTap(1); // Drink
      runtime.agregarAlTicketOneTap(8); // Food
      runtime.modificarCantidadTicket(0, -1); // Remove drink
      runtime.modificarCantidadTicket(0, -1); // Remove food

      const btn = elements['btnEnviarComandaCocina'];
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
    });
  });

  describe('Suite 2: Multi-Item and Sequential Decrement Scenarios', () => {
    it('2.1: Multi-food and multi-drink sequential elimination', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      // Add 3 drinks (ids 1, 2, 3) and 3 foods (ids 8, 9, 10)
      runtime.agregarAlTicketOneTap(1);
      runtime.agregarAlTicketOneTap(2);
      runtime.agregarAlTicketOneTap(3);
      assert.strictEqual(btn.innerHTML, '💾 Guardar');

      runtime.agregarAlTicketOneTap(8);
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      runtime.agregarAlTicketOneTap(9);
      runtime.agregarAlTicketOneTap(10);
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 6);

      // Now remove foods one by one:
      // Current items: [1, 2, 3, 8, 9, 10]
      runtime.modificarCantidadTicket(5, -1); // Remove 10 (food)
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 5);

      runtime.modificarCantidadTicket(4, -1); // Remove 9 (food)
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 4);

      runtime.modificarCantidadTicket(3, -1); // Remove 8 (food - last food)
      assert.strictEqual(btn.innerHTML, '💾 Guardar', 'With all foods removed, button MUST toggle to Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 3);

      // Now remove drinks one by one:
      // Current items: [1, 2, 3]
      runtime.modificarCantidadTicket(2, -1); // Remove 3 (drink)
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 2);

      runtime.modificarCantidadTicket(1, -1); // Remove 2 (drink)
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 1);

      runtime.modificarCantidadTicket(0, -1); // Remove 1 (drink - last drink)
      assert.strictEqual(btn.innerHTML, '💾 Guardar', 'With 0 items, button MUST be Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
    });

    it('2.2: Decrementing high-quantity item until zero', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      // Add single food item 5 times
      for (let i = 0; i < 5; i++) {
        runtime.agregarAlTicketOneTap(8);
      }
      assert.strictEqual(runtime.estado.mesaActiva.items[0].cantidad, 5);
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(elements['mobTicketCount'].textContent, 5);

      // Decrement from 5 down to 1
      for (let q = 5; q > 1; q--) {
        runtime.modificarCantidadTicket(0, -1);
        assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina', `At qty ${q-1}, should still be Cocina`);
        assert.strictEqual(elements['mobTicketCount'].textContent, q - 1);
      }

      // Final decrement from 1 to 0
      runtime.modificarCantidadTicket(0, -1);
      assert.strictEqual(btn.innerHTML, '💾 Guardar', 'At qty 0, should toggle to Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
      assert.strictEqual(elements['mobTicketCount'].textContent, 0);
      assert.strictEqual(runtime.estado.mesaActiva.items.length, 0);
    });
  });

  describe('Suite 3: Already Sent Items (enviado: true) & Incremental Rounds', () => {
    it('3.1: Table with only already-sent food items displays "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = {
        id: 1,
        numero: '1',
        estado: 'esperando',
        items: [
          { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 2, destino: 'cocina', curso: 2, enviado: true }
        ]
      };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
    });

    it('3.2: Adding unsent drinks to table with sent food keeps "💾 Guardar"', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = {
        id: 1,
        numero: '1',
        estado: 'esperando',
        items: [
          { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 2, destino: 'cocina', curso: 2, enviado: true }
        ]
      };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      runtime.agregarAlTicketOneTap(1); // Drink
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');

      runtime.modificarCantidadTicket(1, -1); // Delete unsent drink
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
    });

    it('3.3: Adding unsent food to table with sent food toggles to "🔥 Enviar a Cocina", then deleting toggles back', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = {
        id: 1,
        numero: '1',
        estado: 'esperando',
        items: [
          { id: 8, nombre: 'Chifrijo', precio: 4500, cantidad: 2, destino: 'cocina', curso: 2, enviado: true }
        ]
      };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      runtime.agregarAlTicketOneTap(9); // New Burger (unsent)
      assert.strictEqual(btn.innerHTML, '🔥 Enviar a Cocina');
      assert.strictEqual(btn.className, 'btn-btn-cmd cocina');

      runtime.modificarCantidadTicket(1, -1); // Delete new burger
      assert.strictEqual(btn.innerHTML, '💾 Guardar');
      assert.strictEqual(btn.className, 'btn-btn-cmd guardar');
    });
  });

  describe('Suite 4: Randomized Fuzzing Stress Harness (5,000 Invariant Checks)', () => {
    it('4.1: 5,000 random actions preserve button state and item counter invariants', () => {
      const { runtime, elements } = createClientEnvironment();
      runtime.estado.mesaActiva = { id: 1, numero: '1', items: [], estado: 'libre' };
      runtime.actualizarBotonEnviarComanda();
      const btn = elements['btnEnviarComandaCocina'];

      const foodIds = [8, 9, 10];
      const drinkIds = [1, 2, 3];

      let transitionsChecked = 0;

      for (let step = 0; step < 5000; step++) {
        const action = Math.floor(Math.random() * 8);

        if (action === 0) {
          // Add random food
          const fid = foodIds[Math.floor(Math.random() * foodIds.length)];
          runtime.agregarAlTicketOneTap(fid);
        } else if (action === 1) {
          // Add random drink
          const did = drinkIds[Math.floor(Math.random() * drinkIds.length)];
          runtime.agregarAlTicketOneTap(did);
        } else if (action === 2 && runtime.estado.mesaActiva.items.length > 0) {
          // Increment random item
          const idx = Math.floor(Math.random() * runtime.estado.mesaActiva.items.length);
          if (!runtime.estado.mesaActiva.items[idx].enviado) {
            runtime.modificarCantidadTicket(idx, 1);
          }
        } else if (action === 3 && runtime.estado.mesaActiva.items.length > 0) {
          // Decrement random item
          const idx = Math.floor(Math.random() * runtime.estado.mesaActiva.items.length);
          if (!runtime.estado.mesaActiva.items[idx].enviado) {
            runtime.modificarCantidadTicket(idx, -1);
          }
        } else if (action === 4 && runtime.estado.mesaActiva.items.length > 0) {
          // Send comanda (mark all as enviado: true)
          runtime.estado.mesaActiva.items.forEach(it => { it.enviado = true; });
          runtime.actualizarBotonEnviarComanda();
        } else if (action === 5) {
          // Clear table
          runtime.estado.mesaActiva.items = [];
          runtime.renderTicketItems();
        } else {
          // Add food or drink
          runtime.agregarAlTicketOneTap(foodIds[0]);
        }

        // --- INVARIANT VERIFICATION ---
        const items = runtime.estado.mesaActiva.items || [];
        const hasUnsentKitchen = items.some(it =>
          !it.enviado && (it.destino === 'cocina' || (it.curso && it.curso <= 3 && it.destino !== 'barra'))
        );

        const expectedLabel = hasUnsentKitchen ? '🔥 Enviar a Cocina' : '💾 Guardar';
        const expectedClass = hasUnsentKitchen ? 'btn-btn-cmd cocina' : 'btn-btn-cmd guardar';
        const expectedCount = items.reduce((sum, it) => sum + it.cantidad, 0);

        assert.strictEqual(
          btn.innerHTML,
          expectedLabel,
          `Step ${step}: Mismatch on button text! expected="${expectedLabel}", actual="${btn.innerHTML}", items=${JSON.stringify(items)}`
        );
        assert.strictEqual(
          btn.className,
          expectedClass,
          `Step ${step}: Mismatch on button class! expected="${expectedClass}", actual="${btn.className}"`
        );

        const actualCount = parseInt(elements['mobTicketCount'].textContent || '0', 10);
        assert.strictEqual(
          actualCount,
          expectedCount,
          `Step ${step}: Mismatch on mobTicketCount! expected=${expectedCount}, actual=${actualCount}`
        );

        transitionsChecked++;
      }

      assert.strictEqual(transitionsChecked, 5000);
    });
  });
});
