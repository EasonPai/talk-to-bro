// scripts/verify-t3-cft.mjs
// Real Chrome for Testing verification script for T-3 (M7)
// Verifies words: claude, haiku, Anthropology, apple
// Under both (1) pre-existing unsent draft and (2) empty editor scenarios.
// Runs on existing Bro Chat tab via CDP 9222 without launching extra browsers or using pkill.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
    const resp = await new Promise((r) => pend.set(id, r));
    if (resp.error) throw new Error(`${method} error: ${JSON.stringify(resp.error)}`);
    return resp.result;
  };
  const evaluate = async (expression, userGesture = false) => {
    const res = await send('Runtime.evaluate', {
      expression,
      userGesture,
      awaitPromise: true,
      returnByValue: true
    });
    if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res?.result?.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function closeTarget(targetId) {
  try {
    await fetch(`${BASE}/json/close/${targetId}`);
  } catch {}
}

async function main() {
  console.log('====================================================');
  console.log(' Talk To Bro: Comprehensive T-3 CfT Verification');
  console.log(' Reusing CDP Port 9222 (isolated profile)');
  console.log('====================================================');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const listRes = await fetch(`${BASE}/json/list`);
  const targets = await listRes.json();

  // 1. Locate Bro Chat tab
  const geminiTarget = targets.find(
    (t) => t.type === 'page' && t.url.includes('gemini.google.com/app/2e89301dd952fb12')
  );
  if (!geminiTarget) {
    throw new Error('Could not find existing Bro Chat Gemini tab (gemini.google.com/app/2e89301dd952fb12)');
  }
  console.log(`[CfT] Located Bro Chat Tab: ${geminiTarget.title} (${geminiTarget.id})`);

  // 2. Resolve active and enabled extension ID
  let extId = 'gifbhcpkdcdokkjbomgoebomdeklfbdk';
  const extPage = targets.find((t) => t.url === 'chrome://extensions/');
  if (extPage) {
    const extConn = cdp(extPage.webSocketDebuggerUrl);
    try {
      const detectedId = await extConn.evaluate(`(() => {
        const manager = document.querySelector('extensions-manager');
        const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
        const items = itemList?.shadowRoot?.querySelectorAll('extensions-item');
        for (const item of (items || [])) {
          if (item.data?.name?.includes('Talk To Bro') && item.data?.state === 'ENABLED') {
            return item.data.id;
          }
        }
        return null;
      })()`);
      if (detectedId) extId = detectedId;
    } finally {
      extConn.close();
    }
  }
  console.log(`[CfT] Extension ID: ${extId}`);

  // 3. Verify bundle identity
  const localAdapterJs = fs.readFileSync(path.resolve(ROOT, 'dist/adapter.js'), 'utf-8');
  const localSha256 = crypto.createHash('sha256').update(localAdapterJs).digest('hex');

  const helperPageRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
  const helperPage = await helperPageRes.json();
  const helperConn = cdp(helperPage.webSocketDebuggerUrl);

  let servedSha256 = null;
  let manifestVersion = null;
  try {
    let isReady = false;
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      try {
        isReady = await helperConn.evaluate(`typeof chrome?.runtime?.getURL === 'function'`);
        if (isReady) break;
      } catch {}
    }
    if (!isReady) throw new Error('Extension popup context failed to initialize chrome.runtime.getURL');

    const adapterText = await helperConn.evaluate(`(async () => {
      const res = await fetch(chrome.runtime.getURL('adapter.js'));
      return await res.text();
    })()`);
    servedSha256 = crypto.createHash('sha256').update(adapterText).digest('hex');

    manifestVersion = await helperConn.evaluate(`(async () => {
      const res = await fetch(chrome.runtime.getURL('manifest.json'));
      const m = await res.json();
      return m.version;
    })()`);

    // Ensure settings:v1 has broChatUrl configured
    await helperConn.evaluate(`(async () => {
      await chrome.storage.local.set({
        'settings:v1': {
          broChatUrl: ${JSON.stringify(geminiTarget.url)},
          updatedAt: Date.now()
        }
      });
    })()`);
  } finally {
    helperConn.close();
    await closeTarget(helperPage.id);
  }

  console.log(`[CfT] Local adapter.js SHA-256:  ${localSha256}`);
  console.log(`[CfT] Served adapter.js SHA-256: ${servedSha256}`);
  console.log(`[CfT] Extension Version:         ${manifestVersion}`);

  if (servedSha256 !== localSha256) {
    throw new Error(`Bundle SHA mismatch: local=${localSha256}, served=${servedSha256}`);
  }

  const geminiConn = cdp(geminiTarget.webSocketDebuggerUrl);

  const report = {
    gitRevision: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
    bundleSha256: servedSha256,
    extensionVersion: manifestVersion,
    cdpPort: PORT,
    broChatUrl: geminiTarget.url,
    results: [],
    timestamp: new Date().toISOString()
  };

  const words = ['claude', 'haiku', 'Anthropology', 'apple'];
  const scenarios = ['draft_present', 'empty_editor'];

  try {
    for (const word of words) {
      for (const scenario of scenarios) {
        console.log(`\n----------------------------------------------------`);
        console.log(`[Test Run] Word: "${word}" | Scenario: ${scenario}`);
        console.log(`----------------------------------------------------`);

        // Wait until Gemini stops generating from any previous request
        for (let i = 0; i < 60; i++) {
          const isBusy = await geminiConn.evaluate(`(() => {
            const stop = document.querySelector('button.send-button.stop, button[aria-label*="Stop" i], button[aria-label*="停止" i]');
            return !!stop && getComputedStyle(stop).display !== 'none';
          })()`);
          if (!isBusy) break;
          console.log('[Wait] Waiting for Gemini generation to complete...');
          await sleep(1000);
        }

        // Setup initial editor state for scenario
        let initialDraft = '';
        if (scenario === 'draft_present') {
          initialDraft = `preexisting_draft_for_${word}_${Date.now() % 10000}`;
          await geminiConn.evaluate(`((draft) => {
            const ed = document.querySelector('.ql-editor') || document.querySelector('[contenteditable="true"]');
            if (!ed) throw new Error('Gemini editor element not found');
            ed.focus();
            const range = document.createRange();
            range.selectNodeContents(ed);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertText', false, draft);
            ed.dispatchEvent(new Event('input', { bubbles: true }));
          })(${JSON.stringify(initialDraft)})`);
          console.log(`[Setup] Set pre-existing draft: "${initialDraft}"`);
          await sleep(200);
        } else {
          await geminiConn.evaluate(`(() => {
            const ed = document.querySelector('.ql-editor') || document.querySelector('[contenteditable="true"]');
            if (!ed) throw new Error('Gemini editor element not found');
            ed.focus();
            const range = document.createRange();
            range.selectNodeContents(ed);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false);
            ed.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          console.log(`[Setup] Emptied Gemini editor`);
        }

        // Verify editor state before submitting
        const observedEditorText = await geminiConn.evaluate(`(() => {
          const ed = document.querySelector('.ql-editor') || document.querySelector('[contenteditable="true"]');
          return ed ? ed.innerText.trim() : null;
        })()`);
        console.log(`[Setup] Verified editor text before submit: "${observedEditorText}"`);

        // Submit Talk via extension popup/background messaging
        const submitPageRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
        const submitPage = await submitPageRes.json();
        const submitConn = cdp(submitPage.webSocketDebuggerUrl);

        let submitResult = null;
        try {
          let hasRuntime = false;
          for (let i = 0; i < 50; i++) {
            await sleep(100);
            try {
              hasRuntime = await submitConn.evaluate(`typeof chrome?.runtime?.sendMessage === 'function'`);
              if (hasRuntime) break;
            } catch {}
          }

          submitResult = await submitConn.evaluate(`(async () => {
            return await chrome.runtime.sendMessage({ action: 'talk/submit', text: ${JSON.stringify(word)} });
          })()`);
          console.log(`[Submit] Sent talk/submit for "${word}":`, submitResult);
        } finally {
          submitConn.close();
          await closeTarget(submitPage.id);
        }

        if (!submitResult?.accepted || !submitResult?.talk?.id) {
          throw new Error(`talk/submit failed for ${word} in ${scenario}: ${JSON.stringify(submitResult)}`);
        }

        const talkId = submitResult.talk.id;
        const startTime = Date.now();
        let finalTalk = null;

        // Poll storage until phase reaches 'done' or 'failed'
        const monitorPageRes = await fetch(`${BASE}/json/new?chrome-extension://${extId}/popup.html`, { method: 'PUT' });
        const monitorPage = await monitorPageRes.json();
        const monitorConn = cdp(monitorPage.webSocketDebuggerUrl);

        try {
          while (Date.now() - startTime < 60000) {
            await sleep(1000);
            const storage = await monitorConn.evaluate(`(async () => {
              return await chrome.storage.local.get(['runtime:v1']);
            })()`);
            const lastTalk = storage?.['runtime:v1']?.lastTalk;
            if (lastTalk?.id === talkId) {
              process.stdout.write(`.`);
              if (lastTalk.phase === 'done' || lastTalk.phase === 'failed') {
                finalTalk = lastTalk;
                break;
              }
            }
          }
        } finally {
          monitorConn.close();
          await closeTarget(monitorPage.id);
        }

        console.log(`\n[Result] Talk ${talkId} reached phase: ${finalTalk?.phase} in ${Date.now() - startTime}ms`);

        if (!finalTalk) {
          throw new Error(`Timeout waiting for Talk ${talkId} to complete`);
        }

        if (finalTalk.phase !== 'done') {
          const code = finalTalk.failure?.code || finalTalk.failureCode;
          const reason = finalTalk.failureReason || finalTalk.failure?.reason;
          throw new Error(`Talk ${talkId} failed with code: ${code}, reason: ${reason}`);
        }

        const answerLength = finalTalk.answerMarkdown?.length || 0;
        const answerPreview = (finalTalk.answerMarkdown || '').slice(0, 120).replace(/\n/g, ' ');
        console.log(`[Result] Answer (${answerLength} chars): "${answerPreview}..."`);

        if (answerLength === 0) {
          throw new Error(`Talk ${talkId} completed but answerMarkdown is empty`);
        }

        report.results.push({
          word,
          scenario,
          initialDraft,
          talkId,
          phase: finalTalk.phase,
          answerLength,
          answerPreview,
          durationMs: Date.now() - startTime
        });

        // Generous breathing room between requests for Gemini rate limits
        await sleep(3000);
      }
    }

    report.overall = 'PASS';
    const outPath = path.join(EVIDENCE_DIR, 't3-cft-evidence.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    // Also write to root evidence directory
    fs.writeFileSync(
      path.resolve('/Users/eason/Documents/Dev/ai/talk-to-bro/.scratch/orca-team/evidence/t3-cft-evidence.json'),
      JSON.stringify(report, null, 2)
    );

    console.log(`\n✓ All 8/8 T-3 CfT M7 Scenarios PASSED! Evidence saved to ${outPath}`);
  } finally {
    geminiConn.close();
  }
}

main().catch((err) => {
  console.error('[CfT T-3 Verification Error]:', err);
  process.exit(1);
});
