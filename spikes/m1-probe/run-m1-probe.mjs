// spikes/m1-probe/run-m1-probe.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Users/eason/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EXT_PATH = '/Users/eason/Documents/Dev/ai/talk-to-bro/.worktrees/T-1-popup/spikes/m1-probe';
const USER_DATA_DIR = '/tmp/cft-m1-profile';
const PORT = 9225;
const BASE = `http://127.0.0.1:${PORT}`;

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

async function waitForCdp(maxRetries = 30) {
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

async function launchChrome(extraArgs = []) {
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...extraArgs
  ];
  console.log(`[Launch] Starting Chrome: ${CHROME_PATH} ${args.join(' ')}`);
  const proc = spawn(CHROME_PATH, args, { stdio: 'ignore' });
  const version = await waitForCdp();
  console.log(`[Launch] Chrome ready: ${version.Browser}`);
  return { proc, version };
}

async function run() {
  console.log('=== Starting M1 Chrome Capability Probe ===');
  // Clean profile directory initially
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const results = {
    chromeVersion: null,
    path1: null,
    path2: null,
    path3_session_restore: null,
    path3_normal_restart: null,
    timestamp: new Date().toISOString()
  };

  let { proc, version } = await launchChrome();
  results.chromeVersion = version.Browser;

  try {
    // 1. Discover extension ID
    await sleep(1000);
    let targets = await getTargets();
    console.log('[Probe] All targets upon launch:');
    targets.forEach(t => console.log('  -', t.type, t.url, t.title));
    const swTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('sw.js'));
    const extId = swTarget?.url?.match(/chrome-extension:\/\/([a-z0-9]+)\//)?.[1];
    console.log(`[Probe] Discovered extension ID from SW: ${extId}`);
    if (!extId) throw new Error('Could not discover extension ID from targets: ' + JSON.stringify(targets));

    // ==========================================
    // PATH 1: Popup pin -> Side Panel opens
    // ==========================================
    console.log('\n--- Testing Path 1: Popup pin to Side Panel ---');
    // Open popup page
    const popupRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const popupTarget = await popupRes.json();
    console.log(`[Path 1] Popup page opened: target ${popupTarget.id}`);
    await sleep(1000);

    const popupConn = cdp(popupTarget.webSocketDebuggerUrl);
    const loc = await popupConn.evaluate(`document.location.href`);
    console.log(`[Path 1] popupConn location: ${loc}`);
    const html = await popupConn.evaluate(`document.body ? document.body.innerHTML : 'no body'`);
    console.log(`[Path 1] popupConn html: ${html}`);
    // Wait for DOM
    for (let i = 0; i < 20; i++) {
      const ready = await popupConn.evaluate(`!!document.getElementById('draft-input')`);
      if (ready) break;
      await sleep(100);
    }
    // Type draft and click Pin
    const draftText = 'Hello M1 Draft 換行\n第二行 中文測試';
    await popupConn.evaluate(`document.getElementById('draft-input').value = ${JSON.stringify(draftText)};`);
    await popupConn.evaluate(`document.getElementById('draft-input').dispatchEvent(new Event('input'));`);
    await sleep(200);

    // Click pin button
    console.log('[Path 1] Clicking Pin button in popup with userGesture: true...');
    const tPinStart = Date.now();
    popupConn.send('Runtime.evaluate', {
      expression: `document.getElementById('pin-btn').click();`,
      userGesture: true
    });
    // Wait for sidepanel target to appear
    let sidepanelTarget = null;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      targets = await getTargets();
      sidepanelTarget = targets.find((t) => t.url.includes('sidepanel.html'));
      if (sidepanelTarget) break;
    }

    const tPinDuration = Date.now() - tPinStart;
    console.log(`[Path 1] Sidepanel target found: ${!!sidepanelTarget} (${tPinDuration}ms)`);
    popupConn.close();

    // Verify storage in SW or sidepanel
    let path1Storage = null;
    if (sidepanelTarget) {
      const spConn = cdp(sidepanelTarget.webSocketDebuggerUrl);
      path1Storage = await spConn.evaluate(`new Promise(r => chrome.storage.local.get(null, r))`);
      console.log('[Path 1] Storage in sidepanel:', JSON.stringify(path1Storage));
      spConn.close();
    }

    results.path1 = {
      success: !!sidepanelTarget && path1Storage?.mode === 'sidepanel',
      durationMs: tPinDuration,
      sidepanelFound: !!sidepanelTarget,
      storage: path1Storage
    };
    console.log('[Path 1] Result:', results.path1.success ? 'PASS' : 'FAIL');

    // ==========================================
    // PATH 2: Side Panel unpin -> Popup opens, sidepanel closes
    // ==========================================
    console.log('\n--- Testing Path 2: Side Panel unpin to Popup ---');
    if (sidepanelTarget) {
      const spConn = cdp(sidepanelTarget.webSocketDebuggerUrl);
      // Type additional text in sidepanel
      const addedText = '\nSidepanel added line';
      await spConn.evaluate(`
        const el = document.getElementById('draft-input');
        el.value += ${JSON.stringify(addedText)};
        el.dispatchEvent(new Event('input'));
      `);
      await sleep(200);

      // Click unpin (do not await evaluate directly as sidePanel.close will destroy the execution context)
      console.log('[Path 2] Clicking Unpin button in sidepanel with userGesture: true...');
      spConn.send('Runtime.evaluate', {
        expression: `document.getElementById('unpin-btn').click();`,
        userGesture: true
      });
      await sleep(1500);

      // Read result from Service Worker
      const swConn = cdp(swTarget.webSocketDebuggerUrl);
      const storageAfterUnpin = await swConn.evaluate(`new Promise(r => chrome.storage.local.get(null, r))`);
      console.log('[Path 2] Storage after unpin (from SW):', JSON.stringify(storageAfterUnpin?.m1_path2_result));

      // Check if sidepanel is closed
      targets = await getTargets();
      const spStillPresent = targets.some((t) => t.url.includes('sidepanel.html'));
      console.log(`[Path 2] Sidepanel target still present: ${spStillPresent}`);

      const path2Success = storageAfterUnpin?.m1_path2_result?.openPopupOk && !spStillPresent;
      results.path2 = {
        success: path2Success,
        details: storageAfterUnpin?.m1_path2_result,
        sidepanelTargetStillPresent: spStillPresent
      };
      swConn.close();
      spConn.close();
    } else {
      results.path2 = { success: false, error: 'Sidepanel target not available from Path 1' };
    }
    console.log('[Path 2] Result:', results.path2.success ? 'PASS' : 'FAIL');

    // Re-pin to sidepanel so we can test restart behavior in Path 3
    console.log('\n[Setup for Path 3] Re-opening sidepanel for browser restart test...');
    const setupPopupRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const setupPopupTarget = await setupPopupRes.json();
    await sleep(1000);
    const setupPopupConn = cdp(setupPopupTarget.webSocketDebuggerUrl);
    for (let i = 0; i < 20; i++) {
      const ready = await setupPopupConn.evaluate(`!!document.getElementById('pin-btn')`);
      if (ready) break;
      await sleep(100);
    }
    setupPopupConn.send('Runtime.evaluate', {
      expression: `document.getElementById('pin-btn').click();`,
      userGesture: true
    });
    await sleep(1500);
    setupPopupConn.close();

    // Verify sidepanel is open before quitting
    targets = await getTargets();
    const sidepanelOpenBeforeQuit = targets.some((t) => t.url.includes('sidepanel.html'));
    console.log(`[Setup for Path 3] Sidepanel is open before quit: ${sidepanelOpenBeforeQuit}`);

  } finally {
    // Gracefully terminate Chrome
    proc.kill('SIGTERM');
    await sleep(1500);
  }

  // ==========================================
  // PATH 3A: Restart with --restore-last-session
  // ==========================================
  console.log('\n--- Testing Path 3A: Browser Restart with session restore ---');
  let launchRestore = await launchChrome(['--restore-last-session']);
  try {
    await sleep(2000);
    let targets = await getTargets();
    console.log('[Path 3A] Targets after restore launch:');
    targets.forEach((t) => console.log(`  - [${t.type}] ${t.title} (${t.url})`));

    const sidepanelAutoRestored = targets.some((t) => t.url.includes('sidepanel.html'));
    console.log(`[Path 3A] Did sidepanel auto-restore? ${sidepanelAutoRestored}`);

    results.path3_session_restore = {
      sidepanelAutoRestored,
      note: sidepanelAutoRestored
        ? 'Side panel automatically opened upon session restore'
        : 'Side panel DID NOT automatically open upon session restore (as required by spec)'
    };
  } finally {
    launchRestore.proc.kill('SIGTERM');
    await sleep(1500);
  }

  // ==========================================
  // PATH 3B: Normal restart (without restore flag)
  // ==========================================
  console.log('\n--- Testing Path 3B: Normal Browser Restart ---');
  let launchNormal = await launchChrome();
  try {
    await sleep(2000);
    let targets = await getTargets();
    console.log('[Path 3B] Targets after normal launch:');
    targets.forEach((t) => console.log(`  - [${t.type}] ${t.title} (${t.url})`));

    const sidepanelAutoOpened = targets.some((t) => t.url.includes('sidepanel.html'));
    console.log(`[Path 3B] Did sidepanel auto-open? ${sidepanelAutoOpened}`);

    results.path3_normal_restart = {
      sidepanelAutoOpened,
      note: sidepanelAutoOpened
        ? 'Side panel automatically opened upon normal launch'
        : 'Side panel DID NOT automatically open upon normal launch (as required by spec)'
    };
  } finally {
    launchNormal.proc.kill('SIGTERM');
    await sleep(1000);
  }

  console.log('\n=== Final M1 Capability Probe Summary ===');
  console.log(JSON.stringify(results, null, 2));

  const outDir = '/Users/eason/Documents/Dev/ai/talk-to-bro/.scratch/orca-team/evidence';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'm1-probe-report.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Report written to ${path.join(outDir, 'm1-probe-report.json')}`);
}

run().catch((err) => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});
