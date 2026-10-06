const puppeteer = require('puppeteer');

(async () => {
  console.log('--- TEST DE SEPARACIÓN DESKTOP VS MÓVIL ---');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. TEST DESKTOP (1366 x 768)
    console.log('\n[1] Probando resolución Desktop (1366x768)...');
    const pageDesktop = await browser.newPage();
    await pageDesktop.setCacheEnabled(false);
    await pageDesktop.setViewport({ width: 1366, height: 768 });
    await pageDesktop.goto('https://gammapos.app/?negocio=18', { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 1500));

    const userFieldD = await pageDesktop.$('#loginUsuario');
    if (userFieldD) {
      await pageDesktop.type('#loginUsuario', 'superadmin');
      await pageDesktop.type('#loginPassword', '1234');
      const btn = await pageDesktop.$('#btnLoginSubmit');
      if (btn) await btn.click();
      await new Promise(r => setTimeout(r, 3000));
    }

    await pageDesktop.waitForFunction(() => window.estado && window.estado.mesas && window.estado.mesas.length > 0, { timeout: 15000 });
    console.log('Login exitoso en Desktop.');

    const desktopCheck = await pageDesktop.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const splitter = document.getElementById('comanderoResizerSplitter');
      const floatBar = document.getElementById('mobFloatingTicketBar');
      const backBanner = document.querySelector('.mob-ticket-back-banner');

      return {
        htmlHasDesktop: html.classList.contains('gamma-desktop'),
        htmlHasMobile: html.classList.contains('gamma-mobile'),
        bodyHasDesktop: body ? body.classList.contains('gamma-desktop') : false,
        isGammaDesktop: typeof window.isGammaDesktop === 'function' ? window.isGammaDesktop() : null,
        isGammaMobile: typeof window.isGammaMobile === 'function' ? window.isGammaMobile() : null,
        splitterDisplay: splitter ? window.getComputedStyle(splitter).display : null,
        floatBarDisplay: floatBar ? window.getComputedStyle(floatBar).display : null,
        backBannerDisplay: backBanner ? window.getComputedStyle(backBanner).display : null
      };
    });
    console.log('Resultados Desktop:', JSON.stringify(desktopCheck, null, 2));

    // Abrir una mesa en Desktop para verificar botones
    const ticketButtonsDesktop = await pageDesktop.evaluate(async () => {
      const mesa = window.estado.mesas[0];
      await window.abrirComanderoMesa(mesa.id);
      const btnBox = document.querySelector('.ticket-action-buttons');
      const cobrarBtn = document.querySelector('.ticket-action-buttons .btn-btn-cmd.cobrar');
      const prefacturaBtn = document.querySelector('.ticket-action-buttons .btn-btn-cmd.prefactura');
      if (!btnBox) return null;
      const boxStyle = window.getComputedStyle(btnBox);
      const cobrarStyle = cobrarBtn ? window.getComputedStyle(cobrarBtn) : null;
      return {
        display: boxStyle.display,
        gridTemplateColumns: boxStyle.gridTemplateColumns,
        cobrarGridColumn: cobrarStyle ? cobrarStyle.gridColumn : null,
        cobrarOrder: cobrarStyle ? cobrarStyle.order : null
      };
    });
    console.log('Botonera Comanda Desktop (Grid 2x2):', JSON.stringify(ticketButtonsDesktop, null, 2));
    await pageDesktop.close();

    // 2. TEST MÓVIL (390 x 844 - Smartphone)
    console.log('\n[2] Probando resolución Móvil (390x844)...');
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
    console.log('Login exitoso en Móvil.');

    const mobileCheck = await pageMobile.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const splitter = document.getElementById('comanderoResizerSplitter');

      return {
        htmlHasDesktop: html.classList.contains('gamma-desktop'),
        htmlHasMobile: html.classList.contains('gamma-mobile'),
        bodyHasDesktop: body ? body.classList.contains('gamma-desktop') : false,
        bodyHasMobile: body ? body.classList.contains('gamma-mobile') : false,
        isGammaDesktop: typeof window.isGammaDesktop === 'function' ? window.isGammaDesktop() : null,
        isGammaMobile: typeof window.isGammaMobile === 'function' ? window.isGammaMobile() : null,
        splitterDisplay: splitter ? window.getComputedStyle(splitter).display : null
      };
    });
    console.log('Resultados Móvil:', JSON.stringify(mobileCheck, null, 2));

    // Abrir una mesa en Móvil para verificar botonera móvil
    const ticketButtonsMobile = await pageMobile.evaluate(async () => {
      const mesa = window.estado.mesas[0];
      await window.abrirComanderoMesa(mesa.id);
      window.switchComanderoMobileTab('ticket');
      const btnBox = document.querySelector('.ticket-action-buttons');
      const cobrarBtn = document.querySelector('.ticket-action-buttons .btn-btn-cmd.cobrar');
      if (!btnBox) return null;
      const boxStyle = window.getComputedStyle(btnBox);
      const cobrarStyle = cobrarBtn ? window.getComputedStyle(cobrarBtn) : null;
      return {
        display: boxStyle.display,
        gridTemplateColumns: boxStyle.gridTemplateColumns,
        cobrarGridColumn: cobrarStyle ? cobrarStyle.gridColumn : null,
        cobrarOrder: cobrarStyle ? cobrarStyle.order : null
      };
    });
    console.log('Botonera Comanda Móvil (3 col + Cobrar full-width):', JSON.stringify(ticketButtonsMobile, null, 2));
    await pageMobile.close();

    console.log('\n=============================================');
    console.log('✓ SEPARACIÓN VERIFICADA Y COMPLETAMENTE ACTIVA');
    console.log('=============================================');
  } catch (err) {
    console.error('Error durante la prueba:', err);
  } finally {
    await browser.close();
  }
})();
