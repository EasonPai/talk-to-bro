// scripts/test-m4-suite.js
// Automated End-to-End Verification Harness for Ticket 06 (#30: M4)
// Validates HTML-to-MD Extraction, Goldens, Popup GFM Rendering, Sanitization, Copy & Last Talk Restoration
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCRATCH_EXT_DIR, syncDistToScratch } from './lib/scratch-ext.mjs';
import { htmlToMarkdown } from '../src/adapter/html-to-md.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const LOADED_EXT_DIR = SCRATCH_EXT_DIR;
const GOLDENS_DIR = path.join(ROOT_DIR, 'tests/fixtures/goldens');

const CDP_HOST = '[::1]';
const CDP_PORT = Number(process.env.CDP_PORT) || 9222;

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
      } catch {}
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
  console.log('    Ticket 06 (#30: M4) Rigorous Verification Suite             ');
  console.log('================================================================\n');

  // ===========================================================================
  // SECTION A: STATIC & ARCHITECTURE CONTRACTS (6 GOLDENS + CONTRACT CHECKS)
  // ===========================================================================
  console.log('--- [SECTION A: STATIC ARCHITECTURE & GOLDEN CONTRACT CHECKS] ---');

  // 1. Build Verification
  console.log('[Static Check] 1. Rebuilding extension with esbuild...');
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  assert.ok(fs.existsSync(path.join(DIST_DIR, 'adapter.js')), 'dist/adapter.js must exist');
  assert.ok(fs.existsSync(path.join(DIST_DIR, 'popup.js')), 'dist/popup.js must exist');
  assert.ok(fs.existsSync(path.join(DIST_DIR, 'popup.html')), 'dist/popup.html must exist');
  assert.ok(fs.existsSync(path.join(DIST_DIR, 'popup.css')), 'dist/popup.css must exist');
  console.log('  ✓ [Build Pass]: Extension bundles compiled successfully.\n');

  // 2. Offline CSP & Bundled Dependencies
  console.log('[Static Check] 2. Offline CSP & Bundled Dependencies Verification...');
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf-8'));
  const csp = manifest.content_security_policy?.extension_pages || '';
  assert.ok(csp.includes("script-src 'self'"), "CSP must enforce script-src 'self'");
  assert.ok(!csp.includes('https://'), 'CSP must not allow external HTTPS script sources');

  const popupBundle = fs.readFileSync(path.join(DIST_DIR, 'popup.js'), 'utf-8');
  assert.ok(popupBundle.includes('DOMPurify'), 'popup.js must bundle DOMPurify locally');
  assert.ok(popupBundle.includes('marked'), 'popup.js must bundle marked locally');

  const adapterBundle = fs.readFileSync(path.join(DIST_DIR, 'adapter.js'), 'utf-8');
  assert.ok(adapterBundle.includes('TurndownService'), 'adapter.js must bundle TurndownService locally');
  console.log('  ✓ [CSP Pass]: All conversion/rendering libraries bundled locally under strict self CSP.\n');

  // 3. Golden Test Fidelity Check (All 6 Cases)
  console.log('[Static Check] 3. Running All 6 Golden Conversion Fixtures...');
  const goldenCases = [
    { name: 'case1-table', desc: 'GFM Table Alignment' },
    { name: 'case2-nested-lists', desc: 'Ordered & Unordered Nested Lists' },
    { name: 'case3-formatting', desc: 'Bold, Italic, Code, Blockquote' },
    { name: 'case4-codeblock', desc: 'Code Block with Language & Indentation' },
    { name: 'case1-real-ledger', desc: 'Complex Live Gemini Turn' },
    { name: 'case5-citations-m4', desc: 'Visible Citations & Sources (Excluding UI Noise)' }
  ];

  for (const gc of goldenCases) {
    const htmlPath = path.join(GOLDENS_DIR, `${gc.name}.html`);
    const mdPath = path.join(GOLDENS_DIR, `${gc.name}.md`);
    assert.ok(fs.existsSync(htmlPath), `HTML fixture ${gc.name}.html must exist`);
    assert.ok(fs.existsSync(mdPath), `Expected MD fixture ${gc.name}.md must exist`);

    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const expectedMd = fs.readFileSync(mdPath, 'utf-8').trim();
    const actualMd = htmlToMarkdown(htmlContent);

    assert.equal(actualMd, expectedMd, `Golden case ${gc.name} (${gc.desc}) failed exact match`);
    console.log(`  ✓ [Golden Pass]: ${gc.name} — ${gc.desc} (100% exact match)`);
  }
  console.log('');

  // 4. Citation Preservation & UI Noise Stripping Specific Contract
  console.log('[Static Check] 4. Citations & Noise Stripping Specifics...');
  const citHtml = fs.readFileSync(path.join(GOLDENS_DIR, 'case5-citations-m4.html'), 'utf-8');
  const citMd = htmlToMarkdown(citHtml);
  assert.ok(citMd.includes('[Oxford Reference](https://oxford.com)'), 'Source links must be preserved');
  assert.ok(citMd.includes('[1]'), 'Superscript citation indicators must be preserved');
  assert.ok(!citMd.includes('正在分析單字源流'), 'Internal thinking (model-thoughts) must be stripped');
  assert.ok(!citMd.includes('share'), 'UI buttons and icons must be stripped');
  console.log('  ✓ [Citations Pass]: Citations preserved and internal thought/UI noise stripped.\n');

  // 5. Code Indentation & Literal Metacharacter Regressions
  console.log('[Static Check] 5. Verifying Code Indentation & Literal Metacharacters...');
  const probeCode = htmlToMarkdown('<pre><code class="language-python">    return 42\n\n</code></pre>');
  assert.equal(probeCode, '```python\n    return 42\n\n```', 'First-line code indentation and trailing newlines must be preserved');
  const probeStar = htmlToMarkdown('<p>literal *star*</p>');
  assert.equal(probeStar, 'literal \\*star\\*', 'Literal asterisks must be escaped to prevent false italicization');
  console.log('  ✓ [Regression Pass]: First-line code indentation and literal Markdown metacharacter escaping verified.\n');

  // ===========================================================================
  // SECTION B: LIVE ISOLATED-CFT ACTION POPUP EXECUTION
  // ===========================================================================
  console.log('--- [SECTION B: LIVE ISOLATED-CFT ACTION POPUP EXECUTION] ---');

  const EXPECTED_EXT_ID = calculateExtensionId(LOADED_EXT_DIR);
  console.log(`[CfT Setup] Target Extension Directory: ${LOADED_EXT_DIR}`);
  console.log(`[CfT Setup] Expected Extension ID: ${EXPECTED_EXT_ID}`);

  // Backup system clipboard
  let origClipboard = '';
  try {
    origClipboard = execSync('pbpaste', { encoding: 'utf-8' });
  } catch {
    origClipboard = '';
  }

  try {
    // Mount dist artifacts into loaded extension directory
    syncDistToScratch(DIST_DIR);
    console.log('[CfT Setup] Mounted built dist artifacts into active extension directory.');

    // Reload extension
    console.log(`[CfT Setup] Reloading extension ${EXPECTED_EXT_ID} in Chrome for Testing...`);
    await triggerExtensionReload(EXPECTED_EXT_ID);

    // 1. Connect to Service Worker
    const targetsRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
    const targets = await targetsRes.json();
    const swTarget = targets.find(t => t.type === 'service_worker' && t.url && t.url.includes(EXPECTED_EXT_ID));
    assert.ok(swTarget, `Service Worker for Extension ID ${EXPECTED_EXT_ID} must be running`);

    const swCdp = new CdpClient(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();

    // =========================================================================
    // LIVE TEST 1: Active State Restoration (resolving_tab / queued)
    // =========================================================================
    console.log('\n[Live Test 1] Testing Active State Restoration (phase: resolving_tab)...');
    await swCdp.send('Runtime.evaluate', {
      expression: `
        chrome.storage.local.set({
          'runtime:v1': {
            lastTalk: {
              id: 'talk-test-active',
              text: 'meticulous',
              phase: 'resolving_tab',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              phaseDeadlineAt: Date.now() + 30000
            },
            logByTalkId: {}
          }
        })
      `,
      awaitPromise: true
    });

    // Open popup page via CDP
    const popupUrl = `chrome-extension://${EXPECTED_EXT_ID}/popup.html`;
    const popupTargetRes = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(popupUrl)}`, { method: 'PUT' });
    const popupTab = await popupTargetRes.json();
    const popupCdp = new CdpClient(popupTab.webSocketDebuggerUrl);
    await popupCdp.connect();

    await new Promise(r => setTimeout(r, 600));

    // Inspect active state in Popup DOM
    const activeEval = await popupCdp.send('Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.getElementById('talk-input');
          const mood = document.getElementById('pip-mood');
          const container = document.getElementById('answer-container');
          return {
            inputValue: input ? input.value : null,
            moodText: mood ? mood.textContent : null,
            containerDisplay: container ? container.style.display : null
          };
        })()
      `,
      returnByValue: true
    });

    const activeRes = activeEval.result?.value;
    assert.ok(activeRes, 'Active state evaluation failed');
    assert.equal(activeRes.inputValue, 'meticulous', 'Input must be restored with prompt text');
    assert.ok(activeRes.moodText && activeRes.moodText.includes('勇者 把訊息傳給惡龍'), `hero mood must show active dispatch state: "${activeRes.moodText}"`);
    assert.equal(activeRes.containerDisplay, 'none', 'Answer container must be hidden during active phase');
    console.log('  ✓ [Live Test 1 Pass]: Active phase (resolving_tab) restored input text and active mood without showing Answer.');

    // Close popup
    popupCdp.close();
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${popupTab.id}`).catch(() => {});

    // =========================================================================
    // LIVE TEST 2: Completed State (Done) with GFM Rendering, DOMPurify Sanitization & Last Talk Restoration
    // =========================================================================
    console.log('\n[Live Test 2] Testing Done State with GFM & DOMPurify Sanitization...');
    const testMarkdown = [
      '### Oxford Dictionary',
      '',
      '根據牛津英文字典[1]，該詞源自拉丁文 *meticulosus*。',
      '',
      '| 詞彙 | 難度 |',
      '| :--- | :--- |',
      '| meticulous | GRE |',
      '',
      '[Oxford Reference](https://oxford.com)',
      '',
      '<!-- Representative Unsafe HTML Injection Payload -->',
      '<script>window.__xss_flag = true;</script>',
      '<img src="invalid-image.png" onerror="window.__img_xss = true;" />'
    ].join('\n');

    await swCdp.send('Runtime.evaluate', {
      expression: `
        chrome.storage.local.set({
          'runtime:v1': {
            lastTalk: {
              id: 'talk-test-done',
              text: 'meticulous',
              phase: 'done',
              createdAt: Date.now() - 5000,
              updatedAt: Date.now(),
              phaseDeadlineAt: null,
              answerMarkdown: ${JSON.stringify(testMarkdown)}
            },
            logByTalkId: {}
          }
        })
      `,
      awaitPromise: true
    });

    // Reopen Popup
    const popupTargetRes2 = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(popupUrl)}`, { method: 'PUT' });
    const popupTab2 = await popupTargetRes2.json();
    const popupCdp2 = new CdpClient(popupTab2.webSocketDebuggerUrl);
    await popupCdp2.connect();

    await new Promise(r => setTimeout(r, 800));

    // Verify Rendered DOM, Sanitization, Link Attributes
    const doneEval = await popupCdp2.send('Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.getElementById('talk-input');
          const mood = document.getElementById('pip-mood');
          const container = document.getElementById('answer-container');
          const content = document.getElementById('answer-content');
          const copyBtn = document.getElementById('copy-btn');

          const h3 = content ? content.querySelector('h3') : null;
          const em = content ? content.querySelector('em') : null;
          const table = content ? content.querySelector('table') : null;
          const a = content ? content.querySelector('a') : null;
          const script = content ? content.querySelector('script') : null;
          const img = content ? content.querySelector('img') : null;

          return {
            inputValue: input ? input.value : null,
            moodText: mood ? mood.textContent : null,
            containerDisplay: container ? container.style.display : null,
            hasH3: Boolean(h3 && h3.textContent === 'Oxford Dictionary'),
            hasEm: Boolean(em && em.textContent === 'meticulosus'),
            hasTable: Boolean(table),
            linkHref: a ? a.getAttribute('href') : null,
            linkTarget: a ? a.getAttribute('target') : null,
            linkRel: a ? a.getAttribute('rel') : null,
            hasScript: Boolean(script),
            xssFlag: window.__xss_flag,
            imgHasOnerror: Boolean(img && img.hasAttribute('onerror')),
            copyBtnText: copyBtn ? copyBtn.textContent : null
          };
        })()
      `,
      returnByValue: true
    });

    const doneRes = doneEval.result?.value;
    assert.ok(doneRes, 'Done state evaluation failed');
    assert.equal(doneRes.inputValue, 'meticulous', 'Prompt text restored in input');
    assert.equal(doneRes.moodText, '惡龍 回覆了！勇者 獲得了 知識 ×1。', 'hero mood updated to completion');
    assert.equal(doneRes.containerDisplay, 'block', 'Answer container must be displayed');
    assert.equal(doneRes.hasH3, true, 'H3 header rendered via marked GFM');
    assert.equal(doneRes.hasEm, true, 'Italic text rendered via marked GFM');
    assert.equal(doneRes.hasTable, true, 'GFM Table rendered properly');
    assert.equal(doneRes.linkHref, 'https://oxford.com', 'Citation link preserved');
    assert.equal(doneRes.linkTarget, '_blank', 'External link must have target="_blank"');
    assert.equal(doneRes.linkRel, 'noopener noreferrer', 'External link must have rel="noopener noreferrer"');

    // Strict DOMPurify Sanitization checks
    assert.equal(doneRes.hasScript, false, 'DOMPurify must strip <script> tag');
    assert.equal(doneRes.xssFlag, undefined, 'Script execution must NOT occur');
    assert.equal(doneRes.imgHasOnerror, false, 'DOMPurify must strip onerror attribute');
    console.log('  ✓ [Live Test 2 Pass]: GFM rendered accurately with headings, tables, links, and DOMPurify stripped all unsafe payloads.');

    // =========================================================================
    // LIVE TEST 3: AC4 One-Click Copy Directly Copies Raw Markdown
    // =========================================================================
    console.log('\n[Live Test 3] Testing AC4 One-Click Copy & Clipboard Readback...');

    // Trigger click on #copy-btn
    const copyEval = await popupCdp2.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const btn = document.getElementById('copy-btn');
          if (!btn) throw new Error('#copy-btn not found');
          btn.click();
          await new Promise(r => setTimeout(r, 200));
          return {
            text: btn.textContent,
            hasCopiedClass: btn.classList.contains('copied')
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    const copyRes = copyEval.result?.value;
    assert.ok(copyRes, 'Copy button evaluation failed');
    assert.equal(copyRes.text, '已複製！', 'Copy button text must transition to "已複製！"');
    assert.equal(copyRes.hasCopiedClass, true, 'Copy button must have .copied class');

    // Read back copied text via macOS pbpaste
    const copiedSystemText = execSync('pbpaste', { encoding: 'utf-8' });
    assert.equal(copiedSystemText, testMarkdown, 'System clipboard must match raw lastTalk.answerMarkdown exactly');
    console.log('  ✓ [Live Test 3 Pass]: One-click copy copied exact raw Markdown to system clipboard with interactive visual feedback.');
    console.log(`    - Copied text length: ${copiedSystemText.length} characters (exact match with testMarkdown)`);

    // =========================================================================
    // LIVE TEST 4: Popup Submit Contract (talk/submit), Raw Text & IME Guard
    // =========================================================================
    console.log('\n[Live Test 4] Testing Popup Enter Dispatch (talk/submit), Raw Text & IME Guard...');

    // Open fresh popup
    const popupTargetRes3 = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?${encodeURIComponent(popupUrl)}`, { method: 'PUT' });
    const popupTab3 = await popupTargetRes3.json();
    const popupCdp3 = new CdpClient(popupTab3.webSocketDebuggerUrl);
    await popupCdp3.connect();

    await new Promise(r => setTimeout(r, 600));

    // Install message interceptor / spy in popup context
    const submitSpyEval = await popupCdp3.send('Runtime.evaluate', {
      expression: `
        (async () => {
          const input = document.getElementById('talk-input');
          if (!input) throw new Error('#talk-input not found');

          window.__sentMessages = [];
          const origSendMessage = chrome.runtime.sendMessage;
          chrome.runtime.sendMessage = function(msg, callback) {
            window.__sentMessages.push(msg);
            if (origSendMessage) origSendMessage.apply(this, arguments);
          };

          // 1. Test IME composition guard: Enter during IME should NOT dispatch
          input.value = '輸入中';
          input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          input.dispatchEvent(new Event('compositionend', { bubbles: true }));

          const countAfterIme = window.__sentMessages.length;

          // 2. Test whitespace-only prompt: Should NOT dispatch
          input.value = '   ';
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

          const countAfterWhitespace = window.__sentMessages.length;

          // 3. Test genuine submit: Must send action: 'talk/submit' and preserve raw untrimmed text
          input.value = '  ledger test  ';
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

          return {
            countAfterIme,
            countAfterWhitespace,
            sent: window.__sentMessages
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    const submitSpyRes = submitSpyEval.result?.value;
    assert.ok(submitSpyRes, 'Submit spy evaluation failed');
    assert.equal(submitSpyRes.countAfterIme, 0, 'Enter during IME composition must NOT dispatch message');
    assert.equal(submitSpyRes.countAfterWhitespace, 0, 'Whitespace-only input must NOT dispatch message');
    assert.equal(submitSpyRes.sent.length, 1, 'Genuine Enter must dispatch exactly one message');
    assert.equal(submitSpyRes.sent[0].action, 'talk/submit', 'Message action must be "talk/submit" to match Service Worker');
    assert.equal(submitSpyRes.sent[0].text, '  ledger test  ', 'Raw prompt text must be preserved without premature trimming');
    console.log('  ✓ [Live Test 4 Pass]: Popup Enter dispatched action "talk/submit" once with raw untrimmed prompt; IME and empty whitespace guards verified.');

    // Clean up popup 3
    popupCdp3.close();
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${popupTab3.id}`).catch(() => {});

    // Clean up popup 2
    popupCdp2.close();
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/close/${popupTab2.id}`).catch(() => {});
    swCdp.close();

    console.log('\n================================================================');
    console.log('       ALL ACCEPTANCE CRITERIA FOR TICKET 06 (#30) PASSED       ');
    console.log('       [6 Goldens + Bundled GFM/Purify + Live Action Popup]     ');
    console.log('================================================================\n');
  } finally {
    // Restore developer system clipboard
    if (origClipboard !== undefined) {
      try {
        const proc = spawnSync('pbcopy', { input: origClipboard, encoding: 'utf-8' });
        console.log('[CfT Cleanup] Developer clipboard restored.');
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error('\n❌ M4 Verification Failed:', err);
  process.exit(1);
});
