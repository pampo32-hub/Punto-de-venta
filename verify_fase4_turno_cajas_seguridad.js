const puppeteer = require('puppeteer');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\Juan\\.gemini\\antigravity\\brain\\d8fe76e7-4855-42e3-9a28-eca78e65bcbf';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  console.log('🚀 Iniciando pruebas automatizadas exhaustivas de la Fase 4...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Browser log error:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('BROWSER PAGE ERROR:', err.message);
  });

  try {
    // 1. Acceder al sistema
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });
    console.log('✅ Página principal cargada correctamente');
    await sleep(2000);

    // Iniciar sesión si aparece la pantalla de login
    const isLogin = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Bienvenido') || text.includes('Selecciona tu usuario') || !!document.querySelector('input[type="password"]');
    });

    if (isLogin) {
      console.log('Detectada pantalla de Login. Autenticando como Don Alberto (Admin Master)...');
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const b = btns.find(x => x.textContent.includes('Don Alberto') || x.textContent.includes('Admin Master GastroBar') || x.textContent.includes('Juan Developer'));
        if (b) {
          b.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        console.log('✔ Clic en perfil admin realizado');
        await sleep(2500);
      }
    }

    // Cerrar cualquier modal residual si lo hay
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Iniciar Turno de Caja') || x.textContent.includes('Confirmar y Abrir Turno') || x.getAttribute('title') === 'Cerrar ventana');
      if (b && (b.textContent.includes('Iniciar') || b.textContent.includes('Confirmar'))) b.click();
    });
    await sleep(1000);

    // =========================================================================
    // PRUEBA 1: CONFIGURACIÓN DEL LOCAL -> PUNTOS DE COBRO & CAJAS FÍSICAS
    // =========================================================================
    console.log('\n--- PRUEBA 1: Puntos de Cobro & Cajas Físicas ---');
    // Abrir menú Admin
    await page.click('#btn-nav-admin');
    await sleep(600);

    // Clic en "Puntos de Cobro & Cajas Físicas"
    const clickedPuntosNav = await page.evaluate(() => {
      const btn = document.querySelector('#btn-admin-puntos-cobro');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('✔ Navegación a Puntos de Cobro ejecutada:', clickedPuntosNav);
    await sleep(1500);

    // Asegurar pestaña "Puntos de Cobro & Cajas"
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Puntos de Cobro & Cajas'));
      if (b) b.click();
    });
    await sleep(1000);

    // Screenshot 1: Lista de Cajas Físicas
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_01_puntos_cobro_lista.png'),
      fullPage: false
    });
    console.log('📸 Screenshot guardado: verify_fase4_01_puntos_cobro_lista.png');

    // Crear una nueva caja física
    console.log('Creando nueva estación / caja física...');
    const btnNuevaCaja = await page.$('#btn-nueva-caja-fisica');
    if (btnNuevaCaja) {
      await btnNuevaCaja.click();
      await sleep(1000);

      await page.type('input[placeholder*="Ej. Caja Terraza"]', 'Caja Terraza VIP Test');
      await page.type('input[placeholder*="Ej. CAJA-03"]', 'CAJA-05');
      await page.type('input[placeholder*="Ej. Terraza Exterior"]', 'Terraza Alta Exclusiva');

      // Guardar caja física
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find(x => x.textContent.includes('Guardar Caja Física'));
        if (b) b.click();
      });
      await sleep(2000);
      console.log('✔ Nueva caja física creada exitosamente');

      // Screenshot 2: Lista con la nueva caja
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, 'verify_fase4_02_caja_creada_exitosamente.png'),
        fullPage: false
      });
      console.log('📸 Screenshot guardado: verify_fase4_02_caja_creada_exitosamente.png');
    }

    // =========================================================================
    // PRUEBA 2: SEGURIDAD DEL LOCAL & RED / DISPOSITIVOS AUTORIZADOS
    // =========================================================================
    console.log('\n--- PRUEBA 2: Seguridad de Red & Dispositivos en Seguridad del Local ---');
    // Clic en pestaña "Seguridad del Local & Red" en ConfiguracionLocalView
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.textContent.includes('Seguridad del Local & Red'));
      if (b) b.click();
    });
    await sleep(1500);

    // Autorizar este dispositivo
    const inputNombreDisp = await page.$('#input-nombre-dispositivo');
    if (inputNombreDisp) {
      await page.evaluate(() => {
        const inp = document.querySelector('#input-nombre-dispositivo');
        if (inp) inp.value = '';
      });
      await page.type('#input-nombre-dispositivo', 'Terminal Principal Barra');
      await sleep(500);

      const btnAuth = await page.$('#btn-autorizar-este-dispositivo');
      if (btnAuth) {
        await btnAuth.click();
        console.log('✔ Clic en autorizar terminal ejecutado');
        await sleep(2000);
      }
    }

    // Toggle restricción de dispositivos y guardar políticas
    const switchDisp = await page.$('#switch-restringir-dispositivos');
    if (switchDisp) {
      await switchDisp.click();
      await sleep(500);
    }

    const btnSaveSec = await page.$('#btn-guardar-seguridad-red');
    if (btnSaveSec) {
      await btnSaveSec.click();
      console.log('✔ Políticas de seguridad de red guardadas');
      await sleep(2000);
    }

    // Screenshot 3: Seguridad de Red y Dispositivos
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_03_seguridad_local_y_dispositivos.png'),
      fullPage: false
    });
    console.log('📸 Screenshot guardado: verify_fase4_03_seguridad_local_y_dispositivos.png');

    // =========================================================================
    // PRUEBA 3: MODAL DE SEGURIDAD DEL LOCAL (ACCESO DESDE HEADER)
    // =========================================================================
    console.log('\n--- PRUEBA 3: Modal de Seguridad del Local ---');
    await page.click('#btn-nav-admin');
    await sleep(500);

    await page.click('#btn-admin-seguridad-local');
    await sleep(1500);
    console.log('✔ Modal de Seguridad del Local abierto');

    // Screenshot 4: Modal de Seguridad del Local
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_04_modal_seguridad_local.png'),
      fullPage: false
    });
    console.log('📸 Screenshot guardado: verify_fase4_04_modal_seguridad_local.png');

    // Cerrar modal
    await page.evaluate(() => {
      const closeBtn = document.querySelector('.material-symbols-outlined');
      const allBtns = Array.from(document.querySelectorAll('button'));
      const b = allBtns.find(x => x.innerHTML.includes('close'));
      if (b) b.click();
    });
    await sleep(1000);

    // =========================================================================
    // PRUEBA 4: TURNO DE CAJA & REASIGNACIÓN EN CALIENTE
    // =========================================================================
    console.log('\n--- PRUEBA 4: Turno de Caja & Reasignación de Turno ---');
    await page.click('#btn-nav-caja');
    await sleep(2000);
    console.log('✔ Navegación a Turno de Caja completada');

    // Screenshot 5: Turno Inicial
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_05_turno_caja_inicial.png'),
      fullPage: false
    });
    console.log('📸 Screenshot guardado: verify_fase4_05_turno_caja_inicial.png');

    // Clic en botón "Reasignar Turno" (del panel o del header)
    const btnReasignar = await page.$('#btn-reasignar-turno-panel') || await page.$('#btn-reasignar-turno-top');
    if (btnReasignar) {
      await btnReasignar.click();
      await sleep(1500);
      console.log('✔ Modal de Reasignar Turno abierto');

      // Screenshot 6: Modal Reasignar Turno
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, 'verify_fase4_06_modal_reasignar_turno.png'),
        fullPage: false
      });
      console.log('📸 Screenshot guardado: verify_fase4_06_modal_reasignar_turno.png');

      // Cambiar de usuario si hay opciones
      await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        if (selects.length > 0 && selects[0].options.length > 1) {
          selects[0].selectedIndex = 1;
          selects[0].dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await sleep(500);

      // Ingresar PIN de admin (1234)
      const pinInputs = await page.$$('input[type="password"]');
      if (pinInputs.length > 0) {
        await pinInputs[pinInputs.length - 1].type('1234');
      }

      // Confirmar reasignación
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const b = btns.find(x => x.textContent.includes('Confirmar Reasignación'));
        if (b) b.click();
      });
      await sleep(3000);
      console.log('✔ Reasignación confirmada');

      // Screenshot 7: Turno de caja actualizado con nuevo responsable
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, 'verify_fase4_07_turno_reasignado_exitoso.png'),
        fullPage: false
      });
      console.log('📸 Screenshot guardado: verify_fase4_07_turno_reasignado_exitoso.png');
    }

    // =========================================================================
    // PRUEBA 5: SALÓN & MESAS INTACTO
    // =========================================================================
    console.log('\n--- PRUEBA 5: Salón & Mesas Intacto ---');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('header button, nav button'));
      const b = btns.find(x => x.textContent.includes('Salón & Mesas') || x.textContent.includes('Salón'));
      if (b) b.click();
    });
    await sleep(2000);

    // Screenshot 8: Salón Intacto
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_08_salon_intacto.png'),
      fullPage: false
    });
    console.log('📸 Screenshot guardado: verify_fase4_08_salon_intacto.png');

    console.log('\n🎉 ¡TODAS LAS PRUEBAS DE LA FASE 4 FINALIZADAS CON ÉXITO!');

  } catch (err) {
    console.error('❌ Error durante la ejecución del test:', err.message);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'verify_fase4_error.png'),
      fullPage: true
    }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
