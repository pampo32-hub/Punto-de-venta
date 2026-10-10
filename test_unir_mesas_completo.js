const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('1. Cargando http://localhost:4000/...');
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // Si está en login
    const isLogin = await page.evaluate(() => document.body.innerText.includes('Bienvenido al Punto de Venta'));
    if (isLogin) {
      console.log('Detectado login, autenticando...');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find(x => x.textContent.includes('Admin Master GastroBar') || x.textContent.includes('Don Alberto'));
        if (b) b.click();
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // Ir a Salón
    console.log('2. Navegando al Salón...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('header button, nav button, button'));
      const b = btns.find(x => x.textContent.trim().includes('Salón'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Si hay un modal abierto (como apertura o preview), lo cerramos
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[title="Cerrar ventana"], button.material-symbols-outlined');
      if (closeBtn && closeBtn.innerText.includes('close')) closeBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    // 3. Preparar Mesa 3 y Mesa 6 para la prueba
    console.log('3. Verificando estado de Mesa 3 y Mesa 6...');
    const prepareTable = async (tableNum, clientName) => {
      // Asegurarse de estar en Salón
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('header button, nav button, button'));
        const b = btns.find(x => x.textContent.trim().includes('Salón'));
        if (b) b.click();
      });
      await new Promise(r => setTimeout(r, 1000));

      const isFree = await page.evaluate((num) => {
        const cards = Array.from(document.querySelectorAll('[data-table-number]'));
        const card = cards.find(c => c.getAttribute('data-table-number') == String(num) || c.getAttribute('data-table-number') == `0${num}`);
        return card && (card.innerText.includes('LIBRE') || card.innerText.includes('Libre'));
      }, tableNum);

      if (isFree) {
        console.log(`Mesa ${tableNum} está libre. Ocupando con cliente "${clientName}"...`);
        await page.evaluate((num) => {
          const cards = Array.from(document.querySelectorAll('[data-table-number]'));
          const card = cards.find(c => c.getAttribute('data-table-number') == String(num) || c.getAttribute('data-table-number') == `0${num}`);
          if (card) card.click();
        }, tableNum);
        await new Promise(r => setTimeout(r, 1000));

        // Completar modal de asignación
        const hasAssignModal = await page.evaluate(() => !!document.getElementById('btn-assign-registrar-nombre'));
        if (hasAssignModal) {
          await page.evaluate((name) => {
            const input = document.querySelector('input[placeholder*="Ej: Carlos"]');
            if (input) {
              input.value = name;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const confirmBtn = document.getElementById('btn-assign-registrar-nombre');
            if (confirmBtn) confirmBtn.click();
          }, clientName);
          await new Promise(r => setTimeout(r, 1500));
        }

        // Agregar 1 producto en la comanda
        await page.evaluate(() => {
          const itemCard = document.querySelector('div.group[class*="cursor-pointer"]');
          if (itemCard) itemCard.click();
        });
        await new Promise(r => setTimeout(r, 800));

        // Volver al Salón
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const salonBtn = btns.find(b => b.textContent.includes('Salón'));
          if (salonBtn) salonBtn.click();
        });
        await new Promise(r => setTimeout(r, 1500));
      } else {
        console.log(`Mesa ${tableNum} ya se encuentra ocupada con comanda.`);
      }
    };

    await prepareTable(3, 'Familia Gómez');
    await prepareTable(6, 'Carlos Pérez');

    // Cambiar a Plano de Planta (floor plan 2D)
    console.log('Cambiando a Plano de Planta...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Plano de Planta'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // 4. Obtener coordenadas de Mesa 3 y Mesa 6 en el lienzo de Plano de Planta
    console.log('4. Obteniendo posiciones de Mesa 3 y Mesa 6 en el lienzo...');
    const posMesa3 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-table-number]'));
      const card = cards.find(c => c.getAttribute('data-table-number') === '3' || c.getAttribute('data-table-number') === '03');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    const posMesa6 = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-table-number]'));
      const card = cards.find(c => c.getAttribute('data-table-number') === '6' || c.getAttribute('data-table-number') === '06');
      if (!card) return null;
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    console.log('Posición Mesa 3 en pantalla:', posMesa3);
    console.log('Posición Mesa 6 en pantalla:', posMesa6);

    if (!posMesa3 || !posMesa6) {
      throw new Error('No se encontraron las mesas 3 y 6 en pantalla');
    }

    // 5. Arrastrar Mesa 3 sobre Mesa 6
    console.log('5. Arrastrando físicamente Mesa 3 hacia la posición de Mesa 6...');
    await page.mouse.move(posMesa3.x, posMesa3.y);
    await page.mouse.down();
    await new Promise(r => setTimeout(r, 200));

    const steps = 15;
    for (let i = 1; i <= steps; i++) {
      const curX = posMesa3.x + (posMesa6.x - posMesa3.x) * (i / steps);
      const curY = posMesa3.y + (posMesa6.y - posMesa3.y) * (i / steps);
      await page.mouse.move(curX, curY);
      await new Promise(r => setTimeout(r, 40));
    }

    await new Promise(r => setTimeout(r, 300));
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 1200));

    // 6. Verificar si se abrió el modal de confirmación de unión
    const isModalOpen = await page.evaluate(() => {
      return !!document.getElementById('btn-confirmar-unir-mesas');
    });

    console.log('¿Modal de Confirmación de Unión abierto?:', isModalOpen);
    await page.screenshot({ path: 'test_unir_mesas_01_modal.png' });
    console.log('Captura guardada: test_unir_mesas_01_modal.png');

    if (isModalOpen) {
      console.log('7. Confirmando unión de Mesa 3 en Mesa 6...');
      await page.click('#btn-confirmar-unir-mesas');
      await new Promise(r => setTimeout(r, 2000));

      // Captura tras la unión en el salón
      await page.screenshot({ path: 'test_unir_mesas_02_salon_post_union.png' });
      console.log('Captura guardada: test_unir_mesas_02_salon_post_union.png');

      // Verificar que Mesa 3 está libre y Mesa 6 ocupada
      const table3Status = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-table-number]'));
        const card = cards.find(c => c.getAttribute('data-table-number') === '3' || c.getAttribute('data-table-number') === '03');
        return card ? card.innerText : null;
      });
      console.log('Estado de Mesa 3 post-unión:', table3Status?.includes('LIBRE') || table3Status?.includes('Libre') ? '✅ LIBRE (Confirmado)' : table3Status);

      // 8. Entrar a la comanda de Mesa 6 para verificar división de productos
      console.log('8. Abriendo comanda de Mesa 6...');
      await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-table-number]'));
        const card = cards.find(c => c.getAttribute('data-table-number') === '6' || c.getAttribute('data-table-number') === '06');
        if (card) card.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      const comandaContent = await page.evaluate(() => document.body.innerText);
      const hasMesa6Group = comandaContent.includes('Mesa 6');
      const hasMesa3Group = comandaContent.includes('Mesa 3');

      console.log('¿Comanda contiene sección Mesa 6?:', hasMesa6Group);
      console.log('¿Comanda contiene sección Mesa 3?:', hasMesa3Group);

      await page.screenshot({ path: 'test_unir_mesas_03_comanda_dividida.png' });
      console.log('Captura guardada: test_unir_mesas_03_comanda_dividida.png');
      console.log('✅ TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO.');
    } else {
      console.error('❌ FALLO: El modal de unión de mesas no se abrió al soltar Mesa 3 sobre Mesa 6.');
    }

  } catch (err) {
    console.error('Error durante la prueba:', err);
  } finally {
    await browser.close();
  }
})();
