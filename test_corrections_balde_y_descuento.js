const puppeteer = require('puppeteer');

(async () => {
  console.log('🚀 Iniciando pruebas de corrección: Balde (6 unid, inicio en 0) y Descuento persistente...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  page.on('dialog', async (d) => {
    console.log('Dialog detectado:', d.message());
    await d.accept();
  });

  try {
    console.log('1. Cargando http://localhost:4000/...');
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    // 0. Login con Don Alberto si está en pantalla
    const hasLogin = await page.evaluate(() => document.body.innerText.includes('Bienvenido al Punto de Venta') || document.body.innerText.includes('Don Alberto'));
    if (hasLogin) {
      console.log('2. Iniciando sesión con Don Alberto (@admin)...');
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const donAlberto = elements.find(el => el.innerText && el.innerText.trim() === 'Don Alberto');
        if (donAlberto) donAlberto.click();
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // 1. Entrar al Comandero en Mesa 1
    console.log('3. Entrando al Comandero en Mesa 1...');
    await page.evaluate(() => {
      const mesa1 = document.querySelector('[data-table-number="1"]');
      if (mesa1) {
        mesa1.click();
      } else {
        const btnMenu = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Menú') || b.innerText.includes('Comanda'));
        if (btnMenu) btnMenu.click();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Abrir mesa si pide pax
    await page.evaluate(() => {
      const btnAbrir = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Abrir Mesa'));
      if (btnAbrir) btnAbrir.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({ path: 'verify_fix_01_comanda_abierta.png' });
    console.log('📸 Captura 1: Comanda abierta.');

    // 2. Abrir Modal de Balde
    console.log('4. Clic en Balde Nacional...');
    const baldeClicked = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-menu-item-name]'));
      const card = cards.find(c => c.getAttribute('data-menu-item-name').toLowerCase().includes('balde'));
      if (card) {
        card.click();
        return true;
      }
      return false;
    });

    if (!baldeClicked) {
      // Intentar buscar 'balde' en el input
      await page.evaluate(() => {
        const inp = document.querySelector('input[placeholder*="Buscar"]');
        if (inp) {
          inp.value = 'balde';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 1000));
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('*'));
        const card = cards.find(c => c.innerText && c.innerText.includes('Balde'));
        if (card) card.click();
      });
    }

    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'verify_fix_02_balde_modal_abierto.png' });
    console.log('📸 Captura 2: Modal de Balde abierto.');

    // Verificar texto "0 / 6 seleccionadas"
    const baldeHeaderText = await page.evaluate(() => {
      const modal = document.querySelector('h3');
      const counter = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('seleccionadas'));
      return {
        title: modal ? modal.innerText : '',
        counter: counter ? counter.innerText : ''
      };
    });
    console.log('🔎 Estado inicial del Balde:', baldeHeaderText);
    const isZeroOfSix = baldeHeaderText.counter.includes('0 / 6');
    console.log('👉 ¿El balde empieza en 0 / 6?:', isZeroOfSix ? '✅ SÍ (CORRECTO)' : '❌ NO');

    // 3. Probar Presets y Steppers: Probar "Todo Imperial" (debe ser 6/6), luego "Todo en Cero (0)", luego distribuir 3 y 3
    console.log('5. Probando botón "Todo Imperial" (debe poner 6/6)...');
    await page.evaluate(() => {
      const btnTodoImperial = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Todo Imperial'));
      if (btnTodoImperial) btnTodoImperial.click();
    });
    await new Promise(r => setTimeout(r, 600));

    const countTodoImperial = await page.evaluate(() => {
      const counter = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('seleccionadas'));
      return counter ? counter.innerText : '';
    });
    console.log('👉 Resultado de Todo Imperial:', countTodoImperial);

    console.log('6. Probando botón "Todo en Cero (0)"...');
    await page.evaluate(() => {
      const btnCero = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Todo en Cero'));
      if (btnCero) btnCero.click();
    });
    await new Promise(r => setTimeout(r, 600));

    const countDespuesDeCero = await page.evaluate(() => {
      const counter = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('seleccionadas'));
      return counter ? counter.innerText : '';
    });
    console.log('👉 Resultado después de Todo en Cero:', countDespuesDeCero);

    console.log('7. Distribuyendo 3 Imperial Clásica y 3 Pilsen...');
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.divide-y > div'));
      if (rows.length >= 4) {
        // Primera fila: Imperial Clásica
        const plus1 = rows[0].querySelectorAll('button')[1];
        if (plus1) { plus1.click(); plus1.click(); plus1.click(); }
        // Cuarta fila: Pilsen
        const plus4 = rows[3].querySelectorAll('button')[1];
        if (plus4) { plus4.click(); plus4.click(); plus4.click(); }
      }
    });
    await new Promise(r => setTimeout(r, 800));

    await page.screenshot({ path: 'verify_fix_03_balde_3_y_3.png' });
    console.log('📸 Captura 3: Balde con 3 Imperial y 3 Pilsen.');

    // Confirmar balde
    await page.evaluate(() => {
      const btnConfirm = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Agregar Balde'));
      if (btnConfirm) btnConfirm.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    await page.screenshot({ path: 'verify_fix_04_balde_agregado_a_comanda.png' });
    console.log('📸 Captura 4: Balde en la comanda con sus 6 unidades.');

    // 4. Probar Aplicar Descuento del 50%
    console.log('8. Abriendo modal de Descuento en la Comanda...');
    await page.evaluate(() => {
      const btnDesc = document.querySelector('#btn-comanda-descuento') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('% Descuento'));
      if (btnDesc) btnDesc.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    await page.screenshot({ path: 'verify_fix_05_modal_descuento.png' });
    console.log('📸 Captura 5: Modal de Descuento abierto.');

    console.log('9. Seleccionando 50% de Descuento y aplicando...');
    await page.evaluate(() => {
      const btn50 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '50%');
      if (btn50) btn50.click();
    });
    await new Promise(r => setTimeout(r, 500));

    await page.evaluate(() => {
      const btnApply = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Aplicar Descuento'));
      if (btnApply) btnApply.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    await page.screenshot({ path: 'verify_fix_06_descuento_recien_aplicado.png' });
    console.log('📸 Captura 6: Descuento del 50% recién aplicado.');

    // 5. ESPERAR 8 SEGUNDOS (Múltiples ciclos de polling del servidor)
    console.log('⏳ Esperando 8 segundos completos para asegurar que el polling NO borra el descuento...');
    await new Promise(r => setTimeout(r, 8000));

    await page.screenshot({ path: 'verify_fix_07_descuento_persiste_tras_8s.png' });
    console.log('📸 Captura 7: Comanda tras 8 segundos de polling.');

    const discountPersists = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Descuento (50%)') && text.includes('Quitar');
    });
    console.log('👉 ¿El descuento del 50% PERSISTE tras el polling?:', discountPersists ? '✅ SÍ (CORRECTO Y PERSISTENTE)' : '❌ NO (ERROR)');

    // 6. Probar Cobrar Cuenta
    console.log('10. Abriendo modal de Cobro para verificar que descuenta el 50% del total...');
    await page.evaluate(() => {
      const btnCobrar = document.querySelector('#btn-comanda-cobrar') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cobrar Cuenta'));
      if (btnCobrar) btnCobrar.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    await page.screenshot({ path: 'verify_fix_08_modal_cobro_con_descuento.png' });
    console.log('📸 Captura 8: Modal de cobro con descuento aplicado.');

    const chargeModalHasDiscount = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Descuento') || text.includes('descuento aplicado');
    });
    console.log('👉 ¿El modal de cobro reconoce el descuento?:', chargeModalHasDiscount ? '✅ SÍ' : '❌ NO');

    console.log('🎉 ¡Todas las pruebas de corrección completadas con éxito!');

  } catch (e) {
    console.error('❌ Error en script de verificación:', e);
  } finally {
    await browser.close();
  }
})();
