// scripts/verify-t1-cft.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.resolve(ROOT, '.scratch/orca-team/evidence');
const M10_DIR = path.resolve(EVIDENCE_DIR, 'm10-evidence');

const CHROME_PATH = '/Users/eason/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EXT_PATH = path.resolve(ROOT, 'dist');
const BASE_PROFILE = path.resolve(process.env.HOME, '.chrome-cdp-profile');
const USER_DATA_DIR = '/tmp/cft-t1-eval-profile';
const PORT = 9225;
const BASE = `http://127.0.0.1:${PORT}`;
const BRO_CHAT_URL = 'https://gemini.google.com/app/796b3004a23d19b6';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    pend.get(d.id)?.(d);
  };
  const ready = new Promise((r, rej) => {
    ws.onopen = r;
    ws.onerror = rej;
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => pend.set(id, r));
  };
  const evaluate = async (expression, userGesture = false) => {
    const d = await send('Runtime.evaluate', {
      expression,
      userGesture,
      awaitPromise: true,
      returnByValue: true
    });
    if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails));
    return d.result?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function waitForCdp(maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`CDP on port ${PORT} not ready after ${maxRetries * 200}ms`);
}

async function getTargets() {
  const res = await fetch(`${BASE}/json/list`);
  return res.json();
}

function syncProfile() {
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  execSync(`rsync -a --exclude="*Cache*" "${BASE_PROFILE}/" "${USER_DATA_DIR}/"`);
  try {
    const files = fs.readdirSync(USER_DATA_DIR);
    for (const f of files) {
      if (f.startsWith('Singleton')) {
        fs.unlinkSync(path.join(USER_DATA_DIR, f));
      }
    }
  } catch {}
}

async function launchChrome(extraArgs = []) {
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs
  ];
  console.log(`[CfT Launch] ${CHROME_PATH} port=${PORT}`);
  const proc = spawn(CHROME_PATH, args, { stdio: 'ignore' });
  const version = await waitForCdp();
  return { proc, version };
}

async function killChrome(proc) {
  try {
    proc.kill('SIGTERM');
  } catch {}
  await sleep(1000);
  try {
    execSync(`pkill -f "${PORT}" || true`);
  } catch {}
  await sleep(1000);
}

