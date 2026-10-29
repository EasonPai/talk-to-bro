// src/popup/popup.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Talk } from '../shared/types.ts';

// Configure marked with GFM support
marked.setOptions({
  gfm: true,
  breaks: true
});

let currentLastTalk: Talk | null = null;

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

  if (!talk) {
    if (pipMood) pipMood.textContent = '準備替你去找老大...';
    if (pipSprite) pipSprite.textContent = '🦊';
    if (answerContainer) answerContainer.style.display = 'none';
    return;
  }

  // Restore input text and character counter
  if (input && talk.text) {
    input.value = talk.text;
    if (counter) {
      counter.textContent = `${talk.text.length} / 300`;
    }
  }

  // Phase handling
  switch (talk.phase) {
    case 'queued':
    case 'resolving_tab':
    case 'sending':
    case 'submitting':
      if (pipMood) pipMood.textContent = 'Pip 正在派發話語給老大...';
      if (pipSprite) pipSprite.textContent = '🦊';
      if (answerContainer) answerContainer.style.display = 'none';
      break;

    case 'waiting':
      if (pipMood) pipMood.textContent = '老大正在思考中...';
      if (pipSprite) pipSprite.textContent = '⏳';
      if (answerContainer) answerContainer.style.display = 'none';
      break;

    case 'extracting':
      if (pipMood) pipMood.textContent = '正在擷取老大的回覆...';
      if (pipSprite) pipSprite.textContent = '📝';
      if (answerContainer) answerContainer.style.display = 'none';
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

    case 'failed':
      if (pipMood) {
        const errCode = talk.failure?.code || 'UNKNOWN';
        pipMood.textContent = `找老大失敗 (${errCode})`;
      }
      if (pipSprite) pipSprite.textContent = '⚠️';
      if (answerContainer) answerContainer.style.display = 'none';
      break;
  }
}

/**
 * Initializes the popup DOM listeners and storage synchronization.
 */
document.addEventListener('DOMContentLoaded', async () => {
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
      if (e.isComposing || isComposing || e.keyCode === 229) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const rawText = input.value;
        if (rawText && rawText.trim().length > 0) {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ action: 'talk/submit', text: rawText });
          }
        }
      }
    });
  }

  // AC4: One-Click Copy raw Markdown directly from currentLastTalk.answerMarkdown
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!currentLastTalk?.answerMarkdown) return;

      try {
        await navigator.clipboard.writeText(currentLastTalk.answerMarkdown);
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '已複製！';
        copyBtn.classList.add('copied');

        setTimeout(() => {
          copyBtn.textContent = originalText || '一鍵複製';
          copyBtn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('[Popup] Copy failed:', err);
      }
    });
  }

  // AC5: Restore Last Talk state from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get('runtime:v1');
      if (data && data['runtime:v1']) {
        renderTalkState(data['runtime:v1'].lastTalk);
      }
    } catch (err) {
      console.warn('[Popup] Failed to read runtime storage:', err);
    }

    // Dynamic state synchronization
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes['runtime:v1']) {
        const runtime = changes['runtime:v1'].newValue;
        if (runtime) {
          renderTalkState(runtime.lastTalk);
        }
      }
    });
  }
});
