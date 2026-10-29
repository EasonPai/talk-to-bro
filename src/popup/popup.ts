// src/popup/popup.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Talk } from '../shared/types.ts';
import { getFailureInfo } from '../shared/failures.ts';

// Configure marked with GFM support
marked.setOptions({
  gfm: true,
  breaks: true
});

let currentLastTalk: Talk | null = null;
let countdownInterval: any = null;

/**
 * Cancels any active handoff countdown timer.
 */
export function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

/**
 * Starts the 1.5s countdown to copy Talk prompt and switch to Bro Chat.
 */
function startHandoffCountdown(talk: Talk) {
  clearCountdown();

  const handoffNotice = document.getElementById('handoff-notice') as HTMLDivElement | null;
  const countdownText = document.getElementById('countdown-text') as HTMLSpanElement | null;
  const cancelBtn = document.getElementById('cancel-handoff-btn') as HTMLButtonElement | null;

  if (!handoffNotice || !countdownText) return;
  handoffNotice.style.display = 'flex';

  let remainingMs = 1500;
  countdownText.textContent = `Pip 帶你去找老大… (${(remainingMs / 1000).toFixed(1)}s)`;

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      clearCountdown();
      handoffNotice.style.display = 'none';
      if (countdownText) {
        countdownText.textContent = '已取消切換，Talk 內容已保留在輸入框。';
      }

      // 1. Immediately persist cancellation to storage from Popup
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          const res = await chrome.storage.local.get('runtime:v1');
          const rt = res['runtime:v1'];
          if (rt?.lastTalk && rt.lastTalk.id === talk.id) {
            rt.lastTalk.handoff = {
              status: 'cancelled',
              copied: false,
              focused: false
            };
            await chrome.storage.local.set({ 'runtime:v1': rt });
          }
        } catch (err) {
          console.warn('[Popup] Failed to persist cancellation locally:', err);
        }
      }

      // 2. Notify SW to ensure service worker state synchronization
      chrome.runtime.sendMessage({ action: 'handoff/cancel', talkId: talk.id });
    };
  }

  countdownInterval = setInterval(async () => {
    remainingMs -= 100;
    if (remainingMs <= 0) {
      clearCountdown();
      countdownText.textContent = '正在切換至老大分頁…';

      // 1. Copy Talk text using navigator.clipboard
      try {
        await navigator.clipboard.writeText(talk.text);
      } catch (e) {
        console.warn('[Popup] navigator.clipboard write failed:', e);
      }

      // 2. Request SW to switch tab and focus window
      chrome.runtime.sendMessage({
        action: 'handoff/switch_tab',
        talkId: talk.id,
        alreadyCopied: true
      });
    } else {
      countdownText.textContent = `Pip 帶你去找老大… (${(remainingMs / 1000).toFixed(1)}s)`;
    }
  }, 100);
}

/**
 * Renders the state of the last talk into the popup UI.
 */
