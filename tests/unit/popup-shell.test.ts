// tests/unit/popup-shell.test.ts — Tidal Calm design system & dual-host shell contract (#26)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POPUP_DIR = path.join(ROOT, 'src/popup');
const OPTIONS_DIR = path.join(ROOT, 'src/options');

const RPG_SHELL_RE = /Pip|老大|小弟|勇者|惡龍|冒險之書|Roguelike|🦊/;

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
  assert.doesNotMatch(html + css, /(?:src|href|url)\s*[=(]\s*["']?https?:\/\/|@import|\/\/fonts\./i, 'popup must not reference external resources');
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
  assert.match(html, /id="mainView"/, 'popup.html must have #mainView');
  assert.match(html, /id="settings"/, 'popup.html must have embedded #settings');
  assert.match(html, /id="foot-settings-btn"/, 'popup.html must have #foot-settings-btn');
  assert.match(html, /id="settings-url-input"/, 'popup.html must have #settings-url-input');
  assert.match(html, /id="stat-sent-in"/, 'popup.html must have #stat-sent-in');
  assert.match(html, /id="stat-read-back"/, 'popup.html must have #stat-read-back');
  assert.match(html, /id="settings-back-btn"/, 'popup.html must have #settings-back-btn');
  assert.match(html, /id="settings-open-options-link"/, 'popup.html must have #settings-open-options-link');
});

test('Tidal Calm options: options.html/css/ts use Tidal Calm tokens and zero legacy RPG terms', () => {
  const html = fs.readFileSync(path.join(OPTIONS_DIR, 'options.html'), 'utf8');
  const css = fs.readFileSync(path.join(OPTIONS_DIR, 'options.css'), 'utf8');
  const ts = fs.readFileSync(path.join(OPTIONS_DIR, 'options.ts'), 'utf8');

  for (const [name, content] of [['options.html', html], ['options.css', css], ['options.ts', ts]]) {
    assert.doesNotMatch(content, RPG_SHELL_RE, `${name} must not contain legacy RPG terms`);
  }
  assert.doesNotMatch(html + css, /@import|\/\/fonts\.|<img\b|<script[^>]+src="https?:/i, 'options must not load external assets');
  for (const token of ['--bg:', '--surface:', '--ink:', '--deep:', '--sea:', '--coral:']) {
    assert.ok(css.includes(token), `options.css must define ${token}`);
  }
  assert.match(css, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/, 'options.css must support dark mode');
  assert.match(html, /chrome:\/\/extensions\/shortcuts/, 'options.html must include shortcut customization hint');
  assert.match(html, /id="bro-url-input"/, 'options.html must have #bro-url-input');
  assert.match(html, /id="save-btn"/, 'options.html must have #save-btn');
  assert.match(html, /id="check-ready-btn"/, 'options.html must have #check-ready-btn');
});

test('Tidal Calm build: scripts/build.mjs does not bundle legacy popup/assets', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
  assert.doesNotMatch(build, /popup\/assets/, 'build.mjs must not copy legacy popup/assets');
  if (fs.existsSync(path.join(ROOT, 'dist/popup.html'))) {
    assert.equal(fs.existsSync(path.join(ROOT, 'dist/assets')), false, 'dist/assets must not exist after build');
  }
});
