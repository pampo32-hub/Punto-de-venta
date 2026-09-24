const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

console.log('========================================================');
console.log('🔍 INICIANDO AUDITORÍA COMPLETA DEL SISTEMA Y PÁGINA POS');
console.log('========================================================\n');

// 1. VERIFICAR ARCHIVOS PRINCIPALES Y SU SINCRONIZACIÓN CON public/
console.log('--- 1. COMPARACIÓN RAÍZ vs PUBLIC ---');
const filesToSync = ['index.html', 'app.js', 'server.js', 'styles.css'];
for (const file of filesToSync) {
  const rootPath = path.join(rootDir, file);
  const pubPath = path.join(rootDir, 'public', file);
  if (fs.existsSync(rootPath) && fs.existsSync(pubPath)) {
    const rootContent = fs.readFileSync(rootPath, 'utf8');
    const pubContent = fs.readFileSync(pubPath, 'utf8');
    if (rootContent === pubContent) {
      console.log(`✓ ${file}: Sincronizado exactamente (raíz y public son idénticos).`);
    } else {
      console.log(`⚠️ ${file}: DESINCRONIZADO entre raíz y public! Longitudes: raíz=${rootContent.length}, public=${pubContent.length}`);
    }
  } else {
    console.log(`⚠️ Archivo faltante: ${file} (raíz existe: ${fs.existsSync(rootPath)}, public existe: ${fs.existsSync(pubPath)})`);
  }
}

