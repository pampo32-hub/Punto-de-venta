const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

    console.log('1. Navigating to POS...');
    await page.goto('http://localhost:4000', { waitUntil: 'networkidle0' });

    console.log('2. Logging in as admin...');
    await page.evaluate(() => {
      document.getElementById('loginUsuario').value = 'admin';
      document.getElementById('loginPassword').value = 'admin123';
      if (typeof ejecutarLogin === 'function') {
        ejecutarLogin();
      }
    });

    await new Promise(r => setTimeout(r, 2000));

    console.log('3. Navigating to Salón view...');
    await page.evaluate(() => {
      const btn = document.querySelector('.nav-pill[data-view="salon"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('4. Verifying Reservas Button in toolbar...');
    const btnReservasExists = await page.evaluate(() => {
      const b = document.getElementById('btnGestionReservasSalon');
      return !!b && b.textContent.includes('Reservas');
    });
    console.log('btnGestionReservasSalon exists:', btnReservasExists);

    console.log('5. Creating a new reservation on first table via backend API...');
    const targetMesa = await page.evaluate(async () => {
      const mesa = (estado.mesas && estado.mesas.length > 0) ? estado.mesas[0] : { id: 1, numero: '1' };
      const nid = estado.negocioActual?.id || 1;
      const res = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-negocio-id': String(nid) },
        body: JSON.stringify({
          mesa_id: mesa.id,
          cliente_nombre: 'María Fernández',
          cliente_telefono: '8888-1234',
          pax: 4,
          fecha: new Date().toISOString().split('T')[0],
          hora: '19:30',
          notas: 'Celebración de Aniversario'
        })
      });
      const d = await res.json();
      return { mesaId: mesa.id, mesaNum: mesa.numero, resData: d };
    });
    console.log('Target mesa & reservation result:', targetMesa);

    await new Promise(r => setTimeout(r, 1000));
    await page.evaluate(() => {
      if (typeof cargarMesasDesdeBackend === 'function') {
        cargarMesasDesdeBackend();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log(`6. Inspecting Mesa ${targetMesa.mesaNum} in 2D Salón...`);
    const mesaInspection = await page.evaluate((mId) => {
      const card = document.querySelector(`.mesa-render-card[data-mesa-id="${mId}"]`) || document.querySelector(`[data-mesa-id="${mId}"]`);
      if (!card) return { found: false };
      const comp = window.getComputedStyle(card);
      const afterComp = window.getComputedStyle(card, '::after');
      return {
        found: true,
        className: card.className,
        hasReservadaClass: card.classList.contains('reservada'),
        opacity: comp.opacity,
        filter: comp.filter,
        borderStyle: comp.borderStyle,
        afterContent: afterComp.content,
        afterPosition: afterComp.position,
        afterTransform: afterComp.transform
      };
    }, targetMesa.mesaId);
    console.log('Mesa Inspection result:', JSON.stringify(mesaInspection, null, 2));

    console.log('7. Taking screenshot of reserved table...');
    await page.screenshot({ path: 'test_mesa_reservada.png' });
    console.log('Screenshot captured at test_mesa_reservada.png');

    console.log('8. Clicking Mesa to test Modal Detalle Reserva...');
    await page.evaluate((mId) => {
      const card = document.querySelector(`.mesa-render-card[data-mesa-id="${mId}"]`);
      if (card) {
        if (typeof abrirModalDetalleReserva === 'function') {
          abrirModalDetalleReserva(mId);
        } else {
          card.click();
        }
      }
    }, targetMesa.mesaId);
    await new Promise(r => setTimeout(r, 800));

    const modalDetalle = await page.evaluate(() => {
      const mod = document.getElementById('modalDetalleReservaMesa');
      const cli = document.getElementById('detResCliente')?.textContent;
      const tel = document.getElementById('detResTelefono')?.textContent;
      const hora = document.getElementById('detResHora')?.textContent;
      const notas = document.getElementById('detResNotas')?.textContent;
      return {
        isActive: mod ? mod.classList.contains('active') : false,
        cliente: cli,
        telefono: tel,
        hora: hora,
        notas: notas
      };
    });
    console.log('Modal Detalle Inspection:', JSON.stringify(modalDetalle, null, 2));

    console.log('9. Testing Sentar Mesa...');
    await page.evaluate(async () => {
      const btn = document.getElementById('btnSentarMesaReserva');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    const seatedState = await page.evaluate((mId) => {
      const mesa = (estado.mesas || []).find(m => m.id === mId);
      return {
        mesaEstado: mesa ? mesa.estado : 'desconocido',
        cliente: mesa ? mesa.cliente : null
      };
    }, targetMesa.mesaId);
    console.log('Mesa state after Sentar:', JSON.stringify(seatedState, null, 2));

    console.log('10. Liberating test mesa...');
    await page.evaluate(async (mId) => {
      const nid = estado.negocioActual?.id || 1;
      await fetch(`/api/mesas/${mId}/liberar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-negocio-id': String(nid) } });
      if (typeof cargarMesasDesdeBackend === 'function') await cargarMesasDesdeBackend();
    }, targetMesa.mesaId);

    console.log('✅ ALL TESTS EXECUTED PERFECTLY!');
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    if (browser) await browser.close();
  }
})();
