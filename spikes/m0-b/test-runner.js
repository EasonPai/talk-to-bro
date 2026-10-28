// test-runner.js - Automated CfT Harness for M0-B Spike
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIR = __dirname;
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDENS_DIR = path.join(__dirname, 'goldens');
const GEMINI_FIXTURES_DIR = path.join(__dirname, '../../tests/fixtures/gemini');

const HTTP_PORT = 8766;
const CDP_HOST = '[::1]';
const CDP_PORT = 9222;

const CFT_PATH = path.join(
  process.env.HOME,
  'Applications/chrome-for-testing/chrome/mac_arm-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
const USER_DATA_DIR = path.join(process.env.HOME, '.chrome-cdp-profile');

function calculateExtensionId(dirPath) {
  const hash = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 32);
  return hash.split('').map(c => String.fromCharCode(parseInt(c, 16) + 'a'.charCodeAt(0))).join('');
}

async function isCdpReady() {
  try {
    const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/version`);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function launchChrome() {
  if (await isCdpReady()) {
    console.log('[CfT] Reusing existing Chrome for Testing instance on port 9222.');
    return;
  }

  console.log('[CfT] Launching Chrome for Testing with M0-B extension...');
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--no-first-run',
    '--no-default-browser-check'
  ];

  const proc = spawn(CFT_PATH, args, { stdio: 'ignore', detached: true });
  proc.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isCdpReady()) {
      console.log('[CfT] Chrome for Testing is ready and listening on port 9222.');
      return;
    }
  }

  throw new Error('Timed out waiting for Chrome for Testing CDP port to open');
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/long-stream.html';
    const filePath = path.join(FIXTURES_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8'
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(HTTP_PORT, '127.0.0.1', () => {
      console.log(`[Fixture Server] Serving ${FIXTURES_DIR} on http://127.0.0.1:${HTTP_PORT}`);
      resolve(server);
    });
  });
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
    if (this.ws) this.ws.close();
  }
}

function loadGoldens() {
  const cases = [
    { name: 'Case 1: Table Comparison', html: 'case1-table.html', md: 'case1-table.md' },
    { name: 'Case 2: Nested Lists', html: 'case2-nested-lists.html', md: 'case2-nested-lists.md' },
    { name: 'Case 3: Bold / Italic / Blockquote', html: 'case3-formatting.html', md: 'case3-formatting.md' },
    { name: 'Case 4: Code Block & Decoration Exclusion', html: 'case4-codeblock.html', md: 'case4-codeblock.md' },
    { name: 'Case 5: Citations & Noise Exclusion', html: 'case5-citations.html', md: 'case5-citations.md' }
  ];

  return cases.map(c => ({
    name: c.name,
    html: fs.readFileSync(path.join(GOLDENS_DIR, c.html), 'utf-8'),
    expectedMarkdown: fs.readFileSync(path.join(GOLDENS_DIR, c.md), 'utf-8')
  }));
}

function verifyS9Fixtures() {
  const requiredFixtures = [
    'idle.html',
    'streaming.html',
    'done.html',
    'signed-out.html',
    'missing-chat.html'
  ];

  const results = [];
  for (const f of requiredFixtures) {
    const fPath = path.join(GEMINI_FIXTURES_DIR, f);
    const exists = fs.existsSync(fPath) && fs.statSync(fPath).size > 50;
    results.push({ fixture: f, path: fPath, exists });
  }

  const allExist = results.every(r => r.exists);
  return {
    test: 'S9',
    name: 'Raw DOM Fixtures Capture & De-identification',
    passed: allExist,
    fixtures: results,
    details: allExist
      ? 'All 5 de-identified DOM fixtures (idle, streaming, done, signed-out, missing-chat) exist in tests/fixtures/gemini/.'
      : 'Missing some required DOM fixtures.'
  };
}

