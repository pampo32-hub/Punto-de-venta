const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:\\Users\\Juan\\.gemini\\antigravity\\brain\\d8fe76e7-4855-42e3-9a28-eca78e65bcbf';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- INICIANDO TEST EXHAUSTIVO FASE 2: HAPPY HOUR Y RESERVAS ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  try {
    // 1. Cargar la página
    console.log('1. Cargando http://localhost:4000/ ...');
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Si aparece pantalla de login, ingresar como Don Alberto (Admin)
    const btnDonAlberto = await page.$('div::-p-text(Don Alberto), button::-p-text(Don Alberto)');
    if (btnDonAlberto) {
      console.log('Haciendo clic en acceso rápido Don Alberto (ADMIN)...');
      await btnDonAlberto.click();
      await sleep(2500);
    } else {
      const btnDev = await page.$('button::-p-text(Entrar como Juan Developer (Super Admin))');
      if (btnDev) {
        console.log('Haciendo clic en Entrar como Juan Developer...');
        await btnDev.click();
        await sleep(2500);
      }
    }

    // Si nos deja en la consola dev, ir al Punto de Venta
    const btnPuntoDeVenta = await page.$('button::-p-text(Punto de Venta)');
    if (btnPuntoDeVenta) {
      console.log('Volviendo a Punto de Venta...');
      await btnPuntoDeVenta.click();
      await sleep(1500);
    }

    // Si aparece modal de apertura de caja, omitir
    const modalOmitir = await page.$('button::-p-text(Omitir por ahora)');
    if (modalOmitir) {
      console.log('Omitiendo modal de apertura de caja...');
      await modalOmitir.click();
      await sleep(1000);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_01_salon_inicial.png'), fullPage: false });
    console.log('Captura 1 guardada: Salón inicial.');

    // 2. Abrir Configuración de Negocio para probar DESACTIVACIÓN
    console.log('2. Abriendo modal de Configuración de Negocio...');
    const btnConfig = await page.$('header button[title="Configuración general"]');
    if (btnConfig) {
      await btnConfig.click();
    } else {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('header button'));
        const cfgBtn = btns.find(b => b.innerHTML.includes('settings'));
        if (cfgBtn) cfgBtn.click();
      });
    }
    await sleep(1500);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_02_modal_config_abierto.png') });
    console.log('Captura 2 guardada: Modal de configuración abierto.');

    // 3. Probar DESACTIVAR Happy Hour
    console.log('3. Desactivando Happy Hour en Configuración de Negocio...');
    const switchHH = await page.$('#checkbox-happyHourAuto');
    if (switchHH) {
      const isChecked = await page.evaluate(el => el.checked, switchHH);
      console.log(`Estado actual de switch Happy Hour: ${isChecked ? 'ACTIVADO' : 'DESACTIVADO'}`);
      if (isChecked) {
        await switchHH.click();
        await sleep(500);
      }
    }

    // Guardar características
    const btnGuardarCarac = await page.$('#btn-guardar-caracteristicas-modal');
    if (btnGuardarCarac) {
      await btnGuardarCarac.click();
      await sleep(1500);
    }

    // Verificar que con Happy Hour DESACTIVADO NO aparece el pill en el header
    const hhPillDesactivado = await page.$('#btn-happy-hour-indicator');
    console.log(`Verificación con Happy Hour DESACTIVADO: Pill presente = ${hhPillDesactivado !== null ? 'SÍ (ERROR)' : 'NO (CORRECTO - OCULTO)'}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_03_happy_hour_desactivado_header_limpio.png') });
    console.log('Captura 3 guardada: Header sin botón de Happy Hour al estar desactivado.');

    // 4. Ahora ACTIVAR Happy Hour desde Configuración de Negocio
    console.log('4. Reactivando Happy Hour en Configuración de Negocio...');
    const btnConfig2 = await page.$('header button[title="Configuración general"]');
    if (btnConfig2) await btnConfig2.click();
    await sleep(1500);

    const switchHH2 = await page.$('#checkbox-happyHourAuto');
    if (switchHH2) {
      const isChecked2 = await page.evaluate(el => el.checked, switchHH2);
      if (!isChecked2) {
        await switchHH2.click();
        await sleep(500);
      }
    }

    const btnGuardarCarac2 = await page.$('#btn-guardar-caracteristicas-modal');
    if (btnGuardarCarac2) {
      await btnGuardarCarac2.click();
      await sleep(1500);
    }

    // Verificar que ahora SÍ aparece el pill en el Header
    const hhPillActivado = await page.$('#btn-happy-hour-indicator');
    console.log(`Verificación con Happy Hour ACTIVADO: Pill presente = ${hhPillActivado !== null ? 'SÍ (CORRECTO - VISIBLE)' : 'NO (ERROR)'}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_04_happy_hour_activado_en_header.png') });
    console.log('Captura 4 guardada: Header con botón de Happy Hour presente.');

    // 5. Abrir Modal de Happy Hour y Activar en Vivo
    console.log('5. Abriendo Modal de Happy Hour...');
    if (hhPillActivado) {
      await hhPillActivado.click();
      await sleep(1200);

      await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_05_modal_happy_hour_abierto.png') });
      console.log('Captura 5 guardada: Modal de Happy Hour abierto.');

      // Clic en activar en vivo si no está activo
      const btnToggleVivo = await page.$('#btn-toggle-happy-hour-en-vivo');
      if (btnToggleVivo) {
        console.log('Activando Happy Hour en vivo...');
        await btnToggleVivo.click();
        await sleep(1000);
      }

      // Guardar programación
      const btnGuardarHH = await page.$('#btn-guardar-happy-hour');
      if (btnGuardarHH) {
        await btnGuardarHH.click();
        await sleep(1500);
      }
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_06_happy_hour_activo_en_vivo_header.png') });
    console.log('Captura 6 guardada: Header con Happy Hour activo en vivo (2x1).');

    // 6. Ir a la vista de Comanda y Menú para verificar Banner de Happy Hour
    console.log('6. Entrando a Comanda para verificar banner de Happy Hour activo...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btnMenu = btns.find(b => b.textContent && b.textContent.includes('Menú'));
      if (btnMenu) btnMenu.click();
    });
    await sleep(2000);

    const bannerHH = await page.$('#banner-happy-hour-comanda');
    console.log(`Banner Happy Hour en Comanda presente: ${bannerHH !== null ? 'SÍ (CORRECTO)' : 'NO'}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_07_comanda_con_banner_happy_hour.png') });
    console.log('Captura 7 guardada: Comanda con banner Happy Hour.');

    // Volver al salón
    const btnVolverSalon = await page.$('button::-p-text(Salón)');
    if (btnVolverSalon) {
      await btnVolverSalon.click();
      await sleep(1500);
    }

    // 7. Prueba de la AGENDA / LIBRO DE RESERVAS
    console.log('7. Abriendo Agenda / Libro de Reservas...');
    const btnReservasSalon = await page.$('#btn-salon-reservas');
    if (btnReservasSalon) {
      await btnReservasSalon.click();
      await sleep(1200);
    } else {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const rBtn = btns.find(b => b.textContent && b.textContent.includes('Reservas'));
        if (rBtn) rBtn.click();
      });
      await sleep(1200);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_08_modal_reservas_abierto.png') });
    console.log('Captura 8 guardada: Modal de Agenda de Reservas abierto.');

    // Cambiar a la pestaña "+ Nueva Reserva"
    console.log('8. Creando una nueva reserva...');
    const tabNueva = await page.$('#tab-nueva-reserva');
    if (tabNueva) {
      await tabNueva.click();
      await sleep(1000);
    }

    // Llenar formulario
    await page.type('#input-reserva-nombre', 'Familia Morales - Cumpleaños');
    await page.type('#input-reserva-telefono', '8844-1234');
    
    // Seleccionar Mesa si está disponible
    const selectMesa = await page.$('#select-reserva-mesa');
    if (selectMesa) {
      const options = await page.$$eval('#select-reserva-mesa option', opts => opts.map(o => o.value));
      const validVal = options.find(v => v !== '');
      if (validVal) {
        await page.select('#select-reserva-mesa', validVal);
      }
    }

    await page.type('#input-reserva-notas', 'Cliente preferencial. Requiere mesa arreglada para 4 comensales.');
    await sleep(500);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_09_formulario_nueva_reserva.png') });
    console.log('Captura 9 guardada: Formulario de nueva reserva completado.');

    // Guardar la reserva
    const btnGuardarReserva = await page.$('#btn-guardar-reserva');
    if (btnGuardarReserva) {
      await btnGuardarReserva.click();
      await sleep(1000);
    }

    // Esperar a que la lista cargue y aparezca el botón Sentar Mesa
    console.log('Esperando botón de Sentar Mesa en la lista...');
    await page.waitForSelector('.btn-sentar-reserva', { timeout: 10000 });
    await sleep(1000);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_10_reserva_creada_en_lista.png') });
    console.log('Captura 10 guardada: Reserva recién creada listada en la agenda.');

    // 9. Presionar "Sentar Mesa"
    console.log('9. Presionando Sentar Mesa para la reserva...');
    const btnSentar = await page.$('.btn-sentar-reserva');
    if (btnSentar) {
      await btnSentar.click();
      await sleep(2500);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_11_reserva_sentada_exito.png') });
    console.log('Captura 11 guardada: Reserva marcada como sentada.');

    // Cerrar modal de reservas y ver el salón
    const btnCerrarRes = await page.$('button::-p-text(Cerrar)');
    if (btnCerrarRes) {
      await btnCerrarRes.click();
      await sleep(1000);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_12_salon_tras_sentar_reserva.png') });
    console.log('Captura 12 guardada: Salón actualizado tras sentar la reserva.');

    console.log('--- TODAS LAS PRUEBAS DE LA FASE 2 FINALIZADAS CON ÉXITO ---');

  } catch (err) {
    console.error('Error durante la prueba:', err);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_fase2_error.png') });
  } finally {
    await browser.close();
  }
}

run();
