// Verifies Tidal Calm shell on CfT (CDP): zero external requests,
// zero legacy RPG terms/assets, Light & Dark schemes, no footer/main overlap at 100/125/200% zoom,
// Enter / Shift+Enter / IME guard / #send-btn click, embedded #settings, sidepanel.html, and options.html.
// Usage: node scripts/verify-popup-shell.mjs   (exit 0 = pass)
import assert from 'node:assert/strict';

const EXT = process.env.TTB_EXT_ID ?? 'kppigaopbfjcdfcpobapdofifbkdgdom';
const PORT = process.env.CDP_PORT ?? '9222';
const HOST = process.env.CDP_HOST ?? '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch(`${BASE}/json/version`)).json();
const list = await (await fetch(`${BASE}/json/list`)).json();
const swTarget = list.find((t) => typeof t.url === 'string' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/sw.js'));
const discoveredExt = swTarget ? new URL(swTarget.url).hostname : EXT;
const targetOrigin = `chrome-extension://${discoveredExt}`;

// Browser-level WS allows Target.createTarget directly to chrome-extension:// URLs in Chrome 156+
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (bws.onopen = r));
let bSeq = 0;
const bPending = new Map();
bws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  bPending.get(d.id)?.(d);
};
const bSend = (method, params = {}) => new Promise((r) => { const id = ++bSeq; bPending.set(id, r); bws.send(JSON.stringify({ id, method, params })); });

