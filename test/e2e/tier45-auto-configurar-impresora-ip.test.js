const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const printerService = require('../../printerService');

describe('Tier 45: Auto-Configuracion Plug & Play de Impresoras IP en Panel Admin', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const publicIndexHtml = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('T45.1: HTML contiene formulario de auto-configuracion Plug & Play en modal de impresoras', () => {
    assert.ok(indexHtml.includes('id="txtAutoPrinterIP"'), 'index.html debe tener input txtAutoPrinterIP');
    assert.ok(indexHtml.includes('id="selectAutoPrinterDestino"'), 'index.html debe tener selectAutoPrinterDestino');
    assert.ok(indexHtml.includes('id="txtAutoPrinterPort"'), 'index.html debe tener input txtAutoPrinterPort');
    assert.ok(indexHtml.includes('id="btnEjecutarAutoConfigPrinter"'), 'index.html debe tener btnEjecutarAutoConfigPrinter');
    assert.ok(indexHtml.includes('ejecutarAutoConfiguracionImpresora()'), 'index.html debe invocar ejecutarAutoConfiguracionImpresora');

    assert.ok(publicIndexHtml.includes('id="txtAutoPrinterIP"'), 'public/index.html debe tener input txtAutoPrinterIP');
    assert.ok(publicIndexHtml.includes('id="selectAutoPrinterDestino"'), 'public/index.html debe tener selectAutoPrinterDestino');
    assert.ok(publicIndexHtml.includes('id="btnEjecutarAutoConfigPrinter"'), 'public/index.html debe tener btnEjecutarAutoConfigPrinter');
  });

  it('T45.2: Frontend app.js contiene controladores para ejecutar auto-configuracion y refrescar tarjetas', () => {
    assert.ok(appJs.includes('window.ejecutarAutoConfiguracionImpresora = async function'), 'app.js debe definir ejecutarAutoConfiguracionImpresora');
    assert.ok(appJs.includes('cargarEstadoImpresorasConfig'), 'app.js debe definir funcion para cargar estado dinamico de impresoras');
    assert.ok(appJs.includes('/api/impresoras/auto-configurar'), 'app.js debe llamar al endpoint /api/impresoras/auto-configurar');
  });

  it('T45.3: Backend server.js y printerService implementan endpoint y funcion autoConfigurarImpresora', () => {
    assert.ok(serverJs.includes("app.post('/api/impresoras/auto-configurar'"), 'server.js debe tener ruta POST /api/impresoras/auto-configurar');
    assert.ok(typeof printerService.autoConfigurarImpresora === 'function', 'printerService debe exportar autoConfigurarImpresora');
  });

  it('T45.4: autoConfigurarImpresora rechaza IPs vacias o invalidas con mensaje explicativo', async () => {
    await assert.rejects(
      async () => {
        await printerService.autoConfigurarImpresora({ ip: '' });
      },
      /Debes ingresar una dirección IP válida/
    );

    await assert.rejects(
      async () => {
        await printerService.autoConfigurarImpresora({ ip: 'ip-invalida' });
      },
      /El formato de la dirección IP no es válido/
    );
  });
});
