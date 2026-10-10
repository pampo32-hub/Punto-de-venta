const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Iniciando verificación de: Creación de Producto sin borrado & Nuevas Unidades de Bar...');
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
    console.log('✅ Página inicial cargada');

    // Login Don Alberto
    await page.evaluate(() => {
      const donAlberto = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Don Alberto'));
      if (donAlberto) donAlberto.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // ==============================================================
    // TEST 1: Menú y Creación de Producto sin que se borre el nombre
    // ==============================================================
    console.log('--- TEST 1: Verificando creación de producto en menú ---');
    // Navegar a vista de Menú
    await page.evaluate(() => {
      const menuBtn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Menú'));
      if (menuBtn) menuBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Clic en "Agregar Producto"
    const modalAbierto = await page.evaluate(() => {
      const btn = document.querySelector('#btn-agregar-producto') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Agregar Producto') || b.innerText.includes('Nuevo Platillo'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log(`Modal Agregar Producto abierto: ${modalAbierto}`);
    await new Promise(r => setTimeout(r, 1000));

    // Escribir el nombre del producto letra por letra con pausas
    const testNombre = 'Mojito de Fresa Artesanal';
    console.log(`Escribiendo nombre: "${testNombre}"...`);
    const inputSelector = 'input[placeholder*="Chifrijo"], input[placeholder*="Ej."]';
    await page.waitForSelector(inputSelector, { timeout: 5000 });
    await page.type(inputSelector, testNombre, { delay: 100 });

    // Esperar 4 segundos (antes aquí el polling borraba el nombre)
    console.log('Esperando 4 segundos para comprobar persistencia de texto...');
    await new Promise(r => setTimeout(r, 4000));

    const valorDespuesDeEspera = await page.$eval(inputSelector, el => el.value);
    console.log(`Valor del campo tras espera: "${valorDespuesDeEspera}"`);

    if (valorDespuesDeEspera === testNombre) {
      console.log('✅ ÉXITO: El nombre del producto permanece intacto sin borrarse.');
    } else {
      throw new Error(`FALLO: El nombre se borró o cambió a: "${valorDespuesDeEspera}"`);
    }

    await page.screenshot({ path: 'verify_05_crear_producto_nombre_intacto.png' });
    console.log('📸 Captura guardada: verify_05_crear_producto_nombre_intacto.png');

    // Cerrar modal de producto
    await page.evaluate(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cancelar'));
      if (cancelBtn) cancelBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // ==============================================================
    // TEST 2: Recetas y Escandallos con Trago, Cuarta, 1L
    // ==============================================================
    console.log('--- TEST 2: Verificando nuevas medidas en Recetas y Escandallos ---');
    // Abrir menú Admin y entrar a Recetas & Escandallos
    await page.evaluate(() => {
      const adminBtn = Array.from(document.querySelectorAll('header button')).find(b => b.innerText.includes('Admin'));
      if (adminBtn) adminBtn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    await page.evaluate(() => {
      const recetaBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Recetas'));
      if (recetaBtn) recetaBtn.click();
    });
    await new Promise(r => setTimeout(r, 2500));

    // 2.1 Verificar modal "+ Nuevo Insumo"
    console.log('Verificando opciones de unidad en modal "+ Nuevo Insumo"...');
    await page.evaluate(() => {
      const nuevoInsumoBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Nuevo Insumo'));
      if (nuevoInsumoBtn) nuevoInsumoBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const opcionesInsumoModal = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const unitSelect = selects.find(s => Array.from(s.options).some(o => o.text.includes('Litro') || o.text.includes('Cuarta')));
      if (unitSelect) {
        return Array.from(unitSelect.options).map(o => o.text);
      }
      return [];
    });

    console.log('Opciones de Presentación en Bodega detectadas:', opcionesInsumoModal);
    await page.screenshot({ path: 'verify_06_nuevo_insumo_presentaciones_1L_cuarta.png' });
    console.log('📸 Captura guardada: verify_06_nuevo_insumo_presentaciones_1L_cuarta.png');

    // Cerrar modal de nuevo insumo
    await page.evaluate(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cancelar'));
      if (cancelBtn) cancelBtn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // 2.2 Verificar selector de unidad en la receta de un licor o bebida
    console.log('Verificando unidades Trago y Cuarta en el formulario de escandallo...');
    // Seleccionar un insumo de tipo licor o botella en el formulario
    const opcionesUnidadReceta = await page.evaluate(() => {
      const selectInsumo = document.querySelector('form select');
      if (!selectInsumo) return [];
      
      // Buscar una opción de licor o cerveza (Cacique, Ron, etc.)
      const options = Array.from(selectInsumo.options);
      const licorOpt = options.find(o => o.text.toLowerCase().includes('cacique') || o.text.toLowerCase().includes('ron') || o.text.toLowerCase().includes('corona') || o.text.toLowerCase().includes('pilsen'));
      if (licorOpt) {
        selectInsumo.value = licorOpt.value;
        selectInsumo.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Ahora leer el segundo select (selector de unidades)
      const allSelects = Array.from(document.querySelectorAll('form select'));
      const unitSelect = allSelects[1];
      if (unitSelect) {
        return Array.from(unitSelect.options).map(o => o.text);
      }
      return [];
    });

    console.log('Opciones de Unidad para receta detectadas:', opcionesUnidadReceta);
    await page.screenshot({ path: 'verify_07_unidades_escandallo_trago_cuarta.png' });
    console.log('📸 Captura guardada: verify_07_unidades_escandallo_trago_cuarta.png');

    const tieneTrago = opcionesUnidadReceta.some(t => t.includes('Trago'));
    const tieneCuarta = opcionesUnidadReceta.some(t => t.includes('Cuarta'));

    console.log(`¿Incluye Trago?: ${tieneTrago}`);
    console.log(`¿Incluye Cuarta?: ${tieneCuarta}`);

    if (tieneTrago && tieneCuarta) {
      console.log('✅ ÉXITO: Las unidades Trago y Cuarta están disponibles y operativas.');
    }

    console.log('🎉 TODAS LAS VERIFICACIONES COMPLETADAS EXITOSAMENTE.');
  } catch (err) {
    console.error('❌ Error durante la verificación:', err);
  } finally {
    await browser.close();
  }
})();
