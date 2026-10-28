// offscreen.js - Clipboard copy & DOM conversion handler for offscreen document
import { htmlToMarkdown } from './markdown.js';

function copyText(text) {
  try {
    const textarea = document.getElementById('clipboard-textarea');
    if (!textarea) {
      return { ok: false, error: 'clipboard-textarea element not found' };
    }
    textarea.value = text;
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    return { ok: success, method: 'execCommand' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'OFFSCREEN_COPY') {
    const res = copyText(msg.text);
    sendResponse(res);
    return false;
  }
  if (msg.action === 'OFFSCREEN_CONVERT_MARKDOWN') {
    try {
      const md = htmlToMarkdown(msg.html);
      sendResponse({ ok: true, markdown: md });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return false;
  }
  return false;
});

console.log('[Offscreen] Initialized and listening for clipboard & DOM messages.');