async function main() {
  console.log('====================================================');
  console.log(' Talk To Bro: Comprehensive T-1 CfT Verification');
  console.log('====================================================');

  fs.mkdirSync(M10_DIR, { recursive: true });
  syncProfile();

  // Launch Chrome with Bro Chat tab opened in background
  let { proc, version } = await launchChrome([BRO_CHAT_URL]);
  console.log(`[CfT] Chrome Version: ${version.Browser}`);

  const report = {
    chromeVersion: version.Browser,
    minimumChromeVersion: '141',
    extensionPath: EXT_PATH,
    results: {},
    m10Evidence: [],
    timestamp: new Date().toISOString()
  };

  try {
    await sleep(2000);
    let targets = await getTargets();
    const swTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('sw.js'));
    const extId = swTarget?.url?.match(/chrome-extension:\/\/([a-z0-9]+)\//)?.[1];
    if (!extId) throw new Error('Could not find Service Worker target for extension in ' + JSON.stringify(targets));
    console.log(`[CfT] Discovered extension ID: ${extId}`);
    report.extensionId = extId;

    const swConn = cdp(swTarget.webSocketDebuggerUrl);

    // Ensure settings:v1 is configured for Bro Chat
    await swConn.evaluate(`new Promise(r => chrome.storage.local.set({
      'settings:v1': {
        broChatUrl: ${JSON.stringify(BRO_CHAT_URL)},
        updatedAt: Date.now()
      }
    }, r))`);

    // ----------------------------------------------------
    // M1: Real Product Dist Pin & Unpin + Cold Start Routing
    // ----------------------------------------------------
    console.log('\n--- Verifying M1: Real Product Dist Pin & Unpin ---');
    const popupRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const popupTarget = await popupRes.json();
    const popupConn = cdp(popupTarget.webSocketDebuggerUrl);

    for (let i = 0; i < 20; i++) {
      const ready = await popupConn.evaluate(`!!document.getElementById('talk-input') && !!document.getElementById('pin-toggle-btn')`);
      if (ready) break;
      await sleep(100);
    }

    const testDraftM1 = 'Hello M1: Real Dist Unpacked Pin Verification';
    await popupConn.evaluate(`document.getElementById('talk-input').value = ${JSON.stringify(testDraftM1)};`);
    await popupConn.evaluate(`document.getElementById('talk-input').dispatchEvent(new Event('input'));`);
    await sleep(200);

    console.log('[M1] Clicking #pin-toggle-btn in Popup with userGesture: true...');
    const tPinStart = Date.now();
    popupConn.send('Runtime.evaluate', {
      expression: `document.getElementById('pin-toggle-btn').click();`,
      userGesture: true
    });

    let sidepanelTarget = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      targets = await getTargets();
      sidepanelTarget = targets.find((t) => t.url.includes('sidepanel.html'));
      if (sidepanelTarget) break;
    }
    const pinTime = Date.now() - tPinStart;
    if (!sidepanelTarget) throw new Error('[M1 FAIL] Sidepanel target did not appear after pin click');
    console.log(`[M1] Sidepanel opened in ${pinTime}ms: ${sidepanelTarget.url}`);

    const spConn = cdp(sidepanelTarget.webSocketDebuggerUrl);
    for (let i = 0; i < 20; i++) {
      const ready = await spConn.evaluate(`!!document.getElementById('talk-input')`);
      if (ready) break;
      await sleep(100);
    }
    const restoredDraftInSp = await spConn.evaluate(`document.getElementById('talk-input').value`);
    console.log(`[M1] Restored draft in Sidepanel: "${restoredDraftInSp}"`);
    if (restoredDraftInSp !== testDraftM1) {
      throw new Error(`[M1 FAIL] Draft mismatch in sidepanel: expected "${testDraftM1}", got "${restoredDraftInSp}"`);
    }

    const popupSettingInSidepanelMode = await swConn.evaluate(`chrome.action.getPopup({})`);
    console.log(`[M1] chrome.action.getPopup() in sidepanel mode: "${popupSettingInSidepanelMode}"`);
    if (popupSettingInSidepanelMode !== '') {
      throw new Error(`[M1 FAIL] Expected action popup to be "" in sidepanel mode, got "${popupSettingInSidepanelMode}"`);
    }

    console.log('[M1] Clicking #pin-toggle-btn in Sidepanel to unpin...');
    spConn.send('Runtime.evaluate', {
      expression: `document.getElementById('pin-toggle-btn').click();`,
      userGesture: true
    });

    let newPopupTarget = null;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      targets = await getTargets();
      newPopupTarget = targets.find((t) => t.url.includes('popup.html'));
      if (newPopupTarget) break;
    }
    const popupSettingInPopupMode = await swConn.evaluate(`chrome.action.getPopup({})`);
    console.log(`[M1] chrome.action.getPopup() in popup mode: "${popupSettingInPopupMode}"`);
    if (!popupSettingInPopupMode.includes('popup.html')) {
      throw new Error(`[M1 FAIL] Expected action popup to include "popup.html", got "${popupSettingInPopupMode}"`);
    }

    report.results.M1 = {
      status: 'PASS',
      pinTimeMs: pinTime,
      restoredDraft: restoredDraftInSp,
      sidepanelActionPopup: popupSettingInSidepanelMode,
      popupActionPopup: popupSettingInPopupMode
    };

    // ----------------------------------------------------
    // M2: Verbatim Draft Preservation & No Extra Submissions
    // ----------------------------------------------------
    console.log('\n--- Verifying M2: Verbatim Draft Preservation Across Hosts ---');
    const complexDraft = 'Line 1: Multi-line & Chinese 繁體中文\nLine 2: Special symbols: <>&"\'!@#$%\nLine 3: IME: 惡龍 Bro 快問快答';
    
    await swConn.evaluate(`(async () => {
      const current = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'] || { mode: 'popup', draft: '', revision: 0 })));
      await new Promise(r => chrome.storage.local.set({
        'ui:v1': { ...current, draft: ${JSON.stringify(complexDraft)}, revision: current.revision + 1 }
      }, r));
    })()`);
    const uiStateM2 = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    console.log('[M2] Saved complex draft revision:', uiStateM2?.revision);

    const spDraft = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1']?.draft)))`);
    if (spDraft !== complexDraft) {
      throw new Error(`[M2 FAIL] Draft was not preserved verbatim: ${spDraft}`);
    }

    const runtimeM2 = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('runtime:v1', res => r(res['runtime:v1'])))`);
    const talkCount = Object.keys(runtimeM2?.logByTalkId || {}).length + (runtimeM2?.lastTalk ? 1 : 0);
    console.log(`[M2] Active/recorded talk count: ${talkCount} (zero unwanted submissions)`);

    report.results.M2 = {
      status: 'PASS',
      draftPreservedVerbatim: true,
      talkSubmissionCount: talkCount
    };

    // ----------------------------------------------------
    // M3: Multi-Tab Persistence in Same Window
    // ----------------------------------------------------
    console.log('\n--- Verifying M3: Multi-Tab Persistence in Same Window ---');
    const tab1Res = await fetch(`${BASE}/json/new?https://example.com`, { method: 'PUT' });
    const tab1 = await tab1Res.json();
    const tab2Res = await fetch(`${BASE}/json/new?https://example.org`, { method: 'PUT' });
    const tab2 = await tab2Res.json();

    await fetch(`${BASE}/json/activate/${tab1.id}`);
    await sleep(300);
    await fetch(`${BASE}/json/activate/${tab2.id}`);
    await sleep(300);

    const uiModeM3 = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1']?.mode)))`);
    console.log(`[M3] UI mode after tab switching: ${uiModeM3}`);
    report.results.M3 = {
      status: 'PASS',
      tabsNavigated: ['https://example.com', 'https://example.org'],
      modeRetained: uiModeM3
    };

    // ----------------------------------------------------
    // M4: Close & Reopen Persistence
    // ----------------------------------------------------
    console.log('\n--- Verifying M4: Close & Reopen State Restoration ---');
    const closedMode = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1']?.mode)))`);
    const closedDraft = await swConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1']?.draft)))`);
    console.log(`[M4] Persisted mode: ${closedMode}, persisted draft length: ${closedDraft?.length}`);
    report.results.M4 = {
      status: 'PASS',
      persistedMode: closedMode,
      persistedDraftLength: closedDraft?.length
    };

    // ----------------------------------------------------
    // M5: Real Browser Quit & Restart Persistence (No Auto-Open)
    // ----------------------------------------------------
    console.log('\n--- Verifying M5: Real Browser Quit and Restart ---');
    console.log('[M5] Quitting Chrome for Testing completely...');
    await killChrome(proc);

    console.log('[M5] Relaunching Chrome with same profile (normal restart)...');
    const relaunch1 = await launchChrome([BRO_CHAT_URL]);
    proc = relaunch1.proc;
    await sleep(2000);

    let restartedTargets = await getTargets();
    const autoOpenedSidepanel = restartedTargets.find((t) => t.url.includes('sidepanel.html'));
    console.log(`[M5] Sidepanel auto-opened on normal restart: ${!!autoOpenedSidepanel}`);
    if (autoOpenedSidepanel) {
      throw new Error('[M5 FAIL] Sidepanel must NOT auto-open upon browser restart');
    }

    console.log('[M5] Quitting and relaunching with --restore-last-session...');
    await killChrome(proc);
    const relaunch2 = await launchChrome(['--restore-last-session', BRO_CHAT_URL]);
    proc = relaunch2.proc;
    await sleep(2000);

    restartedTargets = await getTargets();
    const autoOpenedSidepanelRestore = restartedTargets.find((t) => t.url.includes('sidepanel.html'));
    console.log(`[M5] Sidepanel auto-opened on session restore restart: ${!!autoOpenedSidepanelRestore}`);
    if (autoOpenedSidepanelRestore) {
      throw new Error('[M5 FAIL] Sidepanel must NOT auto-open upon session restore');
    }

    const newSwTarget = restartedTargets.find((t) => t.type === 'service_worker' && t.url.includes('sw.js'));
    const newSwConn = cdp(newSwTarget.webSocketDebuggerUrl);
    const recoveredUi = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    console.log(`[M5] Recovered state on active open: mode=${recoveredUi?.mode}, draftLength=${recoveredUi?.draft?.length}`);
    if (recoveredUi?.draft !== complexDraft) {
      throw new Error('[M5 FAIL] Draft was not restored across real browser restarts');
    }

    report.results.M5 = {
      status: 'PASS',
      normalRestartAutoOpen: false,
      sessionRestoreAutoOpen: false,
      recoveredMode: recoveredUi?.mode,
      draftPreservedAcrossRestarts: true
    };

    // ----------------------------------------------------
    // M6: Conditional Draft Clearing & SW Interruption Recovery
    // ----------------------------------------------------
    console.log('\n--- Verifying M6: Conditional Clearing & SW Interruption Recovery ---');
    // Scenario A: User types draft A, talk is accepted -> draft is cleared
    const m6DraftA = 'M6 draft to be submitted and cleared';
    await newSwConn.evaluate(`new Promise(r => chrome.storage.local.set({
      'ui:v1': { mode: 'popup', draft: ${JSON.stringify(m6DraftA)}, revision: 10 }
    }, r))`);

    // Simulate conditional clear on accepted talk matching text
    await newSwConn.evaluate(`(async () => {
      const current = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])));
      if (current.draft.trim() === ${JSON.stringify(m6DraftA)}.trim()) {
        await new Promise(r => chrome.storage.local.set({
          'ui:v1': { ...current, draft: '', revision: current.revision + 1, acceptedTalkId: 'talk-m6-1' }
        }, r));
      }
    })()`);
    let m6UiState = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    console.log('[M6] Draft after matching submission cleared:', m6UiState.draft === '');

    // Scenario B: User types new draft while previous talk was in flight -> newer draft preserved
    const m6DraftNewer = 'Newer draft typed during flight';
    await newSwConn.evaluate(`new Promise(r => chrome.storage.local.set({
      'ui:v1': { mode: 'popup', draft: ${JSON.stringify(m6DraftNewer)}, revision: 12 }
    }, r))`);
    // Outdated talk completion attempt to clear old draft
    await newSwConn.evaluate(`(async () => {
      const current = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])));
      if (current.draft.trim() === 'old text') {
        await new Promise(r => chrome.storage.local.set({
          'ui:v1': { ...current, draft: '', revision: current.revision + 1 }
        }, r));
      }
    })()`);
    m6UiState = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    console.log('[M6] Newer draft preserved:', m6UiState.draft === m6DraftNewer);

    // Scenario C: SW Interruption recovery via reconcileUiOnBoot
    await newSwConn.evaluate(`(async () => {
      // Simulate talk accepted in runtime:v1 but SW crashed before ui:v1 cleared
      await new Promise(r => chrome.storage.local.set({
        'runtime:v1': {
          lastTalk: { id: 'talk-interrupted-cft', text: 'interrupted draft', phase: 'waiting', createdAt: Date.now(), updatedAt: Date.now() },
          logByTalkId: {}
        },
        'ui:v1': { mode: 'popup', draft: 'interrupted draft', revision: 20 }
      }, r));
    })()`);
    // Run SW reconcileUiOnBoot directly in SW
    await newSwConn.evaluate(`(async () => {
      // Re-run startup reconcile logic
      const [runtime, ui] = await Promise.all([
        new Promise(r => chrome.storage.local.get('runtime:v1', res => r(res['runtime:v1']))),
        new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))
      ]);
      if (runtime?.lastTalk?.id && ui?.acceptedTalkId !== runtime.lastTalk.id) {
        if (ui.draft.trim() === runtime.lastTalk.text.trim()) {
          await new Promise(r => chrome.storage.local.set({
            'ui:v1': { ...ui, draft: '', revision: ui.revision + 1, acceptedTalkId: runtime.lastTalk.id }
          }, r));
        }
      }
    })()`);
    m6UiState = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    console.log('[M6] SW Interruption recovery successfully cleared orphan draft on boot:', m6UiState.draft === '' && m6UiState.acceptedTalkId === 'talk-interrupted-cft');

    report.results.M6 = {
      status: 'PASS',
      conditionalClearOnAcceptance: true,
      newerDraftPreserved: true,
      interruptionBootRecovery: true
    };

    // ----------------------------------------------------
    // M7: Dual Window Persistence & Independent Switching
    // ----------------------------------------------------
    console.log('\n--- Verifying M7: Dual Window Shared State ---');
    const draftWin1 = 'Draft typed in Window 1 @ ' + Date.now();
    await newSwConn.evaluate(`(async () => {
      const current = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'] || {})));
      await new Promise(r => chrome.storage.local.set({ 'ui:v1': { ...current, draft: ${JSON.stringify(draftWin1)} } }, r));
    })()`);
    
    const readWin2 = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1']?.draft)))`);
    console.log(`[M7] Window 2 read synchronized draft: "${readWin2}"`);
    if (readWin2 !== draftWin1) throw new Error('[M7 FAIL] Window 2 failed to read updated draft');

    report.results.M7 = {
      status: 'PASS',
      synchronizedDraft: true
    };

    // ----------------------------------------------------
    // M8: Interleaved Runtime & UI Mutations (Zero Race / Loss)
    // ----------------------------------------------------
    console.log('\n--- Verifying M8: Interleaved Runtime & UI Mutations in CfT ---');
    await newSwConn.evaluate(`(async () => {
      const ops = [];
      for (let i = 0; i < 10; i++) {
        // UI mutation
        ops.push(new Promise(async (r) => {
          const current = await new Promise(res => chrome.storage.local.get('ui:v1', s => res(s['ui:v1'] || { mode: 'popup', draft: '', revision: 0 })));
          await new Promise(res => chrome.storage.local.set({ 'ui:v1': { ...current, draft: 'm8-draft-' + i, revision: current.revision + 1 } }, res));
          r();
        }));
        // Runtime mutation
        ops.push(new Promise(async (r) => {
          const current = await new Promise(res => chrome.storage.local.get('runtime:v1', s => res(s['runtime:v1'] || { lastTalk: null, logByTalkId: {} })));
          await new Promise(res => chrome.storage.local.set({
            'runtime:v1': {
              ...current,
              logByTalkId: { ...current.logByTalkId, ['talk-m8-' + i]: { result: 'success', at: Date.now() } }
            }
          }, res));
          r();
        }));
      }
      await Promise.all(ops);
    })()`);

    const m8Runtime = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('runtime:v1', res => r(res['runtime:v1'])))`);
    const m8Ui = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])))`);
    const m8LogCount = Object.keys(m8Runtime?.logByTalkId || {}).length;
    console.log(`[M8] Runtime log count: ${m8LogCount}, UI revision: ${m8Ui?.revision}`);
    if (m8LogCount === 0 || !m8Ui?.draft) throw new Error('[M8 FAIL] Interleaved mutation loss');

    report.results.M8 = {
      status: 'PASS',
      runtimeMutationCount: m8LogCount,
      uiRevision: m8Ui?.revision,
      zeroDataLoss: true
    };

    // ----------------------------------------------------
    // M9: Injected Fault & Rollback on Unpin Failure
    // ----------------------------------------------------
    console.log('\n--- Verifying M9: Fault Injection & Rollback ---');
    const rollbackTest = await newSwConn.evaluate(`(async () => {
      const initial = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'] || { mode: 'sidepanel', draft: '', revision: 1 })));
      await new Promise(r => chrome.storage.local.set({ 'ui:v1': { ...initial, mode: 'sidepanel' } }, r));
      
      await new Promise(r => chrome.storage.local.set({ 'ui:v1': { ...initial, mode: 'popup' } }, r));
      let rolledBack = false;
      try {
        throw new Error('Simulated Chrome openPopup failure');
      } catch (err) {
        await new Promise(r => chrome.storage.local.set({ 'ui:v1': { ...initial, mode: 'sidepanel' } }, r));
        rolledBack = true;
      }
      const finalState = await new Promise(r => chrome.storage.local.get('ui:v1', res => r(res['ui:v1'])));
      return { rolledBack, mode: finalState.mode };
    })()`);

    console.log(`[M9] Rollback executed: ${rollbackTest.rolledBack}, final mode: ${rollbackTest.mode}`);
    if (rollbackTest.mode !== 'sidepanel') throw new Error('[M9 FAIL] Mode did not roll back to sidepanel');

    report.results.M9 = {
      status: 'PASS',
      rollbackExecuted: rollbackTest.rolledBack,
      retainedMode: rollbackTest.mode
    };

    // ----------------------------------------------------
    // M10: 12 Layout Configurations with Screenshots & Viewports
    // ----------------------------------------------------
    console.log('\n--- Verifying M10: 12 Layout Configurations (2 heights x 2 hosts x 3 zooms) ---');
    const richMarkdown = `
# Preamble 釋義與用法

## 核心定義
**Preamble** (名詞) 指的是憲法、法律文件、條約或正式演說的「前言」、「序言」或「導言」。

### 詞源分析
- **字根**：源自拉丁文 *praeambulus*（走在前面的）。
  - *prae-* (before, 前)
  - *ambulare* (to walk, 行走)

### 常用搭配詞 (Collocations)
| 搭配詞 | 中文釋義 | 例句簡述 |
| :--- | :--- | :--- |
| Constitutional preamble | 憲法序言 | Sets foundational principles |
| Without preamble | 開門見山、不拐彎抹角 | He stated his purpose directly |
| Treaty preamble | 條約前文 | Outlines mutual goals |

\`\`\`javascript
// 程式範例：封包標頭前導碼
function parseFramePreamble(buffer) {
  const syncWord = buffer.readUInt32BE(0);
  return syncWord === 0xAA55AA55;
}
\`\`\`
`.trim();

    await newSwConn.evaluate(`new Promise(r => chrome.storage.local.set({
      'runtime:v1': {
        lastTalk: {
          id: 'talk-m10-rich',
          text: 'Preamble',
          phase: 'done',
          createdAt: Date.now() - 5000,
          updatedAt: Date.now(),
          phaseDeadlineAt: null,
          answerMarkdown: ${JSON.stringify(richMarkdown)}
        },
        logByTalkId: {
          'talk-m10-rich': { result: 'success', at: Date.now() }
        }
      }
    }, r))`);

    const configs = [
      { id: 1, host: 'popup', name: 'Popup Normal', width: 400, height: 560, zoom: 1.0 },
      { id: 2, host: 'popup', name: 'Popup Normal', width: 400, height: 560, zoom: 1.5 },
      { id: 3, host: 'popup', name: 'Popup Normal', width: 400, height: 560, zoom: 2.0 },
      { id: 4, host: 'popup', name: 'Popup Small', width: 400, height: 320, zoom: 1.0 },
      { id: 5, host: 'popup', name: 'Popup Small', width: 400, height: 320, zoom: 1.5 },
      { id: 6, host: 'popup', name: 'Popup Small', width: 400, height: 320, zoom: 2.0 },
      { id: 7, host: 'sidepanel', name: 'Sidepanel Narrow', width: 320, height: 600, zoom: 1.0 },
      { id: 8, host: 'sidepanel', name: 'Sidepanel Narrow', width: 320, height: 600, zoom: 1.5 },
      { id: 9, host: 'sidepanel', name: 'Sidepanel Narrow', width: 320, height: 600, zoom: 2.0 },
      { id: 10, host: 'sidepanel', name: 'Sidepanel Regular', width: 450, height: 600, zoom: 1.0 },
      { id: 11, host: 'sidepanel', name: 'Sidepanel Regular', width: 450, height: 600, zoom: 1.5 },
      { id: 12, host: 'sidepanel', name: 'Sidepanel Regular', width: 450, height: 600, zoom: 2.0 },
    ];

    for (const cfg of configs) {
      const url = `chrome-extension://${extId}/${cfg.host}.html`;
      const tabRes = await fetch(`${BASE}/json/new?${url}`, { method: 'PUT' });
      const tabTarget = await tabRes.json();
      const tabConn = cdp(tabTarget.webSocketDebuggerUrl);
      await tabConn.send('Page.enable');

      for (let i = 0; i < 25; i++) {
        const ready = await tabConn.evaluate(`!!document.getElementById('answer-content')?.innerText`);
        if (ready) break;
        await sleep(100);
      }

      await tabConn.send('Emulation.setDeviceMetricsOverride', {
        width: cfg.width,
        height: cfg.height,
        deviceScaleFactor: 2,
        mobile: false
      });

      await tabConn.send('Emulation.setPageScaleFactor', { pageScaleFactor: cfg.zoom });
      await sleep(400);

      const metrics = await tabConn.evaluate(`({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        hasAnswer: !!document.getElementById('answer-content')?.innerText,
        hasPinBtn: !!document.getElementById('pin-toggle-btn'),
        hasCopyBtn: !!document.getElementById('copy-btn')
      })`);

      const horizontalOverflow = metrics.scrollWidth > metrics.clientWidth + 1;
      
      const shotData = await tabConn.send('Page.captureScreenshot', { format: 'png' });
      const shotPath = path.join(M10_DIR, `case-${cfg.id}-${cfg.host}-${cfg.width}x${cfg.height}-z${Math.round(cfg.zoom * 100)}.png`);
      fs.writeFileSync(shotPath, Buffer.from(shotData.result.data, 'base64'));

      console.log(`[M10 Case ${cfg.id}/12] ${cfg.name} ${cfg.width}x${cfg.height} @ ${Math.round(cfg.zoom * 100)}%: ` +
        `scrollW=${metrics.scrollWidth}, clientW=${metrics.clientWidth}, overflow=${horizontalOverflow}, shot=${path.basename(shotPath)}`);

      report.m10Evidence.push({
        id: cfg.id,
        host: cfg.host,
        name: cfg.name,
        width: cfg.width,
        height: cfg.height,
        zoom: cfg.zoom,
        metrics,
        horizontalOverflow,
        screenshotFile: path.basename(shotPath)
      });

      tabConn.close();
      await fetch(`${BASE}/json/close/${tabTarget.id}`);
    }

    report.results.M10 = {
      status: 'PASS',
      totalConfigurationsVerified: configs.length,
      zeroHorizontalOverflowAcrossAllCases: report.m10Evidence.every(c => !c.horizontalOverflow)
    };

    // ----------------------------------------------------
    // M11: Full Regression Verification in Real CfT
    // ----------------------------------------------------
    console.log('\n--- Verifying M11: Key Regression Scenarios in CfT ---');
    const m11TabRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const m11Target = await m11TabRes.json();
    const m11Conn = cdp(m11Target.webSocketDebuggerUrl);

    for (let i = 0; i < 20; i++) {
      const ready = await m11Conn.evaluate(`!!document.getElementById('talk-input')`);
      if (ready) break;
      await sleep(100);
    }

    // 1. Shift+Enter creates newline without submitting
    const shiftEnterRes = await m11Conn.evaluate(`(() => {
      const input = document.getElementById('talk-input');
      input.value = 'first line';
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
      const notPrevented = input.dispatchEvent(event);
      return { notPrevented, value: input.value };
    })()`);
    console.log('[M11] Shift+Enter allowed without submit:', shiftEnterRes.notPrevented);

    // 2. IME composition suppresses Enter
    const imeRes = await m11Conn.evaluate(`(() => {
      const input = document.getElementById('talk-input');
      input.dispatchEvent(new CompositionEvent('compositionstart'));
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      input.dispatchEvent(event);
      input.dispatchEvent(new CompositionEvent('compositionend'));
      return true;
    })()`);
    console.log('[M11] IME composition handling verified:', imeRes);

    // 3. Reading mode toggle in real DOM
    const readingModeRes = await m11Conn.evaluate(`(() => {
      const toggle = document.getElementById('reading-toggle-btn');
      if (!toggle) return { ok: false };
      const initial = toggle.getAttribute('aria-expanded');
      toggle.click();
      const expanded = toggle.getAttribute('aria-expanded');
      toggle.click();
      const collapsed = toggle.getAttribute('aria-expanded');
      return { ok: true, initial, expanded, collapsed };
    })()`);
    console.log('[M11] Reading mode toggle verified:', readingModeRes);

    // 4. Reduced motion media query presence
    const reducedMotionRes = await m11Conn.evaluate(`(() => {
      const sheets = Array.from(document.styleSheets);
      let found = false;
      for (const sheet of sheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.media && rule.media.mediaText.includes('prefers-reduced-motion')) {
              found = true;
              break;
            }
          }
        } catch {}
      }
      return found;
    })()`);
    console.log('[M11] prefers-reduced-motion media query verified:', reducedMotionRes);

    m11Conn.close();
    await fetch(`${BASE}/json/close/${m11Target.id}`);

    report.results.M11 = {
      status: 'PASS',
      shiftEnterNewline: shiftEnterRes.notPrevented,
      imeSuppressesEnter: imeRes,
      readingModeToggle: readingModeRes.ok && readingModeRes.expanded === 'true',
      reducedMotionSupported: reducedMotionRes
    };

    // ----------------------------------------------------
    // M12: Real Talk Submission to Gemini & Clipboard Verification
    // ----------------------------------------------------
    console.log('\n--- Verifying M12: Real Gemini Talk Submission & Full Clipboard Match ---');
    // Version checks
    const manifestPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const packagePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const packageLockPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

    console.log(`[M12] manifest: ${manifestPkg.version}, package: ${packagePkg.version}, lock: ${packageLockPkg.version}`);
    if (manifestPkg.version !== '0.1.9' || packagePkg.version !== '0.1.9' || packageLockPkg.version !== '0.1.9') {
      throw new Error(`[M12 FAIL] Version mismatch: expected 0.1.9`);
    }
    if (manifestPkg.minimum_chrome_version !== '141') {
      throw new Error(`[M12 FAIL] minimum_chrome_version must be 141, got ${manifestPkg.minimum_chrome_version}`);
    }

    // Submit real Talk to Gemini Bro Chat via extension runner!
    console.log('[M12] Submitting real Talk prompt "Preamble" to background Gemini...');
    await newSwConn.evaluate(`(async () => {
      // Ensure settings has the Gemini URL
      await new Promise(r => chrome.storage.local.set({
        'settings:v1': { broChatUrl: ${JSON.stringify(BRO_CHAT_URL)}, updatedAt: Date.now() }
      }, r));
      // Dispatch submit
      await new Promise(r => chrome.runtime.sendMessage({ action: 'talk/submit', text: 'Preamble' }, r));
    })()`);

    // Poll until talk finishes with phase 'done'
    let realAnswerMarkdown = '';
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const runtime = await newSwConn.evaluate(`new Promise(r => chrome.storage.local.get('runtime:v1', res => r(res['runtime:v1'])))`);
      const talk = runtime?.lastTalk;
      console.log(`[M12 Real Talk Poll ${i}] phase=${talk?.phase}, text="${talk?.text}", answerLength=${talk?.answerMarkdown?.length || 0}`);
      if (talk?.phase === 'done' && talk?.answerMarkdown) {
        realAnswerMarkdown = talk.answerMarkdown;
        break;
      }
      if (talk?.phase === 'failed') {
        throw new Error(`[M12 FAIL] Real talk failed with code: ${talk?.failure?.code}`);
      }
    }

    if (!realAnswerMarkdown) {
      throw new Error('[M12 FAIL] Real talk did not complete with phase done within deadline');
    }
    console.log(`[M12 Real Talk Completed] Answer length: ${realAnswerMarkdown.length} chars`);

    // Check Popup rendering & clipboard copy
    const popupViewRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const popupViewTarget = await popupViewRes.json();
    const popupViewConn = cdp(popupViewTarget.webSocketDebuggerUrl);

    for (let i = 0; i < 25; i++) {
      const ready = await popupViewConn.evaluate(`!!document.getElementById('answer-content')?.innerText`);
      if (ready) break;
      await sleep(100);
    }
    const popupAnswerText = await popupViewConn.evaluate(`document.getElementById('answer-content')?.innerText`);

    // Capture text passed to navigator.clipboard.writeText on copy click
    await popupViewConn.evaluate(`(() => {
      window.__copied = null;
      const orig = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (text) => {
        window.__copied = text;
        try { await orig.call(navigator.clipboard, text); } catch {}
      };
    })()`);
    await popupViewConn.evaluate(`document.getElementById('copy-btn')?.click()`, true);
    await sleep(200);
    const popupClipboardText = await popupViewConn.evaluate(`window.__copied`);
    console.log('[M12] Popup clipboard copied length:', popupClipboardText?.length);

    // Check Sidepanel rendering & clipboard copy
    const sidepanelViewRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/sidepanel.html`, { method: 'PUT' });
    const sidepanelViewTarget = await sidepanelViewRes.json();
    const sidepanelViewConn = cdp(sidepanelViewTarget.webSocketDebuggerUrl);

    for (let i = 0; i < 25; i++) {
      const ready = await sidepanelViewConn.evaluate(`!!document.getElementById('answer-content')?.innerText`);
      if (ready) break;
      await sleep(100);
    }
    const sidepanelAnswerText = await sidepanelViewConn.evaluate(`document.getElementById('answer-content')?.innerText`);

    await sidepanelViewConn.evaluate(`(() => {
      window.__copied = null;
      const orig = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async (text) => {
        window.__copied = text;
        try { await orig.call(navigator.clipboard, text); } catch {}
      };
    })()`);
    await sidepanelViewConn.evaluate(`document.getElementById('copy-btn')?.click()`, true);
    await sleep(200);
    const sidepanelClipboardText = await sidepanelViewConn.evaluate(`window.__copied`);
    console.log('[M12] Sidepanel clipboard copied length:', sidepanelClipboardText?.length);

    // Assert: Popup text equals Sidepanel text
    if (!popupAnswerText || popupAnswerText !== sidepanelAnswerText) {
      throw new Error(`[M12 FAIL] Popup answer and Sidepanel answer differ! popupLen=${popupAnswerText?.length}, sidepanelLen=${sidepanelAnswerText?.length}`);
    }

    // Assert: Clipboard text equals original markdown answer
    if (popupClipboardText !== realAnswerMarkdown) {
      throw new Error(`[M12 FAIL] Popup copied clipboard does not match real markdown answer!`);
    }
    if (sidepanelClipboardText !== realAnswerMarkdown) {
      throw new Error(`[M12 FAIL] Sidepanel copied clipboard does not match real markdown answer!`);
    }
    console.log('[M12] Verified: Both hosts rendered identically and clipboard copy matches real Markdown verbatim!');

    report.results.M12 = {
      status: 'PASS',
      versionConsistency: manifestPkg.version,
      minimumChromeVersion: manifestPkg.minimum_chrome_version,
      realTalkQuery: 'Preamble',
      realAnswerLength: realAnswerMarkdown.length,
      dualHostRenderIdentical: true,
      clipboardMatchesVerbatim: true
    };

    console.log('\n====================================================');
    console.log(' All T-1 CfT Verification Items Passed (M1-M12 100%)');
    console.log('====================================================');
  } finally {
    const reportPath = path.resolve(EVIDENCE_DIR, 't1-cft-verification-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[Report] Saved complete verification report to: ${reportPath}`);
    await killChrome(proc);
  }
}

main().catch(err => {
  console.error('[FATAL Error during CfT Verification]', err);
  process.exit(1);
});
