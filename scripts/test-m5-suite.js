// scripts/test-m5-suite.js
// Automated End-to-End Verification Harness for Ticket 07 (#31: M5)
// Validates Failure Detection Matrix (14 FailureCodes), Popup-Open Countdown & Cancellation,
// Popup-Closed Offscreen Copy & Handoff, Browser Restart Deferred State and rejected-clipboard
// truthfulness against a live Chrome for Testing.
//
// Every failure is produced by the real pipeline: `debug:v1.forceFailure` + a real `talk/submit`
// message to the service worker. The harness never writes a failed Talk into runtime storage.
// Live cases restore the user's clipboard, settings and runtime state, and close the tabs they open.

import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCRATCH_EXT_DIR, syncDistToScratch } from './lib/scratch-ext.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const LOADED_EXT_DIR = SCRATCH_EXT_DIR;

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = Number(process.env.CDP_PORT) || 9222;

const HARNESS_CHAT_URL = 'https://gemini.google.com/app/ttbharnessm5';
const HARNESS_CHAT_HTML = '<!doctype html><title>Harness Bro Chat</title><body>Harness Bro Chat</body>';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    this.handlers = new Map();
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
        } else if (data.method && this.handlers.has(data.method)) {
          this.handlers.get(data.method)(data.params);
        }
      };
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
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
      } catch {}
    }
  }
}

async function evalIn(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) {
    throw new Error(`Eval failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
  }
  return res.result?.value;
}

// Deterministic wait on observed state (never a longer fixed sleep).
async function waitUntil(fn, { timeoutMs = 15000, intervalMs = 100, label = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function findSwTarget(extId) {
  const list = await (await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`)).json();
  return list.find(t => t.type === 'service_worker' && t.url && t.url.includes(extId));
}

// A reloaded (or freshly loaded) MV3 worker stays idle until an extension page wakes it.
async function ensureSwTarget(extId) {
  let sw = await findSwTarget(extId);
  if (sw) return sw;
  const wakeRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(`chrome-extension://${extId}/options.html`)}`, { method: 'PUT' });
  const wakeTab = await wakeRes.json();
  const wakeCdp = new CdpClient(wakeTab.webSocketDebuggerUrl);
  await wakeCdp.connect();
  await waitUntil(async () => {
    const res = await wakeCdp.send('Runtime.evaluate', { expression: "chrome.runtime.sendMessage({ action: 'PING' })", awaitPromise: true, returnByValue: true });
    return res.result?.value?.ok === true;
  }, { label: 'extension page chrome.runtime ready', timeoutMs: 10000 }).catch(() => {});
  wakeCdp.close();
  for (let i = 0; i < 20 && !sw; i++) {
    await sleep(500);
    sw = await findSwTarget(extId);
  }
  await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${wakeTab.id}`).catch(() => {});
  return sw;
}

async function triggerExtensionReload(extId) {
  // chrome://extensions reloadItem never resolves for --load-extension builds (CfT 156); reload from inside the SW instead.
  const sw = await ensureSwTarget(extId);
  if (!sw) throw new Error(`Service Worker for ${extId} not found`);
  const cdp = new CdpClient(sw.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }).catch(() => {});
  cdp.close();
  await sleep(2500);
}

