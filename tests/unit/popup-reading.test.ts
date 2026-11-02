// tests/unit/popup-reading.test.ts
// Unit tests for T-popover-reading: M1-M5, M7, S1
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Talk } from '../../src/shared/types.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');

function createDoneTalk(text: string, answerMarkdown: string, id = 'test-talk-1'): Talk {
  return {
    id,
    text,
    phase: 'done',
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    sentAt: Date.now() - 8000,
    phaseDeadlineAt: null,
    answerMarkdown
  };
}

function createMockEnvironment() {
  const root = {
    style: {
      setProperty: (_k: string, _v: string) => {},
      getPropertyValue: (_k: string) => '1',
      zoom: '1'
    }
  };
  const body = {
    dataset: {} as Record<string, string>,
    classList: {
      add: (c: string) => { body.classes.add(c); },
      remove: (c: string) => { body.classes.delete(c); }
    },
    classes: new Set<string>(),
    style: {
      width: '',
      removeProperty: (p: string) => { if (p === 'width') body.style.width = ''; }
    }
  };
  const toggleBtn = {
    style: { display: 'none' },
    attributes: {} as Record<string, string>,
    textContent: '展開閱讀',
    setAttribute: (k: string, v: string) => { toggleBtn.attributes[k] = v; },
    getAttribute: (k: string) => toggleBtn.attributes[k],
    focus: () => {}
  };
  const answerContainer = {
    style: { display: 'none' },
    attributes: {} as Record<string, string>,
    setAttribute: (k: string, v: string) => { answerContainer.attributes[k] = v; }
  };
  const answerContent = {
    innerHTML: '',
    querySelectorAll: () => [],
    children: [] as any[],
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    scrollTop: 0
  };
  const talkInput = {
    value: '',
    focus: () => {},
    readOnly: false,
    attributes: {} as Record<string, string>,
    removeAttribute: (k: string) => { delete talkInput.attributes[k]; },
    setAttribute: (k: string, v: string) => { talkInput.attributes[k] = v; }
  };
  const popupMain = {
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    scrollTop: 0
  };

  const doc = {
    body,
    documentElement: root,
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id: string) => {
      if (id === 'reading-toggle-btn') return toggleBtn;
      if (id === 'answer-container') return answerContainer;
      if (id === 'answer-content') return answerContent;
      if (id === 'talk-input') return talkInput;
      return null;
    },
    querySelector: (s: string) => {
      if (s === '.popup-main') return popupMain;
      if (s === '.popup-container') return { style: { removeProperty: () => {} }, dataset: {} };
      return null;
    }
  };

  const win = {
    screen: { availWidth: 1440, width: 1440 },
    innerHeight: 600,
    innerWidth: 400
  };

  return { root, body, toggleBtn, answerContainer, answerContent, talkInput, popupMain, doc, win };
}

test('popup.html contains reading-toggle-btn with correct ARIA attributes', () => {
  assert.match(POPUP_HTML, /<button\s+id="reading-toggle-btn"[^>]*class="reading-toggle-btn"/);
  assert.match(POPUP_HTML, /aria-expanded="false"/);
  assert.match(POPUP_HTML, /aria-controls="answer-content"/);
  assert.match(POPUP_HTML, />展開閱讀<\/button>/);
});

