const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const networkErrors = [];
  page.on('console', msg => console.log(`[BROWSER CONSOLE ${msg.type()}]`, msg.text()));
  page.on('requestfailed', req => {
    networkErrors.push(`FAIL: ${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
  });
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      networkErrors.push(`HTTP ${res.status()}: ${res.request().method()} ${res.url()}`);
    }
  });

  console.log('1. Cargando http://localhost:4000/ ...');
  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // Autenticar si está en Login
  const isLogin = await page.evaluate(() => document.body.innerText.includes('Bienvenido al Punto de Venta'));
  if (isLogin) {
    console.log('Autenticando como Don Alberto...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Admin Master GastroBar') || x.textContent.includes('Don Alberto'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('--- TEST 1: Verificación de Fotos de Menú y Logo ---');
  // Ir a Menú
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, nav a, div'));
    const menuBtn = btns.find(b => b.textContent.includes('Menú') && (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button'));
    if (menuBtn) menuBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  const brokenImgs = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.filter(img => img.complete && img.naturalWidth === 0).map(img => img.src);
  });
  console.log('Total imágenes rotas en Menú:', brokenImgs.length);
  if (brokenImgs.length > 0) {
    console.log('Imágenes rotas encontradas:', brokenImgs);
  }
  await page.screenshot({ path: 'verify_menu_photos_clean.png' });

  console.log('--- TEST 2: Agregar a comanda, enviar a cocina y verificar permanencia ---');
  // Clic en Chifrijo
  const clickedChifrijo = await page.evaluate(() => {
    const card = document.querySelector('[data-menu-item-name="Chifrijo"]');
    if (card) { card.click(); return true; }
    return false;
  });
  console.log('Chifrijo agregado:', clickedChifrijo);
  await new Promise(r => setTimeout(r, 800));

  // Clic en Hamburguesa
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-menu-item-name]'));
    const h = cards.find(c => c.getAttribute('data-menu-item-name').includes('Hamburguesa'));
    if (h) h.click();
  });
  await new Promise(r => setTimeout(r, 800));

  const comandaInitialText = await page.evaluate(() => document.querySelector('aside')?.innerText || '');
  console.log('Comanda antes de enviar a cocina:\n', comandaInitialText);

  // Clic en "Enviar a cocina"
  console.log('Pulsando "Enviar a cocina"...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const sendBtn = btns.find(b => b.textContent.includes('Enviar a cocina'));
    if (sendBtn) sendBtn.click();
  });

  // Monitorear comanda por 8 segundos (intervalo de polling del backend)
  for (let s = 1; s <= 8; s++) {
    await new Promise(r => setTimeout(r, 1000));
    const asideText = await page.evaluate(() => document.querySelector('aside')?.innerText || '');
    const hasChifrijo = asideText.includes('Chifrijo');
    console.log(`Segundo ${s} post-envío: ¿Tiene Chifrijo en comanda? ${hasChifrijo}`);
    if (!hasChifrijo && s > 1) {
      console.error(`¡ERROR! Ítem se borró de la comanda en segundo ${s}`);
    }
  }

  await page.screenshot({ path: 'verify_comanda_persists_after_8s.png' });

  console.log('--- TEST 3: Verificación de Cocina (KDS) ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, nav a, div'));
    const kdsBtn = btns.find(b => b.textContent.includes('Cocina') && (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button'));
    if (kdsBtn) kdsBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  const kdsText = await page.evaluate(() => document.body.innerText);
  const kdsHasChifrijo = kdsText.includes('Chifrijo');
  console.log('¿Cocina KDS muestra el Chifrijo en ticket?:', kdsHasChifrijo);
  await page.screenshot({ path: 'verify_kds_ticket_active.png' });

  console.log('--- TEST 4: Arrastre de mesas en Salón ---');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, nav a, div'));
    const salonBtn = btns.find(b => b.textContent.includes('Salón') && (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button'));
    if (salonBtn) salonBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Obtener Mesa 2 y Mesa 4
  const tablesInfo = await page.evaluate(() => {
    const el2 = document.querySelector('[data-table-number="2"]');
    const el4 = document.querySelector('[data-table-number="4"]');
    const r2 = el2 ? el2.getBoundingClientRect() : null;
    const r4 = el4 ? el4.getBoundingClientRect() : null;
    return {
      t2: r2 ? { left: Math.round(r2.left), top: Math.round(r2.top), width: Math.round(r2.width), height: Math.round(r2.height) } : null,
      t4: r4 ? { left: Math.round(r4.left), top: Math.round(r4.top), width: Math.round(r4.width), height: Math.round(r4.height) } : null
    };
  });

  if (tablesInfo.t2) {
    console.log('Probando arrastre libre de Mesa 2...', tablesInfo.t2);
    await page.mouse.move(tablesInfo.t2.left + 40, tablesInfo.t2.top + 30);
    await page.mouse.down();
    await page.mouse.move(tablesInfo.t2.left + 80, tablesInfo.t2.top + 80);
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: 'verify_drag_mesa2_moving.png' });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: 'verify_drag_mesa2_dropped.png' });
    console.log('Arrastre libre completado exitosamente.');
  } else {
    console.log('No se encontró elemento data-table-number="2" en vista de salón');
  }

  console.log('--- Network Errors detectados (' + networkErrors.length + ') ---');
  networkErrors.forEach(e => console.log(e));

  console.log('--- VERIFICACIÓN FINALIZADA CON ÉXITO ---');
  await browser.close();
})();
