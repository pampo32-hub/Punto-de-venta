const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const printerService = require('../../printerService');

describe('Tier 33: Reubicación de Botones (Piso del Salón y Agotados) y Desglose Exento de Servicio en Tickets Para Llevar', () => {

  it('1. HTML: Verifica que el botón "Piso del Salón" NO esté en salon-quick-tools y SOLO en Diseñar Salón', () => {
    const indexPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(indexPath, 'utf8');

    const quickToolsMatch = htmlContent.match(/<div class="salon-quick-tools">([\s\S]*?)<\/div>/);
    assert.ok(quickToolsMatch, 'Debe existir .salon-quick-tools');
    const quickToolsHtml = quickToolsMatch[1];

    assert.strictEqual(
      quickToolsHtml.includes('abrirModalSelectorPiso()'),
      false,
      'salon-quick-tools NO debe contener abrirModalSelectorPiso()'
    );
    assert.strictEqual(
      quickToolsHtml.includes('🎨 Piso del Salón'),
      false,
      'salon-quick-tools NO debe contener "🎨 Piso del Salón"'
    );

    const editorPlanoMatch = htmlContent.match(/<section id="view-editor-plano"[\s\S]*?<\/section>/);
    assert.ok(editorPlanoMatch, 'Debe existir section #view-editor-plano');
    assert.ok(
      editorPlanoMatch[0].includes('abrirModalSelectorPiso()'),
      'view-editor-plano SI debe contener abrirModalSelectorPiso()'
    );
  });

  it('2. HTML: Verifica que el botón "Lista Agotados (86)" NO esté en salon-quick-tools y esté en Control de Inventarios y Panel Admin', () => {
    const indexPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(indexPath, 'utf8');

    const quickToolsMatch = htmlContent.match(/<div class="salon-quick-tools">([\s\S]*?)<\/div>/);
    const quickToolsHtml = quickToolsMatch[1];

    assert.strictEqual(
      quickToolsHtml.includes('btnGestionarAgotados'),
      false,
      'salon-quick-tools NO debe contener btnGestionarAgotados'
    );
    assert.strictEqual(
      quickToolsHtml.includes('Lista Agotados (86)'),
      false,
      'salon-quick-tools NO debe contener Lista Agotados (86)'
    );

    const invMatch = htmlContent.match(/<section id="view-inventario"[\s\S]*?<\/section>/);
    assert.ok(invMatch, 'Debe existir section #view-inventario');
    assert.ok(
      invMatch[0].includes('btnGestionarAgotados') || invMatch[0].includes('abrirModalAgotados()'),
      'view-inventario SI debe contener el acceso a Lista Agotados (86)'
    );

    const adminModalMatch = htmlContent.match(/<div class="modal-backdrop" id="modalPanelAdmin"[sS]*?<!-- Fin Panel Admin/);
    const adminHtml = adminModalMatch ? adminModalMatch[0] : htmlContent;
    assert.ok(
      adminHtml.includes('card-agotados') || adminHtml.includes('abrirModalAgotados()'),
      'modalPanelAdmin SI debe contener la tarjeta de Lista Agotados (86)'
    );
  });

  it('3. Public HTML: Verifica que public/index.html mantenga la misma estructura limpia', () => {
    const pubIndexPath = path.join(__dirname, '../../public/index.html');
    const pubHtmlContent = fs.readFileSync(pubIndexPath, 'utf8');

    const quickToolsMatch = pubHtmlContent.match(/<div class="salon-quick-tools">([\s\S]*?)<\/div>/);
    const quickToolsHtml = quickToolsMatch[1];

    assert.strictEqual(quickToolsHtml.includes('abrirModalSelectorPiso()'), false);
    assert.strictEqual(quickToolsHtml.includes('btnGestionarAgotados'), false);

    const invMatch = pubHtmlContent.match(/<section id="view-inventario"[\s\S]*?<\/section>/);
    assert.ok(invMatch[0].includes('abrirModalAgotados()'));

    const editorMatch = pubHtmlContent.match(/<section id="view-editor-plano"[\s\S]*?<\/section>/);
    assert.ok(editorMatch[0].includes('abrirModalSelectorPiso()'));
  });

  it('4. Tickets: generarTicketLiquidacion genera 0% de servicio y rotula EXENTO para pedidos Para Llevar', () => {
    const ordenParaLlevar = {
      numeroOrden: 'PL-501',
      tipo_orden: 'para_llevar',
      es_para_llevar: true,
      mesa: 'Para Llevar #101',
      cliente: 'Carlos Alvarado',
      items: [
        { nombre: 'Hamburguesa Artesanal', cantidad: 2, precio: 5000, subtotal: 10000 }
      ],
      subtotal: 10000,
      servicio: 0,
      iva: 1300,
      total: 11300,
      recibido: 12000,
      cambio: 700
    };

    const res = printerService.generarTicketLiquidacion(ordenParaLlevar, { nombre: 'GastroBar' });
    const ticketRaw = res.raw || res;
    assert.ok(ticketRaw, 'El ticket generado no debe estar vacío');
    assert.ok(
      ticketRaw.includes('Servicio (0% Para Llevar):') && ticketRaw.includes('EXENTO'),
      'El ticket debe mostrar Servicio (0% Para Llevar): EXENTO'
    );
    assert.strictEqual(
      ticketRaw.includes('10% Servicio (Ley):'),
      false,
      'No debe contener el cargo de 10% de Servicio en pedidos para llevar'
    );
    assert.strictEqual(res.ticketVisual?.servicio, 0, 'ticketVisual.servicio debe ser 0');
  });

  it('5. Tickets: generarTicketPreFactura genera 0% de servicio y rotula EXENTO para pedidos Para Llevar', () => {
    const prefacturaParaLlevar = {
      numeroOrden: 'PL-502',
      tipo_orden: 'para_llevar',
      es_para_llevar: true,
      mesa: 'Para Llevar',
      cliente: 'Sofia Ruiz',
      items: [
        { nombre: 'Ceviche Mixto', cantidad: 1, precio: 7000, subtotal: 7000 }
      ],
      subtotal: 7000,
      servicio: 0,
      iva: 910,
      total: 7910
    };

    const res = printerService.generarTicketPreFactura(prefacturaParaLlevar, { nombre: 'GastroBar' });
    const preTicketRaw = res.raw || res;
    assert.ok(preTicketRaw, 'La prefactura generada no debe estar vacía');
    assert.ok(
      preTicketRaw.includes('Servicio (0% Para Llevar):') && preTicketRaw.includes('EXENTO'),
      'La prefactura debe mostrar Servicio (0% Para Llevar): EXENTO'
    );
    assert.strictEqual(
      preTicketRaw.includes('10% Servicio (Ley):'),
      false,
      'No debe contener 10% Servicio en prefactura para llevar'
    );
  });

  it('6. Tickets: Ordenes normales en Salón siguen calculando 10% Servicio de ley correctamente', () => {
    const ordenSalon = {
      numeroOrden: '105',
      mesa: 'Mesa 4',
      cliente: 'Consumidor Local',
      items: [
        { nombre: 'Pizza Suprema', cantidad: 1, precio: 10000, subtotal: 10000 }
      ],
      subtotal: 10000,
      servicio: 1000,
      iva: 1300,
      total: 12300,
      recibido: 15000,
      cambio: 2700
    };

    const res = printerService.generarTicketLiquidacion(ordenSalon, { nombre: 'GastroBar' });
    const ticketSalon = res.raw || res;
    assert.ok(
      ticketSalon.includes('10% Servicio (Ley):'),
      'Orden de salón debe cobrar e incluir 10% Servicio (Ley)'
    );
    assert.strictEqual(res.ticketVisual?.servicio, 1000, 'ticketVisual.servicio debe ser 1000');
  });
});
