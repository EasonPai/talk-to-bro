// scripts/test-m1-suite.js
// Automated Verification Suite for Ticket 03 (#27: M1 - Skeleton, Manifest V3 & Options Validation)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateBroChatUrl } from '../src/shared/validate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const CDP_HOST = '[::1]';
const CDP_PORT = 9222;

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  console.log('================================================================');
  console.log('    Ticket 03 (#27: M1) Automated Verification Suite            ');
  console.log('================================================================\n');

  // 1. Manifest V3 Integrity Verification
  console.log('[Test Suite] 1. Verifying Manifest V3 configuration...');
  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  assert.equal(fs.existsSync(manifestPath), true, 'dist/manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
  assert.equal(manifest.minimum_chrome_version, '132', 'minimum_chrome_version must be 132');

  const requiredPermissions = ['storage', 'tabs', 'scripting', 'alarms', 'offscreen', 'clipboardWrite'];
  for (const p of requiredPermissions) {
    assert.equal(manifest.permissions?.includes(p), true, `Permission "${p}" must be declared`);
  }

  assert.deepEqual(manifest.host_permissions, ['https://gemini.google.com/*'], 'host_permissions must be strictly https://gemini.google.com/*');
  assert.equal(manifest.background?.service_worker, 'sw.js', 'background.service_worker must be sw.js');
  assert.equal(manifest.background?.type, 'module', 'background.type must be module');
  assert.equal(manifest.action?.default_popup, 'popup.html', 'action.default_popup must be popup.html');
  assert.equal(manifest.options_ui?.page, 'options.html', 'options_ui.page must be options.html');
  assert.equal(manifest.commands?._execute_action?.suggested_key?.default, 'Alt+Shift+B', 'commands._execute_action must be Alt+Shift+B');
  console.log('  ✓ Manifest V3 checks passed (permissions, host_permissions, shortcut, service worker).\n');

  // 2. esbuild Bundle Pipeline Verification
  console.log('[Test Suite] 2. Verifying esbuild output bundles in dist/...');
  const expectedBundles = [
    'sw.js',
    'adapter.js',
    'popup.js',
    'options.js',
    'offscreen.js',
    'popup.html',
    'popup.css',
    'options.html',
    'options.css',
    'offscreen.html'
  ];

  for (const b of expectedBundles) {
    const bPath = path.join(DIST_DIR, b);
    assert.equal(fs.existsSync(bPath), true, `Bundle ${b} must exist in dist/`);
    assert.ok(fs.statSync(bPath).size > 0, `Bundle ${b} must not be empty`);
  }
  console.log('  ✓ All 10 expected build artifacts verified.\n');

  // 3. validateBroChatUrl 100% Boundary Unit Coverage
  console.log('[Test Suite] 3. Verifying validateBroChatUrl boundaries...');
  const valid1 = validateBroChatUrl('https://gemini.google.com/app/4d870f290f0c5975');
  assert.equal(valid1.valid, true);
  assert.equal(valid1.ref?.chatId, '4d870f290f0c5975');

  const valid2 = validateBroChatUrl('https://gemini.google.com/u/2/gem/my-gem/my-chat');
  assert.equal(valid2.valid, true);
  assert.equal(valid2.ref?.accountIndex, 2);
  assert.equal(valid2.ref?.gemId, 'my-gem');
  assert.equal(valid2.ref?.chatId, 'my-chat');

  // Boundaries: evil, http, credentials, homepage
  assert.equal(validateBroChatUrl('https://gemini.google.com.evil.com/app/test').valid, false);
  assert.equal(validateBroChatUrl('http://gemini.google.com/app/test').valid, false);
  assert.equal(validateBroChatUrl('https://user:pass@gemini.google.com/app/test').valid, false);
  assert.equal(validateBroChatUrl('https://gemini.google.com/').valid, false);
  console.log('  ✓ validateBroChatUrl boundary assertions passed.\n');

  // 4. Live Chrome for Testing Integration (Active Browser Environment)
  console.log('[Test Suite] 4. Verifying active Chrome for Testing environment & storage integration...');
  const verRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`);
  const verData = await verRes.json();
  console.log(`  [CfT] Browser Version: ${verData.Browser}`);

  // Query active targets to locate extension runner / pages
  const targets = await (await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)).json();
  const runnerTarget = targets.find(t => t.url && t.url.includes('runner.html')) || targets.find(t => t.type === 'page');
  assert.ok(runnerTarget, 'Active browser page target must be available');

  const cdp = new CdpClient(runnerTarget.webSocketDebuggerUrl);
  await cdp.connect();

  // Test Settings Storage persistence in active browser profile
  console.log('[Test Suite] 5. Verifying settings:v1 persistence in Chrome storage...');
  const testSettings = {
    broChatUrl: 'https://gemini.google.com/app/4d870f290f0c5975',
    updatedAt: Date.now()
  };

  const storageWriteEval = await cdp.send('Runtime.evaluate', {
    expression: `
      (async () => {
        await chrome.storage.local.set({ 'settings:v1': ${JSON.stringify(testSettings)} });
        const res = await chrome.storage.local.get('settings:v1');
        return res['settings:v1'];
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  const storedResult = storageWriteEval.result?.value;
  assert.equal(storedResult?.broChatUrl, testSettings.broChatUrl, 'settings:v1 broChatUrl must match');
  console.log(`  ✓ settings:v1 write & read-back verified in Chrome local storage (${storedResult.broChatUrl}).\n`);

  // Test Popup Autofocus (F1) DOM semantics
  console.log('[Test Suite] 6. Verifying Popup DOM structure & Autofocus (F1) attributes...');
  const popupHtml = fs.readFileSync(path.join(DIST_DIR, 'popup.html'), 'utf-8');
  assert.ok(popupHtml.includes('id="talk-input"'), 'popup.html must contain #talk-input');
  assert.ok(popupHtml.includes('autofocus'), 'popup.html textarea must have autofocus attribute');
  assert.ok(popupHtml.includes('Alt'), 'popup.html must display Alt+Shift+B shortcut badge');

  const popupJs = fs.readFileSync(path.join(DIST_DIR, 'popup.js'), 'utf-8');
  assert.ok(popupJs.includes('.focus()'), 'popup.js must explicitly invoke focus() on talk-input');
  console.log('  ✓ Popup autofocus and shortcut semantics verified.\n');

  cdp.close();

  console.log('================================================================');
  console.log('       ALL ACCEPTANCE CRITERIA FOR TICKET 03 (#27) PASSED       ');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('[Verification Failed]', err);
  process.exit(1);
});
