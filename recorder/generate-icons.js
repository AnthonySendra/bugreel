/**
 * generate-icons.js
 * Generates simple placeholder icons for the extension.
 * Run with: node generate-icons.js
 * Requires: npm install canvas (optional — only needed for icon generation)
 *
 * Alternatively, just provide your own icons/icon48.png and icons/icon96.png
 */

const fs = require('fs');
const path = require('path');

// Try to use canvas if available
try {
  const { createCanvas } = require('canvas');

  function makeIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#e53e3e';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();

    // Record dot
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
    ctx.fill();

    return canvas.toBuffer('image/png');
  }

  const iconsDir = path.join(__dirname, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(iconsDir, 'icon48.png'), makeIcon(48));
  fs.writeFileSync(path.join(iconsDir, 'icon96.png'), makeIcon(96));
  console.log('Icons generated in icons/');
} catch (_) {
  console.log('`canvas` not installed — creating SVG icons instead (Firefox accepts SVG for icons in dev mode)');

  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="10" fill="#e53e3e"/>
  <circle cx="24" cy="24" r="13" fill="white"/>
</svg>`;

  const iconsDir = path.join(__dirname, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgIcon);
  console.log('Created icons/icon.svg — for production, replace with proper PNGs.');
  console.log('For dev: update manifest.json to use "icons/icon.svg" or just remove the icon fields temporarily.');
}
