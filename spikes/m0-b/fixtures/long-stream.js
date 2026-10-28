// long-stream.js - Configurable long streaming fixture for M0-B Spike
(() => {
  const editor = document.querySelector('.ql-editor');
  const sendBtn = document.querySelector('#mock-send-btn');
  const stopBtn = document.querySelector('#mock-stop-btn');
  const history = document.querySelector('#history');
  const stats = document.querySelector('#stats');

  const params = new URLSearchParams(window.location.search);
  const chunkCount = parseInt(params.get('chunks') || '30', 10);
  const chunkDelayMs = parseInt(params.get('delay') || '100', 10);

  let totalChunksRendered = 0;
  let activeStreamCancel = null;

  function updateStats() {
    stats.textContent = `Visibility: ${document.visibilityState} | Chunks: ${totalChunksRendered}/${chunkCount}`;
  }

  document.addEventListener('visibilitychange', updateStats);

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
    const userTurn = document.createElement('user-query');
    userTurn.innerHTML = `<div class="query-text">${escapeHtml(userText)}</div>`;
    history.appendChild(userTurn);

    editor.innerHTML = '';
    sendBtn.disabled = true;

    const modelTurn = document.createElement('model-response');
    modelTurn.innerHTML = `<message-content><div class="markdown"></div></message-content>`;
    history.appendChild(modelTurn);

    const markdownDiv = modelTurn.querySelector('.markdown');

    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';

    let cancelled = false;
    activeStreamCancel = () => { cancelled = true; };

    for (let i = 0; i < chunkCount; i++) {
      if (cancelled) break;
      markdownDiv.textContent += `[Token #${i + 1}] Analyzing "${userText}": Nuance step ${i + 1} verifies continuous streaming updates.\n`;
      totalChunksRendered++;
      updateStats();
      history.scrollTop = history.scrollHeight;
      await nonThrottledDelay(chunkDelayMs);
    }

    if (!cancelled) {
      stopBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
      sendBtn.disabled = true;

      const actions = document.createElement('message-actions');
      actions.innerHTML = `<span class="response-footer">Long stream output completed (${chunkCount} chunks)</span>`;
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
  console.log(`[Long Stream Fixture] Ready with chunks=${chunkCount}, delay=${chunkDelayMs}ms.`);
})();
