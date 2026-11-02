// Renders fixtures (2a sending, 2b waiting + HUD, 3 done answer, 3-long long answer, 4* TIMEOUT_IDLE failure) in the REAL toolbar action popup on the existing CfT (CDP 9222).
// Usage: node scripts/render-popup-fixture.mjs <2a|2b|3|3-long|4|4-deferred|4-copied|4-notcopied> [--zoom 1|1.25|2] [--tab] [--reduced-motion] [--copy] [--out dir]
// --copy (states 3*): clicks Copy with a stubbed navigator.clipboard.writeText and checks the text equals the Answer Markdown (real clipboard untouched).
// States 4*: TIMEOUT_IDLE failure. 4 = pending handoff countdown (needs --tab so chrome.runtime.sendMessage/clipboard can be stubbed before the 1.5s timer fires), 4-deferred = deferred button,
// 4-copied / 4-notcopied = executed handoff with copied true/false. Keyboard checks (Tab/Enter) run with sendMessage and clipboard stubbed, so no tab is switched and the real clipboard is untouched.
// --tab renders popup.html in a host tab with the popup viewport emulated (fallback when the CfT window is OS-inactive and chrome.action.openPopup is refused).
// States 3* also close and reopen the popup to prove the Last Talk answer restores (T3-3).
// Protocol (plan section 5): snapshots chrome.storage.local/session, writes a synthetic lastTalk, opens the action
// popup, screenshots the popup ONLY (never the Gemini tab), measures layout, then restores storage and tab zoom.
// Fixture text is synthetic. Nothing is sent to Gemini. Exit 0 = rendered and verified, 1 = failed, 2 = inconclusive.
import fs from 'node:fs';
import path from 'node:path';

const EXT = process.env.TTB_EXT_ID ?? 'kppigaopbfjcdfcpobapdofifbkdgdom';
const BASE = 'http://127.0.0.1:9222';
const POPUP = `chrome-extension://${EXT}/popup.html`;
const args = process.argv.slice(2);
const state = args[0];
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
if (!['2a', '2b', '3', '3-long', '4', '4-deferred', '4-copied', '4-notcopied'].includes(state)) { console.error('usage: <2a|2b|3|3-long|4|4-deferred|4-copied|4-notcopied> [--zoom n] [--tab] [--reduced-motion] [--copy] [--out dir]'); process.exit(1); }
const zoom = Number(opt('--zoom', 1));
const reduced = args.includes('--reduced-motion');
const tabMode = args.includes('--tab');
const doCopy = args.includes('--copy');
const isDone = state.startsWith('3');
const isFail = state.startsWith('4');
if (state === '4' && !tabMode) { console.error('state 4 (pending countdown) needs --tab'); process.exit(1); }
const outDir = opt('--out', '.scratch/talk-to-bro-personally/t2-fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await fetch(`${BASE}/json/list`)).json();

function cdp(url) {
  const ws = new WebSocket(url); let seq = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = async (method, params = {}) => { await ready; const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pend.set(id, r)); };
  const evaluate = async (expression) => { const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails)); return d.result?.result?.value; };
  return { send, evaluate, close: () => ws.close() };
}

const sw = (await list()).find((t) => t.type === 'service_worker' && t.url.includes(EXT));
if (!sw) { console.error('extension service worker not running (open options.html to wake it)'); process.exit(2); }
const swc = cdp(sw.webSocketDebuggerUrl);
const now = Date.now();
const SHORT_ANSWER = '# meticulous\n\n**一絲不苟**：非常注意細節。\n\n- Careful and precise\n- 保留完整的中英文解釋';
const LONG_ANSWER = '# take for granted\n\n' + '視為理所當然 — do not take a friend’s kindness for granted.\n\n'.repeat(35) + '最後一段，完整保留。';
const answerMarkdown = state === '3-long' ? LONG_ANSWER : SHORT_ANSWER;
const handoffFor = { 4: { status: 'pending', copied: false, focused: false }, '4-deferred': { status: 'deferred', copied: false, focused: false },
  '4-copied': { status: 'done', copied: true, focused: true }, '4-notcopied': { status: 'partial', copied: false, focused: true } };
