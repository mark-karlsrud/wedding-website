#!/usr/bin/env node
/**
 * generate-manifest.js
 *
 * Scans the pics/ folder and writes pics/manifest.json.
 * Run this whenever you add or remove photos/videos:
 *
 *   node generate-manifest.js
 *
 * Supported formats  →  included in manifest (browser-native):
 *   Images : .jpg .jpeg .png .webp .gif .avif
 *   Video  : .mp4 .webm
 *
 * Unsupported formats → skipped with a note (need conversion first):
 *   .heic .heif  → convert to JPEG  (macOS: sips -s format jpeg file.heic --out file.jpg)
 *   .mov         → convert to MP4   (macOS: ffmpeg -i file.mov -c copy file.mp4)
 */

const fs   = require('fs');
const path = require('path');

const PICS_DIR = path.join(__dirname, 'pics');
const OUT_FILE = path.join(PICS_DIR, 'manifest.json');

const SUPPORTED   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.webm']);
const NEEDS_CONV  = new Set(['.heic', '.heif', '.mov', '.avi', '.wmv']);

if (!fs.existsSync(PICS_DIR)) {
  console.error('pics/ folder not found. Create it and add your photos.');
  process.exit(1);
}

const all      = fs.readdirSync(PICS_DIR).filter(f => f !== 'manifest.json' && !f.startsWith('.'));
const files    = all.filter(f => SUPPORTED.has(path.extname(f).toLowerCase()));
const skipped  = all.filter(f => NEEDS_CONV.has(path.extname(f).toLowerCase()));
const unknown  = all.filter(f => {
  const ext = path.extname(f).toLowerCase();
  return !SUPPORTED.has(ext) && !NEEDS_CONV.has(ext) && ext !== '';
});

fs.writeFileSync(OUT_FILE, JSON.stringify({ files }, null, 2) + '\n');

console.log(`\n✓  pics/manifest.json updated — ${files.length} file(s):\n`);
files.forEach(f => console.log(`   + ${f}`));

if (skipped.length) {
  console.log(`\n⚠  ${skipped.length} file(s) skipped — convert before adding:\n`);
  skipped.forEach(f => {
    const ext  = path.extname(f).toLowerCase();
    const hint = ['.heic', '.heif'].includes(ext)
      ? `sips -s format jpeg "pics/${f}" --out "pics/${path.basename(f, ext)}.jpg"`
      : `ffmpeg -i "pics/${f}" -c copy "pics/${path.basename(f, ext)}.mp4"`;
    console.log(`   - ${f}\n     → ${hint}`);
  });
}

if (unknown.length) {
  console.log(`\n   ${unknown.length} unrecognised file(s) ignored: ${unknown.join(', ')}`);
}

console.log('');
