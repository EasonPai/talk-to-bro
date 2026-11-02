// scripts/build.mjs
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

async function build() {
  console.log('[Build] Cleaning dist directory...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  console.log('[Build] Compiling TypeScript bundles with esbuild...');

  // 1. Service Worker (ESM)
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'sw/index.ts')],
    outfile: path.join(DIST_DIR, 'sw.js'),
    bundle: true,
    format: 'esm',
    target: 'chrome132',
    sourcemap: true,
    minify: false
  });

  // 2. Adapter (IIFE for isolated world injection with dynamic build ID)
  const adapterBuildId = `ttb-build-${Date.now()}`;
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'adapter/entry.ts')],
    outfile: path.join(DIST_DIR, 'adapter.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome132',
    sourcemap: true,
    minify: false,
    define: {
      '__TTB_BUILD_ID__': JSON.stringify(adapterBuildId)
    }
  });

  // 3. Popup (ESM)
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'popup/popup.ts')],
    outfile: path.join(DIST_DIR, 'popup.js'),
    bundle: true,
    format: 'esm',
    target: 'chrome132',
    sourcemap: true,
    minify: false
  });

  // 4. Options (ESM)
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'options/options.ts')],
    outfile: path.join(DIST_DIR, 'options.js'),
    bundle: true,
    format: 'esm',
    target: 'chrome132',
    sourcemap: true,
    minify: false
  });

  // 5. Offscreen (ESM)
  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, 'offscreen/clipboard.ts')],
    outfile: path.join(DIST_DIR, 'offscreen.js'),
    bundle: true,
    format: 'esm',
    target: 'chrome132',
    sourcemap: true,
    minify: false
  });

  console.log('[Build] Copying static assets (HTML, CSS, manifest.json)...');

  // Copy manifest.json
  fs.copyFileSync(path.join(ROOT_DIR, 'manifest.json'), path.join(DIST_DIR, 'manifest.json'));

  // Copy HTML & CSS
  fs.copyFileSync(path.join(SRC_DIR, 'popup/popup.html'), path.join(DIST_DIR, 'popup.html'));
  fs.copyFileSync(path.join(SRC_DIR, 'popup/popup.css'), path.join(DIST_DIR, 'popup.css'));
  fs.cpSync(path.join(SRC_DIR, 'popup/assets'), path.join(DIST_DIR, 'assets'), { recursive: true });

  fs.copyFileSync(path.join(SRC_DIR, 'options/options.html'), path.join(DIST_DIR, 'options.html'));
  fs.copyFileSync(path.join(SRC_DIR, 'options/options.css'), path.join(DIST_DIR, 'options.css'));

  fs.copyFileSync(path.join(SRC_DIR, 'offscreen/offscreen.html'), path.join(DIST_DIR, 'offscreen.html'));

  console.log('[Build] Extension successfully bundled into dist/ !');
}

build().catch((err) => {
  console.error('[Build Error]', err);
  process.exit(1);
});
