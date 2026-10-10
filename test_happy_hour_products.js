const puppeteer = require('puppeteer');
const path = require('path');
const db = require('./database');

const ARTIFACT_DIR = 'C:\\Users\\Juan\\.gemini\\antigravity\\brain\\d8fe76e7-4855-42e3-9a28-eca78e65bcbf';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function queryDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

(async () => {
  console.log('=== TEST VERIFICACIÓN DE CHECK HAPPY HOUR EN CREACIÓN Y EDICIÓN DE PRODUCTOS ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('response', resp => {
    if (resp.url().includes('/productos')) {
      console.log(`API RESP [${resp.status()}]: ${resp.url()}`);
    }
  });

  try {
    console.log('1. Cargando http://localhost:4000/ ...');
    await page.goto('http://localhost:4000/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Login si es necesario
    const btnDonAlberto = await page.$('div::-p-text(Don Alberto), button::-p-text(Don Alberto)');
    if (btnDonAlberto) {
      console.log('Iniciando sesión con Don Alberto (ADMIN)...');
      await btnDonAlberto.click();
      await sleep(2500);
    }

    const btnDev = await page.$('button::-p-text(Entrar como Juan Developer (Super Admin))');
    if (btnDev) {
      await btnDev.click();
      await sleep(2000);
    }

    const btnPuntoDeVenta = await page.$('button::-p-text(Punto de Venta)');
    if (btnPuntoDeVenta) {
      await btnPuntoDeVenta.click();
      await sleep(1500);
    }

    const modalOmitir = await page.$('button::-p-text(Omitir por ahora)');
    if (modalOmitir) {
      await modalOmitir.click();
      await sleep(1000);
    }

    // 2. Navegar a Menú / Comanda
    console.log('2. Navegando a Menú...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const menuBtn = btns.find(b => b.textContent && (b.textContent.includes('Menú') || b.textContent.includes('Menu')));
      if (menuBtn) menuBtn.click();
    });
    await sleep(2500);

    // 3. Abrir modal "Agregar Producto"
    console.log('3. Abriendo modal "Agregar Producto"...');
    await page.click('#btn-agregar-producto');
    await sleep(1000);

    // Verificar que el check existe y está DESACTIVADO por defecto
    const isCreateChecked = await page.evaluate(() => {
      const chk = document.getElementById('check-happy-hour-create');
      return chk ? chk.checked : null;
    });
    console.log(`-> Checkbox Happy Hour al crear: existe=${isCreateChecked !== null}, checked=${isCreateChecked}`);
    if (isCreateChecked !== false) {
      throw new Error(`El check debe estar desactivado por defecto (esperado: false, obtenido: ${isCreateChecked})`);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_hh_01_modal_crear_desactivado.png'), fullPage: false });
    console.log('📸 Captura 1 guardada: Modal crear producto con Happy Hour desactivado por defecto.');

    // 4. Llenar formulario y activar el check de Happy Hour
    console.log('4. Creando producto de prueba con Happy Hour activado...');
    const inputSelector = 'input[placeholder*="Chifrijo"]';
    await page.waitForSelector(inputSelector);
    await page.click(inputSelector);
    await page.type(inputSelector, 'Cerveza Especial Test HH', { delay: 30 });
    await sleep(500);

    const typedVal = await page.$eval(inputSelector, el => el.value);
    console.log(`-> Valor escrito en input: "${typedVal}"`);

    // Activar el checkbox de Happy Hour con click nativo
    await page.click('#check-happy-hour-create + div');
    await sleep(500);

    const isNowChecked = await page.evaluate(() => {
      const chk = document.getElementById('check-happy-hour-create');
      return chk ? chk.checked : false;
    });
    console.log(`-> Checkbox tras hacer clic: ${isNowChecked}`);

    // Click nativo en Guardar Producto
    console.log('Enviando formulario...');
    await page.click('button[type="submit"]');
    await sleep(3000);

    // 5. Verificar en Base de Datos
    const rows = await queryDb("SELECT id, nombre, precio, happy_hour FROM Productos WHERE nombre LIKE '%Cerveza Especial Test HH%'");
    console.log('Resultado en Base de Datos:', rows);
    if (!rows || rows.length === 0 || rows[0].happy_hour !== 1) {
      throw new Error('El producto no se guardó con happy_hour = 1 en la base de datos!');
    }
    const testProductId = rows[0].id;
    console.log(`-> Producto creado con ID: ${testProductId} y happy_hour = 1.`);

    // 6. Verificar en UI que la tarjeta tenga el badge de Happy Hour
    await sleep(1500);
    const cardInfo = await page.evaluate((prodId) => {
      const card = document.querySelector(`[data-menu-item-id="${prodId}"]`);
      if (!card) return null;
      const badge = card.innerText.includes('Happy Hour');
      return { found: true, hasBadge: badge };
    }, testProductId);
    console.log('Tarjeta en Menú:', cardInfo);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_hh_02_card_con_badge.png'), fullPage: false });
    console.log('📸 Captura 2 guardada: Tarjeta en catálogo con insignia Happy Hour.');

    // 7. Abrir modal de edición para este producto
    console.log('7. Abriendo modal de edición...');
    await page.evaluate((prodId) => {
      const card = document.querySelector(`[data-menu-item-id="${prodId}"]`);
      if (card) {
        const editBtn = card.querySelector('button[title="Editar platillo"]');
        if (editBtn) editBtn.click();
      }
    }, testProductId);
    await sleep(1000);

    const isEditChecked = await page.evaluate(() => {
      const chk = document.getElementById('check-happy-hour-edit');
      return chk ? chk.checked : null;
    });
    console.log(`-> Checkbox Happy Hour en modal de edición: ${isEditChecked}`);
    if (isEditChecked !== true) {
      throw new Error(`En el modal de edición el check debía estar activado (obtenido: ${isEditChecked})`);
    }

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_hh_03_modal_editar_activo.png'), fullPage: false });
    console.log('📸 Captura 3 guardada: Modal de edición con Happy Hour activo.');

    // 8. Desactivar Happy Hour en edición y guardar
    console.log('8. Desactivando Happy Hour en edición y guardando...');
    await page.click('#check-happy-hour-edit + div');
    await sleep(500);

    console.log('Guardando cambios de edición...');
    await page.click('button[type="submit"]');
    await sleep(2500);

    // Verificar en BD que ahora happy_hour = 0
    const rowsAfter = await queryDb("SELECT id, nombre, precio, happy_hour FROM Productos WHERE id = ?", [testProductId]);
    console.log('Resultado en BD tras editar:', rowsAfter);
    if (!rowsAfter || rowsAfter[0].happy_hour !== 0) {
      throw new Error('El producto no actualizó happy_hour a 0 en la BD!');
    }
    console.log('-> Éxito: En BD happy_hour se actualizó correctamente a 0.');

    await sleep(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_hh_04_card_sin_badge_final.png'), fullPage: false });
    console.log('📸 Captura 4 guardada: Tarjeta tras editar sin insignia Happy Hour.');

    // 9. Limpieza de datos de prueba
    await runDb("DELETE FROM Productos WHERE id = ?", [testProductId]);
    console.log('-> Limpieza completada: producto de prueba eliminado de la base de datos.');

    console.log('=== TODAS LAS PRUEBAS DE HAPPY HOUR EN PRODUCTOS PASARON CON ÉXITO ===');
  } catch (err) {
    console.error('ERROR EN TEST:', err);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verify_hh_error.png'), fullPage: false }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
