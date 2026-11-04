// scripts/verify-t2-speech.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CHROME_PATH = '/Users/eason/Applications/chrome-for-testing/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const EXT_PATH = path.resolve(ROOT, 'dist');
const BASE_PROFILE = path.resolve(process.env.HOME, '.chrome-cdp-profile');
const USER_DATA_DIR = '/tmp/cft-t2-speech-profile';
const PORT = 9226;
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
  console.log('[T-2 Speech Probe] Initializing...');
  syncProfile();
  const { proc, version } = await launchChrome();
  console.log(`[T-2 Speech Probe] CfT Version: ${version.Browser}`);

  try {
    let extId = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const res = await fetch(`${BASE}/json/list`);
      const targets = await res.json();
      const swTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('sw.js'));
      extId = swTarget?.url?.match(/chrome-extension:\/\/([a-z0-9]+)\//)?.[1];
      if (extId) break;
    }
    console.log(`[T-2 Speech Probe] Extension ID: ${extId}`);

    // Create a new target navigating to popup.html
    const popupRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
    const popupTarget = await popupRes.json();
    console.log(`[T-2 Speech Probe] Opened popup target: ${popupTarget.id}`);

    const client = cdp(popupTarget.webSocketDebuggerUrl);

    // Probe speechSynthesis in popup
    const probeResult = await client.evaluate(`(async () => {
      const hasSpeech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
      if (!hasSpeech) return { hasSpeech: false };

      // Check initial voices
      let voices = window.speechSynthesis.getVoices();
      let voicesLoadedAsync = false;

      if (voices.length === 0) {
        // Wait up to 3 seconds for voiceschanged
        await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(), 3000);
          window.speechSynthesis.onvoiceschanged = () => {
            clearTimeout(timeout);
            voicesLoadedAsync = true;
            resolve();
          };
        });
        voices = window.speechSynthesis.getVoices();
      }

      const enVoices = voices.filter(v => v.lang.startsWith('en')).map(v => ({ name: v.name, lang: v.lang, default: v.default }));

      // Test speaking a word
      const speakPromise = new Promise((resolve) => {
        try {
          window.speechSynthesis.cancel();
          const utt = new SpeechSynthesisUtterance('hello');
          utt.lang = 'en-US';
          const startTime = performance.now();
          let started = false;
          let startMs = null;
          let ended = false;
          let endMs = null;
          let error = null;

          utt.onstart = () => {
            started = true;
            startMs = Math.round(performance.now() - startTime);
          };
          utt.onend = () => {
            ended = true;
            endMs = Math.round(performance.now() - startTime);
            resolve({ started, startMs, ended, endMs, error });
          };
          utt.onerror = (e) => {
            error = e.error || 'unknown_error';
            resolve({ started, startMs, ended, error });
          };

          window.speechSynthesis.speak(utt);

          // timeout safety 8s
          setTimeout(() => {
            resolve({
              started,
              startMs,
              ended,
              endMs,
              error: error || 'timeout_after_8s',
              speaking: window.speechSynthesis.speaking,
              paused: window.speechSynthesis.paused,
              pending: window.speechSynthesis.pending
            });
          }, 8000);
        } catch (err) {
          resolve({ exception: String(err) });
        }
      });

      const speakResult = await speakPromise;

      return {
        hasSpeech: true,
        voicesCount: voices.length,
        voicesLoadedAsync,
        enVoicesSample: enVoices.slice(0, 5),
        speakResult
      };
    })()`, true);

    console.log('[T-2 Speech Probe] Probe result:', JSON.stringify(probeResult, null, 2));

    client.close();
    return probeResult;
  } finally {
    proc.kill('SIGTERM');
    await sleep(1000);
    try {
      execSync(`pkill -f "${PORT}" || true`);
    } catch {}
  }
}

main().catch((err) => {
  console.error('[T-2 Speech Probe] Error:', err);
  process.exit(1);
});
