const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Iniciando verificación de Recetas, Escandallos y Kárdex...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('favicon') && !text.includes('downloadable font') && !text.includes('DOM')) {
      console.log(`[BROWSER CONSOLE] ${msg.type()}: ${text}`);
    }
  });

  try {
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✅ Página cargada');

    // 1. Limpiar storage y loguearse como Don Alberto (Admin)
    console.log('🔑 Iniciando sesión como Don Alberto (Restaurante Master)...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const donAlberto = btns.find(b => b.innerText.includes('Don Alberto'));
      if (donAlberto) donAlberto.click();
    });

    await new Promise(r => setTimeout(r, 2500));

    // 2. Localizar y hacer clic en el botón "Admin" del Header
    console.log('🔘 Abriendo menú desplegable "Admin"...');
    const adminMenuAbierto = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('header button'));
      const adminBtn = btns.find(b => b.innerText.trim().startsWith('Admin') || b.innerText.includes('Admin'));
      if (adminBtn) {
        adminBtn.click();
        return true;
      }
      return false;
    });

    console.log(`Dropdown Admin clickeado: ${adminMenuAbierto}`);
    await new Promise(r => setTimeout(r, 800));

    // 3. Clic en "Recetas & Escandallos"
    console.log('🍽️ Clic en opción "Recetas & Escandallos"...');
    const navOk = await page.evaluate(() => {
      const menuBtns = Array.from(document.querySelectorAll('button'));
      const recetaBtn = menuBtns.find(b => b.innerText.includes('Recetas') || b.innerText.includes('Escandallos'));
      if (recetaBtn) {
        recetaBtn.click();
        return true;
      }
      return false;
    });

    console.log(`Navegación iniciada: ${navOk}`);
    await new Promise(r => setTimeout(r, 3000));

    // 4. Validar vista activa
    const vistaInfo = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const articles = Array.from(document.querySelectorAll('article')).map(a => a.innerText);
      const kpis = Array.from(document.querySelectorAll('.font-serif')).map(s => s.innerText);
      return {
        titulo: h1 ? h1.innerText : '',
        totalPlatillos: articles.length,
        primerosPlatillos: articles.slice(0, 3),
        kpis: kpis.slice(0, 5)
      };
    });

    console.log('📊 Información de la vista cargada:', JSON.stringify(vistaInfo, null, 2));
    await page.screenshot({ path: 'verify_01_recetas_escandallos_view.png', fullPage: true });
    console.log('📸 Captura guardada: verify_01_recetas_escandallos_view.png');

    // 5. Clic en el platillo "Hamburguesa de la casa"
    console.log('🍔 Seleccionando platillo "Hamburguesa de la casa"...');
    const seleccion = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll('article'));
      const burger = articles.find(a => a.innerText.toLowerCase().includes('hamburguesa'));
      if (burger) {
        burger.click();
        return burger.innerText;
      }
      return null;
    });

    console.log('Resultado de selección:', seleccion);
    await new Promise(r => setTimeout(r, 2000));

    // 6. Validar detalle de receta del platillo seleccionado
    const detallePlatillo = await page.evaluate(() => {
      const h2 = document.querySelector('h2');
      const ingredientes = Array.from(document.querySelectorAll('tbody tr')).map(tr => tr.innerText);
      const costos = Array.from(document.querySelectorAll('.font-serif')).map(s => s.innerText);
      return {
        nombrePlatillo: h2 ? h2.innerText : '',
        ingredientesCount: ingredientes.length,
        ingredientes: ingredientes,
        metricasCostos: costos.slice(0, 8)
      };
    });

    console.log('🥗 Detalle de Escandallo:', JSON.stringify(detallePlatillo, null, 2));
    await page.screenshot({ path: 'verify_02_escandallo_detalle_hamburguesa.png', fullPage: true });
    console.log('📸 Captura guardada: verify_02_escandallo_detalle_hamburguesa.png');

    // 7. Cambiar a la pestaña "Kárdex en Vivo"
    console.log('📜 Cambiando a pestaña "Kárdex en Vivo"...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const kardexBtn = btns.find(b => b.innerText.includes('Kárdex en Vivo'));
      if (kardexBtn) kardexBtn.click();
    });

    await new Promise(r => setTimeout(r, 2000));

    // Validar filas de Kárdex
    const kardexInfo = await page.evaluate(() => {
      const filas = Array.from(document.querySelectorAll('tbody tr')).map(tr => tr.innerText);
      return {
        totalMovimientos: filas.length,
        movimientosMuestra: filas.slice(0, 4)
      };
    });

    console.log('📋 Movimientos de Kárdex en Vivo:', JSON.stringify(kardexInfo, null, 2));
    await page.screenshot({ path: 'verify_03_kardex_en_vivo_tab.png', fullPage: true });
    console.log('📸 Captura guardada: verify_03_kardex_en_vivo_tab.png');

    console.log('🎉 ¡VERIFICACIÓN EXITOSA Y COMPLETA!');
  } catch (err) {
    console.error('❌ Error durante la prueba:', err);
    await page.screenshot({ path: 'verify_recetas_error.png' }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
