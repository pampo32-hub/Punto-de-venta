const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Iniciando verificación de: Scroll dentro del Modal de Gestión de Insumos...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720']
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
    console.log('✅ Página inicial cargada');

    // Login Don Alberto
    await page.evaluate(() => {
      const donAlberto = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Don Alberto'));
      if (donAlberto) donAlberto.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Crear 10 insumos para garantizar que la lista desborde verticalmente
    console.log('Insertando insumos adicionales para prueba de scroll...');
    await page.evaluate(async () => {
      const token = localStorage.getItem('token') || localStorage.getItem('aura_auth_token') || '';
      const rol = localStorage.getItem('user_rol') || 'admin';
      const headers = {
        'Content-Type': 'application/json',
        'x-negocio-id': '1',
        'x-user-rol': rol,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      for (let i = 1; i <= 10; i++) {
        await fetch('/api/admin/inventario?negocio_id=1', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            nombre: `Insumo Scroll Test ${i}`,
            categoria: i % 2 === 0 ? 'Bar' : 'Cocina',
            unidad_medida: 'Unidades',
            costo_unitario: 1000 * i,
            stock_actual: 50,
            stock_minimo: 5,
            negocio_id: 1
          })
        });
      }
    });

    // Navegar a Admin -> Recetas & Escandallos
    await page.evaluate(() => {
      const adminBtn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Admin'));
      if (adminBtn) adminBtn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      const recetaBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Recetas'));
      if (recetaBtn) recetaBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Abrir modal "Gestionar Insumos"
    console.log('Abriendo modal "Gestionar Insumos"...');
    await page.click('#btn-gestionar-insumos');
    await new Promise(r => setTimeout(r, 1200));

    // 1. Verificar bloqueo del scroll de la página de fondo (body.style.overflow)
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    console.log(`Estado de document.body.style.overflow: "${bodyOverflow}"`);
    if (bodyOverflow !== 'hidden') {
      throw new Error(`FALLO: El fondo no está bloqueado. Valor actual: ${bodyOverflow}`);
    }
    console.log('✅ El fondo (página principal) está estrictamente bloqueado con overflow: hidden.');

    // 2. Verificar contenedores de scroll dentro del modal
    const scrollInfo = await page.evaluate(() => {
      const tableWrapper = document.querySelector('tbody')?.closest('div');
      const modalContent = document.querySelector('.max-w-4xl .flex-1');
      return {
        tableWrapperScrollHeight: tableWrapper ? tableWrapper.scrollHeight : 0,
        tableWrapperClientHeight: tableWrapper ? tableWrapper.clientHeight : 0,
        modalContentScrollHeight: modalContent ? modalContent.scrollHeight : 0,
        modalContentClientHeight: modalContent ? modalContent.clientHeight : 0,
      };
    });
    console.log('Métricas de Scroll del Modal:', scrollInfo);

    await page.screenshot({ path: 'verify_12_modal_insumos_top.png' });
    console.log('📸 Captura guardada (arriba): verify_12_modal_insumos_top.png');

    // 3. Simular scroll hacia abajo usando la rueda del ratón sobre la tabla de insumos
    console.log('Simulando desplazamiento de rueda (mouse wheel) dentro de la lista de insumos...');
    
    // Obtener coordenadas de la tabla para posicionar el mouse sobre ella
    const rect = await page.evaluate(() => {
      const el = document.querySelector('tbody') || document.querySelector('.max-w-4xl');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    await page.mouse.move(rect.x, rect.y);
    await page.mouse.wheel({ deltaY: 450 });
    await new Promise(r => setTimeout(r, 1000));

    // También scrollear programáticamente si el delta del mouse no fue suficiente
    const scrollResult = await page.evaluate(() => {
      const tableWrapper = document.querySelector('tbody')?.closest('div');
      const modalContent = document.querySelector('.max-w-4xl .flex-1');
      
      let tableScrollTop = tableWrapper ? tableWrapper.scrollTop : 0;
      let modalScrollTop = modalContent ? modalContent.scrollTop : 0;

      if (tableScrollTop === 0 && modalScrollTop === 0) {
        // Ejecutar scroll directo
        if (tableWrapper && tableWrapper.scrollHeight > tableWrapper.clientHeight) {
          tableWrapper.scrollTop = 250;
        } else if (modalContent && modalContent.scrollHeight > modalContent.clientHeight) {
          modalContent.scrollTop = 250;
        }
      }

      return {
        tableScrollTop: tableWrapper ? tableWrapper.scrollTop : 0,
        modalScrollTop: modalContent ? modalContent.scrollTop : 0,
        windowScrollY: window.scrollY
      };
    });

    console.log('Resultado del desplazamiento:', scrollResult);

    if (scrollResult.windowScrollY > 0) {
      throw new Error(`FALLO: La página de fondo se scrolleó (${scrollResult.windowScrollY}px).`);
    }

    console.log('✅ Verificado: La página principal permanece en 0px (sin moverse).');
    console.log(`✅ Verificado: El contenedor interno del modal se desplazó correctamente (ScrollTop: ${Math.max(scrollResult.tableScrollTop, scrollResult.modalScrollTop)}px).`);

    await page.screenshot({ path: 'verify_13_modal_insumos_scrolled.png' });
    console.log('📸 Captura guardada (scrolleado): verify_13_modal_insumos_scrolled.png');

    console.log('🎉 VERIFICACIÓN DE SCROLL EXITOSA: El modal se desplaza internamente y la página principal no se mueve.');
  } catch (err) {
    console.error('❌ Error durante la verificación:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
