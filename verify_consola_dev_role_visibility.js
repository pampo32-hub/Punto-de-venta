const puppeteer = require('puppeteer-core');

(async () => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();

  console.log('--- TEST 1: Login como Restaurante Master / Admin (Don Alberto) ---');
  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });

  // Limpiar localStorage para prueba limpia
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'networkidle2' });

  // Clic en Don Alberto (rol admin de Master Gastro Bar&Grill)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('Don Alberto'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Verificar si "Consola Dev" aparece en el Header
  const headerTextAdmin = await page.evaluate(() => {
    const header = document.querySelector('header');
    return header ? header.innerText : '';
  });
  const hasConsolaDevInHeaderAdmin = headerTextAdmin.includes('Consola Dev');
  console.log('¿Aparece "Consola Dev" en Header para Admin?:', hasConsolaDevInHeaderAdmin);

  // Abrir menú Admin y verificar si aparece "Consola Developer SaaS"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('header button'));
    const adminBtn = btns.find(b => b.textContent.includes('Admin'));
    if (adminBtn) adminBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  const adminMenuText = await page.evaluate(() => document.body.innerText);
  const hasConsolaDevInAdminMenu = adminMenuText.includes('Consola Developer SaaS');
  console.log('¿Aparece "Consola Developer SaaS" en el menú Admin para Admin?:', hasConsolaDevInAdminMenu);

  await page.screenshot({ path: 'verify_admin_no_dev_console.png' });

  // Ahora cerrar sesión limpiando almacenamiento y recargando
  console.log('Cerrando sesión de Admin y recargando login...');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));

  console.log('--- TEST 2: Login como Developer Global (Juan Developer) ---');
  await page.evaluate(() => {
    const devBtn = Array.from(document.querySelectorAll('button')).find(b => 
      b.textContent.includes('Juan Developer') || b.textContent.includes('Entrar como Juan Developer')
    );
    if (devBtn) devBtn.click();
  });
  await new Promise(r => setTimeout(r, 2000));

  const headerTextDev = await page.evaluate(() => {
    const header = document.querySelector('header');
    return header ? header.innerText : '';
  });
  const hasConsolaDevInHeaderDev = headerTextDev.includes('Consola Dev') || headerTextDev.includes('Punto de Venta');
  console.log('¿Aparece "Consola Dev / Punto de Venta" en Header para Developer?:', hasConsolaDevInHeaderDev);

  await page.screenshot({ path: 'verify_developer_has_console.png' });

  await browser.close();

  const success = !hasConsolaDevInHeaderAdmin && !hasConsolaDevInAdminMenu && hasConsolaDevInHeaderDev;
  console.log('RESULTADO FINAL:', success ? 'EXITOSO' : 'FALLIDO');
  process.exit(success ? 0 : 1);
})();
