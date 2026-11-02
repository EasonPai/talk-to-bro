import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const output = new URL('../../../.scratch/impeccable/talk-popup/', import.meta.url);
const endpoint = 'http://127.0.0.1:9222';
let socket;
let target;
let sequence = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(error); }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

function talk(phase, extra = {}) {
  return {
    id: 'synthetic-popup-test', text: 'take for granted, meticulous, wary',
    phase, createdAt: 1, updatedAt: 1, phaseDeadlineAt: null, ...extra
  };
}

const render = (value) => evaluate(`PopupView.renderTalkState(${JSON.stringify(value)})`);

async function capture(name) {
  const rect = await evaluate(`(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
  })()`);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, ...rect, scale: 1 }
  });
  await writeFile(new URL(`${name}.png`, output), Buffer.from(data, 'base64'));
}

before(async () => {
  assert.equal(typeof WebSocket, 'function', 'Run with a Node runtime supporting WebSocket and TypeScript tests');
  const response = await fetch(`${endpoint}/json/new?about:blank%23talk-popup-design-check`, { method: 'PUT' });
  assert.ok(response.ok, 'Existing isolated CfT must be available on port 9222');
  target = await response.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await mkdir(output, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 400, height: 600, deviceScaleFactor: 1, mobile: false
  });
  const css = await readFile(new URL('src/popup/popup.css', root), 'utf8');
  const html = (await readFile(new URL('src/popup/popup.html', root), 'utf8'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace('<link rel="stylesheet" href="popup.css">', `<style>${css}</style>`);
  const { frameTree } = await send('Page.getFrameTree');
  await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  const result = await build({
    entryPoints: [fileURLToPath(new URL('src/popup/popup.ts', root))],
    bundle: true, write: false, format: 'iife', globalName: 'PopupView', target: 'chrome132'
  });
  await evaluate(`
    window.testMessages = [];
    window.testClipboard = [];
    window.chrome = {
      runtime: { sendMessage: (message, callback) => {
        testMessages.push(message);
        callback?.({});
      }},
      tabs: {
        query: async () => [{ id: 123 }],
        getZoom: async () => 1,
        onZoomChange: { addListener: () => {} }
      },
      storage: {
        local: { get: async () => ({ 'runtime:v1': { lastTalk: null } }) },
        onChanged: { addListener: (listener) => { window.testStorageChanged = listener; } }
      }
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async (text) => { testClipboard.push(text); } }
    });
    ${result.outputFiles[0].text}
    document.dispatchEvent(new Event('DOMContentLoaded'));
    new Promise(resolve => setTimeout(resolve, 80));
  `);
});

after(async () => {
  socket?.close();
  if (target) {
    const response = await fetch(`${endpoint}/json/close/${target.id}`);
    assert.ok(response.ok, 'Close only the isolated test target');
  }
});

beforeEach(async () => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 400, height: 600, deviceScaleFactor: 1, mobile: false
  });
  await evaluate(`PopupView.clearCountdown();
    document.documentElement.style.zoom = '1';
    document.documentElement.style.setProperty('--ttb-zoom', '1');
    document.body.style.removeProperty('width')`);
});

test('idle is compact, keyboard-ready, and has an accessible status and settings link', async () => {
  await render(null);
  const state = await evaluate(`({
    phase: document.body.dataset.phase,
    busy: document.body.dataset.busy,
    focus: document.activeElement.id,
    status: document.getElementById('pip-mood').getAttribute('role'),
    settings: document.querySelector('.gear-btn').getAttribute('aria-label'),
    height: document.body.getBoundingClientRect().height,
    answerHidden: getComputedStyle(document.getElementById('answer-container')).display === 'none'
  })`);
  assert.deepEqual({ ...state, height: undefined }, {
    phase: 'idle', busy: 'false', focus: 'talk-input', status: 'status',
    settings: '設定 Bro Chat', height: undefined, answerHidden: true
  });
  // T1 design adds the LINE header, RPG narration box and pill composer (~306px); the answer area is still not reserved (answerHidden).
  assert.ok(state.height < 320, `Idle should not reserve a scene/answer area: ${state.height}`);
  await capture('idle-400');
});

