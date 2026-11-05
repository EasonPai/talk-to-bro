import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertIdle, assertAnswer } from './lib/t3-verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:9222';
const URL = process.env.T3_BRO_CHAT_URL;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dir = path.join(ROOT, '.scratch/orca-team/evidence');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `t3-cft-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const report = { timestamp: new Date().toISOString(), gitRevision: execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(), results: [], overall: 'RUNNING' };
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const message = JSON.parse(e.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP_TIMEOUT: ${method}; no resend`)); }, 90000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    },
    close: () => ws.close()
  };
}

const snapshotExpression = `(() => {
  const visible = e => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0;
  const users = [...document.querySelectorAll('user-query')];
  const last = users.at(-1);
  const models = [...document.querySelectorAll('model-response')];
  const response = last ? models.find(e => last.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) : models.at(-1);
  const lines = last ? [...last.querySelectorAll('.query-text-line')] : [];
  return {
    url: location.href, visibility: document.visibilityState, focus: document.hasFocus(),
    editor: document.querySelector('rich-textarea .ql-editor[contenteditable="true"]')?.innerText ?? null,
    stop: [...document.querySelectorAll('button.send-button.stop,button[aria-label*="Stop" i],button[aria-label*="停止" i]')].some(visible),
    pending: !!response?.querySelector('.markdown[aria-busy="true"], .pending'),
    userCount: users.length,
    userText: lines.map(e => e.textContent.trim()).join('\\n'),
    pairedAnswer: response?.querySelector('.markdown')?.textContent ?? '',
    headings: response ? [...response.querySelectorAll('.markdown h1,.markdown h2,.markdown h3')].map(e=>e.textContent) : []
  };
})()`;

