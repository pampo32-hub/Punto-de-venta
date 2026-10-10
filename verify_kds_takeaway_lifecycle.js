const puppeteer = require('puppeteer-core');
const db = require('./database');

(async () => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  console.log('1. Cargando http://localhost:4000/ ...');
  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });

  // Autenticar
  const hasLogin = await page.$('input[type="password"]');
  if (hasLogin) {
    console.log('Autenticando...');
    const userBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Don Alberto') || x.textContent.includes('Alberto'));
      if (b) { b.click(); return true; }
      return false;
    });
    if (!userBtn) {
      await page.type('input[type="password"]', '1234');
      await page.keyboard.press('Enter');
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Ir a Menú
  console.log('2. Yendo a Menú...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, nav a, div'));
    const menuBtn = btns.find(b => b.textContent.includes('Menú') && (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button'));
    if (menuBtn) menuBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Agregar Chifrijo
  console.log('3. Agregando Chifrijo...');
  await page.evaluate(() => {
    const card = document.querySelector('[data-menu-item-name="Chifrijo"]');
    if (card) card.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  // Enviar a cocina
  console.log('5. Enviando a cocina...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('Enviar a cocina'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Ir a Cocina (KDS)
  console.log('6. Yendo a Cocina...');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Cocina'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Verificar que el ticket de Mesa 3 está en Cocina
  const ticketTextBefore = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article'));
    return articles.map(a => a.innerText);
  });
  console.log('Tickets en cocina antes del despacho:', ticketTextBefore.length, ticketTextBefore);

  if (ticketTextBefore.length === 0) {
    console.error('ERROR: No se encontró ticket en cocina.');
    process.exit(1);
  }

  // Despachar el ticket: marcar listo o pase
  console.log('7. Despachando comanda en Cocina...');
  const clickedDispatch = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('article button'));
    const targetBtn = btns.find(b => 
      b.textContent.includes('Marcar listo') || 
      b.textContent.includes('Pase y Sello Takeaway') || 
      b.textContent.includes('Entregado a Mozo')
    );
    if (targetBtn) {
      console.log('Haciendo clic en:', targetBtn.textContent.trim());
      targetBtn.click();
      return targetBtn.textContent.trim();
    }
    return null;
  });

  console.log('Botón presionado:', clickedDispatch);
  if (!clickedDispatch) {
    console.error('ERROR: No se encontró botón de despacho en el ticket');
    process.exit(1);
  }

  // Esperar 1 segundo tras el clic
  await new Promise(r => setTimeout(r, 1000));

  // Verificar que el ticket desapareció de la pantalla
  let countAfter1s = await page.evaluate(() => document.querySelectorAll('article').length);
  console.log(`Segundo 1 post-despacho: Tickets visibles en Cocina: ${countAfter1s}`);

  // Esperar 10 segundos para cubrir el ciclo de polling de 8s
  console.log('Esperando 10 segundos para verificar que NO vuelve a aparecer tras el sondeo (polling)...');
  for (let s = 2; s <= 10; s++) {
    await new Promise(r => setTimeout(r, 1000));
    const count = await page.evaluate(() => document.querySelectorAll('article').length);
    console.log(`Segundo ${s}: Tickets visibles en Cocina: ${count}`);
    if (count > 0) {
      const art = await page.evaluate(() => Array.from(document.querySelectorAll('article')).map(a => a.innerText));
      console.log('Artículos que reaparecieron:', art);
    }
  }

  const finalCount = await page.evaluate(() => document.querySelectorAll('article').length);
  console.log(`Resultado final: Tickets visibles en Cocina = ${finalCount} (esperado: 0)`);

  await page.screenshot({ path: 'verify_kds_dispatched_clean.png' });

  if (finalCount === 0) {
    console.log('>>> TEST PASÓ PERFECTAMENTE: La comanda se quitó y NUNCA volvió a aparecer.');
  } else {
    console.error('>>> TEST FALLÓ: La comanda volvió a aparecer.');
    process.exit(1);
  }

  await browser.close();
  process.exit(0);
})();