export function renderTalkState(talk: Talk | null) {
  currentLastTalk = talk;

  const input = document.getElementById('talk-input') as HTMLTextAreaElement | null;
  const counter = document.getElementById('char-counter') as HTMLSpanElement | null;
  const pipMood = document.getElementById('pip-mood') as HTMLSpanElement | null;
  const pipSprite = document.getElementById('pip-sprite') as HTMLSpanElement | null;
  const answerContainer = document.getElementById('answer-container') as HTMLDivElement | null;
  const answerContent = document.getElementById('answer-content') as HTMLDivElement | null;
  const errorContainer = document.getElementById('error-container') as HTMLDivElement | null;
  const errorBadge = document.getElementById('error-badge') as HTMLSpanElement | null;
  const errorMessage = document.getElementById('error-message') as HTMLSpanElement | null;
  const handoffNotice = document.getElementById('handoff-notice') as HTMLDivElement | null;
  const deferredNotice = document.getElementById('deferred-notice') as HTMLDivElement | null;
  const gotoBroBtn = document.getElementById('goto-bro-btn') as HTMLButtonElement | null;

  clearCountdown();

  if (!talk) {
    if (pipMood) pipMood.textContent = '準備替你去找老大...';
    if (pipSprite) pipSprite.textContent = '🦊';
    if (answerContainer) answerContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'none';
    return;
  }

  // Restore input text and character counter
  if (input && talk.text) {
    input.value = talk.text;
    if (counter) {
      counter.textContent = `${talk.text.length} / 300`;
    }
  }

  // Reset containers
  if (answerContainer) answerContainer.style.display = 'none';
  if (errorContainer) errorContainer.style.display = 'none';
  if (handoffNotice) handoffNotice.style.display = 'none';
  if (deferredNotice) deferredNotice.style.display = 'none';

  // Phase handling
  switch (talk.phase) {
    case 'queued':
    case 'resolving_tab':
    case 'sending':
    case 'submitting':
      if (pipMood) pipMood.textContent = 'Pip 正在派發話語給老大...';
      if (pipSprite) pipSprite.textContent = '🦊';
      break;

    case 'waiting':
      if (pipMood) pipMood.textContent = '老大正在思考中...';
      if (pipSprite) pipSprite.textContent = '⏳';
      break;

    case 'extracting':
      if (pipMood) pipMood.textContent = '正在擷取老大的回覆...';
      if (pipSprite) pipSprite.textContent = '📝';
      break;

    case 'done':
      if (pipMood) pipMood.textContent = '老大回話了！';
      if (pipSprite) pipSprite.textContent = '✨';

      if (talk.answerMarkdown && answerContent && answerContainer) {
        const dirtyHtml = marked.parse(talk.answerMarkdown) as string;
        const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
          ADD_ATTR: ['target', 'rel']
        });

        answerContent.innerHTML = cleanHtml;

        // Ensure external links open in new tab securely
        const links = answerContent.querySelectorAll('a');
        links.forEach((a) => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });

        answerContainer.style.display = 'block';
      }
      break;

    case 'failed': {
      const code = talk.failure?.code || 'INTERNAL';
      const info = getFailureInfo(code);

      if (pipMood) pipMood.textContent = info.userMessage;
      if (pipSprite) pipSprite.textContent = info.pipState === 'ignored' ? '💤' : '🙀';

      if (errorContainer) errorContainer.style.display = 'block';
      if (errorBadge) errorBadge.textContent = info.pipMoodName;
      if (errorMessage) errorMessage.textContent = info.userMessage;

      // Handle Handoff display logic
      if (talk.handoff?.status === 'deferred') {
        if (deferredNotice) deferredNotice.style.display = 'flex';
        if (gotoBroBtn) {
          gotoBroBtn.focus();
          gotoBroBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(talk.text);
            } catch (e) {
              console.warn('[Popup] clipboard write failed:', e);
            }
            chrome.runtime.sendMessage({
              action: 'handoff/switch_tab',
              talkId: talk.id,
              alreadyCopied: true
            });
          };
        }
      } else if (talk.handoff?.status === 'cancelled') {
        // User explicitly cancelled; keep prompt in input and do not restart countdown
        if (handoffNotice) {
          handoffNotice.style.display = 'flex';
          const countdownText = document.getElementById('countdown-text');
          if (countdownText) countdownText.textContent = '已取消自動切換，Talk 內容已保留在輸入框。';
          const cancelBtn = document.getElementById('cancel-handoff-btn');
          if (cancelBtn) cancelBtn.style.display = 'none';
        }
      } else if (talk.handoff?.status === 'done' || talk.handoff?.status === 'partial') {
        // Handoff already executed in background
        if (handoffNotice) {
          handoffNotice.style.display = 'flex';
          const countdownText = document.getElementById('countdown-text');
          if (countdownText) countdownText.textContent = 'Talk 內容已複製至剪貼簿。';
          const cancelBtn = document.getElementById('cancel-handoff-btn');
          if (cancelBtn) cancelBtn.style.display = 'none';
        }
      } else {
        // Pending handoff: start 1.5s countdown notice
        startHandoffCountdown(talk);
      }
      break;
    }
  }
}

/**
 * Top-level initialization with robust Error Boundary.
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const input = document.getElementById('talk-input') as HTMLTextAreaElement | null;
    const counter = document.getElementById('char-counter') as HTMLSpanElement | null;
    const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement | null;

    if (input) {
      input.focus();
      setTimeout(() => input.focus(), 50);

      input.addEventListener('input', () => {
        const len = input.value.length;
        if (counter) {
          counter.textContent = `${len} / 300`;
        }
      });

      let isComposing = false;
      input.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      input.addEventListener('compositionend', () => {
        isComposing = false;
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (isComposing || e.isComposing || e.keyCode === 229) {
            return;
          }
          e.preventDefault();

          const rawText = input.value;
          if (rawText.trim().length === 0) return;

          chrome.runtime.sendMessage({ action: 'talk/submit', text: rawText }, (res) => {
            if (res && res.talk) {
              renderTalkState(res.talk);
            }
          });
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        if (!currentLastTalk || !currentLastTalk.answerMarkdown) return;

        try {
          await navigator.clipboard.writeText(currentLastTalk.answerMarkdown);
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '已複製！';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
          }, 1500);
        } catch (err) {
          console.error('[Popup] Failed to copy Markdown answer:', err);
        }
      });
    }

    // Read current state from storage
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get('runtime:v1');
      const runtime = res['runtime:v1'];
      renderTalkState(runtime?.lastTalk || null);

      // Listen for runtime updates
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes['runtime:v1']) {
          renderTalkState(changes['runtime:v1'].newValue?.lastTalk || null);
        }
      });
    }
  } catch (err: any) {
    console.error('[Popup] Top-level initialization error boundary caught:', err);
    const pipMood = document.getElementById('pip-mood');
    if (pipMood) pipMood.textContent = 'Pip 暫時無法讀取狀態，但你仍可在此打字。';
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) {
      errorContainer.style.display = 'block';
      const msg = document.getElementById('error-message');
      if (msg) msg.textContent = '無法讀取本機狀態，請稍後重試。';
    }
  }
});
