// src/offscreen/clipboard.ts
// Offscreen Document clipboard helper (MV3 fallback when popup is closed)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'OFFSCREEN_COPY') {
    const text = msg.text || '';
    const textarea = document.getElementById('clipboard-target') as HTMLTextAreaElement | null;
    if (!textarea) {
      sendResponse({ ok: false, error: 'Textarea not found' });
      return true;
    }

    textarea.value = text;
    textarea.select();
    const success = document.execCommand('copy');
    sendResponse({ ok: success, method: 'execCommand', length: text.length });
    return true;
  }
  return false;
});
