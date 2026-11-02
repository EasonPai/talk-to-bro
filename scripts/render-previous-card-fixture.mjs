// T5 冒險之書 上一則 card fixture (T5-2 two Talks in one session, T5-3 close/reopen) on the existing CfT (CDP 9222).
// Usage: node scripts/render-previous-card-fixture.mjs [--zoom 1|1.25|2] [--tab] [--out dir]
// Writes a synthetic done lastTalk, opens the toolbar popup (CEO recipe: windows.update focused + action.openPopup; --tab is the fallback when the window is OS-inactive),
// stubs chrome.runtime.sendMessage so the second submit is NOT sent to Gemini (the stub answers with a synthetic done Talk), then checks:
// card hidden before submit; card shown after submit; Tab order card, input, actions, settings with a visible focus ring; Enter expands, Enter collapses; no overlap, height <= 600, width 400;
// reopen shows no card and the newest Last Talk; storage keys/Talk Log equal the pre snapshot (stub writes nothing) and contain no previous-summary data. Storage and zoom are restored.
// The textarea focus ring is drawn on its .composer wrapper (focus-within).
// Exit 0 = pass, 1 = fail, 2 = inconclusive.
import fs from 'node:fs';
import path from 'node:path';

const EXT = process.env.TTB_EXT_ID ?? 'kppigaopbfjcdfcpobapdofifbkdgdom';
const BASE = 'http://127.0.0.1:9222';
const POPUP = `chrome-extension://${EXT}/popup.html`;
const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const zoom = Number(opt('--zoom', 1));
const tabMode = args.includes('--tab');
const outDir = opt('--out', '.scratch/talk-to-bro-personally/t5-fixtures');
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
const FIRST_TEXT = 'serendipity: finding something good without looking for it (fixture)';
const FIRST_ANSWER = '# serendipity\n\n**意外發現**：偶然發現美好的事物。\n\n- a happy accident\n- 保留完整解釋\n- 第四行不應出現';
const SECOND_TEXT = 'meticulous (fixture)';
const first = { id: 'fixture-t5a', text: FIRST_TEXT, phase: 'done', createdAt: now - 120_000, updatedAt: now - 100_000, phaseDeadlineAt: null, sentAt: now - 118_000, answerMarkdown: FIRST_ANSWER };
const second = { id: 'fixture-t5b', text: SECOND_TEXT, phase: 'done', createdAt: now - 1000, updatedAt: now, phaseDeadlineAt: null, sentAt: now - 900, answerMarkdown: '# meticulous\n\n一絲不苟。' };
const snapshot = await swc.evaluate(`Promise.all([chrome.storage.local.get(null), chrome.storage.session.get(null)]).then(JSON.stringify)`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'storage-snapshot.json'), snapshot);

const STUB = `window.__msgs = []; chrome.runtime.sendMessage = (m, cb) => { window.__msgs.push(m); cb && cb({ talk: ${JSON.stringify(second)} }); };`;
const MEASURE = `(()=>{
  const r = (s) => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
  const box = r('.popup-container'), main = r('.popup-main'), foot = r('.popup-footer'), head = r('.popup-header'), card = r('#previous-card'), detail = r('#previous-detail'), gear = r('.gear-btn');
  const hit = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const pairs = [['head', head], ['card', card], ['detail', detail], ['main', main], ['foot', foot]];
  const overlaps = [];
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if (hit(pairs[i][1], pairs[j][1])) overlaps.push(pairs[i][0] + '/' + pairs[j][0]);
  if (hit(gear, card)) overlaps.push('gear/card'); if (hit(gear, detail)) overlaps.push('gear/detail'); if (hit(gear, main)) overlaps.push('gear/main');
  const c = document.getElementById('previous-card');
  return { innerWidth, innerHeight, containerHeight: box.height, overlaps, pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
    cardVisible: !!card, cardLabel: c.textContent.trim(), expanded: c.getAttribute('aria-expanded'), cardTag: c.tagName, detailVisible: !!detail,
    detailText: document.getElementById('previous-text').textContent, answerLines: document.getElementById('previous-answer').hidden ? [] : document.getElementById('previous-answer').textContent.split('\\n'),
    narrationRole: document.getElementById('pip-mood').getAttribute('role'), narrationLive: document.getElementById('pip-mood').getAttribute('aria-live') };
})()`;

