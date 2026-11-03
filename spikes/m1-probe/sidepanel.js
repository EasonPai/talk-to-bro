// spikes/m1-probe/sidepanel.js
const draftInput = document.getElementById('draft-input');
const unpinBtn = document.getElementById('unpin-btn');
const logEl = document.getElementById('log');

function log(msg) {
  console.log('[SidePanel]', msg);
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

unpinBtn.addEventListener('click', async () => {
  log('Unpin button clicked');
  const t0 = performance.now();
  const currentDraft = draftInput.value;
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const windowId = currentWindow.id;
    log(`Current windowId: ${windowId}`);

    // Step 1: Ensure popup URL is restored on action
    await new Promise((resolve) => {
      chrome.action.setPopup({ popup: 'popup.html' }, resolve);
    });
    log('action.setPopup restored to popup.html');

    // Step 2: Inform SW of mode switch
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SET_MODE_POPUP',
        draft: currentDraft,
        timestamp: Date.now()
      }, resolve);
    });
    log('Mode updated to popup');

    // Step 3: Open Popup
    let openPopupOk = false;
    let openPopupError = null;
    let openPopupDurationMs = 0;
    try {
      const tOpenStart = performance.now();
      await chrome.action.openPopup({ windowId });
      openPopupDurationMs = performance.now() - tOpenStart;
      log(`action.openPopup succeeded in ${openPopupDurationMs.toFixed(1)}ms`);
      openPopupOk = true;
    } catch (err) {
      log(`action.openPopup failed: ${err.message}`);
      openPopupError = err.message;
    }

    // Step 4: Write result to storage BEFORE closing the side panel frame!
    await chrome.storage.local.set({
      m1_path2_result: {
        openPopupOk,
        openPopupError,
        openPopupDurationMs,
        draft: currentDraft,
        timestamp: Date.now()
      }
    });
    log('m1_path2_result saved to storage');

    // Step 5: Close Side Panel
    log('Now calling sidePanel.close...');
    try {
      await chrome.sidePanel.close({ windowId });
      log('sidePanel.close returned');
    } catch (err) {
      log(`sidePanel.close error: ${err.message}`);
      await chrome.storage.local.set({
        m1_path2_close_error: err.message
      });
    }
  } catch (err) {
    log(`Error in unpin: ${err.message}`);
    await chrome.storage.local.set({
      m1_path2_result: {
        success: false,
        error: err.message,
        timestamp: Date.now()
      }
    });
  }
});
