// mock-gemini.js - Simulates Gemini Bro Chat streaming and DOM updates
(() => {
  const editor = document.querySelector('.ql-editor');
  const sendBtn = document.querySelector('#mock-send-btn');
  const stopBtn = document.querySelector('#mock-stop-btn');
  const history = document.querySelector('#history');
  const stats = document.querySelector('#stats');

  let hiddenCount = 0;
  let totalChunksRendered = 0;
  let activeStreamCancel = null;

  function updateStats() {
    stats.textContent = `Visibility: ${document.visibilityState} | Chunks: ${totalChunksRendered} | Hidden Events: ${hiddenCount}`;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenCount++;
    }
    updateStats();
  });

  // Non-throttled delay for background tabs using MessageChannel
  function nonThrottledDelay(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      function tick() {
        if (performance.now() - start >= ms) {
          resolve();
        } else {
          const channel = new MessageChannel();
          channel.port1.onmessage = tick;
          channel.port2.postMessage(null);
        }
      }
      tick();
    });
  }

  editor.addEventListener('input', () => {
    const text = (editor.innerText || '').trim();
    if (text.length > 0) {
      sendBtn.disabled = false;
      sendBtn.removeAttribute('aria-disabled');
    } else {
      sendBtn.disabled = true;
      sendBtn.setAttribute('aria-disabled', 'true');
    }
  });

  async function startStreamingResponse(userText) {
    // 1. Append user turn
    const userTurn = document.createElement('user-query');
    userTurn.innerHTML = `<div class="query-text">${escapeHtml(userText)}</div>`;
    history.appendChild(userTurn);

    // 2. Clear editor
    editor.innerHTML = '';
    sendBtn.disabled = true;

    // 3. Append model turn
    const modelTurn = document.createElement('model-response');
    modelTurn.innerHTML = `<message-content><div class="markdown"></div></message-content>`;
    history.appendChild(modelTurn);

    const markdownDiv = modelTurn.querySelector('.markdown');

    // 4. Show Stop button, hide Send button
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';

    // 5. Generate simulated Bro translation / vocabulary response in chunks
    const simulatedResponse = [
      `### 老大解析：${userText}\n\n`,
      `**核心語意與語境（Nuance & Usage）：**\n`,
      `- 詞性：名詞 / 形容詞（依句構而定）\n`,
      `- 定義：指在特定語境中表現出的高度精確性、連貫性與專業水準。\n\n`,
      `**例句對照：**\n`,
      `1. *The engineer maintained a meticulous approach throughout the implementation phase.*\n`,
      `   （工程師在整個實作階段保持著一絲不苟的嚴謹態度。）\n`,
      `2. *A coherent strategy guarantees resilience under background tab throttling.*\n`,
      `   （連貫一致的策略能確保在背景分頁節流下依然具備韌性。）\n\n`,
      `**小結（Pip 筆記）：** 老大特別強調此詞在技術寫作中極為常見，建議熟記搭配名詞如 *approach*, *attention*, *design*。\n`
    ];

    let cancelled = false;
    activeStreamCancel = () => { cancelled = true; };

    for (let chunkIdx = 0; chunkIdx < simulatedResponse.length; chunkIdx++) {
      if (cancelled) break;
      markdownDiv.textContent += simulatedResponse[chunkIdx];
      totalChunksRendered++;
      updateStats();
      history.scrollTop = history.scrollHeight;
      // Delay 100ms per chunk (unaffected by Chrome background timer throttling)
      await nonThrottledDelay(100);
    }

    if (!cancelled) {
      // Finished streaming
      stopBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
      sendBtn.disabled = true;

      // Append message-actions (modelDone signal)
      const actions = document.createElement('message-actions');
      actions.innerHTML = `<span>👍 滿意</span><span>👎 不滿意</span><span>📋 複製</span><span class="response-footer">Model output completed</span>`;
      modelTurn.appendChild(actions);

      activeStreamCancel = null;
      updateStats();
    }
  }

  sendBtn.addEventListener('click', () => {
    const text = (editor.innerText || '').trim();
    if (!text) return;
    startStreamingResponse(text);
  });

  stopBtn.addEventListener('click', () => {
    if (activeStreamCancel) {
      activeStreamCancel();
      activeStreamCancel = null;
      stopBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
      sendBtn.disabled = true;
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
  }

  updateStats();
  console.log('[Mock Gemini] Initialized successfully with non-throttled streaming engine.');
})();
