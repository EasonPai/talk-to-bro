// tests/unit/popup-shell.test.ts — Tidal Calm design system & dual-host shell contract (#26)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POPUP_DIR = path.join(ROOT, 'src/popup');

const RPG_SHELL_RE = /Pip|老大|小弟|勇者|惡龍|冒險之書/;

test('Tidal Calm shell: popup.html and popup.css contain zero RPG persona terms or legacy .jpg assets', () => {
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  const css = fs.readFileSync(path.join(POPUP_DIR, 'popup.css'), 'utf8');

  assert.doesNotMatch(html, RPG_SHELL_RE, 'popup.html must not contain legacy RPG terms');
  assert.doesNotMatch(css, RPG_SHELL_RE, 'popup.css must not contain legacy RPG terms');
  assert.doesNotMatch(html + css, /\.jpg\b|assets\//i, 'popup shell must not reference legacy .jpg assets');
  assert.doesNotMatch(html + css, /<img\b/i, 'popup shell must use inline SVG rather than raster <img> tags');
});

test('Tidal Calm shell: zero external network URLs or external font imports', () => {
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  const css = fs.readFileSync(path.join(POPUP_DIR, 'popup.css'), 'utf8');
  assert.doesNotMatch(html + css, /https?:\/\/|@import|\/\/fonts\./, 'popup must not reference external resources');
});

test('Tidal Calm shell: popup.css defines Light and Dark design tokens', () => {
  const css = fs.readFileSync(path.join(POPUP_DIR, 'popup.css'), 'utf8');
  for (const token of ['--bg:', '--surface:', '--surface-2:', '--ink:', '--ink-2:', '--ink-3:', '--deep:', '--sea:', '--coral:']) {
    assert.ok(css.includes(token), `popup.css must define ${token}`);
  }
  assert.match(css, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/, 'popup.css must support prefers-color-scheme: dark');
});

test('Tidal Calm shell: popup.html preserves dual-host header actions, capsule composer, empty card, and footer', () => {
  const html = fs.readFileSync(path.join(POPUP_DIR, 'popup.html'), 'utf8');
  assert.match(html, /<header class="hero\b/, 'popup.html must have Tidal Calm .hero header');
  assert.match(html, /id="pin-toggle-btn"/, 'popup.html must have #pin-toggle-btn');
  assert.match(html, /id="settings-btn"/, 'popup.html must have #settings-btn');
  assert.match(html, /class="field"[\s\S]*<textarea[\s\S]*id="talk-input"/, 'popup.html must wrap <textarea id="talk-input"> in .field capsule');
  assert.match(html, /id="send-btn"/, 'popup.html must have #send-btn inside composer');
  assert.match(html, /id="char-counter"/, 'popup.html must have #char-counter');
  assert.match(html, /id="empty-card"/, 'popup.html must have #empty-card welcome card');
  assert.match(html, /class="popup-footer"/, 'popup.html must have .popup-footer');
});

test('Tidal Calm build: scripts/build.mjs does not bundle legacy popup/assets', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
  assert.doesNotMatch(build, /popup\/assets/, 'build.mjs must not copy legacy popup/assets');
  if (fs.existsSync(path.join(ROOT, 'dist/popup.html'))) {
    assert.equal(fs.existsSync(path.join(ROOT, 'dist/assets')), false, 'dist/assets must not exist after build');
  }
});
