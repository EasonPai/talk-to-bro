// test-runner.js - Automated CfT Runner for M0-A Spike
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const EXTENSION_DIR = __dirname;
const HTTP_PORT = 8765;
const CDP_HOST = '[::1]';
const CDP_PORT = 9222;

function calculateExtensionId(dirPath) {
  const hash = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 32);
  return hash.split('').map(c => String.fromCharCode(parseInt(c, 16) + 'a'.charCodeAt(0))).join('');
}

// 1. Static HTTP Server for Fixtures
function startFixtureServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/mock-gemini.html';
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

// 2. WebSocket CDP Helper
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
  console.log('====================================================');
  console.log('  M0-A Spike Automated Verification Harness (CfT)   ');
  console.log('====================================================');

  const server = await startFixtureServer();

  // Calculate Extension ID
  const extId = calculateExtensionId(EXTENSION_DIR);
  console.log(`[Test Harness] Extension ID: ${extId}`);

  // Query existing targets in CfT
  const listRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await listRes.json();

  let runnerTarget = targets.find(t => t.url && t.url.includes(`${extId}/runner.html`));

  if (!runnerTarget) {
    const runnerUrl = `chrome-extension://${extId}/runner.html`;
    console.log(`[Test Harness] Opening Runner page via CDP: ${runnerUrl}`);
    const newTabRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(runnerUrl)}`, { method: 'PUT' });
    runnerTarget = await newTabRes.json();
  } else {
    console.log(`[Test Harness] Reusing existing Runner page: ${runnerTarget.id}`);
  }

  console.log(`[Test Harness] Connecting CDP WebSocket to Runner (${runnerTarget.webSocketDebuggerUrl})...`);
  const cdp = new CdpClient(runnerTarget.webSocketDebuggerUrl);
  await cdp.connect();

  console.log('[Test Harness] Triggering Full Spike Test Suite...');
  const fixtureUrl = `http://127.0.0.1:${HTTP_PORT}/mock-gemini.html`;

  const evalResult = await cdp.send('Runtime.evaluate', {
    expression: `
      (async () => {
        return await chrome.runtime.sendMessage({
          action: 'RUN_FULL_SUITE',
          url: '${fixtureUrl}'
        });
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  const suiteResults = evalResult.result.value;

  console.log('\n====================================================');
  console.log('              M0-A SPIKE TEST RESULTS               ');
  console.log('====================================================\n');

  console.log(`[S1 Focus Isolation]`);
  console.log(`  Passed: ${suiteResults.s1.passed}`);
  console.log(`  Details: ${suiteResults.s1.details}`);
  console.log(`  Tab Initial: ${suiteResults.s1.initialActiveTabId} -> Tab After: ${suiteResults.s1.afterActiveTabId}`);

  console.log(`\n[S2 Background Input Insertion & User Turn]`);
  console.log(`  Passed: ${suiteResults.s2.passed}`);
  console.log(`  Details: ${suiteResults.s2.details}`);

  console.log(`\n[S3 Hidden Tab Streaming DOM Updates (Go/No-go Gate)]`);
  console.log(`  Passed: ${suiteResults.s3.passed}`);
  console.log(`  Growth Steps: ${suiteResults.s3.growthStepCount}`);
  console.log(`  Total Probe Samples: ${suiteResults.s3.totalSamples}`);
  console.log(`  Final Text Length: ${suiteResults.s3.finalTextLength}`);
  console.log(`  Details: ${suiteResults.s3.details}`);

  console.log(`\n[S4 Completion Signal Reliability (10 Consecutive Runs)]`);
  console.log(`  Passed: ${suiteResults.s4.passed}`);
  console.log(`  Runs Passed: ${suiteResults.s4.runsPassed}/${suiteResults.s4.totalRuns}`);
  console.log(`  Details: ${suiteResults.s4.details}`);

  console.log('\n----------------------------------------------------');
  console.log(`Overall Suite Result: ${suiteResults.allPassed ? 'ALL ACCEPTANCE CRITERIA PASSED (GO)' : 'FAILED (NO-GO)'}`);
  console.log('----------------------------------------------------\n');

  // Persist machine-readable result
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