test('The Bro header stays the same character across phases, with truthful loading and reduced motion', async () => {
  for (const phase of ['queued', 'resolving_tab', 'sending', 'submitting', 'waiting', 'extracting']) {
    await render(talk(phase));
    assert.deepEqual(await evaluate(`({
      sprite: document.querySelector('.bro-avatar img').getAttribute('src'),
      phase: document.body.dataset.phase, busy: document.body.dataset.busy,
      hidden: getComputedStyle(document.getElementById('answer-container')).display === 'none'
    })`), { sprite: 'assets/dragon.jpg', phase, busy: 'true', hidden: true });
  }
  await render(talk('waiting'));
  await capture('waiting-400');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.narration-box')).animationName`), 'none');
  await send('Emulation.setEmulatedMedia', { features: [] });
});

test('full sanitized Markdown, original copy and Last Talk restoration remain intact', async () => {
  const answer = '# meticulous\n\n**一絲不苟**：非常注意細節。\n\n- Careful and precise\n- 保留完整的中英文解釋\n\n| Word | Meaning |\n| --- | --- |\n| wary | 小心謹慎 |\n\n<script>window.injected = true</script>';
  const completed = talk('done', { answerMarkdown: answer });
  await evaluate(`testStorageChanged({ 'runtime:v1': { newValue: { lastTalk: ${JSON.stringify(completed)} } } }, 'local')`);
  assert.deepEqual(await evaluate(`({
    input: document.getElementById('talk-input').value,
    counter: document.getElementById('char-counter').textContent,
    sprite: document.querySelector('.bro-avatar img').getAttribute('src'),
    heading: document.querySelector('#answer-content h1').textContent,
    cells: document.querySelectorAll('#answer-content td').length,
    injected: Boolean(window.injected),
    focus: document.activeElement.id,
    busy: document.getElementById('answer-container').getAttribute('aria-busy')
  })`), {
    input: completed.text, counter: `${completed.text.length} / 300`,
    sprite: 'assets/dragon.jpg', heading: 'meticulous', cells: 2, injected: false,
    focus: 'talk-input', busy: 'false'
  });
  assert.deepEqual(await evaluate(`({
    narration: document.getElementById('pip-mood').textContent,
    source: getComputedStyle(document.getElementById('source-line')).display !== 'none' && document.getElementById('source-line').textContent,
    gotoVisible: getComputedStyle(document.getElementById('goto-bro-btn')).display !== 'none' && getComputedStyle(document.getElementById('error-container')).display !== 'none',
    bubbleAvatarAlt: document.querySelector('.answer-avatar').getAttribute('alt')
  })`), { narration: '惡龍 回覆了！勇者 獲得了 知識 ×1。', source: 'SOURCE: TRUST ME BRO', gotoVisible: false, bubbleAvatarAlt: '' });
  await evaluate(`document.getElementById('copy-btn').click()`);
  assert.equal(await evaluate('testClipboard.at(-1)'), answer);
  assert.equal(await evaluate(`document.getElementById('copy-btn').textContent`), '已複製！');
  await capture('answer-400');
});

