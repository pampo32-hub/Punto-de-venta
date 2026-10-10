const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Iniciando verificación de: Gestión de Insumos (Editar y Eliminar)...');
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

    // 1. Navegar a Admin -> Recetas & Escandallos
    console.log('Navegando a Recetas & Escandallos...');
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

    // 2. Verificar existencia del botón "Gestionar Insumos" al lado de "+ Nuevo Insumo"
    const botonesHeader = await page.evaluate(() => {
      const btnGestionar = document.querySelector('#btn-gestionar-insumos');
      const btnNuevo = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Nuevo Insumo'));
      return {
        existeGestionar: Boolean(btnGestionar),
        textoGestionar: btnGestionar ? btnGestionar.innerText : null,
        existeNuevo: Boolean(btnNuevo)
      };
    });

    console.log('Estado de botones en cabecera:', botonesHeader);
    if (!botonesHeader.existeGestionar) {
      throw new Error('FALLO: No se encontró el botón #btn-gestionar-insumos');
    }
    console.log('✅ Botón "Gestionar Insumos" presente junto a "+ Nuevo Insumo"');

    // 3. Crear primero un insumo de prueba para probar edición y eliminación
    const insumoPruebaNombre = `Insumo Test Temp ${Date.now().toString().slice(-4)}`;
    console.log(`Creando insumo temporal de prueba: "${insumoPruebaNombre}"...`);
    await page.evaluate(async (nombre) => {
      const token = localStorage.getItem('token') || localStorage.getItem('aura_auth_token') || '';
      const rol = localStorage.getItem('user_rol') || 'admin';
      const headers = {
        'Content-Type': 'application/json',
        'x-negocio-id': '1',
        'x-user-rol': rol,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/admin/inventario?negocio_id=1', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nombre,
          categoria: 'Bar',
          unidad_medida: 'Cuarta (250ml)',
          costo_unitario: 2500,
          stock_actual: 10,
          stock_minimo: 2,
          es_licor: 1,
          capacidad_ml: 250,
          medida_shot_ml: 30,
          negocio_id: 1
        })
      });
      const data = await res.json();
      console.log('Insumo test creado status:', res.status, data);
      return res.status;
    }, insumoPruebaNombre);
    await new Promise(r => setTimeout(r, 1000));

    // 4. Abrir modal "Gestionar Insumos"
    console.log('Abriendo modal "Gestionar Insumos"...');
    await page.click('#btn-gestionar-insumos');
    await new Promise(r => setTimeout(r, 1200));

    await page.screenshot({ path: 'verify_08_modal_gestionar_insumos.png' });
    console.log('📸 Captura guardada: verify_08_modal_gestionar_insumos.png');

    // 5. Buscar el insumo en el buscador del modal
    console.log(`Buscando insumo "${insumoPruebaNombre}" en el buscador del modal...`);
    const searchInput = 'input[placeholder*="Buscar por nombre"]';
    await page.waitForSelector(searchInput, { timeout: 4000 });
    await page.type(searchInput, insumoPruebaNombre);
    await new Promise(r => setTimeout(r, 800));

    // Verificar que aparece en la tabla
    const filaEncontrada = await page.evaluate((nombre) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return rows.some(r => r.innerText.includes(nombre));
    }, insumoPruebaNombre);

    console.log(`¿Insumo visible en la tabla?: ${filaEncontrada}`);
    if (!filaEncontrada) {
      throw new Error(`FALLO: No se encontró la fila con "${insumoPruebaNombre}"`);
    }

    // 6. Probar Edición del Insumo
    console.log('Probando botón "Editar"...');
    await page.evaluate(() => {
      const editBtn = document.querySelector('tbody tr button[title*="Editar"]');
      if (editBtn) editBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({ path: 'verify_09_submodal_editar_insumo.png' });
    console.log('📸 Captura guardada: verify_09_submodal_editar_insumo.png');

    // Cambiar costo a 3200
    console.log('Modificando costo a ₡3.200...');
    const costoInput = 'input[type="number"][placeholder="0"]';
    await page.evaluate((sel) => {
      const inp = document.querySelector(sel);
      if (inp) {
        inp.value = '3200';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, costoInput);

    // Guardar cambios
    await page.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Guardar Cambios'));
      if (saveBtn) saveBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    console.log('✅ Cambios guardados');

    // 7. Probar Eliminación del Insumo
    console.log('Probando botón "Eliminar" (Papelera roja)...');
    await page.evaluate(() => {
      const delBtn = document.querySelector('tbody tr button[title*="Eliminar"]');
      if (delBtn) delBtn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.screenshot({ path: 'verify_10_confirmar_eliminacion_insumo.png' });
    console.log('📸 Captura guardada: verify_10_confirmar_eliminacion_insumo.png');

    // Confirmar en el modal de confirmación
    console.log('Confirmando eliminación en el diálogo de seguridad...');
    await page.evaluate(() => {
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Sí, Eliminar Insumo'));
      if (confirmBtn) confirmBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Verificar que ya no está en la tabla
    const sigueExistiendo = await page.evaluate((nombre) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      return rows.some(r => r.innerText.includes(nombre));
    }, insumoPruebaNombre);

    console.log(`¿Sigue existiendo después de borrar?: ${sigueExistiendo}`);
    if (sigueExistiendo) {
      throw new Error('FALLO: El insumo todavía aparece en la lista después de eliminarlo');
    }

    console.log('✅ ÉXITO: El insumo fue eliminado correctamente de bodega y removido de la vista.');
    await page.screenshot({ path: 'verify_11_insumo_eliminado_exitoso.png' });
    console.log('📸 Captura guardada: verify_11_insumo_eliminado_exitoso.png');

    console.log('🎉 TODAS LAS PRUEBAS DE GESTIÓN DE INSUMOS COMPLETADAS CON ÉXITO.');
  } catch (err) {
    console.error('❌ Error durante la verificación:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
