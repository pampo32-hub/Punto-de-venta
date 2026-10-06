const puppeteer = require('puppeteer');

(async () => {
  console.log('--- VERIFICACIÓN DE ELEMENTOS OCULTOS SOLO EN MÓVIL ---');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. DESKTOP (1366 x 768)
    console.log('\n[1] Verificando en PC / Desktop (1366x768)...');
    const pageDesktop = await browser.newPage();
    await pageDesktop.setCacheEnabled(false);
    await pageDesktop.setViewport({ width: 1366, height: 768 });
    await pageDesktop.goto('https://gammapos.app/?negocio=18', { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 1500));

    const userFieldD = await pageDesktop.$('#loginUsuario');
    if (userFieldD) {
      await pageDesktop.type('#loginUsuario', 'superadmin');
      await pageDesktop.type('#loginPassword', '1234');
      await pageDesktop.evaluate(() => {
        const btn = document.getElementById('btnLoginSubmit');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }
    await pageDesktop.waitForFunction(() => window.estado && window.estado.mesas && window.estado.mesas.length > 0, { timeout: 15000 });

    const desktopElements = await pageDesktop.evaluate(() => {
      const getDisplay = (sel) => {
        const el = document.querySelector(sel);
        return el ? window.getComputedStyle(el).display : 'not_found';
      };
      return {
        disenarSalon: getDisplay('#btnIrEditorSalon'),
        estiloBotones: getDisplay('#btnEstiloBotonesSalonQuick'),
        unirMesas: getDisplay('#btnAbrirMoverUnirModal'),
        codigosQR: getDisplay('#btnVerTodosQRs'),
        reservas: getDisplay('#btnGestionReservasSalon'),
        segundoPiso: getDisplay('#btnTogglePisoSalon'),
        segundoPisoTab: getDisplay('.zone-tab[data-zona="segundo"]'),
        leyendaEstados: getDisplay('.legend-group')
      };
    });
    console.log('Visibilidad en Desktop (Deben estar visibles):', JSON.stringify(desktopElements, null, 2));
    // Capturar screenshot de desktop
    await pageDesktop.screenshot({ path: 'gammapos_desktop_salon_completo.png' });
    console.log('Screenshot guardado: gammapos_desktop_salon_completo.png');
    await pageDesktop.close();

    // 2. MÓVIL (390 x 844)
    console.log('\n[2] Verificando en Móvil (390x844)...');
    const pageMobile = await browser.newPage();
    await pageMobile.setCacheEnabled(false);
    await pageMobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await pageMobile.goto('https://gammapos.app/?negocio=18', { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 1500));

    const userFieldM = await pageMobile.$('#loginUsuario');
    if (userFieldM) {
      await pageMobile.type('#loginUsuario', 'superadmin');
      await pageMobile.type('#loginPassword', '1234');
      await pageMobile.evaluate(() => {
        const btn = document.getElementById('btnLoginSubmit');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 3000));
    }
    await pageMobile.waitForFunction(() => window.estado && window.estado.mesas && window.estado.mesas.length > 0, { timeout: 15000 });

    const mobileElements = await pageMobile.evaluate(() => {
      const getDisplay = (sel) => {
        const el = document.querySelector(sel);
        return el ? window.getComputedStyle(el).display : 'not_found';
      };
      return {
        disenarSalon: getDisplay('#btnIrEditorSalon'),
        estiloBotones: getDisplay('#btnEstiloBotonesSalonQuick'),
        unirMesas: getDisplay('#btnAbrirMoverUnirModal'),
        codigosQR: getDisplay('#btnVerTodosQRs'),
        reservas: getDisplay('#btnGestionReservasSalon'),
        segundoPiso: getDisplay('#btnTogglePisoSalon'),
        segundoPisoTab: getDisplay('.zone-tab[data-zona="segundo"]'),
        leyendaEstados: getDisplay('.legend-group')
      };
    });
    console.log('Visibilidad en Móvil (Deben estar todos en "none"):', JSON.stringify(mobileElements, null, 2));

    // Cerrar cualquier modal informativo si está visible
    await pageMobile.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Entendido'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Capturar screenshot móvil del salón limpio
    await pageMobile.screenshot({ path: 'gammapos_mobile_salon_limpio.png' });
    console.log('Screenshot guardado: gammapos_mobile_salon_limpio.png');

    await pageMobile.close();
    console.log('\n✓ Verificación de elementos móviles finalizada.');
  } catch (err) {
    console.error('Error durante la prueba:', err);
  } finally {
    await browser.close();
  }
})();
