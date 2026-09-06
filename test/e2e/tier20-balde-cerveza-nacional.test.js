const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-server');

describe('Tier 20: Detección de Ráfagas y Oferta de Balde de Cerveza Nacional 2026', () => {
  let server;
  let mockEstado = {};

  before(async () => {
    server = await startTestServer();
    mockEstado = {
      categorias: [
        { id: 1, nombre: 'Comidas Principales' },
        { id: 4, nombre: 'Cervezas' }
      ],
      productos: [
        { id: 1, nombre: 'Imperial Regular', precio: 1800, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 2, nombre: 'Pilsen', precio: 1800, categoria_id: 4, destino: 'barra', curso: 1 },
        { id: 10, nombre: 'Casado con Carne', precio: 4500, categoria_id: 1, destino: 'cocina', curso: 2 }
      ],
      mesaActiva: {
        id: 1,
        numero: 'Mesa 1',
        estado: 'libre',
        items: []
      }
    };
  });

  after(async () => {
    if (server) await server.stop();
  });

  beforeEach(async () => {
    await server.resetDb();
  });

  function req(endpoint, method = 'GET', body = null, headers = { 'x-user-rol': 'salonero' }) {
    return server.request(endpoint, { method, body, headers }).then(res => ({
      status: res.status,
      body: res.data
    }));
  }

  it('T20.1: Ráfaga rápida (< 1 minuto): 6 cervezas de la misma marca disparan la oferta y "Sí" las convierte en Balde de ₡7.500', async () => {
    mockEstado.mesaActiva = { id: 1, numero: 'Mesa 1', items: [] };
    const trackerRafaga = {};
    let modalInvocado = false;
    let mensajeModal = '';

    async function simularVerificarOferta(prodId, delta, confirmacionUsuario, nowTime) {
      const prod = mockEstado.productos.find(p => p.id === prodId);
      const trackerKey = `1_${prod.id}`;
      if (!trackerRafaga[trackerKey]) {
        trackerRafaga[trackerKey] = { count: 0, startTime: null };
      }
      const tr = trackerRafaga[trackerKey];
      if (tr.count === 0 || !tr.startTime) {
        tr.startTime = nowTime;
        tr.count = delta;
      } else {
        const elapsed = nowTime - tr.startTime;
        if (elapsed > 60000) {
          tr.startTime = nowTime;
          tr.count = delta;
        } else {
          tr.count += delta;
        }
      }

      if (tr.count >= 6) {
        const totalElapsed = nowTime - tr.startTime;
        if (totalElapsed <= 60000) {
          modalInvocado = true;
          mensajeModal = `Veo que agregaste 6 ${prod.nombre} rápidamente. ¿Deseas convertir en balde?`;
          if (confirmacionUsuario) {
            let restantes = 6;
            for (let i = mockEstado.mesaActiva.items.length - 1; i >= 0; i--) {
              const it = mockEstado.mesaActiva.items[i];
              if (it.id === prod.id && !it.enviado && !it.es_balde) {
                if (it.cantidad <= restantes) {
                  restantes -= it.cantidad;
                  mockEstado.mesaActiva.items.splice(i, 1);
                } else {
                  it.cantidad -= restantes;
                  restantes = 0;
                }
                if (restantes <= 0) break;
              }
            }
            mockEstado.mesaActiva.items.push({
              id: 'balde_' + prod.id,
              producto_id: prod.id,
              nombre: `Balde de ${prod.nombre} (6 unidades)`,
              precio: 7500,
              cantidad: 1,
              destino: 'barra',
              curso: 1,
              es_balde: true,
              enviado: false
            });
          }
        }
        tr.count = 0;
        tr.startTime = null;
      }
    }

    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      mockEstado.mesaActiva.items.push({
        id: 1,
        nombre: 'Imperial Regular',
        precio: 1800,
        cantidad: 1,
        enviado: false
      });
      await simularVerificarOferta(1, 1, true, t0 + (i * 800));
    }

    assert.equal(modalInvocado, true, 'El modal debe haberse disparado');
    assert.ok(mensajeModal.includes('Veo que agregaste 6 Imperial Regular rápidamente'), 'El mensaje debe contener el texto requerido');
    
    assert.equal(mockEstado.mesaActiva.items.length, 1);
    assert.equal(mockEstado.mesaActiva.items[0].nombre, 'Balde de Imperial Regular (6 unidades)');
    assert.equal(mockEstado.mesaActiva.items[0].precio, 7500);
    assert.equal(mockEstado.mesaActiva.items[0].es_balde, true);
  });

  it('T20.2: Ráfaga rápida (< 1 minuto): responder "No" mantiene las 6 cervezas a precio individual regular', async () => {
    mockEstado.mesaActiva = { id: 2, numero: 'Mesa 2', items: [] };
    const trackerRafaga = {};
    let modalInvocado = false;

    async function simularVerificarOferta(prodId, delta, confirmacionUsuario, nowTime) {
      const prod = mockEstado.productos.find(p => p.id === prodId);
      const trackerKey = `2_${prod.id}`;
      if (!trackerRafaga[trackerKey]) {
        trackerRafaga[trackerKey] = { count: 0, startTime: null };
      }
      const tr = trackerRafaga[trackerKey];
      if (tr.count === 0 || !tr.startTime) {
        tr.startTime = nowTime;
        tr.count = delta;
      } else {
        tr.count += delta;
      }

      if (tr.count >= 6) {
        const totalElapsed = nowTime - tr.startTime;
        if (totalElapsed <= 60000) {
          modalInvocado = true;
        }
        tr.count = 0;
        tr.startTime = null;
      }
    }

    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      mockEstado.mesaActiva.items.push({
        id: 2,
        nombre: 'Pilsen',
        precio: 1800,
        cantidad: 1,
        enviado: false
      });
      await simularVerificarOferta(2, 1, false, t0 + (i * 1000));
    }

    assert.equal(modalInvocado, true);
    assert.equal(mockEstado.mesaActiva.items.length, 6);
    const totalIndividual = mockEstado.mesaActiva.items.reduce((acc, it) => acc + it.precio, 0);
    assert.equal(totalIndividual, 6 * 1800);
  });

  it('T20.3: Adición espaciada (> 1 minuto): NO dispara la pregunta y mantiene cobro individual', async () => {
    mockEstado.mesaActiva = { id: 3, numero: 'Mesa 3', items: [] };
    const trackerRafaga = {};
    let modalInvocado = false;

    async function simularVerificarOferta(prodId, delta, nowTime) {
      const prod = mockEstado.productos.find(p => p.id === prodId);
      const trackerKey = `3_${prod.id}`;
      if (!trackerRafaga[trackerKey]) {
        trackerRafaga[trackerKey] = { count: 0, startTime: null };
      }
      const tr = trackerRafaga[trackerKey];
      if (tr.count === 0 || !tr.startTime) {
        tr.startTime = nowTime;
        tr.count = delta;
      } else {
        const elapsed = nowTime - tr.startTime;
        if (elapsed > 60000) {
          tr.startTime = nowTime;
          tr.count = delta;
        } else {
          tr.count += delta;
        }
      }

      if (tr.count >= 6) {
        const totalElapsed = nowTime - tr.startTime;
        if (totalElapsed <= 60000) {
          modalInvocado = true;
        }
        tr.count = 0;
        tr.startTime = null;
      }
    }

    const t0 = 1000000;
    await simularVerificarOferta(1, 1, t0);
    await simularVerificarOferta(1, 1, t0 + 70000);
    await simularVerificarOferta(1, 1, t0 + 75000);
    await simularVerificarOferta(1, 1, t0 + 80000);
    await simularVerificarOferta(1, 1, t0 + 85000);
    await simularVerificarOferta(1, 1, t0 + 90000);

    assert.equal(modalInvocado, false, 'No debe haberse disparado la pregunta');
  });

  it('T20.4: Reinicio de ciclo: tras completar un bloque de 6, el contador se reinicia para las siguientes adiciones', async () => {
    const trackerRafaga = {};
    let ciclosCompletados = 0;

    function agregarYMonitorear(prodId, delta, nowTime) {
      const trackerKey = `4_${prodId}`;
      if (!trackerRafaga[trackerKey]) {
        trackerRafaga[trackerKey] = { count: 0, startTime: null };
      }
      const tr = trackerRafaga[trackerKey];
      if (tr.count === 0 || !tr.startTime) {
        tr.startTime = nowTime;
        tr.count = delta;
      } else {
        tr.count += delta;
      }
      if (tr.count >= 6) {
        ciclosCompletados++;
        tr.count = 0;
        tr.startTime = null;
      }
    }

    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      agregarYMonitorear(1, 1, t0 + (i * 500));
    }
    assert.equal(ciclosCompletados, 1);
    assert.equal(trackerRafaga['4_1'].count, 0);

    for (let i = 0; i < 6; i++) {
      agregarYMonitorear(1, 1, t0 + 10000 + (i * 500));
    }
    assert.equal(ciclosCompletados, 2);
    assert.equal(trackerRafaga['4_1'].count, 0);
  });

  it('T20.5: Backend E2E: Enviar comanda con Balde de Cerveza almacena precio ₡7.500 y destino Barra', async () => {
    const comandaRes = await req('/api/comandas/enviar', 'POST', {
      mesaId: 1,
      mesero: 'Juan Mesero',
      items: [
        {
          producto_id: 1,
          nombre: 'Balde de Imperial Regular (6 unidades)',
          precio: 7500,
          cantidad: 1,
          notas: 'Balde promo 6 unidades',
          destino: 'barra',
          curso: 1
        }
      ]
    });

    assert.equal(comandaRes.status, 200);
    assert.ok(comandaRes.body.ordenId);

    const ordenRes = await req('/api/ordenes/mesa/1');
    assert.equal(ordenRes.status, 200);
    assert.equal(ordenRes.body.orden.total, 7500);
    const itemBalde = ordenRes.body.items.find(i => i.nombre_producto.includes('Balde de Imperial'));
    assert.ok(itemBalde, 'El ítem de Balde debe existir en la orden');
    assert.equal(itemBalde.precio_unitario, 7500);
    assert.equal(itemBalde.destino, 'barra');
  });

});