async function openExtensionPage(url) {
  const created = await bSend('Target.createTarget', { url });
  if (created.error) throw new Error(created.error.message);
  const targetId = created.result.targetId;
  await sleep(600);
  const pages = await (await fetch(`${BASE}/json/list`)).json();
  const page = pages.find((t) => t.id === targetId);
  assert.ok(page?.webSocketDebuggerUrl, `Target ${url} must have webSocketDebuggerUrl`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  await send('Network.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(800);
  return {
    targetId,
    requests,
    send,
    evaluate,
    close: async () => {
      ws.close();
      await bSend('Target.closeTarget', { targetId });
    }
  };
}

let failed = false;
try {
  // 1. Popup shell + Light/Dark + Zoom + Embedded #settings + Composer
  const popup = await openExtensionPage(`${targetOrigin}/popup.html`);
  try {
    const external = popup.requests.filter((u) => !/^(chrome-extension|data|blob|about):/.test(u));
    console.log(`popup requests=${popup.requests.length} external=${external.length}`);
    assert.deepEqual(external, [], 'popup must make no external network request');
    assert.equal(popup.requests.some((u) => /\.jpg\b/i.test(u)), false, 'popup must not load legacy .jpg assets');

    const bodyText = await popup.evaluate(`document.body.innerText`);
    assert.doesNotMatch(bodyText, /勇者|惡龍|冒險之書|Pip|老大|小弟/, 'popup must not display legacy RPG terms');

    for (const scheme of ['light', 'dark']) {
      await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      for (const z of [1, 1.25, 2]) {
        const m = await popup.evaluate(`(()=>{
          const r=document.documentElement; r.style.setProperty('--ttb-zoom','${z}'); r.style.zoom='${z}';
          const e=document.getElementById('error-container'); e.style.display='block';
          document.getElementById('error-message').textContent='x'.repeat(400);
          const n=document.getElementById('handoff-notice'); n.style.display='flex';
          const main=document.querySelector('.popup-main').getBoundingClientRect();
          const foot=document.querySelector('.popup-footer').getBoundingClientRect();
          const box=document.querySelector('.popup-container').getBoundingClientRect();
          const bg=getComputedStyle(document.body).backgroundColor;
          return {mainBottom:main.bottom, footTop:foot.top, boxHeight:box.height, bg};
        })()`);
        console.log(`${scheme} zoom ${z}`, JSON.stringify(m));
        assert.ok(m.mainBottom <= m.footTop + 0.5, `main overlaps footer at ${scheme} zoom ${z}`);
        assert.ok(m.boxHeight <= 600.5, `popup taller than 600 at ${scheme} zoom ${z}`);
      }
    }
    await popup.send('Emulation.setEmulatedMedia', { features: [] });
    await popup.evaluate(`(()=>{const r=document.documentElement;r.style.zoom='1';r.style.setProperty('--ttb-zoom','1');document.getElementById('error-container').style.display='none';})()`);

    // Embedded #settings toggle & layout check
    await popup.evaluate(`document.getElementById('settings-btn').click()`);
    await sleep(150);
    const settingsMetrics = await popup.evaluate(`(()=>{
      const s = document.getElementById('settings');
      const f = document.querySelector('.popup-footer');
      return {
        open: !s.hidden && document.getElementById('mainView').hidden,
        sentIn: document.getElementById('stat-sent-in').textContent,
        readBack: document.getElementById('stat-read-back').textContent,
        settingsBottom: s.getBoundingClientRect().bottom,
        footTop: f.getBoundingClientRect().top
      };
    })()`);
    console.log('popup settings', JSON.stringify(settingsMetrics));
    assert.equal(settingsMetrics.open, true, 'embedded #settings must open on gear click');
    assert.ok(settingsMetrics.settingsBottom <= settingsMetrics.footTop + 0.5, 'settings must not overlap footer');
    await popup.evaluate(`document.getElementById('settings-back-btn').click()`);
    await sleep(100);

    // Composer keyboard & send button behaviour with a stubbed sendMessage
    const key = (init) => popup.evaluate(`(()=>{
      window.__sent = window.__sent ?? [];
      chrome.runtime.sendMessage = (msg) => { if (msg?.action === 'talk/submit') window.__sent.push(msg); };
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

    const btnSent = await popup.evaluate(`(()=>{
      window.__sent = [];
      const t=document.getElementById('talk-input'); t.value='hello';
      document.getElementById('send-btn').click();
      return window.__sent.length;
    })()`);
    assert.equal(btnSent, 1, 'Send button click submits');
  } finally {
    await popup.close();
  }

  // 2. Verify sidepanel.html host semantics & layout
  const sidepanel = await openExtensionPage(`${targetOrigin}/sidepanel.html`);
  try {
    const sp = await sidepanel.evaluate(`(()=>{
      return {
        host: document.documentElement.getAttribute('data-host'),
        pinText: document.getElementById('pin-toggle-text')?.textContent,
        mainBottom: document.querySelector('.popup-main').getBoundingClientRect().bottom,
        footTop: document.querySelector('.popup-footer').getBoundingClientRect().top
      };
    })()`);
    console.log('sidepanel', JSON.stringify(sp));
    assert.equal(sp.host, 'sidepanel', 'sidepanel.html must set data-host="sidepanel"');
    assert.equal(sp.pinText, '取消釘選', 'sidepanel.html must show 取消釘選');
    assert.ok(sp.mainBottom <= sp.footTop + 0.5, 'sidepanel main must not overlap footer');
  } finally {
    await sidepanel.close();
  }

  // 3. Verify options.html in Light & Dark modes
  const options = await openExtensionPage(`${targetOrigin}/options.html`);
  try {
    const optExternal = options.requests.filter((u) => !/^(chrome-extension|data|blob|about):/.test(u));
    assert.deepEqual(optExternal, [], 'options must make no external network request');
    const optText = await options.evaluate(`document.body.innerText`);
    assert.doesNotMatch(optText, /Pip|老大|Roguelike|🦊|v0\.1\.0/, 'options must not display legacy RPG terms');
    assert.match(optText, /Talk To Bro v1\.0\.0/, 'options must display v1.0.0');
    for (const scheme of ['light', 'dark']) {
      await options.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      const bg = await options.evaluate(`getComputedStyle(document.body).backgroundColor`);
      console.log(`options ${scheme} bg=${bg}`);
      assert.equal(bg, scheme === 'light' ? 'rgb(237, 242, 236)' : 'rgb(12, 26, 32)');
    }
  } finally {
    await options.close();
  }

  console.log('PASS');
} catch (e) {
  failed = true;
  console.error('FAIL', e.message);
} finally {
  bws.close();
}
process.exit(failed ? 1 : 0);
