// spikes/m1-probe/sw.js
console.log('[SW] Service worker evaluated at', new Date().toISOString());

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SW] onInstalled');
});

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[SW] action.onClicked on tab', tab.id, 'window', tab.windowId);
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log('[SW] action.onClicked successfully opened sidePanel');
  } catch (err) {
    console.error('[SW] action.onClicked failed to open sidePanel:', err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[SW] onMessage received:', msg);
  if (msg.type === 'SET_MODE_SIDEPANEL') {
    // When mode is sidepanel, clear default popup so action click triggers action.onClicked
    chrome.action.setPopup({ popup: '' }, () => {
      chrome.storage.local.set({ mode: 'sidepanel', draft: msg.draft || '' }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }
  if (msg.type === 'SET_MODE_POPUP') {
    chrome.action.setPopup({ popup: 'popup.html' }, () => {
      chrome.storage.local.set({ mode: 'popup', draft: msg.draft || '' }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }
  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(['mode', 'draft'], (data) => {
      sendResponse(data);
    });
    return true;
  }
});
