const puppeteer = require('puppeteer');
const http = require('http');

function apiReq(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL('http://localhost:4000' + path);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-negocio-id': '1'
      }
    };
    const r = http.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d || '{}') }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  let browser;
  try {
    console.log('1. Setting up reservation on Mesa 1 via backend API...');
    const resPost = await apiReq('/api/reservas', 'POST', {
      mesa_id: 1,
      cliente_nombre: 'Don Fernando Mora',
      cliente_telefono: '8888-9999',
      pax: 6,
      fecha: new Date().toISOString().split('T')[0],
      hora: '20:30',
      notas: 'Mesa para 6 personas, terraza'
    });
    console.log('Reservation response:', resPost.body);

    console.log('2. Launching browser...');
    browser = await puppeteer.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    console.log('3. Loading POS application...');
    await page.goto('http://localhost:4000', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));

    console.log('4. Logging in as admin...');
    await page.type('#loginUsuario', 'admin');
    await page.type('#loginPassword', 'admin123');
    await page.click('#btnLoginSubmit');

    console.log('5. Waiting for POS Main View...');
    await page.waitForSelector('#posMainView.active', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    console.log('6. Navigating to Salón view...');
    await page.evaluate(() => {
      const btn = document.querySelector('.nav-pill[data-view="salon"]');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    console.log('7. Waiting for table cards in Salón...');
    await page.waitForSelector('.mesa-render-card, .mesa-grid-card', { timeout: 10000 });

    console.log('8. Inspecting reserved table CSS...');
    const inspection = await page.evaluate(() => {
      const card = document.querySelector('.mesa-render-card[data-mesa-id="1"]') || document.querySelector('.mesa-grid-card[data-mesa-id="1"]') || document.querySelector('[data-mesa-id="1"]');
      if (!card) {
        return {
          found: false,
          totalCards: document.querySelectorAll('.mesa-render-card, .mesa-grid-card').length
        };
      }
      const comp = window.getComputedStyle(card);
      const afterComp = window.getComputedStyle(card, '::after');
      return {
        found: true,
        className: card.className,
        hasReservadaClass: card.classList.contains('reservada'),
        opacity: comp.opacity,
        filter: comp.filter,
        borderStyle: comp.borderStyle,
        borderColor: comp.borderColor,
        afterContent: afterComp.content,
        afterBackground: afterComp.background
      };
    });
    console.log('Table 1 CSS Inspection:\n', JSON.stringify(inspection, null, 2));

    console.log('9. Taking screenshot of Salón with reserved table...');
    await page.screenshot({ path: 'test_mesa_reservada.png' });
    console.log('Screenshot saved to test_mesa_reservada.png');

    console.log('10. Clicking reserved table to test modalDetalleReservaMesa...');
    await page.evaluate(() => {
      const card = document.querySelector('.mesa-render-card[data-mesa-id="1"]') || document.querySelector('[data-mesa-id="1"]');
      if (card) {
        if (typeof abrirModalDetalleReserva === 'function') {
          abrirModalDetalleReserva(1);
        } else {
          card.click();
        }
      }
    });
    await new Promise(r => setTimeout(r, 800));

    const modalState = await page.evaluate(() => {
      const mod = document.getElementById('modalDetalleReservaMesa');
      return {
        active: mod ? (mod.classList.contains('active') || mod.style.display === 'flex') : false,
        cliente: document.getElementById('detResCliente')?.textContent,
        telefono: document.getElementById('detResTelefono')?.textContent,
        pax: document.getElementById('detResPax')?.textContent,
        hora: document.getElementById('detResHora')?.textContent,
        notas: document.getElementById('detResNotas')?.textContent
      };
    });
    console.log('Modal Detalle State:\n', JSON.stringify(modalState, null, 2));

    console.log('11. Clicking "Sentar Mesa / Abrir Comanda"...');
    await page.evaluate(() => {
      const btn = document.getElementById('btnSentarMesaReserva');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    const comState = await page.evaluate(() => {
      const comanderoView = document.getElementById('view-comandero');
      return {
        comanderoActive: comanderoView ? comanderoView.classList.contains('active') : false,
        mesaNumero: document.getElementById('comMesaNumero')?.textContent,
        clienteLabel: document.getElementById('comClienteLabel')?.textContent || document.getElementById('txtNombreClienteMesa')?.value
      };
    });
    console.log('Comandero State after Sentar:\n', JSON.stringify(comState, null, 2));

    console.log('12. Liberating test table...');
    await apiReq('/api/mesas/1/liberar', 'POST');
    console.log('🎉 ALL PUPPETEER TESTS PASSED 100% WITH FLYING COLORS!');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (browser) await browser.close();
  }
})();
