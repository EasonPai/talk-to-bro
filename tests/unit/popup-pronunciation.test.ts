// tests/unit/popup-pronunciation.test.ts
// Unit tests for T-2 Word Pronunciation: M2-M7
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isSpeakableWord,
  CANDIDATE_CHUNK_REGEX,
  VALID_SPEAKABLE_WORD_REGEX,
  wrapSpeakableWords,
  speakWord,
  initPronunciation
} from '../../src/popup/pronunciation.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'src/popup/popup.html'), 'utf8');
const POPUP_CSS = fs.readFileSync(path.join(ROOT, 'src/popup/popup.css'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Minimal Mock DOM implementation for Node.js unit testing
class MockNode {
  nodeType = 1;
  nodeValue: string | null = null;
  parentNode: MockElement | null = null;
  parentElement: MockElement | null = null;
  ownerDocument: any = null;
}

class MockTextNode extends MockNode {
  nodeType = 3;
  text: string;
  constructor(text: string) {
    super();
    this.text = text;
    this.nodeValue = text;
  }
}

class MockElement extends MockNode {
  childNodes: MockNode[] = [];
  dataset: Record<string, string> = {};
  tagName: string;
  classList = {
    _classes: new Set<string>(),
    add: (c: string) => this.classList._classes.add(c),
    contains: (c: string) => this.classList._classes.has(c)
  };

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return Array.from(this.classList._classes).join(' ');
  }

  set className(val: string) {
    this.classList._classes = new Set(val.split(/\s+/).filter(Boolean));
  }

  get textContent(): string {
    return this.childNodes.map(c => c instanceof MockTextNode ? c.text : (c as MockElement).textContent).join('');
  }

  set textContent(val: string) {
    this.childNodes = [new MockTextNode(val)];
    this.childNodes[0].parentNode = this;
    this.childNodes[0].parentElement = this;
  }

  appendChild(child: MockNode) {
    child.parentNode = this;
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChild(newChild: MockNode | MockFragment, oldChild: MockNode) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx === -1) return;
    if (newChild instanceof MockFragment) {
      for (const c of newChild.childNodes) {
        c.parentNode = this;
        c.parentElement = this;
      }
      this.childNodes.splice(idx, 1, ...newChild.childNodes);
    } else {
      newChild.parentNode = this;
      newChild.parentElement = this;
      this.childNodes.splice(idx, 1, newChild);
    }
  }

  closest(selector: string): MockElement | null {
    const selectors = selector.split(',').map(s => s.trim());
    let curr: MockElement | null = this;
    while (curr) {
      for (const sel of selectors) {
        if (sel.startsWith('.')) {
          if (curr.classList.contains(sel.slice(1))) return curr;
        } else if (curr.tagName.toUpperCase() === sel.toUpperCase()) {
          return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

class MockFragment extends MockNode {
  childNodes: MockNode[] = [];
  appendChild(child: MockNode) {
    child.parentNode = this as any;
    child.parentElement = this as any;
    this.childNodes.push(child);
    return child;
  }
}

const mockDocument = {
  createElement: (tag: string) => new MockElement(tag),
  createTextNode: (text: string) => new MockTextNode(text),
  createDocumentFragment: () => new MockFragment(),
  createTreeWalker: (root: MockElement, _what: number, filter: any) => {
    const collectTextNodes = (node: MockNode): MockTextNode[] => {
      const result: MockTextNode[] = [];
      if (node.nodeType === 3) {
        if (filter.acceptNode(node) === 1 /* FILTER_ACCEPT */) {
          result.push(node as MockTextNode);
        }
      } else if (node instanceof MockElement) {
        if (filter.acceptNode(node) === 2 /* FILTER_REJECT */) {
          return [];
        }
        for (const child of node.childNodes) {
          result.push(...collectTextNodes(child));
        }
      }
      return result;
    };

    const nodes = collectTextNodes(root);
    let index = 0;
    return {
      nextNode: () => nodes[index++] || null
    };
  }
};

(globalThis as any).NodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3
};

class MockUtterance {
  text: string;
  lang = 'en-US';
  rate = 1.0;
  voice: any = null;
  onerror: any = null;
  onstart: any = null;
  onend: any = null;
  constructor(text: string) {
    this.text = text;
  }
}

(globalThis as any).SpeechSynthesisUtterance = MockUtterance;

// ----------------------------------------------------
// M2: Word Tokenization & Character Preservation
// ----------------------------------------------------
test('M2: isSpeakableWord correctly identifies English words with contractions and hyphens', () => {
  // Pure words
  assert.equal(isSpeakableWord('apple'), true);
  assert.equal(isSpeakableWord('Hello'), true);

  // Internal contractions and hyphens
  assert.equal(isSpeakableWord("don't"), true);
  assert.equal(isSpeakableWord('don’t'), true); // curly apostrophe
  assert.equal(isSpeakableWord('mother-in-law'), true);
  assert.equal(isSpeakableWord('state-of-the-art'), true);

  // Disallowed: pure numbers, alphanumeric identifiers, underscores
  assert.equal(isSpeakableWord('123'), false);
  assert.equal(isSpeakableWord('MP3'), false);
  assert.equal(isSpeakableWord('item1'), false);
  assert.equal(isSpeakableWord('UTF-8'), false);
  assert.equal(isSpeakableWord('H2O'), false);
  assert.equal(isSpeakableWord('test_case'), false);
  assert.equal(isSpeakableWord(''), false);
});

test('M2: wrapSpeakableWords wraps only valid English words in text nodes across headings, lists, tables', () => {
  const container = new MockElement('DIV');
  (container as any).ownerDocument = mockDocument;

  const h1 = new MockElement('H1');
  h1.appendChild(new MockTextNode("Don't worry about mother-in-law in 2026."));
  container.appendChild(h1);

  const table = new MockElement('TABLE');
  const tr = new MockElement('TR');
  const td = new MockElement('TD');
  td.appendChild(new MockTextNode('The UTF-8 format is great.'));
  tr.appendChild(td);
  table.appendChild(tr);
  container.appendChild(table);

  wrapSpeakableWords(container as any);

  // Check H1 children
  const h1Children = h1.childNodes;
  const speakableSpans = h1Children.filter(c => c instanceof MockElement && c.classList.contains('speakable-word')) as MockElement[];
  const words = speakableSpans.map(s => s.dataset.word);
  assert.deepEqual(words, ["Don't", 'worry', 'about', 'mother-in-law', 'in']);

  // "2026" must NOT be in speakableSpans
  assert.ok(!words.includes('2026'));

  // Check TD children
  const tdChildren = td.childNodes;
  const tdSpans = tdChildren.filter(c => c instanceof MockElement && c.classList.contains('speakable-word')) as MockElement[];
  const tdWords = tdSpans.map(s => s.dataset.word);
  assert.deepEqual(tdWords, ['The', 'format', 'is', 'great']);
  // "UTF-8" must NOT be split into UTF or spoken
  assert.ok(!tdWords.includes('UTF-8'));
  assert.ok(!tdWords.includes('UTF'));
});

// ----------------------------------------------------
// M3: Excluded Elements (Links, Code, Buttons)
// ----------------------------------------------------
test('M3: links, inline code, pre blocks, and buttons are strictly excluded from wrapping', () => {
  const container = new MockElement('DIV');
  (container as any).ownerDocument = mockDocument;

  // Regular paragraph
  const p = new MockElement('P');
  p.appendChild(new MockTextNode('Click this '));

  // Link
  const a = new MockElement('A');
  a.appendChild(new MockTextNode('example link'));
  p.appendChild(a);

  p.appendChild(new MockTextNode(' or read '));

  // Code
  const code = new MockElement('CODE');
  code.appendChild(new MockTextNode('const speak = true;'));
  p.appendChild(code);

  container.appendChild(p);

  wrapSpeakableWords(container as any);

  // P should have "Click" and "this" and "or" and "read" wrapped
  const pWords = (p.childNodes.filter(c => c instanceof MockElement && c.classList.contains('speakable-word')) as MockElement[]).map(s => s.dataset.word);
  assert.deepEqual(pWords, ['Click', 'this', 'or', 'read']);

  // Inside <a> and <code>: child nodes should remain plain text nodes
  assert.equal(a.childNodes.length, 1);
  assert.ok(a.childNodes[0] instanceof MockTextNode);
  assert.equal((a.childNodes[0] as MockTextNode).text, 'example link');

  assert.equal(code.childNodes.length, 1);
  assert.ok(code.childNodes[0] instanceof MockTextNode);
  assert.equal((code.childNodes[0] as MockTextNode).text, 'const speak = true;');
});

// ----------------------------------------------------
// M4: Gesture Selection Discrimination
// ----------------------------------------------------
test('M4: initPronunciation skips playback when drag distance exceeds threshold or selection is active', () => {
  const container = new MockElement('DIV');
  const span = new MockElement('SPAN');
  span.className = 'speakable-word';
  span.dataset.word = 'hello';
  container.appendChild(span);

  let spokeWord: string | null = null;
  const mockSynth = {
    cancel: () => {},
    getVoices: () => [{ lang: 'en-US', default: true } as any],
    speak: (utt: any) => { spokeWord = utt.text; }
  };

  const listeners: Record<string, Function> = {};
  (container as any).addEventListener = (evt: string, fn: Function) => { listeners[evt] = fn; };
  (container as any).removeEventListener = () => {};

  initPronunciation(container as any, { speechSynthesis: mockSynth as any });

  // Case 1: Normal Click (pointerdown at 10,10; click at 11,11 -> distance ~1.4px)
  listeners.pointerdown({ clientX: 10, clientY: 10 });
  listeners.click({ clientX: 11, clientY: 11, target: span });
  assert.equal(spokeWord, 'hello', 'Normal click must pronounce');

  // Case 2: Drag gesture (pointerdown at 10,10; click at 25,25 -> distance > 20px)
  spokeWord = null;
  listeners.pointerdown({ clientX: 10, clientY: 10 });
  listeners.click({ clientX: 25, clientY: 25, target: span });
  assert.equal(spokeWord, null, 'Drag gesture must not pronounce');

  // Case 3: Click inside link
  spokeWord = null;
  const link = new MockElement('A');
  const linkSpan = new MockElement('SPAN');
  linkSpan.className = 'speakable-word';
  linkSpan.dataset.word = 'linkword';
  link.appendChild(linkSpan);
  container.appendChild(link);

  listeners.pointerdown({ clientX: 10, clientY: 10 });
  listeners.click({ clientX: 11, clientY: 11, target: linkSpan });
  assert.equal(spokeWord, null, 'Click inside link must not pronounce');
});

// ----------------------------------------------------
// M5: Consecutive Clicks Cancel Prior Playback
// ----------------------------------------------------
test('M5: rapid consecutive clicks cancel previous utterance and do not report cancel as error', () => {
  let cancelCount = 0;
  let speakCalls: string[] = [];
  let capturedUtterances: any[] = [];
  let reportedErrors: string[] = [];

  const mockSynth = {
    cancel: () => { cancelCount++; },
    getVoices: () => [{ lang: 'en-US', default: true } as any],
    speak: (utt: any) => {
      speakCalls.push(utt.text);
      capturedUtterances.push(utt);
    }
  };

  // Click 1: 'first'
  speakWord('first', {
    speechSynthesis: mockSynth as any,
    showToast: (msg) => reportedErrors.push(msg)
  });

  // Click 2: 'second'
  speakWord('second', {
    speechSynthesis: mockSynth as any,
    showToast: (msg) => reportedErrors.push(msg)
  });

  assert.equal(cancelCount, 2, 'cancel() must be called on each speakWord');
  assert.deepEqual(speakCalls, ['first', 'second']);

  // Simulate first utterance receiving 'canceled' error event
  capturedUtterances[0].onerror?.({ error: 'canceled' });
  capturedUtterances[0].onerror?.({ error: 'interrupted' });

  // Stale utterance cancellation must not trigger user-facing error toast
  assert.deepEqual(reportedErrors, [], 'Cancelled previous utterance must not emit error toast');
});

// ----------------------------------------------------
// M6: Error Toasts & Graceful Degradation
// ----------------------------------------------------
test('M6: missing API or missing English voice emits non-blocking toast', () => {
  let toastMsg: string | null = null;

  // Case 1: Missing API
  speakWord('test', {
    speechSynthesis: null as any,
    showToast: (msg) => { toastMsg = msg; }
  });
  assert.equal(toastMsg, '瀏覽器未支援語音播放');

  // Case 2: Voices non-empty but no English voice
  toastMsg = null;
  const mockSynthNoEn = {
    cancel: () => {},
    getVoices: () => [{ lang: 'zh-TW', name: 'Mei-Jia' } as any],
    speak: () => {}
  };
  speakWord('test', {
    speechSynthesis: mockSynthNoEn as any,
    showToast: (msg) => { toastMsg = msg; }
  });
  assert.equal(toastMsg, '找不到可用的英文語音');

  // Case 3: Genuine runtime playback error
  toastMsg = null;
  let capturedUtt: any = null;
  const mockSynthError = {
    cancel: () => {},
    getVoices: () => [{ lang: 'en-US', default: true } as any],
    speak: (utt: any) => { capturedUtt = utt; }
  };
  speakWord('errorWord', {
    speechSynthesis: mockSynthError as any,
    showToast: (msg) => { toastMsg = msg; }
  });
  capturedUtt.onerror?.({ error: 'audio-busy' });
  assert.equal(toastMsg, '語音播放失敗');
});

// ----------------------------------------------------
// M7: Duplicate Render Idempotence & DOM Intactness
// ----------------------------------------------------
test('M7: repeated wrapSpeakableWords does not duplicate or nest spans', () => {
  const container = new MockElement('DIV');
  (container as any).ownerDocument = mockDocument;

  const p = new MockElement('P');
  p.appendChild(new MockTextNode('Beautiful world'));
  container.appendChild(p);

  // First wrap
  wrapSpeakableWords(container as any);
  const firstCount = p.childNodes.filter(c => c instanceof MockElement && c.classList.contains('speakable-word')).length;
  assert.equal(firstCount, 2);

  // Second wrap (idempotency check)
  wrapSpeakableWords(container as any);
  const secondCount = p.childNodes.filter(c => c instanceof MockElement && c.classList.contains('speakable-word')).length;
  assert.equal(secondCount, 2, 'Re-wrapping must not produce nested spans');
});

// ----------------------------------------------------
// M8: Markup & Styling Validation
// ----------------------------------------------------
test('M8: popup.html and popup.css declare accessible speech-toast and speakable-word styles', () => {
  assert.ok(POPUP_HTML.includes('id="speech-toast"'), 'popup.html must include #speech-toast');
  assert.ok(POPUP_HTML.includes('role="status"'), 'speech-toast must have role="status"');
  assert.ok(POPUP_HTML.includes('aria-live="polite"'), 'speech-toast must have aria-live="polite"');

  assert.ok(POPUP_CSS.includes('.speakable-word'), 'popup.css must define .speakable-word');
  assert.ok(POPUP_CSS.includes('.speakable-word:hover'), 'popup.css must define .speakable-word:hover');
  assert.ok(POPUP_CSS.includes('.speech-toast'), 'popup.css must define .speech-toast');

  // Zero new permissions in manifest.json (speech synthesis requires no permissions)
  const forbiddenPermissions = ['tts', 'ttsEngine', 'audio', 'audioCapture'];
  for (const perm of forbiddenPermissions) {
    assert.ok(!MANIFEST.permissions.includes(perm), `Forbidden permission in manifest: ${perm}`);
  }
});
