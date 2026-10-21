import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFileIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

console.log('=== Devi Electrical: Frontend Asset Build & Vendor Preparation ===');

// 1. Prepare Vendor Directories
const vendorFontsDir = path.join(publicDir, 'vendor/fonts');
const vendorTesseractDir = path.join(publicDir, 'vendor/tesseract');
const vendorIconsDir = path.join(publicDir, 'vendor/icons');

ensureDir(vendorFontsDir);
ensureDir(vendorTesseractDir);
ensureDir(vendorIconsDir);

// 2. Self-Host Fonts: Plus Jakarta Sans & Inter
const fontPackages = [
  { pkg: '@fontsource/plus-jakarta-sans', outName: 'plus-jakarta-sans.woff2' },
  { pkg: '@fontsource/inter', outName: 'inter.woff2' }
];

for (const fp of fontPackages) {
  try {
    const pkgDir = path.join(rootDir, 'node_modules', fp.pkg, 'files');
    if (fs.existsSync(pkgDir)) {
      const files = fs.readdirSync(pkgDir);
      // Pick latin-400 woff2 or first available woff2
      const woff2 = files.find(f => f.includes('latin-400') && f.endsWith('.woff2')) ||
                    files.find(f => f.endsWith('.woff2'));
      if (woff2) {
        fs.copyFileSync(path.join(pkgDir, woff2), path.join(vendorFontsDir, fp.outName));
        console.log(`✓ Copied font ${fp.pkg} -> vendor/fonts/${fp.outName}`);
      }
    }
  } catch (err) {
    console.warn(`Font packaging notice for ${fp.pkg}:`, err.message);
  }
}

// 3. Self-Host Tesseract.js v5 (Worker, Core WASM variants, and traineddata)
try {
  const tesseractDist = path.join(rootDir, 'node_modules/tesseract.js/dist');
  if (fs.existsSync(tesseractDist)) {
    copyFileIfExists(path.join(tesseractDist, 'worker.min.js'), path.join(vendorTesseractDir, 'worker.min.js'));
    copyFileIfExists(path.join(tesseractDist, 'tesseract.min.js'), path.join(vendorTesseractDir, 'tesseract.min.js'));
  }

  // Tesseract core wasm (handles CPU without SIMD seamlessly)
  const coreDist = path.join(rootDir, 'node_modules/tesseract.js-core');
  if (fs.existsSync(coreDist)) {
    const coreFiles = fs.readdirSync(coreDist).filter(f => f.endsWith('.wasm') || f.endsWith('.js'));
    for (const cf of coreFiles) {
      fs.copyFileSync(path.join(coreDist, cf), path.join(vendorTesseractDir, cf));
    }
    console.log('✓ Copied Tesseract.js core WASM binaries (SIMD and standard fallback).');
  }

  // Traineddata
  const trainedDataDir = path.join(rootDir, 'node_modules/@tesseract.js-data/eng');
  if (fs.existsSync(trainedDataDir)) {
    const tdFiles = fs.readdirSync(trainedDataDir).filter(f => f.includes('traineddata'));
    for (const tdf of tdFiles) {
      fs.copyFileSync(path.join(trainedDataDir, tdf), path.join(vendorTesseractDir, tdf));
    }
    console.log('✓ Copied English traineddata model for OCR.');
  }
} catch (err) {
  console.warn('Tesseract asset copying notice:', err.message);
}

// 4. Inline Lucide Icons
const neededIcons = [
  'phone', 'message-circle', 'map-pin', 'clock', 'truck', 'shield-check',
  'zap', 'sun', 'power', 'fan', 'wrench', 'file-text', 'download',
  'chevron-right', 'check', 'arrow-left', 'plus', 'trash-2', 'edit',
  'printer', 'camera', 'search', 'alert-triangle', 'eye', 'eye-off',
  'log-out', 'settings', 'shopping-cart', 'box', 'users', 'dollar-sign'
];

try {
  const lucidePkgDir = path.join(rootDir, 'node_modules/lucide-static/icons');
  if (fs.existsSync(lucidePkgDir)) {
    for (const icon of neededIcons) {
      const iconPath = path.join(lucidePkgDir, `${icon}.svg`);
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, path.join(vendorIconsDir, `${icon}.svg`));
      }
    }
    console.log(`✓ Copied ${neededIcons.length} essential Lucide SVG icons.`);
  }
} catch (err) {
  console.warn('Lucide icon bundling notice:', err.message);
}

// 5. Template {{PUBLIC_ORIGIN}} in public files
const envPath = path.resolve(__dirname, '../.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {}
}
const publicOrigin = process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.trim().replace(/\/$/, '') : 'http://localhost:3164';

const templateFiles = ['index.html', 'robots.txt', 'sitemap.xml'];

for (const tf of templateFiles) {
  const filePath = path.join(publicDir, tf);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('{{PUBLIC_ORIGIN}}')) {
      content = content.replaceAll('{{PUBLIC_ORIGIN}}', publicOrigin);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ Templated PUBLIC_ORIGIN in ${tf}`);
    }
  }
}

console.log('Frontend build-assets processing complete.');