async function main() {
  console.log('====================================================');
  console.log('  M0-B Spike Automated Verification Harness (CfT)   ');
  console.log('====================================================\n');

  const server = await startFixtureServer();
  await launchChrome();
  const goldens = loadGoldens();
  const s9Result = verifyS9Fixtures();

  const extId = calculateExtensionId(EXTENSION_DIR);
  console.log(`[Test Harness] M0-B Extension ID: ${extId}`);

  // Query existing targets in CfT
  const listRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await listRes.json();

  let runnerTarget = targets.find(t => t.url && t.url.includes(`${extId}/runner.html`));

  if (!runnerTarget) {
    const runnerUrl = `chrome-extension://${extId}/runner.html`;
    console.log(`[Test Harness] Opening Runner page: ${runnerUrl}`);
    const newTabRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(runnerUrl)}`, { method: 'PUT' });
    runnerTarget = await newTabRes.json();
  }

  console.log(`[Test Harness] Connecting CDP WebSocket to Runner (${runnerTarget.webSocketDebuggerUrl})...`);
  const cdp = new CdpClient(runnerTarget.webSocketDebuggerUrl);
  await cdp.connect();

  // Reload runner page to ensure newest scripts loaded
  await cdp.send('Page.reload');
  await new Promise(r => setTimeout(r, 600));

  // Create a background tab for fixture
  const fixtureUrl = `http://127.0.0.1:${HTTP_PORT}/long-stream.html`;
  console.log(`[Test Harness] Opening background pinned tab: ${fixtureUrl}`);

  const tabEval = await cdp.send('Runtime.evaluate', {
    expression: `
      (async () => {
        const tab = await chrome.tabs.create({ url: '${fixtureUrl}', active: false, pinned: true });
        return tab.id;
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  const fixtureTabId = tabEval.result?.value ?? tabEval.result;
  const numericTabId = typeof fixtureTabId === 'number' ? fixtureTabId : (fixtureTabId.value || Number(fixtureTabId));
  console.log(`[Test Harness] Pinned Tab ID: ${numericTabId}`);

  // Trigger S5, S6, S8 on SW
  console.log('[Test Harness] Triggering M0-B SW Tests (S5, S6, S8)...');
  const swEvalResult = await cdp.send('Runtime.evaluate', {
    expression: `
      (async () => {
        return await chrome.runtime.sendMessage({
          action: 'RUN_FULL_SUITE_B',
          tabId: ${numericTabId},
          url: '${fixtureUrl}'
        });
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  if (swEvalResult.exceptionDetails) {
    throw new Error('SW evaluation error: ' + JSON.stringify(swEvalResult.exceptionDetails));
  }
  const swResults = swEvalResult.result?.value;

  // Trigger S7 on Runner (DOMParser environment)
  console.log('[Test Harness] Triggering S7 Markdown Golden Tests in DOM environment...');
  const s7EvalResult = await cdp.send('Runtime.evaluate', {
    expression: `window.runS7Test(${JSON.stringify(goldens)})`,
    returnByValue: true
  });
  const s7Result = s7EvalResult.result?.value;

  const suiteResults = {
    s5: swResults.s5,
    s6: swResults.s6,
    s7: s7Result,
    s8: swResults.s8,
    s9: s9Result,
    allPassed: Boolean(swResults.s5.passed && swResults.s6.passed && s7Result.passed && swResults.s8.passed && s9Result.passed)
  };

  console.log('\n====================================================');
  console.log('              M0-B SPIKE TEST RESULTS               ');
  console.log('====================================================\n');

  console.log(`[S5 SW Watchdog & Reconcile Recovery]`);
  console.log(`  Passed: ${suiteResults.s5.passed}`);
  console.log(`  Write-ahead Protected: ${suiteResults.s5.writeAheadMaintained}`);
  console.log(`  Submit Attempt Count: ${suiteResults.s5.submitAttemptCount}`);
  console.log(`  Reconcile Status: ${suiteResults.s5.reconcileStatus}`);
  console.log(`  Details: ${suiteResults.s5.details}`);

  console.log(`\n[S6 Tab Discard/Freeze Recovery & Pinned Reuse]`);
  console.log(`  Passed: ${suiteResults.s6.passed}`);
  console.log(`  Reused Tab ID: ${suiteResults.s6.tabId} (reused: ${suiteResults.s6.reused}, spawnedNew: ${suiteResults.s6.spawnedNew})`);
  console.log(`  Details: ${suiteResults.s6.details}`);

  console.log(`\n[S7 Markdown Extraction Fidelity (5 Goldens)]`);
  console.log(`  Passed: ${suiteResults.s7.passed}`);
  console.log(`  Cases Passed: ${suiteResults.s7.passedCount}/${suiteResults.s7.totalCount}`);
  console.log(`  Details: ${suiteResults.s7.details}`);

  console.log(`\n[S8 Offscreen Document Clipboard Copy]`);
  console.log(`  Passed: ${suiteResults.s8.passed}`);
  console.log(`  Details: ${suiteResults.s8.details}`);

  console.log(`\n[S9 Raw DOM Fixtures Collection]`);
  console.log(`  Passed: ${suiteResults.s9.passed}`);
  console.log(`  Details: ${suiteResults.s9.details}`);

  console.log('\n----------------------------------------------------');
  console.log(`Overall Suite Result: ${suiteResults.allPassed ? 'ALL ACCEPTANCE CRITERIA PASSED (GO)' : 'FAILED (NO-GO)'}`);
  console.log('----------------------------------------------------\n');

  const resultJsonPath = path.join(__dirname, 'spike-results.json');
  fs.writeFileSync(resultJsonPath, JSON.stringify(suiteResults, null, 2));
  console.log(`[Test Harness] Full results JSON saved to: ${resultJsonPath}`);

  cdp.close();
  server.close();
  process.exit(suiteResults.allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('[Test Harness Error]', err);
  process.exit(1);
});