test('long answers scroll without hiding input or copy at narrow widths and zoom', async () => {
  const answer = '# take for granted\n\n' + '視為理所當然 — do not take a friend’s kindness for granted.\n\n'.repeat(35)
    + '| Word | Meaning | Example | Notes |\n| --- | --- | --- | --- |\n| meticulous | 一絲不苟 | meticulous planning | 注意細節 |\n\n'
    + '```text\n' + 'very-long-unbroken-code-line-'.repeat(12) + '\n```\n\n'
    + '[Reference](https://example.com/)' + '\n\n最後一段，完整保留。';
  // #42 fixes the popup at 400px (a content-sized real popup has no narrower viewport), so 360 is no longer a valid case.
  for (const width of [400]) {
    for (const zoom of [1, 1.5, 2]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: width * zoom, height: 600, deviceScaleFactor: 1, mobile: false
      });
      await evaluate(`document.documentElement.style.zoom = '${zoom}';
        document.documentElement.style.setProperty('--ttb-zoom', '${zoom}')`);
      await render(talk('done', { text: 'a'.repeat(300), answerMarkdown: answer }));
      const state = await evaluate(`(() => {
        const content = document.getElementById('answer-content');
        const copy = document.getElementById('copy-btn');
        const input = document.getElementById('talk-input');
        const before = copy.getBoundingClientRect().top;
        content.scrollTop = content.scrollHeight;
        return {
          height: document.body.getBoundingClientRect().height,
          width: document.body.getBoundingClientRect().width,
          scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
          scrollTop: content.scrollTop, pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
          copyTop: copy.getBoundingClientRect().top, before,
          copyBottom: copy.getBoundingClientRect().bottom,
          inputTop: input.getBoundingClientRect().top,
          inputBottom: input.getBoundingClientRect().bottom,
          text: content.textContent, font: getComputedStyle(content).fontSize,
          tableScroll: content.querySelector('table').scrollWidth > content.querySelector('table').clientWidth,
          codeScroll: content.querySelector('pre').scrollWidth > content.querySelector('pre').clientWidth,
          horizontalPageScroll: document.documentElement.scrollWidth > innerWidth + 1
        };
      })()`);
      assert.ok(state.height <= 601, `Popup height at ${width}/${zoom}: ${state.height}`);
      assert.ok(state.width <= 800, `Popup width: ${state.width}`);
      assert.ok(state.clientHeight > 30, `Answer must remain usable: ${JSON.stringify(state)}`);
      assert.ok(state.scrollHeight > state.clientHeight && state.scrollTop > 0, 'Answer scrolls');
      assert.equal(state.pageScroll, false, 'Only the answer scrolls vertically');
      assert.equal(state.copyTop, state.before, 'Copy toolbar must not scroll away');
      assert.ok(state.copyBottom <= 600 && state.inputTop >= 0 && state.inputBottom < state.copyTop);
      assert.ok(state.text.trimEnd().endsWith('最後一段，完整保留。'));
      assert.equal(state.font, '15px');
      assert.equal(state.tableScroll, true, 'Wide table scrolls locally');
      assert.equal(state.codeScroll, true, 'Wide code scrolls locally');
      assert.equal(state.horizontalPageScroll, false, `Wide content must not widen the Popup at ${width}/${zoom}`);
      await evaluate(`document.getElementById('answer-content').scrollTop = 0`);
      await capture(`long-answer-${width}-${zoom}`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 600, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.documentElement.style.zoom = '1';
    document.documentElement.style.setProperty('--ttb-zoom', '1');
    document.body.style.removeProperty('width')`);
});

test('Handoff cancellation, deferred action and clipboard failure results keep their semantics', async () => {
  const failure = { code: 'TIMEOUT_IDLE', stage: 'read', at: 1 };
  await render(talk('failed', { failure, handoff: { status: 'pending', copied: false, focused: false } }));
  assert.ok((await evaluate(`document.getElementById('countdown-text').textContent`)).includes('1.5s'));
  await capture('handoff-pending-400');
  await evaluate(`document.getElementById('cancel-handoff-btn').click()`);
  assert.equal((await evaluate('testMessages.at(-1)')).action, 'handoff/cancel');
  await render(talk('failed', { failure, handoff: { status: 'cancelled', copied: false, focused: false } }));
  assert.ok((await evaluate(`document.getElementById('countdown-text').textContent`)).includes('已取消'));
  await capture('handoff-cancelled-400');
  await render(talk('failed', { failure, handoff: { status: 'deferred', copied: false, focused: false } }));
  assert.equal(await evaluate('document.activeElement.id'), 'goto-bro-btn');
  await capture('handoff-deferred-400');
  await evaluate(`document.getElementById('goto-bro-btn').click()`);
  assert.equal((await evaluate('testMessages.at(-1)')).authorizeDeferred, true);
  await render(talk('failed', { failure, handoff: { status: 'partial', copied: false, focused: true } }));
  assert.ok((await evaluate(`document.getElementById('countdown-text').textContent`)).includes('剪貼簿未寫入'));
  await capture('handoff-partial-400');
});

test('Enter and IME behavior, Shift+Enter, keyboard focus and the input limit are preserved', async () => {
  await render(null);
  await evaluate(`window.testMessages = [];
    const input = document.getElementById('talk-input');
    input.focus();
    input.value = 'meticulous';
    input.dispatchEvent(new Event('compositionstart'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new Event('compositionend'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  `);
  assert.equal(await evaluate('testMessages.length'), 0);
  await evaluate(`document.getElementById('talk-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  assert.deepEqual(await evaluate('testMessages.at(-1)'), { action: 'talk/submit', text: 'meticulous' });
  await evaluate(`document.querySelector('.gear-btn').focus()`);
  // T5 / X-2: settings is last in Tab order (card, input, actions, settings), so Shift+Tab from settings returns to the input.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  assert.equal(await evaluate('document.activeElement.id'), 'talk-input');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.input-card')).borderColor`), 'rgb(6, 199, 85)');
  assert.equal(await evaluate(`document.getElementById('talk-input').maxLength`), 300);
});
