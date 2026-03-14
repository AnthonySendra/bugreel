/**
 * setup.js
 * Copies rrweb's browser build from node_modules into lib/
 * Run with: node setup.js (after npm install)
 */

const fs = require('fs');
const path = require('path');

const candidates = [
  'node_modules/rrweb/dist/rrweb.umd.min.cjs',   // rrweb v2
  'node_modules/rrweb/dist/rrweb.umd.cjs',        // rrweb v2 non-min
  'node_modules/rrweb/dist/rrweb.min.js',          // rrweb v1
  'node_modules/rrweb/dist/rrweb.umd.min.js',      // rrweb v1 alt
];

const dest = path.join(__dirname, 'lib', 'rrweb.min.js');

let src = null;
for (const candidate of candidates) {
  const fullPath = path.join(__dirname, candidate);
  if (fs.existsSync(fullPath)) {
    src = fullPath;
    break;
  }
}

if (!src) {
  // Try to find anything that looks like a browser bundle
  const distDir = path.join(__dirname, 'node_modules/rrweb/dist');
  if (fs.existsSync(distDir)) {
    console.log('Available files in rrweb/dist:');
    fs.readdirSync(distDir).forEach(f => console.log(' ', f));
  }
  console.error('\nCould not find rrweb browser bundle. Check the list above and update setup.js.');
  process.exit(1);
}

fs.mkdirSync(path.join(__dirname, 'lib'), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied ${src} -> lib/rrweb.min.js`);

// Copy fflate
const fflateUmd = path.join(__dirname, 'node_modules/fflate/umd/index.js');
if (fs.existsSync(fflateUmd)) {
  fs.copyFileSync(fflateUmd, path.join(__dirname, 'lib', 'fflate.min.js'));
  console.log('Copied fflate -> lib/fflate.min.js');
}

console.log('Setup complete. You can now load the extension in Firefox.');
