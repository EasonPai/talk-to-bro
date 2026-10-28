// adapter.js - Gemini DOM Adapter for M0-A Spike
(() => {
  // Prevent duplicate registration in the same context
  if (window.__TTB_ADAPTER_LOADED__) return;
  window.__TTB_ADAPTER_LOADED__ = true;

  const SELECTORS = {
    editor: [
      'rich-textarea .ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[name="chat-input"]',
      '#mock-editor'
    ],
    sendButton: [
      'button.send-button:not(.stop)',
      'button[aria-label*="Send" i]',
      'button[aria-label*="傳送"]',
      '#mock-send-btn'
    ],
    stopButton: [
      'button.send-button.stop',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="停止"]',
      '#mock-stop-btn'
    ],
    userTurn: [
      'user-query',
      '.user-query',
      '[data-turn-type="user"]'
    ],
    userTurnText: [
      '.query-text',
      'user-query-content',
      '.query-content'
    ],
    modelTurn: [
      'model-response',
      '.model-response',
      '[data-turn-type="model"]'
    ],
    modelBody: [
      'message-content .markdown',
      '.model-response-text .markdown',
      '.model-body-content'
    ],
    modelDone: [
      'message-actions',
      '.response-footer',
      '.model-done-actions'
    ],
    signIn: [
      'a[href*="ServiceLogin"]',
      'a[href*="accounts.google.com"][href*="signin" i]'
    ]
  };

  function q(selectorKey) {
    const list = SELECTORS[selectorKey] || [];
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function qa(selectorKey) {
    const list = SELECTORS[selectorKey] || [];
    for (const sel of list) {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) return Array.from(els);
    }
    return [];
  }

  function normalizeText(str) {
    return (str || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  function markBaselines() {
    const userTurns = qa('userTurn');
    const modelTurns = qa('modelTurn');
    userTurns.forEach(el => el.setAttribute('data-ttb-seen', '1'));
    modelTurns.forEach(el => el.setAttribute('data-ttb-seen', '1'));
    return { userTurnCount: userTurns.length, modelTurnCount: modelTurns.length };
  }

  async function checkReady() {
    if (q('signIn')) {
      return { ok: false, code: 'NOT_SIGNED_IN' };
    }
    const editor = q('editor');
    if (!editor) {
      return { ok: false, code: 'INPUT_NOT_FOUND' };
    }
    const stopBtn = q('stopButton');
    if (stopBtn && getComputedStyle(stopBtn).display !== 'none') {
      return { ok: false, code: 'BRO_BUSY' };
    }
    return { ok: true };
  }

  async function insertAndSend(text) {
    const editor = q('editor');
    if (!editor) {
      return { ok: false, error: 'Editor not found' };
    }

    markBaselines();

    // Step A: Focus & execCommand insertText
    let inserted = false;
    try {
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = document.execCommand('insertText', false, text);
    } catch (e) {
      inserted = false;
    }

    // Step B fallback: innerHTML + InputEvent
    if (!inserted || normalizeText(editor.innerText) !== normalizeText(text)) {
      if (editor.tagName.toLowerCase() === 'textarea') {
        editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        editor.innerHTML = `<p>${text}</p>`;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }

    // Verify insertion
    const currentText = editor.tagName.toLowerCase() === 'textarea' ? editor.value : editor.innerText;
    if (normalizeText(currentText) !== normalizeText(text)) {
      return { ok: false, error: 'Verification failed: editor text does not match' };
    }

    // Wait for send button enabled (up to 3 seconds)
    const startTime = Date.now();
    let sendBtn = null;
    while (Date.now() - startTime < 3000) {
      sendBtn = q('sendButton');
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (!sendBtn || sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
      // Fallback: Enter key event
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } else {
      sendBtn.click();
    }

    // Wait for new user turn to appear (up to 5 seconds)
    const waitUserTurnStart = Date.now();
    let verifiedUserTurn = false;
    while (Date.now() - waitUserTurnStart < 5000) {
      const allUserTurns = qa('userTurn');
      const newTurns = allUserTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
      if (newTurns.length > 0) {
        const latest = newTurns[newTurns.length - 1];
        const textEl = latest.querySelector(SELECTORS.userTurnText.join(',')) || latest;
        if (normalizeText(textEl.textContent).includes(normalizeText(text))) {
          verifiedUserTurn = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      ok: verifiedUserTurn,
      userTurnVerified: verifiedUserTurn,
      timestamp: Date.now()
    };
  }

  function probe() {
    const editor = q('editor');
    if (!editor) {
      return {
        page: q('signIn') ? 'signed_out' : 'loading',
        turn: 'not_found',
        generating: false,
        textLength: 0,
        visibility: document.visibilityState
      };
    }

    const stopBtn = q('stopButton');
    const isGenerating = Boolean(stopBtn && getComputedStyle(stopBtn).display !== 'none');

    // Find the latest model-response without data-ttb-seen
    const modelTurns = qa('modelTurn');
    const newModelTurns = modelTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
    const activeModelTurn = newModelTurns.length > 0 ? newModelTurns[newModelTurns.length - 1] : null;

    let textLen = 0;
    let hasDoneAction = false;

    if (activeModelTurn) {
      const body = activeModelTurn.querySelector(SELECTORS.modelBody.join(',')) || activeModelTurn;
      textLen = (body.textContent || '').length;

      const doneEl = activeModelTurn.querySelector(SELECTORS.modelDone.join(','));
      hasDoneAction = Boolean(doneEl && getComputedStyle(doneEl).display !== 'none');
    }

    let turnState = 'not_found';
    if (activeModelTurn) {
      if (isGenerating) {
        turnState = 'streaming';
      } else if (hasDoneAction && textLen > 0) {
        turnState = 'complete';
      } else if (textLen > 0) {
        turnState = 'streaming';
      } else {
        turnState = 'pending';
      }
    }

    return {
      page: 'ready',
      turn: turnState,
      generating: isGenerating,
      textLength: textLen,
      hasDoneAction: hasDoneAction,
      visibility: document.visibilityState,
      timestamp: Date.now()
    };
  }

  function extract() {
    const modelTurns = qa('modelTurn');
    const newModelTurns = modelTurns.filter(el => el.getAttribute('data-ttb-seen') !== '1');
    const targetTurn = newModelTurns.length > 0 ? newModelTurns[newModelTurns.length - 1] : null;
    if (!targetTurn) return { text: '', length: 0 };
    const body = targetTurn.querySelector(SELECTORS.modelBody.join(',')) || targetTurn;
    return {
      text: body.textContent || '',
      length: (body.textContent || '').length
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'TTB_CHECK_READY') {
      checkReady().then(sendResponse);
      return true;
    }
    if (msg.action === 'TTB_INSERT_AND_SEND') {
      insertAndSend(msg.text).then(sendResponse);
      return true;
    }
    if (msg.action === 'TTB_PROBE') {
      sendResponse(probe());
      return false;
    }
    if (msg.action === 'TTB_EXTRACT') {
      sendResponse(extract());
      return false;
    }
  });

  console.log('[TTB Adapter] Injected and initialized successfully.');
})();