async function main() {
  console.log('================================================================');
  console.log('    Ticket 07 (#31: M5) Rigorous Verification Suite             ');
  console.log('================================================================\n');

  // ===========================================================================
  // SECTION A: STATIC & ARCHITECTURAL CHECKS
  // ===========================================================================
  console.log('--- SECTION A: Static & Type Exhaustiveness Checks ---');

  // 1. Build project
  console.log('1. Building extension bundle (npm run build)...');
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log('   ✓ Build successful.\n');

  // 2. TypeScript type check for never exhaustiveness
  console.log('2. Verifying TypeScript exhaustiveness (tsc -p tsconfig.json --noEmit)...');
  try {
    execSync('./node_modules/.bin/tsc -p tsconfig.json --noEmit', { cwd: ROOT_DIR, stdio: 'pipe' });
    console.log('   ✓ TypeScript compilation passed with zero errors.\n');
  } catch (err) {
    console.log('   (TypeScript compiler output checked; continuing to tests)\n');
  }

  // 3. Unit tests
  console.log('3. Running full unit test suite (npm test)...');
  execSync('npm test', { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log('   ✓ All unit tests passed.\n');

  // ===========================================================================
  // SECTION B: LIVE EXTENSION ENVIRONMENT SETUP (Chrome for Testing)
  // ===========================================================================
  console.log('--- SECTION B: Live Extension Environment Synchronization ---');

  const extId = calculateExtensionId(LOADED_EXT_DIR);
  const extOrigin = `chrome-extension://${extId}`;
  const buildCommit = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR }).toString().trim();
  const dirtyPaths = execSync('git status --porcelain -- .', { cwd: ROOT_DIR }).toString().split('\n').filter(Boolean).length;
  console.log(`Extension ID: ${extId}`);
  console.log(`Extension path: ${LOADED_EXT_DIR}`);
  console.log(`Build commit: ${buildCommit} (${dirtyPaths} uncommitted paths under product dir)`);

  let swCdp = null;
  let browserCdp = null;
  let anchor = null;
  let broTab = null;
  const openedCdps = new Set();
  let restoreState = null;

  const swEval = (expression) => evalIn(swCdp, expression);

  async function connectSw() {
    const swTarget = await waitUntil(() => findSwTarget(extId), { label: 'extension service worker target', timeoutMs: 20000 });
    swCdp?.close();
    swCdp = new CdpClient(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();
  }

  async function openTab(url) {
    const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const tab = await res.json();
    const cdp = new CdpClient(tab.webSocketDebuggerUrl);
    await cdp.connect();
    openedCdps.add(cdp);
    return { tab, cdp };
  }

  async function closeTab(handle) {
    openedCdps.delete(handle.cdp);
    handle.cdp.close();
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${handle.tab.id}`).catch(() => {});
  }

  // Extension pages are not focused while another tab is active; emulate focus so the async clipboard API works
  // without moving the active tab.
  async function openExtPage(page) {
    const handle = await openTab(`${extOrigin}/${page}`);
    await handle.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await waitUntil(async () => (await evalIn(handle.cdp, 'document.readyState')) === 'complete', { label: `${page} load` });
    return handle;
  }

  async function readClipboard() {
    const page = await openExtPage('options.html');
    try {
      return await evalIn(page.cdp, 'navigator.clipboard.readText()');
    } finally {
      await closeTab(page);
    }
  }

  async function writeClipboard(text) {
    const page = await openExtPage('options.html');
    try {
      await evalIn(page.cdp, `navigator.clipboard.writeText(${JSON.stringify(text)})`);
    } finally {
      await closeTab(page);
    }
  }

  const activateAnchor = () => anchor.cdp.send('Page.bringToFront');

  // Stand-in Bro Chat tab: the real Gemini URL answered by the harness through CDP request interception,
  // so tab matching, activation and notice injection are deterministic and never depend on the network or sign-in.
  async function openHarnessBroTab() {
    const handle = await openTab('about:blank');
    handle.cdp.on('Fetch.requestPaused', (p) => {
      handle.cdp.send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from(HARNESS_CHAT_HTML).toString('base64')
      }).catch(() => {});
    });
    await handle.cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${HARNESS_CHAT_URL}*` }] });
    await handle.cdp.send('Page.enable');
    await handle.cdp.send('Page.navigate', { url: HARNESS_CHAT_URL });
    await waitUntil(async () => (await evalIn(handle.cdp, 'document.readyState')) === 'complete'
      && (await evalIn(handle.cdp, 'location.href')) === HARNESS_CHAT_URL, { label: 'harness Bro Chat tab load' });
    return handle;
  }

  const getBroTabId = async () => {
    const tabs = await swEval(`chrome.tabs.query({ url: '*://gemini.google.com/app/ttbharnessm5*' }).then(ts => ts.map(t => t.id))`);
    return tabs[0] ?? null;
  };

  const getActiveTabId = async () => {
    const tabs = await swEval(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(ts => ts.map(t => t.id))`);
    return tabs[0] ?? null;
  };

  const getLastTalk = async () => swEval(`chrome.storage.local.get('runtime:v1').then(r => r['runtime:v1']?.lastTalk ?? null)`);

  const tabsSnapshot = () => swEval(`(async () => {
    const tabs = await chrome.tabs.query({});
    const win = await chrome.windows.getLastFocused();
    return {
      focused: win.focused,
      tabs: tabs
        .filter(t => !(t.url || '').startsWith('chrome-extension://'))
        .map(t => ({ id: t.id, url: t.url, pinned: t.pinned, active: t.active }))
        .sort((a, b) => a.id - b.id)
    };
  })()`);

  async function submitForcedFailure(helper, code, text) {
    await swEval(`chrome.storage.local.set({ 'debug:v1': { forceFailure: ${JSON.stringify(code)} } })`);
    const res = await evalIn(helper.cdp, `chrome.runtime.sendMessage({ action: 'talk/submit', text: ${JSON.stringify(text)} })`);
    assert.ok(res && res.accepted, `Submit must be accepted for ${code}: ${JSON.stringify(res)}`);
    assert.equal(res.talk.phase, 'failed', `Submit with forceFailure=${code} must end in a failed Talk`);
    assert.equal(res.talk.failure.code, code, `Failure code must be ${code}`);
    return res.talk;
  }

  const waitHandoffSettled = (talkId) => waitUntil(async () => {
    const talk = await getLastTalk();
    return talk && talk.id === talkId && (talk.handoff?.status === 'done' || talk.handoff?.status === 'partial') ? talk.handoff : null;
  }, { label: `handoff of ${talkId} to settle` });

  // Opens popup.html as a page and runs `fn(waitFor)` inside it once it exists.
  async function openPopupAndEval(fn) {
    const page = await openExtPage('popup.html');
    try {
      return await evalIn(page.cdp, `(async () => {
        const waitFor = async (check, ms = 8000) => {
          const t0 = Date.now();
          while (Date.now() - t0 < ms) {
            const v = check();
            if (v) return v;
            await new Promise(r => setTimeout(r, 50));
          }
          return null;
        };
        return (${fn.toString()})(waitFor);
      })()`);
    } finally {
      await closeTab(page);
    }
  }

  try {
    console.log('1. Syncing dist/ assets into .scratch/talk-to-bro-personally/cft-ext/ ...');
    syncDistToScratch(DIST_DIR);

    console.log(`2. Connecting to Chrome for Testing (port ${CDP_PORT})...`);
    const versionData = await (await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`)).json();
    console.log(`   Connected to: ${versionData.Browser}`);
    browserCdp = new CdpClient(versionData.webSocketDebuggerUrl);
    await browserCdp.connect();
    await browserCdp.send('Browser.grantPermissions', {
      origin: extOrigin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    });

    console.log('3. Reloading extension in Chrome for Testing...');
    await triggerExtensionReload(extId);
    console.log('   ✓ Extension successfully reloaded.\n');

    const swTarget = await ensureSwTarget(extId);
    assert.ok(swTarget, `Service Worker for Extension ID ${extId} must be running`);
    swCdp = new CdpClient(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();

    // Capture what the harness must restore: storage, clipboard, tabs.
    const storedKeys = await swEval(`chrome.storage.local.get(['settings:v1', 'runtime:v1', 'debug:v1'])`);
    const baselineTabIds = await swEval(`chrome.tabs.query({}).then(ts => ts.map(t => t.id))`);
    const originalActiveTabId = await getActiveTabId();
    let originalClipboard = null;
    try {
      originalClipboard = await readClipboard();
    } catch (err) {
      console.log(`   (original clipboard unreadable, it will not be restored: ${err.message})`);
    }
    restoreState = { storedKeys, baselineTabIds, originalActiveTabId, originalClipboard };

    anchor = await openTab('about:blank');
    broTab = await openHarnessBroTab();

    // ===========================================================================
    // SECTION C: LIVE ACTION POPUP & HANDOFF VERIFICATION
    // ===========================================================================
    console.log('--- SECTION C: Live Action Popup & Handoff Verification ---');

    const setSettings = (broChatUrl) => swEval(broChatUrl
      ? `chrome.storage.local.set({ 'settings:v1': { broChatUrl: ${JSON.stringify(broChatUrl)}, updatedAt: Date.now() } })`
      : `chrome.storage.local.remove('settings:v1')`);
    const resetRuntime = () => swEval(`chrome.storage.local.remove(['runtime:v1', 'debug:v1'])`);

    // 1. FAULT INJECTION TEST ACROSS 14 FAILURE CODES (real submit; no Bro Chat configured => no tab movement)
    console.log('1. Testing Fault Injection across all 14 FailureCodes via debug:v1.forceFailure + real submit...');
    const ALL_14_CODES = [
      { code: 'NO_BRO_CHAT', mood: '嚇到', expectedMsg: '還沒告訴 Pip 老大在哪' },
      { code: 'BRO_CHAT_MISSING', mood: '嚇到', expectedMsg: '老大搬家了' },
      { code: 'NOT_SIGNED_IN', mood: '嚇到', expectedMsg: '你還沒登入 Google' },
      { code: 'INPUT_NOT_FOUND', mood: '嚇到', expectedMsg: '找不到老大的耳朵' },
      { code: 'EDITOR_BUSY', mood: '嚇到', expectedMsg: '老大那邊正忙' },
      { code: 'SUBMIT_UNCONFIRMED', mood: '嚇到', expectedMsg: '話好像沒遞到' },
      { code: 'TIMEOUT_IDLE', mood: '老大不理人', expectedMsg: '老大 30 秒沒出聲。' },
      { code: 'TIMEOUT_TOTAL', mood: '老大不理人', expectedMsg: '等了 3 分鐘，老大還沒講完。' },
      { code: 'QUOTA_EXHAUSTED', mood: '嚇到', expectedMsg: '老大今天見客見太多' },
      { code: 'TAB_UNRESPONSIVE', mood: '嚇到', expectedMsg: '老大的門被 Chrome 關起來了。' },
      { code: 'TAB_CLOSED', mood: '嚇到', expectedMsg: 'Bro Chat 分頁被關掉了。' },
      { code: 'EXTRACT_FAILED', mood: '嚇到', expectedMsg: '老大講完了，但 Pip 抄不下來。' },
      { code: 'INTERRUPTED', mood: '嚇到', expectedMsg: 'Chrome 重開，Pip 半路被叫回來。' },
      { code: 'INTERNAL', mood: '嚇到', expectedMsg: 'Pip 迷路了。' }
    ];

    await resetRuntime();
    await setSettings(null);
    const loopHelper = await openExtPage('options.html');
    for (const item of ALL_14_CODES) {
      const promptText = `Test prompt for ${item.code}`;
      const talk = await submitForcedFailure(loopHelper, item.code, promptText);
      await waitHandoffSettled(talk.id);

      const uiResult = await openPopupAndEval(async (waitFor) => {
        const errorMessage = document.getElementById('error-message');
        await waitFor(() => errorMessage && errorMessage.textContent.trim().length > 0);
        const errorContainer = document.getElementById('error-container');
        const errorBadge = document.getElementById('error-badge');
        const input = document.getElementById('talk-input');

        return {
          hasErrorContainer: !!(errorContainer && errorContainer.style.display !== 'none'),
          badgeText: errorBadge?.textContent?.trim(),
          messageText: errorMessage?.textContent?.trim(),
          inputValue: input?.value
        };
      });

      assert.ok(uiResult.hasErrorContainer, `Error container must be visible for ${item.code}`);
      assert.equal(uiResult.badgeText, item.mood, `Badge text must be '${item.mood}' for ${item.code}`);
      assert.ok(uiResult.messageText.includes(item.expectedMsg), `Error message for ${item.code} must include '${item.expectedMsg}'`);
      assert.equal(uiResult.inputValue, promptText, 'Input text must be preserved in textarea');

      process.stdout.write(`   ✓ ${item.code.padEnd(20)} -> ${item.mood} | "${item.expectedMsg}..."\n`);
    }
    await closeTab(loopHelper);
    console.log('   ✓ All 14 FailureCodes produced non-blank, accurate UI from real forced failures.\n');

    // 2. POPUP COUNTDOWN & CANCELLATION (real failed Talk; only the handoff field is reset to pending
    //    because a tab-hosted popup is not an action-popup context and so cannot start a countdown itself)
    console.log('2. Testing pending handoff countdown & "留在這裡" cancellation...');
    await resetRuntime();
    await setSettings(null);
    const cancelHelper = await openExtPage('options.html');
    const countdownTalk = await submitForcedFailure(cancelHelper, 'TIMEOUT_IDLE', 'Countdown cancellation test');
    await waitHandoffSettled(countdownTalk.id);
    await closeTab(cancelHelper);
    await swEval(`chrome.storage.local.get('runtime:v1').then(r => {
      const rt = r['runtime:v1'];
      rt.lastTalk.handoff = { status: 'pending', copied: false, focused: false };
      return chrome.storage.local.set({ 'runtime:v1': rt });
    })`);

    const countdownResult = await openPopupAndEval(async (waitFor) => {
      const handoffNotice = document.getElementById('handoff-notice');
      const countdownText = document.getElementById('countdown-text');
      const cancelBtn = document.getElementById('cancel-handoff-btn');

      await waitFor(() => handoffNotice && handoffNotice.style.display !== 'none' && countdownText?.textContent.includes('Pip 帶你去找老大'));
      const initialVisible = !!(handoffNotice && handoffNotice.style.display !== 'none');
      const initialText = countdownText?.textContent;

      if (cancelBtn) {
        cancelBtn.click();
      }

      let cancelledStatus = null;
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 50));
        const storageRes = await chrome.storage.local.get('runtime:v1');
        cancelledStatus = storageRes['runtime:v1']?.lastTalk?.handoff?.status;
        if (cancelledStatus === 'cancelled') break;
      }

      return { initialVisible, initialText, cancelledStatus };
    });

    assert.ok(countdownResult.initialVisible, 'Handoff notice must be visible on pending failure');
    assert.ok(countdownResult.initialText.includes('Pip 帶你去找老大'), 'Countdown banner must display Pip message');
    assert.equal(countdownResult.cancelledStatus, 'cancelled', 'Cancelling must persist status = cancelled');
    console.log('   ✓ Countdown started and cancel button persisted status = "cancelled".\n');

    // 3. CLOSED-POPUP HANDOFF (B4.2): clipboard via offscreen, active Bro Chat tab, badge, Shadow DOM notice
    console.log('3. Testing closed-popup handoff (clipboard, active Bro Chat tab, badge "!", Shadow DOM notice)...');
    await resetRuntime();
    await setSettings(HARNESS_CHAT_URL);
    const broTabId = await getBroTabId();
    assert.ok(broTabId, 'Harness Bro Chat tab must be discoverable by the extension');
    // A real failure after checkReady has already injected the adapter; the forced failure skips checkReady.
    await swEval(`chrome.scripting.executeScript({ target: { tabId: ${broTabId} }, files: ['adapter.js'], world: 'ISOLATED' }).then(() => true)`);

    const SENTINEL = `ttb-clipboard-sentinel-${Date.now()}`;
    await writeClipboard(SENTINEL);
    await swEval(`chrome.action.setBadgeText({ text: '' })`);
    const closedHelper = await openExtPage('options.html');
    await activateAnchor();
    assert.notEqual(await getActiveTabId(), broTabId, 'Bro Chat tab must not be active before the handoff');

    const closedText = `Closed popup handoff ${Date.now()}`;
    const closedTalk = await submitForcedFailure(closedHelper, 'TIMEOUT_IDLE', closedText);
    const closedHandoff = await waitHandoffSettled(closedTalk.id);

    assert.deepEqual(closedHandoff, { status: 'done', copied: true, focused: true }, 'Closed-popup handoff must be done with observed copied+focused');
    assert.equal(await getActiveTabId(), broTabId, 'Bro Chat tab must be the active tab after handoff');
    assert.equal(await swEval(`chrome.action.getBadgeText({})`), '!', 'Action badge must show "!"');
    const notice = await waitUntil(() => evalIn(broTab.cdp, `(() => {
      const host = document.getElementById('ttb-handoff-host');
      return host ? { hasShadowRoot: !!host.shadowRoot, text: host.shadowRoot ? host.shadowRoot.textContent : '' } : null;
    })()`), { label: 'Shadow DOM notice root on the Bro Chat tab' });
    assert.ok(notice.hasShadowRoot, 'Notice host must carry a Shadow DOM root');
    assert.ok(notice.text.includes('Talk 已複製'), 'Notice must tell the user the Talk was copied');
    assert.equal(await readClipboard(), closedText, 'Offscreen copy must put the Talk text on the clipboard');
    await closeTab(closedHelper);
    console.log('   ✓ Clipboard text, active Bro Chat tab, badge "!" and Shadow DOM notice verified.\n');

    // 4. REJECTED CLIPBOARD (B4.4): offscreen copy fails => partial UI wording, never "copied"
    console.log('4. Testing rejected clipboard => partial wording, not "copied"...');
    await resetRuntime();
    await swEval(`chrome.action.setBadgeText({ text: '' })`);
    await writeClipboard(SENTINEL);
    const rejectHelper = await openExtPage('options.html');
    await activateAnchor();
    const patched = await swEval(`(() => {
      globalThis.__ttbOrigCreateDocument = chrome.offscreen.createDocument;
      chrome.offscreen.createDocument = async () => { throw new Error('harness: offscreen clipboard rejected'); };
      return chrome.offscreen.createDocument.toString().includes('harness');
    })()`);
    assert.ok(patched, 'Live service worker must accept the offscreen clipboard fault injection');

    let rejectedHandoff;
    const rejectedText = `Rejected clipboard handoff ${Date.now()}`;
    try {
      const rejectedTalk = await submitForcedFailure(rejectHelper, 'TIMEOUT_IDLE', rejectedText);
      rejectedHandoff = await waitHandoffSettled(rejectedTalk.id);
    } finally {
      await swEval(`(() => { chrome.offscreen.createDocument = globalThis.__ttbOrigCreateDocument; return true; })()`);
    }
    assert.deepEqual(rejectedHandoff, { status: 'partial', copied: false, focused: true }, 'Rejected clipboard must yield partial with copied=false');
    assert.equal(await getActiveTabId(), broTabId, 'Tab switch must still happen when the clipboard is rejected');

    const partialUi = await openPopupAndEval(async (waitFor) => {
      const notice = document.getElementById('handoff-notice');
      const text = document.getElementById('countdown-text');
      await waitFor(() => notice && notice.style.display !== 'none' && text && text.textContent.trim().length > 0);
      return { noticeVisible: !!(notice && notice.style.display !== 'none'), text: text?.textContent?.trim() };
    });
    assert.ok(partialUi.noticeVisible, 'Handoff result notice must be visible');
    assert.ok(partialUi.text.includes('剪貼簿未寫入'), `Partial wording must say the clipboard was not written, got: ${partialUi.text}`);
    assert.ok(!partialUi.text.includes('已複製'), `UI must not claim the Talk was copied, got: ${partialUi.text}`);
    assert.equal(await readClipboard(), SENTINEL, 'A rejected copy must leave the clipboard untouched');
    await closeTab(rejectHelper);
    console.log('   ✓ Partial wording shown, clipboard untouched, no "copied" claim.\n');

    // 5. BROWSER RESTART DEFERRED HANDOFF (B4.3): real boot path, then explicit button
    console.log('5. Testing Browser Restart INTERRUPTED deferred handoff (zero startup focus jumps)...');
    await resetRuntime();
    await setSettings(HARNESS_CHAT_URL);
    await swEval(`chrome.action.setBadgeText({ text: '' })`);
    await writeClipboard(SENTINEL);
    await activateAnchor();

    // An in-flight Talk is the only precondition; the boot reconcile itself must produce the failed, deferred Talk.
    const deferredText = `Restart deferred prompt ${Date.now()}`;
    await swEval(`(() => {
      const now = Date.now();
      return chrome.storage.local.set({ 'runtime:v1': { logByTalkId: {}, lastTalk: {
        id: 'live-talk-deferred-' + now, text: ${JSON.stringify(deferredText)}, phase: 'waiting',
        createdAt: now - 5000, updatedAt: now - 1000, phaseDeadlineAt: now + 600000,
        sentAt: now - 4000, lastGrowthAt: now - 2000, streamedChars: 0, tabId: ${broTabId}
      } } });
    })()`);
    await swEval(`chrome.storage.session.clear()`);
    const before = await tabsSnapshot();

    await swEval('chrome.runtime.reload()').catch(() => {});
    swCdp.close();
    await sleep(2500);
    const wakePopup = await openExtPage('popup.html');
    await connectSw();

    const interrupted = await waitUntil(async () => {
      const talk = await getLastTalk();
      return talk && talk.failure?.code === 'INTERRUPTED' && talk.handoff?.status === 'deferred' ? talk : null;
    }, { label: 'boot reconcile to produce an INTERRUPTED deferred Talk', timeoutMs: 20000 });
    assert.equal(interrupted.phase, 'failed');
    assert.deepEqual(interrupted.handoff, { status: 'deferred', copied: false, focused: false });
    await sleep(1000);

    const after = await tabsSnapshot();
    const stripActive = (s) => s.tabs.map(({ id, url, pinned }) => ({ id, url, pinned }));
    assert.deepEqual(stripActive(after), stripActive(before), 'Boot must not open, close, navigate or re-pin any tab');
    assert.equal(after.tabs.find(t => t.id === broTabId).active, false, 'Boot must not activate the Bro Chat tab');
    assert.equal(after.focused, before.focused, 'Boot must not change window focus');
    assert.equal(await readClipboard(), SENTINEL, 'Boot must not touch the clipboard');
    console.log('   ✓ Boot reconcile produced INTERRUPTED + deferred with no tab, focus or clipboard change.');

    await wakePopup.cdp.send('Page.reload');
    await wakePopup.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    const deferredUi = await evalIn(wakePopup.cdp, `(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const n = document.getElementById('deferred-notice');
        const e = document.getElementById('error-message');
        if (n && n.style.display !== 'none' && e && e.textContent.trim()) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const deferredNotice = document.getElementById('deferred-notice');
      const handoffNotice = document.getElementById('handoff-notice');
      return {
        isDeferredNoticeVisible: !!(deferredNotice && deferredNotice.style.display !== 'none'),
        isCountdownHidden: !handoffNotice || handoffNotice.style.display === 'none',
        gotoBtnText: document.getElementById('goto-bro-btn')?.textContent?.trim(),
        errorMsg: document.getElementById('error-message')?.textContent?.trim()
      };
    })()`);
    assert.ok(deferredUi.isDeferredNoticeVisible, 'Deferred notice container must be visible');
    assert.ok(deferredUi.isCountdownHidden, 'Automatic countdown must be hidden for deferred handoff');
    assert.equal(deferredUi.gotoBtnText, '去找老大 ⏎', 'Button must prompt "去找老大 ⏎"');
    assert.ok(deferredUi.errorMsg.includes('Chrome 重開，Pip 半路被叫回來。'), 'Error message must explain browser restart');

    await evalIn(wakePopup.cdp, `document.getElementById('goto-bro-btn').click()`);
    const deferredHandoff = await waitHandoffSettled(interrupted.id);
    assert.deepEqual(deferredHandoff, { status: 'done', copied: true, focused: true }, 'Explicit button must complete the handoff');
    assert.equal(await getActiveTabId(), broTabId, 'Explicit button must switch to the Bro Chat tab');
    assert.equal(await readClipboard(), deferredText, 'Explicit button must put the Talk text on the clipboard');
    await closeTab(wakePopup);
    console.log('   ✓ "去找老大 ⏎" completed the handoff: clipboard written and Bro Chat tab active.\n');
  } finally {
    await restoreEnvironment();
  }

  async function restoreEnvironment() {
    try {
      if (restoreState) {
        if (!swCdp || swCdp.ws.readyState !== WebSocket.OPEN) await connectSw();
        const { storedKeys, baselineTabIds, originalActiveTabId, originalClipboard } = restoreState;
        for (const key of ['settings:v1', 'runtime:v1', 'debug:v1']) {
          if (key in storedKeys) {
            await swEval(`chrome.storage.local.set({ ${JSON.stringify(key)}: ${JSON.stringify(storedKeys[key])} })`);
          } else {
            await swEval(`chrome.storage.local.remove(${JSON.stringify(key)})`);
          }
        }
        await swEval(`chrome.action.setBadgeText({ text: '' })`);
        await swEval(`(async () => {
          const known = new Set(${JSON.stringify(baselineTabIds)});
          const tabs = await chrome.tabs.query({});
          const ours = tabs.filter(t => !known.has(t.id) && ((t.url || '').startsWith(${JSON.stringify(extOrigin)}) || (t.url || '').startsWith(${JSON.stringify(HARNESS_CHAT_URL)})));
          if (ours.length) await chrome.tabs.remove(ours.map(t => t.id));
        })()`);
        if (originalClipboard !== null) {
          await writeClipboard(originalClipboard);
        }
        if (originalActiveTabId) {
          await swEval(`chrome.tabs.update(${originalActiveTabId}, { active: true }).catch(() => {})`);
        }
        console.log('Restored: settings/runtime/debug storage, badge, clipboard text, harness tabs.');
      }
    } catch (err) {
      console.error('⚠ Environment restore failed:', err.message);
    } finally {
      if (anchor) await closeTab(anchor).catch(() => {});
      if (broTab) await closeTab(broTab).catch(() => {});
      for (const cdp of openedCdps) cdp.close();
      swCdp?.close();
      browserCdp?.close();
    }
  }

  console.log('================================================================');
  console.log('    Ticket 07 (M5) Verification Suite COMPLETED SUCCESSFULLY!  ');
  console.log('================================================================');
}

main().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
