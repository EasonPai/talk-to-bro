// Verifies UI r2 T1 on the existing CfT (CDP 9222): zero external requests (T1-3),
// no footer/main overlap at 100/125/200% (T1-1), and Enter / Shift+Enter / IME guard (X-2).
// Opens popup.html in a temporary extension tab; sendMessage is stubbed so nothing is submitted.
// Usage: node scripts/verify-popup-shell.mjs   (exit 0 = pass)
import assert from 'node:assert/strict';

const EXT = process.env.TTB_EXT_ID ?? 'kppigaopbfjcdfcpobapdofifbkdgdom';
const BASE = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = await (await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const requests = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === 'Network.requestWillBeSent') requests.push(d.params.request.url);
  pending.get(d.id)?.(d);
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails));
  return d.result.result.value;
};

let failed = false;
try {
  await send('Network.enable');
  await send('Page.navigate', { url: `chrome-extension://${EXT}/popup.html` });
  await sleep(2000);

  const external = requests.filter((u) => !/^(chrome-extension|data|blob|about):/.test(u));
  console.log(`requests=${requests.length} external=${external.length}`);
  assert.deepEqual(external, [], 'popup must make no external network request');
  assert.ok(requests.some((u) => u.endsWith('/assets/dragon.jpg')) && requests.some((u) => u.endsWith('/assets/hero.jpg')), 'packaged avatars must load');

  for (const z of [1, 1.25, 2]) {
    const m = await evaluate(`(()=>{
      const r=document.documentElement; r.style.setProperty('--ttb-zoom','${z}'); r.style.zoom='${z}';
      const e=document.getElementById('error-container'); e.style.display='block';
      document.getElementById('error-message').textContent='x'.repeat(400);
      const n=document.getElementById('handoff-notice'); n.style.display='flex';
      const main=document.querySelector('.popup-main').getBoundingClientRect();
      const foot=document.querySelector('.popup-footer').getBoundingClientRect();
      const box=document.querySelector('.popup-container').getBoundingClientRect();
      return {mainBottom:main.bottom, footTop:foot.top, boxHeight:box.height};
    })()`);
    console.log(`zoom ${z}`, JSON.stringify(m));
    assert.ok(m.mainBottom <= m.footTop + 0.5, `main overlaps footer at zoom ${z}`);
    assert.ok(m.boxHeight <= 600.5, `popup taller than 600 at zoom ${z}`);
  }
  await evaluate(`(()=>{const r=document.documentElement;r.style.zoom='1';r.style.setProperty('--ttb-zoom','1');})()`);

  // X-2: keyboard behaviour with a stubbed sendMessage
  const key = (init) => evaluate(`(()=>{
    window.__sent = window.__sent ?? [];
    chrome.runtime.sendMessage = (msg) => { window.__sent.push(msg); };
    const t=document.getElementById('talk-input'); t.value='hello';
    const e=new KeyboardEvent('keydown',Object.assign({key:'Enter',bubbles:true,cancelable:true},${JSON.stringify(init.event ?? {})}));
    ${init.keyCode ? `Object.defineProperty(e,'keyCode',{get:()=>${init.keyCode}});` : ''}
    ${init.compose ? `t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));` : ''}
    t.dispatchEvent(e);
    ${init.compose ? `t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));` : ''}
    const out={sent:window.__sent.length, prevented:e.defaultPrevented}; window.__sent.length=0; return out;
  })()`);
  assert.deepEqual(await key({}), { sent: 1, prevented: true }, 'Enter submits');
  assert.deepEqual(await key({ event: { shiftKey: true } }), { sent: 0, prevented: false }, 'Shift+Enter keeps newline');
  assert.deepEqual(await key({ keyCode: 229 }), { sent: 0, prevented: false }, 'keyCode 229 is ignored');
  assert.deepEqual(await key({ compose: true }), { sent: 0, prevented: false }, 'composition is ignored');
  assert.deepEqual(await key({ event: { isComposing: true } }), { sent: 0, prevented: false }, 'isComposing is ignored');
  console.log('PASS');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  ws.close();
  await fetch(`${BASE}/json/close/${tab.id}`);
}
process.exit(failed ? 1 : 0);
