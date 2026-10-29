// scripts/test-m1-suite.js
// Automated End-to-End Verification Harness for Ticket 03 (#27: M1)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateBroChatUrl } from '../src/shared/validate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const LOADED_EXT_DIR = path.join(ROOT_DIR, 'spikes/m0-b');

const CDP_HOST = '[::1]';
const CDP_PORT = 9222;

function calculateExtensionId(dirPath) {
  const hash = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 32);
  return hash.split('').map(c => String.fromCharCode(parseInt(c, 16) + 'a'.charCodeAt(0))).join('');
}

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
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
  }
}

async function triggerExtensionReload(extId) {
  const extPageRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?chrome://extensions`, { method: 'PUT' });
  const extTab = await extPageRes.json();
  const cdp = new CdpClient(extTab.webSocketDebuggerUrl);
  await cdp.connect();

  await new Promise(r => setTimeout(r, 800));
  await cdp.send('Runtime.evaluate', {
    expression: `
      (async () => {
        const manager = document.querySelector('extensions-manager');
        const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
        const item = itemList?.shadowRoot?.querySelector('#${extId}');
        if (!item) throw new Error('Extension ${extId} not found in extensions-manager');
        await item.delegate.reloadItem(item.data.id);
      })()
    `,
    awaitPromise: true
  });

  await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${extTab.id}`).catch(() => {});
  cdp.close();
  await new Promise(r => setTimeout(r, 1200));
}

async function main() {
  console.log('================================================================');
  console.log('    Ticket 03 (#27: M1) Rigorous Verification Suite             ');
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

  // 4. Exact Extension Target Resolution & Mounting
  console.log('[Test Suite] 4. Resolving exact target Extension ID & mounting dist bundle...');
  const EXPECTED_EXT_ID = calculateExtensionId(LOADED_EXT_DIR);
  console.log(`  Target Directory: ${LOADED_EXT_DIR}`);
  console.log(`  Expected Extension ID (SHA-256 derived): ${EXPECTED_EXT_ID}`);

  const backupDir = path.join(ROOT_DIR, 'spikes/m0-b-backup-tmp');
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
  fs.cpSync(LOADED_EXT_DIR, backupDir, { recursive: true });

  try {
    for (const file of fs.readdirSync(DIST_DIR)) {
      fs.copyFileSync(path.join(DIST_DIR, file), path.join(LOADED_EXT_DIR, file));
    }
    console.log('  Mounted dist artifacts into active extension directory.');

    const verRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`);
    const verData = await verRes.json();
    console.log(`  [CfT] Browser Version: ${verData.Browser}`);

    // Trigger clean item reload via extensions manager
    console.log(`  Reloading extension ${EXPECTED_EXT_ID} in Chrome...`);
    await triggerExtensionReload(EXPECTED_EXT_ID);

    // Verify exact SW target and runtime manifest correspondence
    let targets = await (await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)).json();
    const swTarget = targets.find(t => t.type === 'service_worker' && t.url && t.url.includes(EXPECTED_EXT_ID));
    assert.ok(swTarget, `Service Worker for expected Extension ID ${EXPECTED_EXT_ID} must be running`);

    const swCdp = new CdpClient(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();

    const runtimeManifestRes = await swCdp.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest()',
      returnByValue: true
    });
    const runtimeManifest = runtimeManifestRes.result?.value;
    assert.ok(runtimeManifest, 'chrome.runtime.getManifest() must return manifest object');
    assert.equal(runtimeManifest.name, manifest.name, `Manifest name must match "${manifest.name}"`);
    assert.equal(runtimeManifest.version, manifest.version, `Manifest version must match "${manifest.version}"`);
    assert.equal(runtimeManifest.manifest_version, 3, 'Manifest version must be 3');
    assert.equal(runtimeManifest.action?.default_popup, 'popup.html', 'Action popup must be popup.html');
    assert.equal(runtimeManifest.options_ui?.page, 'options.html', 'Options page must be options.html');

    const runtimeIdRes = await swCdp.send('Runtime.evaluate', {
      expression: 'chrome.runtime.id',
      returnByValue: true
    });
    assert.equal(runtimeIdRes.result?.value, EXPECTED_EXT_ID, 'Runtime extension ID must strictly match EXPECTED_EXT_ID');
    console.log(`  ✓ Exact Extension Identity & Runtime Manifest Correspondence Verified:`);
    console.log(`    - ID: ${EXPECTED_EXT_ID}`);
    console.log(`    - Name: ${runtimeManifest.name}`);
    console.log(`    - Version: ${runtimeManifest.version}`);

    // Verify commands registration in SW (distinguishing registration from execution)
    const cmdsEval = await swCdp.send('Runtime.evaluate', {
      expression: `(async () => { return await chrome.commands.getAll(); })()`,
      awaitPromise: true,
      returnByValue: true
    });
    const cmds = cmdsEval.result?.value || [];
    const executeActionCmd = cmds.find(c => c.name === '_execute_action');
    assert.ok(executeActionCmd, '_execute_action command must be registered in chrome.commands');
    console.log(`  ✓ [Shortcut Registration Verified]: Command _execute_action registered in Chrome commands table.`);
    console.log(`    Declared manifest suggested_key: ${manifest.commands._execute_action.suggested_key.default}`);

    // 5. Options UI Real End-to-End Verification (Input, Rejection, Save, Persistence)
    console.log('\n[Test Suite] 5. Verifying Options Page UI & settings:v1 persistence...');
    const optionsUrl = `chrome-extension://${EXPECTED_EXT_ID}/options.html`;
    const optTabRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(optionsUrl)}`, { method: 'PUT' });
    const optTab = await optTabRes.json();

    const optCdp = new CdpClient(optTab.webSocketDebuggerUrl);
    await optCdp.connect();
    await new Promise(r => setTimeout(r, 600));

    // Verify Options DOM
    const optTitle = await optCdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    assert.equal(optTitle.result.value, 'Talk To Bro Personally - Options', 'Options title must match');

    // Case 5A: Evil URL Rejection via UI
    console.log('  Testing Evil URL input & rejection in Options UI...');
    const evilUrl = 'https://gemini.google.com.evil.com/app/spoof';
    const evilEval = await optCdp.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const input = document.getElementById('bro-url-input');
          const saveBtn = document.getElementById('save-btn');
          const status = document.getElementById('url-status');

          input.value = '${evilUrl}';
          input.dispatchEvent(new Event('input'));
          saveBtn.click();
          await new Promise(r => setTimeout(r, 200));

          const stored = await chrome.storage.local.get('settings:v1');
          return {
            statusText: status.textContent,
            isError: status.classList.contains('error'),
            storedBroChatUrl: stored['settings:v1']?.broChatUrl || null
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const evilRes = evilEval.result.value;
    assert.equal(evilRes.isError, true, 'Evil URL must trigger error in UI');
    assert.notEqual(evilRes.storedBroChatUrl, evilUrl, 'Evil URL must not be saved into storage');
    console.log(`  ✓ Evil URL correctly rejected by UI: "${evilRes.statusText}"`);

    // Case 5B: Valid URL Normalization & Storage Save via UI
    console.log('  Testing Valid URL save in Options UI...');
    const validUrl = 'https://gemini.google.com/app/4d870f290f0c5975';
    const saveEval = await optCdp.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const input = document.getElementById('bro-url-input');
          const saveBtn = document.getElementById('save-btn');
          const status = document.getElementById('url-status');

          input.value = '${validUrl}';
          input.dispatchEvent(new Event('input'));
          saveBtn.click();
          await new Promise(r => setTimeout(r, 300));

          const stored = await chrome.storage.local.get('settings:v1');
          return {
            statusText: status.textContent,
            isSuccess: status.classList.contains('success'),
            storedUrl: stored['settings:v1']?.broChatUrl
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const saveRes = saveEval.result.value;
    assert.equal(saveRes.isSuccess, true, 'Valid URL save must show success status');
    assert.equal(saveRes.storedUrl, validUrl, 'Valid URL must be persisted to settings:v1 in storage');
    console.log(`  ✓ Valid URL persisted to settings:v1: "${saveRes.storedUrl}"`);

    // Case 5C: Reload Options Page & Verify Settings Auto-Restoration
    console.log('  Reloading Options Page to verify persistent state restoration...');
    await optCdp.send('Page.reload');
    await new Promise(r => setTimeout(r, 600));

    const restoreEval = await optCdp.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const input = document.getElementById('bro-url-input');
          const status = document.getElementById('url-status');
          return {
            inputValue: input.value,
            statusText: status.textContent
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });
    const restoreRes = restoreEval.result.value;
    assert.equal(restoreRes.inputValue, validUrl, 'Options input must restore saved URL on reload');
    console.log(`  ✓ Options page auto-restores saved URL on load: "${restoreRes.inputValue}"`);

    await optCdp.send('Runtime.evaluate', { expression: 'window.close()' });
    optCdp.close();

    // 6. Action Popup Invocation & Autofocus (F1) Real Runtime Verification
    console.log('\n[Test Suite] 6. Verifying Action Popup Invocation & Autofocus (F1)...');
    console.log('  Invoking chrome.action.openPopup from Service Worker to trigger actual Action Popup...');

    const openPopupRes = await swCdp.send('Runtime.evaluate', {
      expression: `
        (async () => {
          try {
            const wins = await chrome.windows.getAll();
            const normalWin = wins.find(w => w.type === 'normal') || wins[0];
            await chrome.windows.update(normalWin.id, { focused: true });
            await new Promise(r => setTimeout(r, 500));
            await chrome.action.openPopup({ windowId: normalWin.id });
            return { success: true, winId: normalWin.id };
          } catch (e) {
            return { success: false, error: e.message };
          }
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    assert.equal(openPopupRes.result?.value?.success, true, `chrome.action.openPopup failed: ${openPopupRes.result?.value?.error}`);
    console.log(`  ✓ chrome.action.openPopup succeeded on window ${openPopupRes.result?.value?.winId}.`);
    swCdp.close();

    await new Promise(r => setTimeout(r, 800));

    // Locate actual Action Popup target in browser targets list
    targets = await (await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)).json();
    const actionPopupTarget = targets.find(t => t.url && t.url.includes(`${EXPECTED_EXT_ID}/popup.html`));
    assert.ok(actionPopupTarget, `Action Popup target for ${EXPECTED_EXT_ID}/popup.html must be open`);
    console.log(`  ✓ Action Popup target found: ${actionPopupTarget.type} (ID: ${actionPopupTarget.id})`);

    const popupCdp = new CdpClient(actionPopupTarget.webSocketDebuggerUrl);
    await popupCdp.connect();

    const focusEval = await popupCdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const active = document.activeElement;
          return {
            activeId: active ? active.id : null,
            activeTag: active ? active.tagName.toLowerCase() : null,
            isTalkInput: Boolean(active && active.id === 'talk-input')
          };
        })()
      `,
      returnByValue: true
    });
    const focusRes = focusEval.result.value;
    assert.equal(focusRes.isTalkInput, true, 'document.activeElement.id must strictly be "talk-input"');
    console.log(`  ✓ Action Popup Focus verified: document.activeElement is <${focusRes.activeTag} id="${focusRes.activeId}"> (Autofocus F1 Confirmed)`);

    // Close action popup
    await popupCdp.send('Runtime.evaluate', { expression: 'window.close()' });
    popupCdp.close();

    console.log('\n================================================================');
    console.log('       ALL ACCEPTANCE CRITERIA FOR TICKET 03 (#27) PASSED       ');
    console.log('================================================================\n');
  } finally {
    // Clean restore of spikes/m0-b directory and reload in Chrome
    if (fs.existsSync(backupDir)) {
      fs.rmSync(LOADED_EXT_DIR, { recursive: true, force: true });
      fs.cpSync(backupDir, LOADED_EXT_DIR, { recursive: true });
      fs.rmSync(backupDir, { recursive: true, force: true });
      try {
        await triggerExtensionReload(EXPECTED_EXT_ID);
        console.log('[Test Suite] Cleaned up temporary test mount; restored and reloaded spikes/m0-b.');
      } catch (e) {
        console.log('[Test Suite] Cleaned up temporary test mount; restored spikes/m0-b files.');
      }
    }
  }
}

main().catch((err) => {
  console.error('\n[Verification Failed]', err);
  process.exit(1);
});
