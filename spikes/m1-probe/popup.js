// spikes/m1-probe/popup.js
const draftInput = document.getElementById('draft-input');
const pinBtn = document.getElementById('pin-btn');
const logEl = document.getElementById('log');

function log(msg) {
  console.log('[Popup]', msg);
  logEl.textContent += `[${new Date().toISOString()}] ${msg}\n`;
}

// Restore state
chrome.storage.local.get(['draft'], (data) => {
  if (data.draft) {
    draftInput.value = data.draft;
    log('Restored draft: ' + data.draft);
  }
});

draftInput.addEventListener('input', () => {
  chrome.storage.local.set({ draft: draftInput.value });
});

pinBtn.addEventListener('click', async () => {
  log('Pin button clicked');
  const t0 = performance.now();
  const currentDraft = draftInput.value;
  try {
    // 1. Get current window
    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;
    log(`Current windowId: ${windowId}`);

    // 2. Direct call to sidePanel.open (preserves user gesture context)
    const tOpenStart = performance.now();
    await chrome.sidePanel.open({ windowId });
    const tOpenEnd = performance.now();
    log(`sidePanel.open succeeded in ${(tOpenEnd - tOpenStart).toFixed(1)}ms`);

    // 3. Inform SW to update mode and routing
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SET_MODE_SIDEPANEL',
        draft: currentDraft,
        timestamp: Date.now()
      }, resolve);
    });
    log('Mode switched to sidepanel');

    // Record probe success in storage
    await chrome.storage.local.set({
      m1_path1_result: {
        success: true,
        windowId,
        openDurationMs: tOpenEnd - tOpenStart,
        totalDurationMs: performance.now() - t0,
        timestamp: Date.now()
      }
    });

    // 4. Close popup
    log('Closing popup window...');
    setTimeout(() => window.close(), 500);
  } catch (err) {
    log(`Error in pin: ${err.message}`);
    await chrome.storage.local.set({
      m1_path1_result: {
        success: false,
        error: err.message,
        timestamp: Date.now()
      }
    });
  }
});