const fixture = {
  id: 'fixture-t23', text: 'meticulous (fixture)', phase: isFail ? 'failed' : isDone ? 'done' : state === '2a' ? 'sending' : 'waiting',
  createdAt: now - 60_000, updatedAt: now, phaseDeadlineAt: isDone || isFail ? null : now + 3_600_000,
  ...(isFail ? { sentAt: now - 40_000, failure: { code: 'TIMEOUT_IDLE', stage: 'read', at: now }, handoff: handoffFor[state] } : {}),
  ...(state === '2b' ? { sentAt: now - 24_000, lastGrowthAt: now - 4_000 } : {}),
  ...(isDone ? { sentAt: now - 30_000, answerMarkdown } : {})
};
const snapshot = await swc.evaluate(`Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]).then(JSON.stringify)`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'storage-snapshot.json'), snapshot);

const STUBS_EVAL = `window.__msgs = window.__msgs ?? []; window.__clip = window.__clip ?? []; chrome.runtime.sendMessage = (m) => { window.__msgs.push(m); return Promise.resolve(); }; navigator.clipboard.writeText = async (t) => { window.__clip.push(t); };`;
const STUBS = `window.__msgs = []; window.__clip = []; try { chrome.runtime.sendMessage = (m) => { window.__msgs.push(m); return Promise.resolve(); }; navigator.clipboard.writeText = async (t) => { window.__clip.push(t); }; } catch (e) {}`;
let host; let code = 0; const report = {};
try {
  host = await (await fetch(`${BASE}/json/new?${encodeURIComponent(POPUP)}`, { method: 'PUT' })).json();
  const h = cdp(host.webSocketDebuggerUrl);
  await sleep(1000);
  const tabId = await h.evaluate(`chrome.tabs.getCurrent().then(t => t.id)`);
  await h.evaluate(`chrome.tabs.setZoom(${tabId}, ${zoom})`);
  await swc.evaluate(`chrome.storage.local.get('runtime:v1').then(r => chrome.storage.local.set({ 'runtime:v1': { ...(r['runtime:v1'] ?? {}), lastTalk: ${JSON.stringify(fixture)} } }))`);

  const openPopup = async () => {
    await fetch(`${BASE}/json/activate/${host.id}`).catch(() => {});
    const before = (await list()).filter((t) => t.url === POPUP).map((t) => t.id);
    await h.evaluate(`(async()=>{const w=await chrome.windows.getCurrent();await chrome.windows.update(w.id,{focused:true});await chrome.action.openPopup({windowId:w.id})})()`).catch(() => {});
    for (let i = 0; i < 20; i++) { await sleep(250); const t = (await list()).find((x) => x.url === POPUP && !before.includes(x.id)); if (t) return t; }
    return null;
  };
  // --tab: fallback when the CfT window is not OS-active (openPopup refuses). Renders popup.html in a host tab with the popup's viewport emulated; not the real action popup.
  const popup = tabMode ? host : await openPopup();
  if (!popup) { console.error('real action popup target not found'); code = 2; }
  else {
    const p = cdp(popup.webSocketDebuggerUrl);
    if (tabMode) {
      await h.evaluate(`chrome.tabs.setZoom(${tabId}, 0)`);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 400 * zoom, height: 600, deviceScaleFactor: 1, mobile: false });
      if (isFail) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: STUBS });
      await p.send('Page.reload'); await sleep(isFail ? 300 : 1500);
      await p.evaluate(`document.documentElement.style.zoom='${zoom}';document.documentElement.style.setProperty('--ttb-zoom','${zoom}')`);
      report.mode = 'tab-emulated';
    }
    if (reduced) await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    if (!(tabMode && isFail)) await sleep(1500);
    Object.assign(report, await p.evaluate(`(()=>{
      const q = (s) => document.querySelector(s);
      const vis = (id) => { const e = document.getElementById(id); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const main = q('.popup-main').getBoundingClientRect(), foot = q('.popup-footer').getBoundingClientRect(), box = q('.popup-container').getBoundingClientRect();
      const copy = document.getElementById('copy-btn').getBoundingClientRect(), input = document.getElementById('talk-input').getBoundingClientRect();
      const ac = document.getElementById('answer-content');
      return { innerWidth, innerHeight, containerHeight: box.height, overlap: main.bottom > foot.top + 0.5,
        receipt: vis('chat-receipt'), receiptText: document.getElementById('chat-receipt').textContent.trim(),
        typing: vis('chat-typing'), hud: vis('hud'), patience: document.getElementById('hud-patience-label').textContent, silence: document.getElementById('hud-silence-label').textContent,
        narration: document.getElementById('pip-mood').textContent,
        answerVisible: vis('answer-container'), sourceLine: vis('source-line') ? document.getElementById('source-line').textContent : null,
        gotoBroVisible: vis('goto-bro-btn'),
        copyInView: copy.top >= 0 && copy.bottom <= innerHeight, inputInView: input.top >= 0 && input.bottom <= innerHeight,
        answerClientHeight: ac.clientHeight, blocks: Object.fromEntries(['.popup-header','.narration','.input-card','.answer-container','.popup-footer'].map((k) => [k, Math.round(q(k).getBoundingClientRect().height)])), answerScrolls: ac.scrollHeight > ac.clientHeight, answerEndsWith: ac.textContent.trimEnd().slice(-12), pageScroll: document.documentElement.scrollHeight > innerHeight + 1, scrollH: document.documentElement.scrollHeight, bodyScrollH: document.body.scrollHeight, below: [...document.querySelectorAll('body *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().bottom > innerHeight + 1 && !e.closest('.popup-main')).map((e) => e.className || e.tagName).slice(0, 6),
        failure: { narration: document.getElementById('pip-mood').textContent, errorVisible: vis('error-container'), badge: document.getElementById('error-badge').textContent, message: document.getElementById('error-message').textContent,
          handoffVisible: vis('handoff-notice'), handoffText: document.getElementById('countdown-text').textContent.trim(), cancelVisible: vis('cancel-handoff-btn'), deferredVisible: vis('deferred-notice'), gotoVisible: vis('goto-bro-btn'),
          focus: document.activeElement.id, errorBottom: document.getElementById('error-container').getBoundingClientRect().bottom, footerTop: foot.top },
        typingAnim: getComputedStyle(q('.typing span')).animationName, barTransition: getComputedStyle(q('.hud-bar > span')).transitionDuration };
    })()`));
    const shot = await p.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${state}-${zoom * 100}${reduced ? '-reduced' : ''}.png`);
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    report.screenshot = file;
    if (isFail) {
      const press = async (key, code, vk) => { for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) }); };
      await p.evaluate(STUBS_EVAL);
      const kb = {};
      if (state === '4-deferred') {
        await p.evaluate(`document.getElementById('talk-input').focus()`);
        await press('Tab', 'Tab', 9);
        kb.focusIsGoto = (await p.evaluate('document.activeElement.id')) === 'goto-bro-btn';
        await press('Enter', 'Enter', 13); await sleep(300);
        kb.msgs = await p.evaluate('window.__msgs'); kb.clip = await p.evaluate('window.__clip');
        kb.ok = kb.focusIsGoto && kb.msgs.length === 1 && kb.msgs[0].action === 'handoff/switch_tab' && kb.msgs[0].authorizeDeferred === true && kb.clip[0] === 'meticulous (fixture)';
      } else if (state === '4') {
        await p.evaluate(`document.getElementById('talk-input').focus()`);
        await press('Tab', 'Tab', 9);
        kb.focusIsCancel = (await p.evaluate('document.activeElement.id')) === 'cancel-handoff-btn';
        await press('Enter', 'Enter', 13); await sleep(300);
        kb.msgs = await p.evaluate('window.__msgs');
        kb.ok = kb.focusIsCancel && kb.msgs.some((m) => m.action === 'handoff/cancel') && !kb.msgs.some((m) => m.action === 'handoff/switch_tab');
      } else kb.ok = true;
      report.keyboard = kb;
      if (!kb.ok) code = 1;
    }
    if (isDone && doCopy) {
      // The popup has no clipboardRead permission, so the write is captured by a stub (never reaching the real clipboard, which stays untouched).
      report.copy = await p.evaluate(`(async()=>{
        const calls = []; const orig = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async (t) => { calls.push(t); };
        document.getElementById('copy-btn').click(); await new Promise(r => setTimeout(r, 400));
        navigator.clipboard.writeText = orig;
        return { ok: calls.length === 1 && calls[0] === ${JSON.stringify(answerMarkdown)}, writes: calls.length, restored: true };
      })()`);
      if (!report.copy.ok || report.copy.restored === false) code = report.copy.inconclusive ? 2 : 1;
    }
    p.close();
    if (isDone && tabMode) report.reopen = 'skipped (tab mode)';
    else if (isDone) {
      await fetch(`${BASE}/json/close/${popup.id}`); await sleep(500);
      const again = await openPopup();
      if (!again) { report.reopen = 'popup not reopened'; code = 2; }
      else {
        const p2 = cdp(again.webSocketDebuggerUrl); await sleep(1500);
        report.reopen = await p2.evaluate(`document.getElementById('answer-content').textContent.trimEnd().slice(-12)`);
        if (report.reopen !== report.answerEndsWith) code = 1;
        p2.close(); await fetch(`${BASE}/json/close/${again.id}`);
      }
    }
    const NARR = '惡龍 已讀不回……', MSG = '惡龍 30 秒沒出聲。';
    const f = report.failure;
    const failOk = isFail && f.narration === NARR && f.errorVisible && f.message === MSG && f.badge === '已讀不回' && f.errorBottom <= f.footerTop + 0.5 && !report.pageScroll
      && (state === '4' ? f.handoffVisible && f.cancelVisible : state === '4-deferred' ? f.deferredVisible && f.gotoVisible
        : state === '4-copied' ? f.handoffText === '勇者 使用了 剪貼簿！訊息已經複製。' : f.handoffText.includes('剪貼簿未寫入') && !f.handoffText.includes('訊息已經複製'));
    const okState = isFail ? failOk : isDone
      ? report.answerVisible && report.sourceLine === 'SOURCE: TRUST ME BRO' && !report.gotoBroVisible && report.copyInView && report.inputInView && !report.pageScroll && report.answerClientHeight >= 30 && (state !== '3-long' || report.answerScrolls)
      : state === '2a' ? !report.receipt && !report.hud : report.receipt && report.hud && report.typing;
    if (!okState || report.overlap || report.containerHeight > 600.5) code = 1;
    if (reduced && !isDone && (report.typingAnim !== 'none' || report.barTransition !== '0s')) code = 1;
  }
  await h.evaluate(`chrome.tabs.setZoom(${tabId}, 0)`);
  h.close();
} finally {
  const [local, session] = JSON.parse(snapshot);
  const orig = local['runtime:v1'];
  await swc.evaluate(`(async()=>{${orig === undefined ? `await chrome.storage.local.remove('runtime:v1');` : `await chrome.storage.local.set({'runtime:v1': ${JSON.stringify(orig)}});`}
    const [l, s] = await Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]);
    return JSON.stringify([l, s]) === ${JSON.stringify(JSON.stringify([local, session]))}})()`).then((eq) => { report.storageRestoredEqual = eq; if (!eq) code = 1; });
  swc.close();
  if (host) await fetch(`${BASE}/json/close/${host.id}`);
}
console.log(JSON.stringify({ state, zoom, reduced, ...report }, null, 1));
process.exit(code);