let host; let code = 0; const report = { zoom };
try {
  host = await (await fetch(`${BASE}/json/new?${encodeURIComponent(POPUP)}`, { method: 'PUT' })).json();
  const h = cdp(host.webSocketDebuggerUrl);
  await sleep(1000);
  const tabId = await h.evaluate(`chrome.tabs.getCurrent().then(t => t.id)`);
  await h.evaluate(`chrome.tabs.setZoom(${tabId}, ${zoom})`);
  await swc.evaluate(`chrome.storage.local.get('runtime:v1').then(r => chrome.storage.local.set({ 'runtime:v1': { ...(r['runtime:v1'] ?? {}), lastTalk: ${JSON.stringify(first)} } }))`);
  const afterWrite = JSON.parse(await swc.evaluate(`chrome.storage.local.get('runtime:v1').then(JSON.stringify)`));
  const openPopup = async () => {
    await fetch(`${BASE}/json/activate/${host.id}`).catch(() => {});
    const before = (await list()).filter((t) => t.url === POPUP).map((t) => t.id);
    await h.evaluate(`(async()=>{const w=await chrome.windows.getCurrent();await chrome.windows.update(w.id,{focused:true});await chrome.action.openPopup({windowId:w.id})})()`).catch(() => {});
    for (let i = 0; i < 20; i++) { await sleep(250); const t = (await list()).find((x) => x.url === POPUP && !before.includes(x.id)); if (t) return t; }
    return null;
  };
  const setup = async (target) => {
    const p = cdp(target.webSocketDebuggerUrl);
    if (tabMode) {
      await h.evaluate(`chrome.tabs.setZoom(${tabId}, 0)`);
      await p.send('Emulation.setDeviceMetricsOverride', { width: 400 * zoom, height: 600, deviceScaleFactor: 1, mobile: false });
      await p.send('Page.reload'); await sleep(1500);
      await p.evaluate(`document.documentElement.style.zoom='${zoom}';document.documentElement.style.setProperty('--ttb-zoom','${zoom}')`);
    } else await sleep(1500);
    return p;
  };
  const popup = tabMode ? host : await openPopup();
  if (!popup) { console.error('real action popup target not found (window OS-inactive); rerun with --tab'); code = 2; }
  else {
    report.mode = tabMode ? 'tab-emulated' : 'real-popup';
    const p = await setup(popup);
    await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const press = async (key, code_, vk) => { for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key, code: code_, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r' } : {}) }); };
    const shot = async (name) => { const s = await p.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(outDir, `${name}-${zoom * 100}.png`); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); return f; };
    const stop = () => p.evaluate(`(()=>{const e=document.activeElement;const cs=getComputedStyle(e.closest('.composer')||e);return {id:e.id||e.className||e.tagName,ring:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)*${zoom}>=1.5, width: cs.outlineWidth}})()`);

    report.beforeSubmit = await p.evaluate(`!!document.getElementById('previous-card') && document.getElementById('previous-card').getClientRects().length > 0`);
    // Second Talk in the same popup session (sendMessage stubbed: nothing reaches Gemini).
    await p.evaluate(STUB);
    await p.evaluate(`(()=>{const i=document.getElementById('talk-input');i.focus();i.value=${JSON.stringify(SECOND_TEXT)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await press('Enter', 'Enter', 13); await sleep(400);
    report.submitMsgs = await p.evaluate('window.__msgs');
    report.collapsed = await p.evaluate(MEASURE);
    report.shotCollapsed = await shot('5-collapsed');
    // Tab order: card, input, actions, settings, each with a visible focus ring.
    const order = [];
    await p.evaluate(`document.getElementById('previous-card').focus()`);
    order.push(await stop());
    for (let i = 0; i < 4; i++) { await press('Tab', 'Tab', 9); order.push(await stop()); }
    report.tabOrder = order;
    await p.evaluate(`document.getElementById('previous-card').focus()`);
    await press('Enter', 'Enter', 13); await sleep(450);
    report.expanded = await p.evaluate(MEASURE);
    report.shotExpanded = await shot('5-expanded');
    await press('Enter', 'Enter', 13); await sleep(450);
    report.recollapsed = await p.evaluate(MEASURE);
    p.close();

    // T5-3: close and reopen -> no card, newest Last Talk restored (storage untouched by the stub).
    let q;
    if (tabMode) { q = await setup(host); }
    else { await fetch(`${BASE}/json/close/${popup.id}`); await sleep(500); const again = await openPopup(); if (!again) { code = 2; report.reopen = 'popup not reopened'; } else q = await setup(again); }
    if (q) {
      report.reopen = await q.evaluate(`({ cardVisible: document.getElementById('previous-card').getClientRects().length > 0, label: document.getElementById('previous-label').textContent, expanded: document.getElementById('previous-card').getAttribute('aria-expanded'), lastTalkText: document.getElementById('answer-content').textContent })`);
      q.close();
    }
    const nowStore = await swc.evaluate(`chrome.storage.local.get(null).then(JSON.stringify)`);
    const [preLocal] = JSON.parse(snapshot);
    const cur = JSON.parse(nowStore);
    report.storage = {
      sameKeysAsPre: JSON.stringify(Object.keys(cur).sort()) === JSON.stringify(Object.keys(preLocal).sort()),
      logUnchanged: JSON.stringify(cur['runtime:v1']?.logByTalkId ?? {}) === JSON.stringify(preLocal['runtime:v1']?.logByTalkId ?? {}),
      lastTalkStillFixture: cur['runtime:v1']?.lastTalk?.id === afterWrite['runtime:v1'].lastTalk.id,
      noPreviousSummary: !/previousSummary|冒險之書|上一則/.test(nowStore), leak: (nowStore.match(/.{30}(previousSummary|冒險之書|上一則).{30}/) ?? [null])[0]
    };
    const L = report.collapsed, E = report.expanded, R = report.recollapsed;
    const ringOk = report.tabOrder.every((t) => t.ring);
    const ids = report.tabOrder.map((t) => t.id);
    const orderOk = ids.join() === 'previous-card,talk-input,copy-btn,answer-content,gear-btn';
    const layoutOk = [L, E, R].every((m) => m.overlaps.length === 0 && !m.pageScroll && m.containerHeight <= 600.5) && (zoom !== 1 || L.innerWidth === 400);
    const ok = report.beforeSubmit === false && report.submitMsgs.length === 1 && report.submitMsgs[0].action === 'talk/submit'
      && L.cardVisible && L.cardTag === 'BUTTON' && L.expanded === 'false' && !L.detailVisible && L.cardLabel.startsWith('📖 冒險之書・上一則 ') && L.cardLabel.includes(`「${Array.from(FIRST_TEXT).slice(0, 40).join('')}」`)
      && E.expanded === 'true' && E.detailVisible && E.detailText === Array.from(FIRST_TEXT).slice(0, 40).join('') && E.answerLines.length === 3 && !E.answerLines.join('').includes('第四行')
      && R.expanded === 'false' && !R.detailVisible && L.narrationRole === 'status' && L.narrationLive === 'polite'
      && orderOk && ringOk && layoutOk
      && report.reopen?.cardVisible === false && report.reopen.label === '' && report.reopen.expanded === 'false'
      && Object.entries(report.storage).every(([k, v]) => k === 'leak' || v) && /serendipity/.test(report.reopen?.lastTalkText ?? '');
    report.checks = { orderOk, ringOk, layoutOk };
    if (!ok) code = 1;
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
console.log(JSON.stringify(report, null, 1));
process.exit(code);
