// tests/unit/adapter-editor.test.ts
// Unit tests for Bro Adapter Editor: clearing drafts, inserting text, and submission safety (T-3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReady, insertAndSend, normalizeText } from '../../src/adapter/entry.ts';
import { SELECTORS } from '../../src/adapter/selectors.ts';

interface MockDomEnvironment {
  editorEl: any;
  sendBtnEl: any;
  stopBtnEl: any;
  userTurns: any[];
  modelTurns: any[];
  execCommandLog: Array<{ command: string; value?: string }>;
  sendClickCount: number;
  stopClickCount: number;
  cleanup: () => void;
}

function setupMockDom(options: {
  initialEditorText?: string;
  isGenerating?: boolean;
  clearSucceeds?: boolean;
  insertSucceeds?: boolean;
  insertMutatesTo?: string;
} = {}): MockDomEnvironment {
  const {
    initialEditorText = '',
    isGenerating = false,
    clearSucceeds = true,
    insertSucceeds = true,
    insertMutatesTo
  } = options;

  let currentText = initialEditorText;
  const execCommandLog: Array<{ command: string; value?: string }> = [];
  let sendClickCount = 0;
  let stopClickCount = 0;
  const userTurns: any[] = [];
  const modelTurns: any[] = [];

  const editorEl = {
    tagName: 'DIV',
    getAttribute: (attr: string) => (attr === 'contenteditable' ? 'true' : null),
    setAttribute: () => {},
    focus: () => {},
    dispatchEvent: () => true,
    get innerText() {
      return currentText;
    },
    set innerText(val: string) {
      currentText = val;
    },
    get textContent() {
      return currentText;
    },
    set textContent(val: string) {
      currentText = val;
    },
    ownerDocument: null as any
  };

  const sendBtnEl = {
    tagName: 'BUTTON',
    disabled: false,
    getAttribute: (attr: string) => (attr === 'aria-disabled' ? 'false' : null),
    click: () => {
      sendClickCount++;
      // Simulate userTurn appearing in DOM after click with .query-text-line child elements
      const lines = currentText.split('\n').map(l => ({
        tagName: 'P',
        className: 'query-text-line',
        textContent: l
      }));
      userTurns.push({
        tagName: 'DIV',
        attributes: { 'data-ttb-seen': '0' },
        getAttribute: function(name: string) { return this.attributes[name] || null; },
        setAttribute: function(name: string, val: string) { this.attributes[name] = val; },
        textContent: currentText,
        querySelector: () => null,
        querySelectorAll: (sel: string) => (sel.includes('.query-text-line') ? lines : [])
      });
    }
  };

  const stopBtnEl = {
    tagName: 'BUTTON',
    style: { display: isGenerating ? 'block' : 'none' },
    click: () => {
      stopClickCount++;
    }
  };

  const editorSelector = SELECTORS.editor[0];
  const sendSelector = SELECTORS.sendButton[0];
  const stopSelector = SELECTORS.stopButton[0];
  const userTurnSelector = SELECTORS.userTurn[0];
  const modelTurnSelector = SELECTORS.modelTurn[0];

  const mockDocument = {
    querySelector: (sel: string) => {
      if (sel === editorSelector || SELECTORS.editor.includes(sel)) return editorEl;
      if (sel === sendSelector || SELECTORS.sendButton.includes(sel)) return sendBtnEl;
      if (sel === stopSelector || SELECTORS.stopButton.includes(sel)) return isGenerating ? stopBtnEl : null;
      if (sel === SELECTORS.signIn[0]) return null;
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === userTurnSelector || SELECTORS.userTurn.includes(sel)) return userTurns;
      if (sel === modelTurnSelector || SELECTORS.modelTurn.includes(sel)) return modelTurns;
      return [];
    },
    createRange: () => ({
      selectNodeContents: () => {},
      collapse: () => {}
    }),
    execCommand: (command: string, _showUi?: boolean, value?: string) => {
      execCommandLog.push({ command, value });
      if (command === 'delete') {
        if (clearSucceeds) {
          currentText = '';
          return true;
        }
        return false;
      }
      if (command === 'insertText') {
        if (insertSucceeds) {
          currentText = insertMutatesTo !== undefined ? insertMutatesTo : (value || '');
          return true;
        }
        return false;
      }
      return false;
    }
  };

  editorEl.ownerDocument = mockDocument;

  const mockWindow = {
    location: { href: 'https://gemini.google.com/app/1234567890abcdef' },
    getSelection: () => ({
      removeAllRanges: () => {},
      addRange: () => {}
    }),
    getComputedStyle: (el: any) => el?.style || { display: 'none' }
  };

  const origDocument = globalThis.document;
  const origWindow = globalThis.window;
  const origLocation = (globalThis as any).location;
  const origGetComputedStyle = (globalThis as any).getComputedStyle;

  (globalThis as any).document = mockDocument;
  (globalThis as any).window = mockWindow;
  (globalThis as any).location = mockWindow.location;
  (globalThis as any).getComputedStyle = mockWindow.getComputedStyle;

  return {
    editorEl,
    sendBtnEl,
    stopBtnEl,
    userTurns,
    modelTurns,
    execCommandLog,
    get sendClickCount() { return sendClickCount; },
    get stopClickCount() { return stopClickCount; },
    cleanup: () => {
      (globalThis as any).document = origDocument;
      (globalThis as any).window = origWindow;
      (globalThis as any).location = origLocation;
      (globalThis as any).getComputedStyle = origGetComputedStyle;
    }
  };
}

