/**
 * build.js
 * Assembles dist/firefox and dist/chrome from:
 *   src/           → shared source files
 *   manifests/     → browser-specific manifests
 *   lib/           → shared libraries
 *   icons/         → shared icons
 *
 * Usage:
 *   node build.js            → builds both
 *   node build.js firefox    → builds only Firefox
 *   node build.js chrome     → builds only Chrome
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else copy(s, d);
  }
}

function buildBrowser(browser) {
  const out = path.join(DIST, browser);

  // Clean
  if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  // Shared source files
  copyDir(path.join(ROOT, 'src'), out);

  // Shared lib (rrweb, fflate)
  copyDir(path.join(ROOT, 'lib'), path.join(out, 'lib'));

  // Icons
  copyDir(path.join(ROOT, 'icons'), path.join(out, 'icons'));

  // Browser-specific manifest → manifest.json
  copy(path.join(ROOT, 'manifests', `${browser}.json`), path.join(out, 'manifest.json'));

  console.log(`Built dist/${browser}/`);
}

const target = process.argv[2];
const browsers = target ? [target] : ['firefox', 'chrome'];

for (const b of browsers) {
  if (!['firefox', 'chrome'].includes(b)) {
    console.error(`Unknown browser: ${b}. Use "firefox" or "chrome".`);
    process.exit(1);
  }
  buildBrowser(b);
}

console.log('\nDone. Load the extension from:');
if (browsers.includes('firefox')) console.log('  Firefox → about:debugging → Load Temporary Add-on → dist/firefox/manifest.json');
if (browsers.includes('chrome'))  console.log('  Chrome  → chrome://extensions → Developer mode → Load unpacked → dist/chrome/');