// 2. AUDITORÍA DE index.html: ASSETS EXTERNOS / LOCALES
console.log('\n--- 2. AUDITORÍA DE RECURSOS (SCRIPTS / CSS / IMÁGENES) EN index.html ---');
const indexHtmlPath = path.join(rootDir, 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Scripts
const scriptSrcRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
let match;
while ((match = scriptSrcRegex.exec(indexHtml)) !== null) {
  const src = match[1];
  if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('//')) {
    const cleanSrc = src.replace(/^\//, '').split('?')[0];
    const assetPath = path.join(rootDir, 'public', cleanSrc);
    const assetPathRoot = path.join(rootDir, cleanSrc);
    if (!fs.existsSync(assetPath) && !fs.existsSync(assetPathRoot)) {
      console.log(`❌ Script local no encontrado: "${src}"`);
    } else {
      console.log(`✓ Script local encontrado: "${src}"`);
    }
  }
}

// CSS
const cssRegex = /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi;
while ((match = cssRegex.exec(indexHtml)) !== null) {
  const href = match[1];
  if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//')) {
    const cleanHref = href.replace(/^\//, '').split('?')[0];
    const assetPath = path.join(rootDir, 'public', cleanHref);
    const assetPathRoot = path.join(rootDir, cleanHref);
    if (!fs.existsSync(assetPath) && !fs.existsSync(assetPathRoot)) {
      console.log(`❌ Estilo local no encontrado: "${href}"`);
    } else {
      console.log(`✓ Estilo local encontrado: "${href}"`);
    }
  }
}

// 3. AUDITORÍA DE IDs DUPLICADOS EN index.html
console.log('\n--- 3. DETECCIÓN DE IDs DUPLICADOS EN index.html ---');
const idRegex = /\sid=["']([^"']+)["']/gi;
const idsFound = {};
const duplicateIds = [];
while ((match = idRegex.exec(indexHtml)) !== null) {
  const id = match[1];
  if (idsFound[id]) {
    idsFound[id]++;
    if (!duplicateIds.includes(id)) duplicateIds.push(id);
  } else {
    idsFound[id] = 1;
  }
}
if (duplicateIds.length === 0) {
  console.log('✓ No se encontraron IDs duplicados en index.html.');
} else {
  console.log(`⚠️ Se encontraron ${duplicateIds.length} IDs duplicados en index.html:`);
  duplicateIds.forEach(id => console.log(`   - "${id}" (aparece ${idsFound[id]} veces)`));
}

// 4. AUDITORÍA DE REFERENCIAS DOM DIRECTAS EN app.js QUE NO EXISTAN EN index.html
console.log('\n--- 4. DETECCIÓN DE getElementById SIN VALIDAR EN app.js QUE NO EXISTAN EN index.html ---');
const appJsPath = path.join(rootDir, 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');

// Detectar document.getElementById('xxx').addEventListener o document.getElementById('xxx').value/etc
const getElRegex = /document\.getElementById\(['"]([^'"]+)['"]\)(\s*\.[a-zA-Z0-9_]+)/g;
const missingElementsDangerous = [];
const missingElementsSafe = [];
const checkedIds = new Set();

while ((match = getElRegex.exec(appJs)) !== null) {
  const elId = match[1];
  const access = match[2].trim();
  if (checkedIds.has(elId + access)) continue;
  checkedIds.add(elId + access);

  if (!idsFound[elId]) {
    // Si la llamada accede directamente a propiedades como .addEventListener o .value sin verificar null
    if (access.startsWith('.addEventListener') || access.startsWith('.onclick') || access.startsWith('.textContent') || access.startsWith('.innerHTML') || access.startsWith('.value')) {
      missingElementsDangerous.push({ id: elId, access });
    }
  }
}

if (missingElementsDangerous.length === 0) {
  console.log('✓ No se detectaron llamadas peligrosas a getElementById de elementos inexistentes en index.html.');
} else {
  console.log(`⚠️ Se detectaron ${missingElementsDangerous.length} accesos directos potencialmente peligrosos a IDs no encontrados en index.html:`);
  missingElementsDangerous.slice(0, 30).forEach(item => {
    console.log(`   - document.getElementById('${item.id}')${item.access}`);
  });
  if (missingElementsDangerous.length > 30) {
    console.log(`   ... y ${missingElementsDangerous.length - 30} más.`);
  }
}

// 5. AUDITORÍA DE ENDPOINTS FETCH EN app.js vs server.js
console.log('\n--- 5. COMPARACIÓN DE RUTAS FETCH LLAMADAS EN app.js vs RUTAS DEFINIDAS EN server.js ---');
const serverJsPath = path.join(rootDir, 'server.js');
const serverJs = fs.readFileSync(serverJsPath, 'utf8');

// Extraer rutas en server.js
const serverRoutes = new Set();
const routeRegex = /app\.(get|post|put|delete|patch)\(\s*(\[[^\]]+\]|['"][^'"]+['"])/g;
while ((match = routeRegex.exec(serverJs)) !== null) {
  const routeParam = match[2];
  if (routeParam.startsWith('[')) {
    try {
      const parsed = eval(routeParam);
      parsed.forEach(r => serverRoutes.add(r));
    } catch(e) {}
  } else {
    serverRoutes.add(routeParam.replace(/['"]/g, ''));
  }
}

// Extraer llamadas fetch('/api/...') en app.js
const fetchRegex = /fetch\(\s*[`'"](\/api\/[^`'"?]+)[`'"?]/g;
const missingRoutes = new Set();
const foundRoutes = new Set();

while ((match = fetchRegex.exec(appJs)) !== null) {
  let endpoint = match[1];
  // Normalizar parámetros dinámicos tipo /api/ordenes/${id} -> /api/ordenes/:id
  endpoint = endpoint.replace(/\$\{[^}]+\}/g, ':param');
  
  // Buscar coincidencia en serverRoutes
  let matchFound = false;
  for (const sRoute of serverRoutes) {
    const sRegexStr = '^' + sRoute.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$';
    const sRegex = new RegExp(sRegexStr);
    const testEndpoint = endpoint.replace(/:param/g, '123');
    if (sRegex.test(testEndpoint)) {
      matchFound = true;
      break;
    }
  }

  if (matchFound) {
    foundRoutes.add(endpoint);
  } else {
    missingRoutes.add(endpoint);
  }
}

console.log(`✓ Rutas de API reconocidas en server.js: ${foundRoutes.size}`);
if (missingRoutes.size > 0) {
  console.log(`⚠️ Rutas llamadas con fetch() en app.js que podrían NO estar definidas en server.js (${missingRoutes.size}):`);
  missingRoutes.forEach(r => console.log(`   - "${r}"`));
} else {
  console.log('✓ Todas las rutas fetch() coinciden con endpoints de server.js.');
}

console.log('\n========================================================');
console.log('Auditoría inicial de código completada.');
console.log('========================================================');