let gemini, extension, browser, createdTarget;
try {
  if (!URL || !/^https:\/\/gemini\.google\.com\/app\/[a-z0-9]+$/.test(URL)) throw new Error('Set T3_BRO_CHAT_URL to the Board-authorized test chat');
  report.browser = await (await fetch(`${BASE}/json/version`)).json();
  const targets = await (await fetch(`${BASE}/json/list`)).json();
  const target = targets.find(t => t.type === 'page' && t.url.includes('gemini.google.com/app/'));
  const extensionsTarget = targets.find(t => t.url === 'chrome://extensions/');
  if (!target || !extensionsTarget) throw new Error('Existing Gemini and extensions targets required');
  gemini = await connect(target.webSocketDebuggerUrl);
  report.beforeNavigation = await gemini.evaluate(snapshotExpression);
  assertIdle(report.beforeNavigation);
  const extManager = await connect(extensionsTarget.webSocketDebuggerUrl);
  let extId;
  try {
    extId = await extManager.evaluate(`(() => {
      const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
      return [...(list?.shadowRoot?.querySelectorAll('extensions-item') || [])].find(e => e.data?.name?.includes('Talk To Bro') && e.data?.state === 'ENABLED')?.data.id;
    })()`);
  } finally { extManager.close(); }
  if (!extId) throw new Error('Cannot resolve enabled extension identity');
  report.extensionId = extId;
  browser = await connect(report.browser.webSocketDebuggerUrl);
  const existing = targets.find(t => t.url === `chrome-extension://${extId}/popup.html`);
  if (existing) extension = await connect(existing.webSocketDebuggerUrl);
  else {
    const result = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html`, background: true });
    createdTarget = result.targetId;
    const list = await (await fetch(`${BASE}/json/list`)).json();
    extension = await connect(list.find(t => t.id === createdTarget).webSocketDebuggerUrl);
  }
  for (let i = 0; i < 50; i++) {
    if (await extension.evaluate(`typeof chrome?.runtime?.sendMessage === 'function'`)) break;
    await sleep(100);
  }
  report.previousSettings = await extension.evaluate(`chrome.storage.local.get('settings:v1')`);
  save();
  if (target.url !== URL) {
    await gemini.send('Page.navigate', { url: URL });
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try { if ((await gemini.evaluate(snapshotExpression)).editor !== null) break; } catch {}
    }
  }
  await gemini.send('Page.bringToFront');
  for (let i = 0; i < 60; i++) {
    report.chatReadiness = await gemini.evaluate(snapshotExpression);
    if (report.chatReadiness.url === URL && report.chatReadiness.editor !== null && report.chatReadiness.userCount > 0 && report.chatReadiness.pairedAnswer) break;
    await sleep(500);
  }
  if (report.chatReadiness.url !== URL || report.chatReadiness.editor === null || report.chatReadiness.userCount === 0 || !report.chatReadiness.pairedAnswer) throw new Error('CHAT_HISTORY_NOT_HYDRATED: translator readiness unconfirmed; no send');
  assertIdle(report.chatReadiness);
  await extension.evaluate(`chrome.storage.local.set({'settings:v1':{...${JSON.stringify(report.previousSettings['settings:v1'] || {})},broChatUrl:${JSON.stringify(URL)},updatedAt:Date.now()}})`);
  report.updatedSettings = await extension.evaluate(`chrome.storage.local.get('settings:v1')`);
  report.bundle = await extension.evaluate(`(async () => ({manifest:chrome.runtime.getManifest(),adapter:await (await fetch(chrome.runtime.getURL('adapter.js'))).text()}))()`);
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  report.bundleSha256 = hash(report.bundle.adapter);
  report.localBundleSha256 = hash(fs.readFileSync(path.join(ROOT, 'dist/adapter.js')));
  report.extensionVersion = report.bundle.manifest.version;
  delete report.bundle;
  if (report.bundleSha256 !== report.localBundleSha256) throw new Error('CANDIDATE_BUNDLE_MISMATCH');
  save();
  for (const word of ['claude', 'haiku', 'Anthropology', 'apple']) {
    for (const scenario of ['draft_present', 'empty_editor']) {
      const result = { word, scenario, startedAt: new Date().toISOString() };
      report.results.push(result);
      try {
        result.beforeSetup = await gemini.evaluate(snapshotExpression);
        assertIdle(result.beforeSetup);
        const draft = scenario === 'draft_present' ? `preexisting_draft_for_${word}_${Date.now()}` : '';
        result.initialDraft = draft;
        await gemini.evaluate(`(() => {
          const ed = document.querySelector('rich-textarea .ql-editor[contenteditable="true"]');
          if (!ed) throw new Error('EDITOR_MISSING');
          ed.focus(); const range=document.createRange(); range.selectNodeContents(ed);
          const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('delete',false);
          ${draft ? `document.execCommand('insertText',false,${JSON.stringify(draft)});` : ''}
          ed.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        await sleep(500);
        result.afterSetup = await gemini.evaluate(snapshotExpression);
        assertIdle(result.afterSetup);
        if (result.afterSetup.editor.trim() !== draft) throw new Error('DRAFT_SETUP_MISMATCH');
        // Existing non-Gemini target keeps the actual send/read observation background-only.
        await browser.send('Target.activateTarget', { targetId: extensionsTarget.id });
        result.preSubmit = await gemini.evaluate(snapshotExpression);
        assertIdle(result.preSubmit);
        if (result.preSubmit.visibility !== 'hidden') throw new Error('BACKGROUND_PRECONDITION_NOT_MET');
        save();
        result.submit = await extension.evaluate(`chrome.runtime.sendMessage({action:'talk/submit',text:${JSON.stringify(word)}})`);
        if (!result.submit?.accepted || !result.submit.talk?.id) throw new Error('SUBMIT_NOT_ACCEPTED');
        const talkId = result.submit.talk.id;
        for (let i = 0; i < 70; i++) {
          const data = await extension.evaluate(`chrome.storage.local.get('runtime:v1')`);
          const talk = data['runtime:v1']?.lastTalk;
          if (talk?.id === talkId && ['done','failed'].includes(talk.phase)) { result.finalTalk = talk; break; }
          await sleep(1000);
        }
        result.after = await gemini.evaluate(snapshotExpression);
        assertAnswer({ beforeCount:result.preSubmit.userCount, afterCount:result.after.userCount, userText:result.after.userText, word, answer:result.finalTalk?.answerMarkdown, pairedAnswer:result.after.pairedAnswer, phase:result.finalTalk?.phase });
        result.outcome = 'PASS';
        console.log(`PASS ${word}/${scenario} ${talkId} visibility=${result.after.visibility}`);
        save();
      } catch (error) {
        result.outcome = 'FAIL'; result.error = String(error);
        try { result.failureSnapshot = await gemini.evaluate(snapshotExpression); } catch {}
        save();
        throw error;
      }
    }
  }
  report.overall = 'PASS';
} catch (error) {
  report.overall = 'FAIL'; report.error = String(error); process.exitCode = 1;
  console.error(error);
} finally {
  save();
  gemini?.close(); extension?.close();
  if (createdTarget) await browser?.send('Target.closeTarget', { targetId: createdTarget });
  browser?.close();
  console.log(`Evidence: ${out}`);
}
