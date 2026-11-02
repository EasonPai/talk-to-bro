// tests/unit/popup-shell.test.ts — UI r2 T1-2 (persona copy) and T1-3 (packaged assets)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POPUP_DIR = path.join(ROOT, 'src/popup');
const ASSETS = ['bg.jpg', 'hero.jpg', 'dragon.jpg'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'assets' ? [] : sourceFiles(full);
    return /\.(html|css|ts)$/.test(e.name) ? [full] : [];
  });
}

test('T1-2: popup and failure copy use 勇者/惡龍, never the old persona terms', () => {
  const files = [...sourceFiles(POPUP_DIR), path.join(ROOT, 'src/shared/failures.ts')];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /Pip|老大|小弟/, `${path.relative(ROOT, file)} contains an old persona term`);
  }
});

test('T1-3: popup assets exist in source, load only from the package, and no external URL is referenced', () => {
  for (const name of ASSETS) {
    const file = path.join(POPUP_DIR, 'assets', name);
    assert.ok(fs.statSync(file).size > 0, `${name} must be a non-empty file`);
  }
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  const css = fs.readFileSync(path.join(POPUP_DIR, 'popup.css'), 'utf8');
  for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    assert.match(m[1], /^assets\/[\w-]+\.jpg$/, `img src must be package-relative: ${m[1]}`);
  }
  assert.doesNotMatch(html + css, /https?:\/\/|@import|\/\/fonts\./, 'popup must not reference external resources');
});

test('T1-3: build copies the assets into dist/assets', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
  assert.match(build, /popup\/assets/, 'build.mjs must copy src/popup/assets');
  const dist = path.join(ROOT, 'dist/assets');
  if (fs.existsSync(path.join(ROOT, 'dist/popup.html'))) {
    for (const name of ASSETS) assert.ok(fs.existsSync(path.join(dist, name)), `dist/assets/${name} missing; run npm run build`);
  }
});
