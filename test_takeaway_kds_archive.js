const puppeteer = require('puppeteer-core');
const path = require('path');
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

  // Autenticación si estamos en login
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

  // Navegar a Cocina (KDS)
  console.log('2. Navegando a Cocina (KDS)...');
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button')).find(x => 
      x.textContent.includes('Cocina')
    );
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  await page.screenshot({ path: 'test_kds_before_click.png' });

  // Buscar el botón "Pase y Sello Takeaway"
  const buttonFound = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('Pase y Sello Takeaway') || b.textContent.includes('Takeaway'));
    if (btn) {
      console.log('Botón encontrado:', btn.textContent.trim());
      btn.click();
      return true;
    }
    return false;
  });

  console.log('¿Botón "Pase y Sello Takeaway" encontrado y presionado?:', buttonFound);

  // Esperar 1 segundo tras el clic
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'test_kds_after_click_1s.png' });

  // Verificar que inmediatamente se quitó
  let hasTakeawayInScreen = await page.evaluate(() => {
    return document.body.innerText.includes('Pase y Sello Takeaway') || document.body.innerText.includes('Para Llevar');
  });
  console.log('Segundo 1 post-clic: ¿Aparece Takeaway en pantalla?:', hasTakeawayInScreen);

  // Esperar a través de ciclos de sincronización (10 segundos)
  console.log('Esperando 10 segundos para probar que el sondeo/polling de 8s NO vuelva a traer la comanda...');
  for (let s = 2; s <= 10; s++) {
    await new Promise(r => setTimeout(r, 1000));
    hasTakeawayInScreen = await page.evaluate(() => {
      return document.body.innerText.includes('Pase y Sello Takeaway') || document.body.innerText.includes('Para Llevar');
    });
    console.log(`Segundo ${s} post-clic: ¿Aparece Takeaway en pantalla?:`, hasTakeawayInScreen);
  }

  await page.screenshot({ path: 'test_kds_after_10s.png' });

  // Verificar en base de datos que el item quedó despachado (estado_comanda = 'listo')
  const pendingInDb = await new Promise((resolve) => {
    db.all("SELECT id, orden_id, nombre_producto, estado_comanda FROM DetalleOrden WHERE orden_id = 299", (err, rows) => {
      resolve(rows || []);
    });
  });
  console.log('Estado en Base de Datos de la Orden 299:', pendingInDb);

  await browser.close();
  console.log('--- TEST COMPLETADO EXITOSAMENTE ---');
  process.exit(0);
})();