test('M1: reading-toggle-btn only appears for done state with answerMarkdown and toggles correctly', async () => {
  const env = createMockEnvironment();
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).document = env.doc;
  (globalThis as any).window = env.win;

  try {
    const popup = await import('../../src/popup/popup.ts');

    // 1. Idle state -> no toggle button
    popup.renderTalkState(null);
    assert.equal(env.toggleBtn.style.display, 'none');

    // 2. Waiting state -> no toggle button
    popup.renderTalkState({
      id: 'talk-waiting',
      text: 'hello',
      phase: 'waiting',
      createdAt: 1,
      updatedAt: 1,
      phaseDeadlineAt: null
    });
    assert.equal(env.toggleBtn.style.display, 'none');

    // 3. Done state with answerMarkdown -> toggle button shown
    const doneTalk = createDoneTalk('hello', '# Answer\n\nFull details here.');
    popup.renderTalkState(doneTalk);
    assert.equal(env.toggleBtn.style.display, 'inline-block');
    assert.equal(env.toggleBtn.textContent, '展開閱讀');
    assert.equal(env.toggleBtn.attributes['aria-expanded'], 'false');

    // 4. Toggle reading mode -> expanded
    popup.toggleReadingMode();
    assert.equal(popup.getReadingMode(), true);
    assert.equal(env.toggleBtn.textContent, '收起');
    assert.equal(env.toggleBtn.attributes['aria-expanded'], 'true');

    // 5. Toggle reading mode again -> compact
    popup.toggleReadingMode();
    assert.equal(popup.getReadingMode(), false);
    assert.equal(env.toggleBtn.textContent, '展開閱讀');
    assert.equal(env.toggleBtn.attributes['aria-expanded'], 'false');
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  }
});

test('M2: redraw of same Talk preserves readingMode; new Talk resets to compact', async () => {
  const env = createMockEnvironment();
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).document = env.doc;
  (globalThis as any).window = env.win;

  try {
    const popup = await import('../../src/popup/popup.ts');

    const talk1 = createDoneTalk('hello', '# Answer 1', 'talk-1');
    popup.renderTalkState(talk1);

    // Enter reading mode
    popup.toggleReadingMode();
    assert.equal(popup.getReadingMode(), true);

    // Redraw same talk (e.g. storage event) -> maintains reading mode
    popup.renderTalkState({ ...talk1, updatedAt: talk1.updatedAt + 1000 });
    assert.equal(popup.getReadingMode(), true);
    assert.equal(env.toggleBtn.textContent, '收起');

    // Different talk arrives -> resets to compact
    const talk2 = createDoneTalk('world', '# Answer 2', 'talk-2');
    popup.renderTalkState(talk2);
    assert.equal(popup.getReadingMode(), false);
    assert.equal(env.toggleBtn.textContent, '展開閱讀');
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  }
});

test('M3: draft in input is preserved across reading mode toggles with zero storage calls', async () => {
  const env = createMockEnvironment();
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).document = env.doc;
  (globalThis as any).window = env.win;

  try {
    const popup = await import('../../src/popup/popup.ts');

    const talk = createDoneTalk('query', '# Answer', 'talk-draft-test');
    popup.renderTalkState(talk);

    // User types into input
    env.talkInput.value = 'user draft preserved';

    // Toggle reading mode
    popup.toggleReadingMode();
    assert.equal(env.talkInput.value, 'user draft preserved');

    // Toggle back
    popup.toggleReadingMode();
    assert.equal(env.talkInput.value, 'user draft preserved');
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  }
});

test('S1: scroll anchor captures first visible child and restores position', async () => {
  const env = createMockEnvironment();
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).document = env.doc;
  (globalThis as any).window = env.win;

  const child0 = {
    getBoundingClientRect: () => ({ top: -100, bottom: -10, height: 90 }),
    offsetTop: 0,
    offsetHeight: 90
  };
  const child1 = {
    getBoundingClientRect: () => ({ top: -10, bottom: 80, height: 90 }),
    offsetTop: 90,
    offsetHeight: 90
  };
  const child2 = {
    getBoundingClientRect: () => ({ top: 80, bottom: 170, height: 90 }),
    offsetTop: 180,
    offsetHeight: 90
  };

  env.answerContent.children = [child0, child1, child2];

  try {
    const popup = await import('../../src/popup/popup.ts');

    // In compact mode, child1 crosses the top (bottom 80 > top 0 + 2)
    popup.setReadingMode(false);
    const anchor = popup.captureScrollAnchor();
    assert.ok(anchor);
    assert.equal(anchor.index, 1);
    assert.ok(anchor.ratio >= 0 && anchor.ratio <= 1);

    // Restore in reading mode: target is child1
    popup.setReadingMode(true);
    popup.restoreScrollAnchor(anchor);
    assert.ok(env.answerContent.scrollTop >= child1.offsetTop);
  } finally {
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
  }
});
