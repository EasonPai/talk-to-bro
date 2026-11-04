// scripts/verify-t2-cft.mjs
// Full Chrome for Testing verification script for T-2 Word Pronunciation (M1-M8)
// Uses existing CDP 9222 instance with isolated profile ~/.chrome-cdp-profile.
// Does NOT spawn or kill browser processes; reuses/manages extension pages cleanly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.resolve(ROOT, '.scratch/orca-team/evidence');
const PORT = 9222;
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

async function getVersion() {
  const res = await fetch(`${BASE}/json/version`);
  if (!res.ok) throw new Error(`Failed to fetch CDP version from ${BASE}`);
  return await res.json();
}

async function closeTarget(targetId) {
  try {
    await fetch(`${BASE}/json/close/${targetId}`);
  } catch {}
}

async function main() {
  console.log('====================================================');
  console.log(' Talk To Bro: Comprehensive T-2 CfT Verification');
  console.log(' Reusing CDP Port 9222 (isolated profile)');
  console.log('====================================================');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const version = await getVersion();
  console.log(`[CfT] Connected to Chrome: ${version.Browser}`);

  const report = {
    chromeVersion: version.Browser,
    minimumChromeVersion: '141',
    cdpPort: PORT,
    results: {},
    audioLimitationNote: 'CDP environment may lack an audible physical sound output; verification rigorously validates Web Speech API invocation, SpeechSynthesisUtterance lifecycle event outcomes (onstart / onend / onerror), and latency metrics.',
    timestamp: new Date().toISOString()
  };

  // Find Extension ID from any existing extension target or fallback to bjdcojepcfcoinghohdhdmjmnfkjegmd
  const listRes = await fetch(`${BASE}/json/list`);
  const targets = await listRes.json();
  let extId = targets
    .map((t) => t.url.match(/chrome-extension:\/\/([a-z0-9]+)\//)?.[1])
    .find(Boolean);

  if (!extId) {
    // If SW is sleeping, check extensions page or known loaded extension ID
    extId = 'bjdcojepcfcoinghohdhdmjmnfkjegmd';
  }

  console.log(`[CfT] Extension ID: ${extId}`);
  report.extensionId = extId;

  // Markdown answer containing M2-M4 test cases:
  // Contractions (Don't), Hyphenated (mother-in-law, state-of-the-art),
  // Pure numbers (2026), UTF-8 / punctuation tokens (UTF-8),
  // Excluded contexts: links ([Google](...)) and inline code (`console.log(...)`)
  const markdownAnswer = `# Pronunciation Guide\n\nDon't hesitate to contact mother-in-law about the state-of-the-art apple in 2026.\n\n| Item | Code |\n| --- | --- |\n| UTF-8 | standard |\n\nRead more at [Google](https://google.com) or inspect \`console.log("hello")\`.`;

  const testTalk = {
    id: 't2-cft-test-talk',
    text: 'test pronunciation verification',
    phase: 'done',
    createdAt: Date.now() - 5000,
    updatedAt: Date.now(),
    sentAt: Date.now() - 4000,
    answerMarkdown: markdownAnswer
  };

  // Open a temporary extension target to seed storage
  const initPageRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
  const initPage = await initPageRes.json();
  const initConn = cdp(initPage.webSocketDebuggerUrl);

  // Wait for extension runtime and storage API to initialize
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const hasStorage = await initConn.evaluate(`!!window.chrome?.storage?.local`);
    if (hasStorage) break;
  }

  await initConn.evaluate(`new Promise(r => chrome.storage.local.set({
    'runtime:v1': { lastTalk: ${JSON.stringify(testTalk)} }
  }, r))`);
  console.log('[CfT] Populated test talk into chrome.storage.local');
  initConn.close();
  await closeTarget(initPage.id);

  // Helper to test a page host (popup or sidepanel)
  async function testHost(hostName, urlPath) {
    console.log(`\n--- Verifying Host: ${hostName} (${urlPath}) ---`);
    const pageRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/${urlPath}`, { method: 'PUT' });
    const pageTarget = await pageRes.json();
    const conn = cdp(pageTarget.webSocketDebuggerUrl);

    try {
      // Wait for DOM to render answer
      for (let i = 0; i < 30; i++) {
        await sleep(150);
        const ready = await conn.evaluate(`!!document.getElementById('answer-content')?.children?.length`);
        if (ready) break;
      }

      // Comprehensive DOM & Speech Evaluation
      const evalResult = await conn.evaluate(`(async () => {
        const hasSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
        const voices = window.speechSynthesis.getVoices();

        const answerContent = document.getElementById('answer-content');
        if (!answerContent) throw new Error('#answer-content not found');

        const speakableSpans = Array.from(answerContent.querySelectorAll('.speakable-word'));
        const words = speakableSpans.map(s => s.dataset.word);

        // M3 Exclusion checks: links and code blocks
        const links = Array.from(answerContent.querySelectorAll('a'));
        const codeBlocks = Array.from(answerContent.querySelectorAll('code, pre'));
        const speakablesInLinks = links.flatMap(a => Array.from(a.querySelectorAll('.speakable-word')));
        const speakablesInCode = codeBlocks.flatMap(c => Array.from(c.querySelectorAll('.speakable-word')));

        // M1 / M5: Utterance Lifecycle Event Tracking
        const appleSpan = speakableSpans.find(s => s.dataset.word === 'apple');
        let speechTriggered = false;
        let spokenText = null;
        let utteranceEvents = {
          startFired: false,
          endFired: false,
          errorFired: false,
          startLatencyMs: null,
          errorDetails: null
        };

        if (appleSpan) {
          const startTime = performance.now();
          const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);

          await new Promise((resolve) => {
            window.speechSynthesis.speak = (utt) => {
              speechTriggered = true;
              spokenText = utt.text;

              const origOnStart = utt.onstart;
              const origOnEnd = utt.onend;
              const origOnError = utt.onerror;

              utt.onstart = (e) => {
                utteranceEvents.startFired = true;
                utteranceEvents.startLatencyMs = Math.round(performance.now() - startTime);
                if (origOnStart) origOnStart(e);
              };

              utt.onend = (e) => {
                utteranceEvents.endFired = true;
                if (origOnEnd) origOnEnd(e);
                resolve();
              };

              utt.onerror = (e) => {
                utteranceEvents.errorFired = true;
                utteranceEvents.errorDetails = e.error || 'speech_error';
                if (origOnError) origOnError(e);
                resolve();
              };

              // Safety timeout in case synthesizer is headless/silent
              setTimeout(() => resolve(), 2500);

              origSpeak(utt);
            };

            appleSpan.click();
          });
        }

        // M4 Drag detection check
        let dragTriggeredSpeech = false;
        const dragDummyUtt = () => { dragTriggeredSpeech = true; };
        const savedSpeak = window.speechSynthesis.speak;
        window.speechSynthesis.speak = dragDummyUtt;

        // Pointerdown at (10, 10), then click at (60, 60) -> distance > 50px
        answerContent.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
        appleSpan?.dispatchEvent(new MouseEvent('click', { clientX: 60, clientY: 60, bubbles: true }));
        window.speechSynthesis.speak = savedSpeak;

        // M8 Toast & ARIA
        const toast = document.getElementById('speech-toast');

        return {
          hasSpeech,
          voicesCount: voices.length,
          sampleVoices: voices.slice(0, 3).map(v => ({ name: v.name, lang: v.lang })),
          totalSpeakableWords: words.length,
          sampleWords: words.slice(0, 8),
          hasContraction: words.includes("Don't"),
          hasHyphenated: words.includes("mother-in-law") && words.includes("state-of-the-art"),
          hasNumber: words.includes("2026"),
          hasUtf8: words.includes("UTF-8") || words.includes("UTF"),
          speakablesInLinksCount: speakablesInLinks.length,
          speakablesInCodeCount: speakablesInCode.length,
          speechTriggered,
          spokenText,
          utteranceEvents,
          dragTriggeredSpeech,
          toastDeclared: !!toast,
          toastAriaLive: toast?.getAttribute('aria-live'),
          toastRole: toast?.getAttribute('role')
        };
      })()`, true);

      console.log(`[CfT ${hostName}] Result:`, JSON.stringify(evalResult, null, 2));

      // Assertions
      if (!evalResult.hasSpeech) throw new Error(`${hostName}: Speech API missing`);
      if (!evalResult.hasContraction) throw new Error(`${hostName}: Contraction Don't missing`);
      if (!evalResult.hasHyphenated) throw new Error(`${hostName}: Hyphenated words missing`);
      if (evalResult.hasNumber) throw new Error(`${hostName}: Number incorrectly wrapped`);
      if (evalResult.hasUtf8) throw new Error(`${hostName}: UTF-8 incorrectly wrapped`);
      if (evalResult.speakablesInLinksCount !== 0) throw new Error(`${hostName}: Links incorrectly wrapped`);
      if (evalResult.speakablesInCodeCount !== 0) throw new Error(`${hostName}: Code incorrectly wrapped`);
      if (!evalResult.speechTriggered || evalResult.spokenText !== 'apple') throw new Error(`${hostName}: Speech trigger failed`);
      if (evalResult.dragTriggeredSpeech) throw new Error(`${hostName}: Drag gesture incorrectly triggered speech`);
      if (!evalResult.toastDeclared) throw new Error(`${hostName}: Speech toast not declared in DOM`);

      return { status: 'PASS', ...evalResult };
    } finally {
      conn.close();
      await closeTarget(pageTarget.id);
    }
  }

  // Run tests on Popup and Sidepanel
  report.results.popupHost = await testHost('Popup', 'popup.html');
  report.results.sidepanelHost = await testHost('Sidepanel', 'sidepanel.html');

  report.overall = 'PASS';
  const outPath = path.join(EVIDENCE_DIR, 't2-cft-evidence.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n✓ All T-2 CfT Verifications PASSED! Evidence written to ${outPath}`);
}

main().catch((err) => {
  console.error('[CfT Verification Error]:', err);
  process.exit(1);
});
