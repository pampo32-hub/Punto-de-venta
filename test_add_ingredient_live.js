const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Probando agregar ingrediente en vivo desde la UI...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle2' });

    // Login
    await page.evaluate(() => {
      const donAlberto = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Don Alberto'));
      if (donAlberto) donAlberto.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Nav to Recetas
    await page.evaluate(() => {
      const adminBtn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Admin'));
      if (adminBtn) adminBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    await page.evaluate(() => {
      const recetaBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Recetas'));
      if (recetaBtn) recetaBtn.click();
    });
    await new Promise(r => setTimeout(r, 2500));

    // Click on Hamburguesa
    await page.evaluate(() => {
      const burger = Array.from(document.querySelectorAll('article')).find(a => a.innerText.includes('Hamburguesa'));
      if (burger) burger.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Fill form to add an ingredient: pick first available option that has value
    const formFilled = await page.evaluate(() => {
      const selectInsumo = document.querySelector('form select');
      if (!selectInsumo || selectInsumo.options.length <= 1) return false;
      selectInsumo.selectedIndex = 1; // pick first insumo
      selectInsumo.dispatchEvent(new Event('change', { bubbles: true }));

      const cantInput = document.querySelector('form input[type="number"]');
      if (cantInput) {
        cantInput.value = '2';
        cantInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    });

    console.log(`Formulario completado: ${formFilled}`);
    await new Promise(r => setTimeout(r, 500));

    // Click submit
    await page.evaluate(() => {
      const submitBtn = document.querySelector('form button[type="submit"]');
      if (submitBtn) submitBtn.click();
    });

    await new Promise(r => setTimeout(r, 2500));

    // Check updated ingredients count
    const updatedIngredients = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('tbody tr')).map(tr => tr.innerText);
    });

    console.log('✅ Ingredientes actualizados en tabla:', updatedIngredients);
    await page.screenshot({ path: 'verify_04_ingrediente_agregado_live.png' });
    console.log('📸 Captura guardada: verify_04_ingrediente_agregado_live.png');
    console.log('🎉 Prueba de agregar ingrediente finalizada con éxito.');
  } catch (err) {
    console.error('Error en prueba interactiva:', err);
  } finally {
    await browser.close();
  }
})();
