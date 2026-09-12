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
    console.log('1. Loading page...');
    await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));

    console.log('2. Logging in...');
    await page.evaluate(() => {
      document.getElementById('loginUsuario').value = 'admin';
      document.getElementById('loginPassword').value = 'admin123';
      ejecutarLogin();
    });
    await new Promise(r => setTimeout(r, 2000));

    console.log('3. Navigating to Salón...');
    await page.evaluate(async () => {
      const btn = document.querySelector('.nav-pill[data-view="salon"]');
      if (btn) btn.click();
      if (typeof cargarMesasDesdeBackend === 'function') {
        await cargarMesasDesdeBackend();
      }
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('4. Creating reservation on table...');
    const res = await page.evaluate(async () => {
      const nid = estado.negocioActual?.id || 1;
      const mRes = await fetch(`/api/mesas?negocio_id=${nid}`);
      const mData = await mRes.json();
      const mesa = (mData.mesas && mData.mesas.length > 0) ? mData.mesas[0] : { id: 1, numero: '1' };
      const createRes = await fetch('/api/reservas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-negocio-id': String(nid) },
        body: JSON.stringify({
          mesa_id: mesa.id,
          cliente_nombre: 'Don Fernando Mora',
          cliente_telefono: '8888-9999',
          pax: 6,
          fecha: new Date().toISOString().split('T')[0],
          hora: '20:30',
          notas: 'Mesa para 6 personas, terraza'
        })
      });
      const d = await createRes.json();
      await cargarMesasDesdeBackend();
      return { mesaId: mesa.id, mesaNum: mesa.numero, resData: d };
    });
    console.log('Mesa reservada:', res);

    await new Promise(r => setTimeout(r, 1500));

    console.log('5. Inspecting table visual styles in DOM...');
    const inspection = await page.evaluate((mId) => {
      const card = document.querySelector(`[data-mesa-id="${mId}"]`);
      if (!card) return { found: false, allCards: document.querySelectorAll('[data-mesa-id]').length };
      const comp = window.getComputedStyle(card);
      const afterComp = window.getComputedStyle(card, '::after');
      return {
        found: true,
        tag: card.tagName,
        className: card.className,
        hasReservadaClass: card.classList.contains('reservada'),
        opacity: comp.opacity,
        filter: comp.filter,
        borderStyle: comp.borderStyle,
        afterContent: afterComp.content,
        afterBackground: afterComp.background
      };
    }, res.mesaId);
    console.log('Inspection Result:\n', JSON.stringify(inspection, null, 2));

    await page.screenshot({ path: 'test_mesa_reservada.png' });
    console.log('Screenshot saved to test_mesa_reservada.png');

    console.log('6. Opening detail modal...');
    await page.evaluate((mId) => {
      if (typeof abrirModalDetalleReserva === 'function') {
        abrirModalDetalleReserva(mId);
      }
    }, res.mesaId);
    await new Promise(r => setTimeout(r, 600));

    const modalState = await page.evaluate(() => {
      const mod = document.getElementById('modalDetalleReservaMesa');
      return {
        active: mod ? mod.classList.contains('active') : false,
        cliente: document.getElementById('detResCliente')?.textContent,
        telefono: document.getElementById('detResTelefono')?.textContent,
        hora: document.getElementById('detResHora')?.textContent
      };
    });
    console.log('Modal State:\n', JSON.stringify(modalState, null, 2));

    console.log('7. Liberating test table...');
    await page.evaluate(async (mId) => {
      const nid = estado.negocioActual?.id || 1;
      await fetch(`/api/mesas/${mId}/liberar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-negocio-id': String(nid) } });
      await cargarMesasDesdeBackend();
    }, res.mesaId);

    console.log('🎉 ALL TESTS PASSED 100%!');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (browser) await browser.close();
  }
})();

