// scripts/verify-t2-cft.mjs
// Full Chrome for Testing verification script for T-2 Word Pronunciation (M1-M8)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.resolve(ROOT, '.scratch/orca-team/evidence');
const CHROME_PATH = '/Users/eason/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EXT_PATH = path.resolve(ROOT, 'dist');
const BASE_PROFILE = path.resolve(process.env.HOME, '.chrome-cdp-profile');
const USER_DATA_DIR = '/tmp/cft-t2-eval-profile';
const PORT = 9227;
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

async function waitForCdp(maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`CDP on port ${PORT} not ready`);
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

async function launchChrome() {
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];
  const proc = spawn(CHROME_PATH, args, { stdio: 'ignore' });
  const version = await waitForCdp();
  return { proc, version };
}

async function main() {
  console.log('====================================================');
  console.log(' Talk To Bro: Comprehensive T-2 CfT Verification');
  console.log('====================================================');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  syncProfile();

  const { proc, version } = await launchChrome();
  console.log(`[CfT] Chrome Version: ${version.Browser}`);

  const report = {
    chromeVersion: version.Browser,
    minimumChromeVersion: '141',
    extensionPath: EXT_PATH,
    results: {},
    timestamp: new Date().toISOString()
  };

  try {
    let swTarget = null;
    let extId = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const res = await fetch(`${BASE}/json/list`);
      const targets = await res.json();
      swTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('sw.js'));
      extId = swTarget?.url?.match(/chrome-extension:\/\/([a-z0-9]+)\//)?.[1];
      if (extId) break;
    }
    console.log(`[CfT] Discovered extension ID: ${extId}`);
    report.extensionId = extId;

    const swConn = cdp(swTarget.webSocketDebuggerUrl);

    // Markdown answer containing test cases
    const markdownAnswer = `# Pronunciation Guide\n\nDon't hesitate to contact mother-in-law about the state-of-the-art apple in 2026.\n\n| Item | Code |\n| --- | --- |\n| UTF-8 | standard |\n\nRead more at [Google](https://google.com) or inspect \`console.log("hello")\`.`;

    const testTalk = {
      id: 't2-test-talk',
      text: 'test pronunciation',
      phase: 'done',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now(),
      sentAt: Date.now() - 4000,
      answerMarkdown: markdownAnswer
    };

    // Pre-populate runtime:v1 so both popup and sidepanel load it cleanly on open
    await swConn.evaluate(`new Promise(r => chrome.storage.local.set({
      'runtime:v1': { lastTalk: ${JSON.stringify(testTalk)} }
    }, r))`);
    console.log('[CfT] Pre-populated runtime:v1 in storage');

    // Host 1: Popup (popup.html)
    console.log('\n--- Host 1: Verifying Word Pronunciation in Popup Host ---');
    const popRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const popTarget = await popRes.json();
    const popConn = cdp(popTarget.webSocketDebuggerUrl);

    // Wait for popup to load and render talk from storage
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const isReady = await popConn.evaluate(`!!document.getElementById('answer-content')?.children?.length`);
      if (isReady) break;
    }

    const popEval = await popConn.evaluate(`(async () => {
      // 1. Check Speech API presence
      const hasSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
      const initialVoices = window.speechSynthesis.getVoices();

      const answerContent = document.getElementById('answer-content');
      const speakableSpans = Array.from(answerContent.querySelectorAll('.speakable-word'));
      const words = speakableSpans.map(s => s.dataset.word);

      // Verify exclusions: links and code should not contain speakable words
      const links = Array.from(answerContent.querySelectorAll('a'));
      const codeBlocks = Array.from(answerContent.querySelectorAll('code, pre'));
      const speakablesInLinks = links.flatMap(a => Array.from(a.querySelectorAll('.speakable-word')));
      const speakablesInCode = codeBlocks.flatMap(c => Array.from(c.querySelectorAll('.speakable-word')));

      // Test real click speech triggering
      const appleSpan = speakableSpans.find(s => s.dataset.word === 'apple');
      let speechTriggered = false;
      let spokenText = null;

      if (appleSpan) {
        // Intercept utterance to observe
        const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (utt) => {
          speechTriggered = true;
          spokenText = utt.text;
          origSpeak(utt);
        };

        appleSpan.click();
      }

      return {
        hasSpeech,
        voicesCount: initialVoices.length,
        totalSpeakableWords: words.length,
        sampleWords: words.slice(0, 10),
        hasContraction: words.includes("Don't"),
        hasHyphenated: words.includes("mother-in-law"),
        hasNumber: words.includes("2026"),
        hasUtf8: words.includes("UTF-8") || words.includes("UTF"),
        speakablesInLinksCount: speakablesInLinks.length,
        speakablesInCodeCount: speakablesInCode.length,
        speechTriggered,
        spokenText
      };
    })()`, true);

    console.log('[CfT Popup Host] Evaluation result:', JSON.stringify(popEval, null, 2));

    if (!popEval.hasSpeech) throw new Error('Speech API missing in Popup host');
    if (!popEval.hasContraction) throw new Error("Contraction \"Don't\" not preserved");
    if (!popEval.hasHyphenated) throw new Error("Hyphenated word \"mother-in-law\" not preserved");
    if (popEval.hasNumber) throw new Error('Number 2026 was incorrectly wrapped as speakable');
    if (popEval.hasUtf8) throw new Error('UTF-8 was incorrectly wrapped as speakable');
    if (popEval.speakablesInLinksCount !== 0) throw new Error('Link text was incorrectly wrapped');
    if (popEval.speakablesInCodeCount !== 0) throw new Error('Code text was incorrectly wrapped');
    if (!popEval.speechTriggered || popEval.spokenText !== 'apple') throw new Error('Click did not trigger speech for apple');

    report.results.popupHost = {
      status: 'PASS',
      ...popEval
    };

    // ----------------------------------------------------
    // Test Host 2: Side Panel (sidepanel.html)
    // ----------------------------------------------------
    console.log('\n--- Host 2: Verifying Word Pronunciation in Sidepanel Host ---');
    const sideRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/sidepanel.html`, { method: 'PUT' });
    const sideTarget = await sideRes.json();
    const sideConn = cdp(sideTarget.webSocketDebuggerUrl);

    for (let i = 0; i < 20; i++) {
      await sleep(200);
      const isReady = await sideConn.evaluate(`!!document.getElementById('answer-content')?.children?.length`);
      if (isReady) break;
    }

    const sideEval = await sideConn.evaluate(`(async () => {
      const answerContent = document.getElementById('answer-content');
      const speakableSpans = Array.from(answerContent.querySelectorAll('.speakable-word'));
      const words = speakableSpans.map(s => s.dataset.word);

      const appleSpan = speakableSpans.find(s => s.dataset.word === 'apple');
      let speechTriggered = false;
      let spokenText = null;

      if (appleSpan) {
        const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (utt) => {
          speechTriggered = true;
          spokenText = utt.text;
          origSpeak(utt);
        };

        appleSpan.click();
      }

      return {
        totalSpeakableWords: words.length,
        sampleWords: words.slice(0, 10),
        speechTriggered,
        spokenText
      };
    })()`, true);

    console.log('[CfT Sidepanel Host] Evaluation result:', JSON.stringify(sideEval, null, 2));

    if (!sideEval.speechTriggered || sideEval.spokenText !== 'apple') {
      throw new Error('Sidepanel click did not trigger speech');
    }

    report.results.sidepanelHost = {
      status: 'PASS',
      ...sideEval
    };

    // ----------------------------------------------------
    // Test Drag Detection & Toast UI
    // ----------------------------------------------------
    console.log('\n--- Verifying Drag Detection & Toast UI ---');
    const dragAndToastEval = await popConn.evaluate(`(async () => {
      const answerContent = document.getElementById('answer-content');
      const appleSpan = answerContent.querySelector('.speakable-word');

      let dragTriggeredSpeech = false;
      window.speechSynthesis.speak = () => {
        dragTriggeredSpeech = true;
      };

      // Dispatch drag gesture: pointerdown at (10, 10), click at (50, 50)
      answerContent.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
      appleSpan.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));

      // Test toast appearance
      const toast = document.getElementById('speech-toast');
      const toastExists = !!toast;
      const initialToastDisplay = toast?.style.display;

      // Trigger toast via helper
      const { showSpeechToast } = await import(location.origin + '/popup.js');
      showSpeechToast('測試提示');
      const toastVisibleAfterCall = toast?.style.display === 'block';
      const toastText = toast?.textContent;

      return {
        dragTriggeredSpeech,
        toastExists,
        initialToastDisplay,
        toastVisibleAfterCall,
        toastText
      };
    })()`, true);

    console.log('[CfT Drag & Toast] Evaluation result:', JSON.stringify(dragAndToastEval, null, 2));

    if (dragAndToastEval.dragTriggeredSpeech) throw new Error('Drag gesture incorrectly triggered speech');
    if (!dragAndToastEval.toastExists) throw new Error('speech-toast element missing');
    if (!dragAndToastEval.toastVisibleAfterCall) throw new Error('showSpeechToast did not show toast');

    report.results.dragAndToast = {
      status: 'PASS',
      ...dragAndToastEval
    };

    report.overall = 'PASS';
    fs.writeFileSync(path.join(EVIDENCE_DIR, 't2-cft-evidence.json'), JSON.stringify(report, null, 2));
    console.log('\n✓ Comprehensive T-2 CfT Verification PASSED! Saved evidence to t2-cft-evidence.json');

  } finally {
    proc.kill('SIGTERM');
    await sleep(1000);
    try {
      execSync(`pkill -f "${PORT}" || true`);
    } catch {}
  }
}

main().catch((err) => {
  console.error('[CfT T-2 Verification Error]:', err);
  process.exit(1);
});