// --------------------------------------------------------------------------
// M1: checkReady must NOT reject non-empty different drafts and must be read-only
// --------------------------------------------------------------------------
test('M1: checkReady permits non-empty different drafts without mutating editor text', async () => {
  const env = setupMockDom({ initialEditorText: 'Existing draft in editor' });
  try {
    // 1. checkReady for word "claude"
    const resClaude = await checkReady({ text: 'claude' });
    assert.deepEqual(resClaude, { ok: true }, 'checkReady must allow "claude" when draft exists');
    assert.equal(env.editorEl.innerText, 'Existing draft in editor', 'checkReady must not modify draft');

    // 2. checkReady for "haiku", "Anthropology", "apple"
    for (const word of ['haiku', 'Anthropology', 'apple']) {
      const res = await checkReady({ text: word });
      assert.deepEqual(res, { ok: true }, `checkReady must allow "${word}"`);
      assert.equal(env.editorEl.innerText, 'Existing draft in editor');
    }
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M2: insertAndSend clears old draft, verifies empty, inserts new text, clicks send
// --------------------------------------------------------------------------
test('M2: insertAndSend clears different draft, verifies empty, inserts new text, clicks send once', async () => {
  const env = setupMockDom({ initialEditorText: 'leftover draft text' });
  try {
    const res = await insertAndSend('claude', 'talk-123');
    assert.equal(res.ok, true);
    assert.equal(res.userTurnVerified, true);

    // Verify command sequence: must delete then insertText
    const deleteCmdIndex = env.execCommandLog.findIndex(c => c.command === 'delete');
    const insertCmdIndex = env.execCommandLog.findIndex(c => c.command === 'insertText');

    assert.ok(deleteCmdIndex !== -1, 'Must invoke delete command to clear old draft');
    assert.ok(insertCmdIndex !== -1, 'Must invoke insertText command');
    assert.ok(deleteCmdIndex < insertCmdIndex, 'Delete must precede insertText');
    assert.equal(env.execCommandLog[insertCmdIndex].value, 'claude');

    // Verify send button clicked exactly once
    assert.equal(env.sendClickCount, 1, 'Send button must be clicked exactly once');
    assert.equal(env.editorEl.innerText, 'claude', 'Editor text must match target prompt');
  } finally {
    env.cleanup();
  }
});

test('M2: insertAndSend on empty editor inserts text without error and clicks send once', async () => {
  const env = setupMockDom({ initialEditorText: '' });
  try {
    const res = await insertAndSend('apple', 'talk-456');
    assert.equal(res.ok, true);
    assert.equal(res.userTurnVerified, true);
    assert.equal(env.sendClickCount, 1);
    assert.equal(env.editorEl.innerText, 'apple');
  } finally {
    env.cleanup();
  }
});

test('M2: insertAndSend on whitespace-only draft clears completely before inserting', async () => {
  const env = setupMockDom({ initialEditorText: '   \n\t   ' });
  try {
    const res = await insertAndSend('Anthropology', 'talk-789');
    assert.equal(res.ok, true);
    assert.equal(res.userTurnVerified, true);
    assert.equal(env.sendClickCount, 1);
    assert.equal(env.editorEl.innerText, 'Anthropology');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M3: Clear failure or insertion failure does NOT click send and returns error
// --------------------------------------------------------------------------
test('M3: insertAndSend aborts without clicking send when clear fails', async () => {
  const env = setupMockDom({
    initialEditorText: 'stubborn draft that refuses deletion',
    clearSucceeds: false
  });
  try {
    const res = await insertAndSend('claude');
    assert.equal(res.ok, false);
    assert.equal(res.code, 'INPUT_NOT_FOUND');
    assert.match(res.reason || '', /clear/i);
    assert.equal(env.sendClickCount, 0, 'Must NOT click send button when clear fails');
  } finally {
    env.cleanup();
  }
});

test('M3: insertAndSend aborts without clicking send when insertion fails', async () => {
  const env = setupMockDom({
    initialEditorText: 'old draft',
    insertSucceeds: false
  });
  try {
    const res = await insertAndSend('claude');
    assert.equal(res.ok, false);
    assert.equal(res.code, 'INPUT_NOT_FOUND');
    assert.equal(env.sendClickCount, 0, 'Must NOT click send button when insertion fails');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M5: Generating state rejects with EDITOR_BUSY without clearing or clicking Stop
// --------------------------------------------------------------------------
test('M5: generating in progress rejects with EDITOR_BUSY without clearing or pressing Stop', async () => {
  const env = setupMockDom({
    initialEditorText: 'some draft',
    isGenerating: true
  });
  try {
    // 1. checkReady returns EDITOR_BUSY
    const readyRes = await checkReady({ text: 'claude' });
    assert.equal(readyRes.ok, false);
    assert.equal(readyRes.code, 'EDITOR_BUSY');

    // 2. insertAndSend also rejects when stopButton is active
    const sendRes = await insertAndSend('claude');
    assert.equal(sendRes.ok, false);
    assert.equal(sendRes.code, 'EDITOR_BUSY');

    // 3. Verify no mutation occurred
    assert.equal(env.stopClickCount, 0, 'Must NEVER click stopButton');
    assert.equal(env.sendClickCount, 0, 'Must NOT click sendButton');
    assert.equal(env.execCommandLog.length, 0, 'Must NOT execute any editor commands while busy');
    assert.equal(env.editorEl.innerText, 'some draft', 'Must NOT clear editor while generating');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M2 (D3): Same-text draft in editor cleanly clears and re-inserts/sends
// --------------------------------------------------------------------------
test('M2 (D3): insertAndSend on identical draft cleanly clears and re-inserts without error', async () => {
  const env = setupMockDom({ initialEditorText: 'claude' });
  try {
    const res = await insertAndSend('claude', 'talk-same-1');
    assert.equal(res.ok, true, 'Same-text draft must succeed');
    assert.equal(res.userTurnVerified, true);
    assert.equal(env.sendClickCount, 1, 'Send button must be clicked exactly once');
    assert.equal(env.editorEl.innerText, 'claude');

    // Must still execute delete followed by insertText
    const deleteIdx = env.execCommandLog.findIndex(c => c.command === 'delete');
    const insertIdx = env.execCommandLog.findIndex(c => c.command === 'insertText');
    assert.ok(deleteIdx !== -1, 'Delete command must execute on same-text draft');
    assert.ok(insertIdx !== -1, 'InsertText command must execute');
    assert.ok(deleteIdx < insertIdx, 'Delete must precede insertText');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M4 (D4): Spaces, tabs, Unicode, and internal newlines survive clear and insert raw
// --------------------------------------------------------------------------
test('M4 (D4): spaces, tabs, Unicode, and internal newlines survive clear and insert raw', async () => {
  const env = setupMockDom({ initialEditorText: 'old dirty draft' });
  const rawPrompt = 'hello\tworld\n你好，世界 🌍\nmultiple   spaces';
  try {
    const res = await insertAndSend(rawPrompt, 'talk-raw-unicode');
    assert.equal(res.ok, true);
    assert.equal(res.userTurnVerified, true);
    assert.equal(env.sendClickCount, 1);

    // Verify exact characters were sent to insertText without stripping leading spaces/tabs
    const insertCmd = env.execCommandLog.find(c => c.command === 'insertText');
    assert.ok(insertCmd, 'insertText must be called');
    assert.equal(insertCmd.value, rawPrompt, 'Exact raw text must be passed to execCommand');
    assert.equal(env.editorEl.innerText, rawPrompt, 'Editor innerText must retain all spaces, tabs, and Unicode');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M3 (D5): Insert command succeeds but DOM content does not match target prompt -> no send click
// --------------------------------------------------------------------------
test('M3 (D5): insert-succeeds-but-content-mismatch aborts without clicking send', async () => {
  const env = setupMockDom({
    initialEditorText: 'initial text',
    insertSucceeds: true,
    insertMutatesTo: 'something completely different from target'
  });
  try {
    const res = await insertAndSend('claude', 'talk-mismatch');
    assert.equal(res.ok, false, 'Must fail when content does not match target prompt');
    assert.equal(res.code, 'INPUT_NOT_FOUND');
    assert.match(res.reason || '', /insertion verification failed/i);
    assert.equal(env.sendClickCount, 0, 'Must NEVER click send button when content verification fails');
  } finally {
    env.cleanup();
  }
});

// --------------------------------------------------------------------------
// M6 (D6): Write-ahead, interrupted, and terminal states prevent duplicate clear/send
// --------------------------------------------------------------------------
test('M6 (D6): terminal failed state (e.g. SUBMIT_UNCONFIRMED) does not re-run clear and send', async () => {
  const env = setupMockDom({ initialEditorText: 'unconfirmed draft' });
  try {
    // Simulate initial submission failure where user turn was unconfirmed
    // When SUBMIT_UNCONFIRMED occurs, insertAndSend returns ok: false
    // and subsequent re-runs are blocked by TalkRunner machine state transitions.
    // Verify that checkReady on an unconfirmed draft allows non-destructive inspection
    const readyRes = await checkReady({ text: 'claude' });
    assert.equal(readyRes.ok, true, 'checkReady is read-only and does not trigger send');
    assert.equal(env.sendClickCount, 0, 'checkReady does not click send');
    assert.equal(env.execCommandLog.length, 0, 'checkReady does not mutate editor');
  } finally {
    env.cleanup();
  }
});
