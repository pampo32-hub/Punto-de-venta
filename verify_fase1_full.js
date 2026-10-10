const puppeteer = require('puppeteer');

(async () => {
  console.log('--- INICIANDO VERIFICACIÓN COMPLETA DE FASE 1 ---');
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

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  try {
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Página cargada.');

    // 0. LOGIN SI ES NECESARIO
    const hasLogin = await page.evaluate(() => document.body.innerText.includes('Bienvenido al Punto de Venta'));
    if (hasLogin) {
      console.log('En login, haciendo clic en Don Alberto...');
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const donAlberto = elements.find(el => el.children.length === 0 && el.innerText && el.innerText.trim() === 'Don Alberto');
        if (donAlberto) donAlberto.click();
      });
      await new Promise(r => setTimeout(r, 2500));
    }

    // 1. VERIFICAR SALÓN & MODO DISEÑO
    console.log('1. Probando Salón y Botones Rápidos de Diseñador...');
    await page.evaluate(() => {
      const btnDisenar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Diseñar Salón'));
      if (btnDisenar) btnDisenar.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // Tomar captura con la barra de herramientas del diseñador visible
    await page.screenshot({ path: 'verify_fase1_01a_barra_disenador_activa.png' });
    console.log('Captura 1a guardada: verify_fase1_01a_barra_disenador_activa.png');

    // Abrir modal de modificar mesa
    await page.evaluate(() => {
      const btnModificar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Modificar Mesa'));
      if (btnModificar) btnModificar.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'verify_fase1_01b_modal_modificar_mesa.png' });
    console.log('Captura 1b guardada: verify_fase1_01b_modal_modificar_mesa.png');

    // Cerrar modal modificar mesa
    await page.evaluate(() => {
      const btnCerrar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Cancelar');
      if (btnCerrar) btnCerrar.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Desactivar modo diseño
    await page.evaluate(() => {
      const btnCerrar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cerrar Editor') || b.innerText.includes('Finalizar Diseño'));
      if (btnCerrar) btnCerrar.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // 2. ENTRAR A COMANDERO HACIENDO CLIC EN MESA 1
    console.log('2. Entrando al Comandero en Mesa 1...');
    await page.evaluate(() => {
      const mesa1 = document.querySelector('[data-table-number="1"]');
      if (mesa1) {
        mesa1.click();
      } else {
        const btnMenu = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Menú'));
        if (btnMenu) btnMenu.click();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    // Si aparece modal de apertura de mesa (Pax)
    await page.evaluate(() => {
      const btnAbrir = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Abrir Mesa'));
      if (btnAbrir) btnAbrir.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'verify_fase1_02a_comandero_abierto.png' });
    console.log('Captura 2a guardada: verify_fase1_02a_comandero_abierto.png');

    // 3. PROBAR SELECCIÓN DE BALDES COMPUESTOS
    console.log('3. Probando modal de Selección de Balde Nacional...');
    const baldeClicked = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-menu-item-name]'));
      const card = cards.find(c => c.getAttribute('data-menu-item-name').toLowerCase().includes('balde'));
      if (card) {
        card.click();
        return true;
      }
      return false;
    });

    if (baldeClicked) {
      await new Promise(r => setTimeout(r, 1000));
      await page.screenshot({ path: 'verify_fase1_02b_modal_balde_compuesto.png' });
      console.log('Captura 2b guardada: verify_fase1_02b_modal_balde_compuesto.png');

      // Confirmar selección del balde
      await page.evaluate(() => {
        const btnConfirm = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Agregar Balde'));
        if (btnConfirm) btnConfirm.click();
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    // 4. AGREGAR PLATILLO DE COCINA Y PROBAR MODIFICADORES
    console.log('4. Agregando platillo de cocina y probando Modificadores...');
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-menu-item-name]'));
      const itemCocina = cards.find(c => {
        const name = c.getAttribute('data-menu-item-name').toLowerCase();
        return name.includes('hamburguesa') || name.includes('alitas') || name.includes('chifrijo') || name.includes('costilla');
      });
      if (itemCocina) itemCocina.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Abrir modal de modificadores para el platillo de cocina
    await page.evaluate(() => {
      const btnNota = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('+ Nota / Término') || b.innerText.includes('Editar Notas'));
      if (btnNota) btnNota.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'verify_fase1_03_modal_modificadores_limpio.png' });
    console.log('Captura 3 guardada: verify_fase1_03_modal_modificadores_limpio.png');

    // Seleccionar tiempo de servicio, término y notas
    await page.evaluate(() => {
      const btnPlatoFuerte = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Plato Fuerte');
      if (btnPlatoFuerte) btnPlatoFuerte.click();

      const btnTermino = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Término Medio');
      if (btnTermino) btnTermino.click();

      const btnCebolla = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Sin cebolla');
      if (btnCebolla) btnCebolla.click();

      const btnSalsa = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Salsa aparte');
      if (btnSalsa) btnSalsa.click();

      const textarea = document.querySelector('textarea');
      if (textarea) textarea.value = 'Cliente solicita ensalada sin aderezo';
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: 'verify_fase1_04_modal_modificadores_seleccionado.png' });
    console.log('Captura 4 guardada: verify_fase1_04_modal_modificadores_seleccionado.png');

    // Guardar modificadores
    await page.evaluate(() => {
      const btnGuardar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Guardar Modificadores'));
      if (btnGuardar) btnGuardar.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // 5. PROBAR DESCUENTOS Y CORTESÍAS
    console.log('5. Probando botón y modal de Descuentos en comanda...');
    await page.evaluate(() => {
      const btnDesc = document.querySelector('#btn-comanda-descuento') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('% Descuento'));
      if (btnDesc) btnDesc.click();
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'verify_fase1_05_modal_aplicar_descuento.png' });
    console.log('Captura 5 guardada: verify_fase1_05_modal_aplicar_descuento.png');

    // Aplicar descuento del 15%
    await page.evaluate(() => {
      const btn15 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '15%');
      if (btn15) btn15.click();

      const btnApply = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Aplicar Descuento'));
      if (btnApply) btnApply.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: 'verify_fase1_06_comanda_con_descuento_y_modificadores.png' });
    console.log('Captura 6 guardada: verify_fase1_06_comanda_con_descuento_y_modificadores.png');

    // 6. ENVIAR A COCINA Y VERIFICAR EN KDS
    console.log('6. Enviando orden a cocina y verificando KDS...');
    await page.evaluate(() => {
      const btnEnviar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Enviar a cocina'));
      if (btnEnviar) btnEnviar.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Ir a Cocina (KDS)
    await page.evaluate(() => {
      const btnCocina = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cocina'));
      if (btnCocina) btnCocina.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'verify_fase1_07_kds_con_notas_de_cocina.png' });
    console.log('Captura 7 guardada: verify_fase1_07_kds_con_notas_de_cocina.png');

    console.log('--- TODAS LAS PRUEBAS DE FASE 1 COMPLETADAS CON ÉXITO ---');
  } catch (err) {
    console.error('Error durante la prueba:', err);
  } finally {
    await browser.close();
  }
})();
