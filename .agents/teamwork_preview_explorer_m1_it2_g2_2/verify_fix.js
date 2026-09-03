const fs = require('fs');
const path = require('path');

let appCode = fs.readFileSync('public/app.js', 'utf8');

const isCRLF = appCode.includes('\r\n');
let targetOld = `  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo con foto para agregarlo con 1 toque.</div>';
    recalcularTotalesTicket();
    return;
  }`;
if (isCRLF) targetOld = targetOld.replace(/\n/g, '\r\n');

let replacementNew = `  if (!estado.mesaActiva || !estado.mesaActiva.items || !estado.mesaActiva.items.length) {
    list.innerHTML = '<div style="text-align:center; color:#9ca3af; margin-top:40px;">Toca cualquier platillo con foto para agregarlo con 1 toque.</div>';
    recalcularTotalesTicket();
    actualizarBotonEnviarComanda();
    const mobCountEl = document.getElementById('mobTicketCount');
    if (mobCountEl) mobCountEl.textContent = 0;
    return;
  }`;
if (isCRLF) replacementNew = replacementNew.replace(/\n/g, '\r\n');

if (!appCode.includes(targetOld)) {
  console.error("Target old block not found. Exiting.");
  process.exit(1);
}

const patchedCode = appCode.replace(targetOld, replacementNew);

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(filePath, options) {
  if (typeof filePath === 'string' && (filePath.endsWith('public/app.js') || filePath.endsWith('public\\app.js'))) {
    return patchedCode;
  }
  return originalReadFileSync.call(fs, filePath, options);
};

console.log("Running challenger-m1.js with in-memory patched app.js...");
require(path.resolve('test/challenger-m1.js'));
