// src/popup/popup.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Talk } from '../shared/types.ts';
import { followActiveTabZoom, applyPopupLayout } from './zoom.ts';
import { sendViewOf, hudOf, formatSentTime, failureViewOf, previousSummaryOf, submitOutcomeOf, draftActionOf, isTalkBusy, shouldFocusInput, type PreviousSummary } from './view-state.ts';
import { wrapSpeakableWords, initPronunciation, speakWord } from './pronunciation.ts';
export { wrapSpeakableWords, initPronunciation, speakWord };

let speechToastTimer: any = null;
export function showSpeechToast(message: string): void {
  const toast = document.getElementById('speech-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  if (speechToastTimer !== null) {
    clearTimeout(speechToastTimer);
  }
  speechToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 200);
    speechToastTimer = null;
  }, 2200);
}

// Configure marked with GFM support
marked.setOptions({
  gfm: true,
  breaks: true
});

function sanitizeHtml(dirtyHtml: string): string {
  try {
    if (typeof (DOMPurify as any)?.sanitize === 'function') {
      return (DOMPurify as any).sanitize(dirtyHtml, { ADD_ATTR: ['target', 'rel'] });
    }
    if (typeof DOMPurify === 'function' && typeof window !== 'undefined') {
      const instance = (DOMPurify as any)(window);
      if (typeof instance?.sanitize === 'function') {
        return instance.sanitize(dirtyHtml, { ADD_ATTR: ['target', 'rel'] });
      }
    }
  } catch {
    // Sanitization failure must never return un-sanitized dirty markup
  }
  return '';
}

let currentLastTalk: Talk | null = null;
// Whether the previous render showed an in-flight Talk; lets this popup see busy-to-terminal once.
let wasBusy = false;
// T5: lives only in this popup document; never written to storage.
let previousSummary: PreviousSummary | null = null;
let countdownInterval: any = null;
let hudInterval: any = null;

// Local reading mode state (T-popover-reading)
let readingMode = false;

export function getReadingMode(): boolean {
  return readingMode;
}

export function setReadingMode(mode: boolean): void {
  readingMode = mode;
  updateReadingModeUI();
}

export interface ScrollAnchor {
  index: number;
  ratio: number;
}

export function captureScrollAnchor(): ScrollAnchor | null {
  const answerContent = document.getElementById('answer-content');
  if (!answerContent || !answerContent.children.length) return null;
  const isReading = readingMode;
  const scroller = isReading ? answerContent : (document.querySelector('.popup-main') as HTMLElement);
  if (!scroller) return null;

  const scrollerTop = scroller.getBoundingClientRect().top;
  const children = Array.from(answerContent.children) as HTMLElement[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const rect = child.getBoundingClientRect();
    if (rect.bottom > scrollerTop + 2) {
      const offset = scrollerTop - rect.top;
      const ratio = rect.height > 0 ? Math.max(0, Math.min(1, offset / rect.height)) : 0;
      return { index: i, ratio };
    }
  }
  return { index: 0, ratio: 0 };
}

export function restoreScrollAnchor(anchor: ScrollAnchor | null) {
  if (!anchor || typeof document === 'undefined') return;
  const answerContent = document.getElementById('answer-content');
  if (!answerContent || !answerContent.children.length) return;
  const isReading = readingMode;
  const scroller = isReading ? answerContent : (document.querySelector('.popup-main') as HTMLElement);
  if (!scroller) return;

  const children = Array.from(answerContent.children) as HTMLElement[];
  const idx = Math.max(0, Math.min(anchor.index, children.length - 1));
  const target = children[idx];
  if (!target) return;

  const applyScroll = () => {
    if (typeof document === 'undefined') return;
    if (isReading) {
      scroller.scrollTop = target.offsetTop + (anchor.ratio * target.offsetHeight);
    } else {
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const diff = targetRect.top - scrollerRect.top;
      scroller.scrollTop += (diff + (anchor.ratio * target.offsetHeight));
    }
  };

  applyScroll();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(applyScroll);
  }
}

export function updateReadingModeUI() {
  if (typeof document === 'undefined') return;
  const toggleBtn = document.getElementById('reading-toggle-btn') as HTMLButtonElement | null;
  const canRead = currentLastTalk?.phase === 'done' && !!currentLastTalk?.answerMarkdown;

  if (toggleBtn) {
    toggleBtn.style.display = canRead ? 'inline-block' : 'none';
    toggleBtn.setAttribute('aria-expanded', String(readingMode && canRead));
    toggleBtn.textContent = (readingMode && canRead) ? '收起' : '展開閱讀';
  }

  if (document.documentElement) {
    applyPopupLayout(document.documentElement, readingMode && canRead);
  }
  scheduleFit();
}

export function toggleReadingMode(): void {
  if (!currentLastTalk || currentLastTalk.phase !== 'done' || !currentLastTalk.answerMarkdown) return;
  const anchor = captureScrollAnchor();
  readingMode = !readingMode;
  updateReadingModeUI();
  restoreScrollAnchor(anchor);
  const toggleBtn = document.getElementById('reading-toggle-btn');
  toggleBtn?.focus();
}

function clearHudTimer() {
  if (hudInterval) {
    clearInterval(hudInterval);
    hudInterval = null;
  }
}

function setHidden(id: string, hidden: boolean) {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

/** Display-only: bubble, 已讀, typing dots and HUD for states 2a/2b. */
function paintSendView(talk: Talk | null, now: number) {
  const view = sendViewOf(talk);
  setHidden('chat-view', view.kind === 'none');
  if (view.kind === 'none' || !talk) return;
  const bubble = document.getElementById('chat-bubble');
  if (bubble) bubble.textContent = talk.text;
  setHidden('chat-receipt', !view.readReceipt);
  const sent = document.getElementById('chat-sent-time');
  if (sent) sent.textContent = view.sentAt === null ? '' : formatSentTime(view.sentAt);
  setHidden('chat-typing', !view.typing);
  const hud = hudOf(talk, now);
  setHidden('hud', hud === null);
  if (hud) {
    for (const [key, m] of [['patience', hud.patience], ['silence', hud.silence]] as const) {
      const fill = document.getElementById(`hud-${key}-fill`);
      if (fill) fill.style.width = `${Math.round(m.ratio * 100)}%`;
      const label = document.getElementById(`hud-${key}-label`);
      if (label) label.textContent = m.label;
    }
  }
}

function startHudTimer(talk: Talk) {
  clearHudTimer();
  hudInterval = setInterval(() => paintSendView(talk, Date.now()), 1000);
}

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
  countdownText.textContent = `勇者帶你去找惡龍… (${(remainingMs / 1000).toFixed(1)}s)`;

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      clearCountdown();
      handoffNotice.style.display = 'none';
      if (countdownText) {
        countdownText.textContent = '已取消切換，Talk 內容已保留在輸入框。';
      }

      // Notify SW to persist cancellation state (Single-Writer architecture)
      chrome.runtime.sendMessage({ action: 'handoff/cancel', talkId: talk.id });
    };
  }

  countdownInterval = setInterval(async () => {
    remainingMs -= 100;
    if (remainingMs <= 0) {
      clearCountdown();
      countdownText.textContent = '正在切換至惡龍分頁…';

      // 1. Copy Talk text using navigator.clipboard
      let copiedOk = false;
      try {
        await navigator.clipboard.writeText(talk.text);
        copiedOk = true;
      } catch (e) {
        console.warn('[Popup] navigator.clipboard write failed:', e);
        copiedOk = false;
      }

      // 2. Request SW to switch tab and focus window
      chrome.runtime.sendMessage({
        action: 'handoff/switch_tab',
        talkId: talk.id,
        alreadyCopied: copiedOk
      });
    } else {
      countdownText.textContent = `勇者帶你去找惡龍… (${(remainingMs / 1000).toFixed(1)}s)`;
    }
  }, 100);
}

let fitTimer: any = null;
// The browser may cap the popup below 600px (small window or screen). When the container is still taller than the settled viewport,
// cap it to the viewport so the chat area scrolls internally instead of the document.
function scheduleFit() {
  if (typeof document === 'undefined') return;
  const box = document.querySelector('.popup-container') as HTMLElement | null;
  if (!box) return;
  box.style.removeProperty('--ttb-max-h');
  delete box.dataset.capped;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const zoom = parseFloat(document.documentElement.style.getPropertyValue('--ttb-zoom')) || 1;
    if (box.getBoundingClientRect().height > window.innerHeight + 1) {
      box.style.setProperty('--ttb-max-h', `${window.innerHeight / zoom}px`);
      box.dataset.capped = 'true';
    }
  }, 250);
}

function paintPreviousCard(expanded: boolean) {
  const card = document.getElementById('previous-card');
  const detail = document.getElementById('previous-detail');
  if (!card || !detail) return;
  if (!previousSummary) {
    card.hidden = true;
    detail.hidden = true;
    card.setAttribute('aria-expanded', 'false');
    return;
  }
  const label = document.getElementById('previous-label');
  if (label) label.textContent = `📖 冒險之書・上一則 ${formatSentTime(previousSummary.at)}「${previousSummary.text}」`;
  const text = document.getElementById('previous-text');
  if (text) text.textContent = previousSummary.text;
  const answer = document.getElementById('previous-answer');
  if (answer) {
    answer.textContent = previousSummary.answerLines?.join('\n') ?? '';
    answer.hidden = !previousSummary.answerLines;
  }
  card.hidden = false;
  detail.hidden = !expanded;
  card.setAttribute('aria-expanded', String(expanded));
  scheduleFit();
}

export function submitPreviousSummary(prev: Talk | null) {
  previousSummary = previousSummaryOf(prev);
  paintPreviousCard(false);
}

/**
 * Renders the state of the last talk into the popup UI.
 */
export function renderTalkState(talk: Talk | null) {
  // If talk changed or is no longer done with an answer, reset reading mode
  if (!talk || talk.id !== currentLastTalk?.id || talk.phase !== 'done' || !talk.answerMarkdown) {
    readingMode = false;
  }

  currentLastTalk = talk;
  scheduleFit();
  const phase = talk?.phase ?? 'idle';
  document.body.dataset.phase = phase;
  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'failed';
  document.body.dataset.busy = String(busy);

  const input = document.getElementById('talk-input') as HTMLTextAreaElement | null;
  const counter = document.getElementById('char-counter') as HTMLSpanElement | null;
  const pipMood = document.getElementById('pip-mood') as HTMLSpanElement | null;
  const answerContainer = document.getElementById('answer-container') as HTMLDivElement | null;
  answerContainer?.setAttribute('aria-busy', String(busy));
  const answerContent = document.getElementById('answer-content') as HTMLDivElement | null;
  const errorContainer = document.getElementById('error-container') as HTMLDivElement | null;
  const errorBadge = document.getElementById('error-badge') as HTMLSpanElement | null;
  const errorMessage = document.getElementById('error-message') as HTMLSpanElement | null;
  const handoffNotice = document.getElementById('handoff-notice') as HTMLDivElement | null;
  const deferredNotice = document.getElementById('deferred-notice') as HTMLDivElement | null;
  const gotoBroBtn = document.getElementById('goto-bro-btn') as HTMLButtonElement | null;

  // readOnly (not disabled) keeps the field in the Tab order and readable by screen readers.
  if (input) {
    input.readOnly = busy;
    if (busy) input.setAttribute('aria-disabled', 'true');
    else input.removeAttribute('aria-disabled');
  }

  clearCountdown();
  clearHudTimer();
  setHidden('source-line', phase !== 'done');
  paintSendView(talk, Date.now());
  if (sendViewOf(talk).kind === 'reading' && talk) startHudTimer(talk);

  if (!talk) {
    wasBusy = false;
    if (pipMood) pipMood.textContent = '野生的 惡龍 Bro 出現了！勇者要怎麼做？';
    if (answerContainer) answerContainer.style.display = 'none';
    if (errorContainer) errorContainer.style.display = 'none';
    updateReadingModeUI();
    return;
  }

  const draft = draftActionOf(wasBusy, talk);
  if (input && shouldFocusInput(wasBusy, talk)) input.focus();
  wasBusy = busy;
  if (input && draft !== 'keep') {
    input.value = draft === 'show_talk_text' ? talk.text : '';
    if (counter) {
      counter.textContent = `${input.value.length} / 300`;
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
      if (pipMood) pipMood.textContent = sendViewOf(talk).narration;
      break;

    case 'waiting':
      if (pipMood) pipMood.textContent = sendViewOf(talk).narration;
      break;

    case 'extracting':
      if (pipMood) pipMood.textContent = sendViewOf(talk).narration;
      break;

    case 'done':
      if (pipMood) pipMood.textContent = '惡龍 回覆了！勇者 獲得了 知識 ×1。';

      if (talk.answerMarkdown && answerContent && answerContainer) {
        const dirtyHtml = marked.parse(talk.answerMarkdown) as string;
        const cleanHtml = sanitizeHtml(dirtyHtml);

        answerContent.innerHTML = cleanHtml;

        // Ensure external links open in new tab securely
        const links = answerContent.querySelectorAll('a');
        links.forEach((a) => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });

        // T-2: Wrap speakable English words
        wrapSpeakableWords(answerContent);

        answerContainer.style.display = 'flex';
      }
      break;

    case 'failed': {
      const code = talk.failure?.code || 'INTERNAL';

      const failureView = failureViewOf(code, talk.handoff);

      if (pipMood) pipMood.textContent = failureView.narration;

      if (errorContainer) errorContainer.style.display = 'block';
      if (errorBadge) errorBadge.textContent = failureView.badge;
      if (errorMessage) errorMessage.textContent = failureView.userMessage;

      // Handle Handoff display logic
      if (talk.handoff?.status === 'deferred') {
        if (deferredNotice) deferredNotice.style.display = 'flex';
        if (gotoBroBtn) {
          gotoBroBtn.focus();
          gotoBroBtn.onclick = async () => {
            let copiedOk = false;
            try {
              await navigator.clipboard.writeText(talk.text);
              copiedOk = true;
            } catch (e) {
              console.warn('[Popup] clipboard write failed:', e);
              copiedOk = false;
            }
            chrome.runtime.sendMessage({
              action: 'handoff/switch_tab',
              talkId: talk.id,
              alreadyCopied: copiedOk,
              authorizeDeferred: true
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
          if (countdownText) {
            countdownText.textContent = failureView.handoffLine;
          }
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

  updateReadingModeUI();
}

/**
 * Top-level initialization with robust Error Boundary.
 */
export async function initPopup(): Promise<void> {
  try {
    const isSidepanel = typeof window !== 'undefined' &&
      (window.location?.pathname?.includes('sidepanel') || document.location?.pathname?.endsWith('sidepanel.html') || false);
    if (typeof document.documentElement?.setAttribute === 'function') {
      document.documentElement.setAttribute('data-host', isSidepanel ? 'sidepanel' : 'popup');
    }

    if (!isSidepanel) {
      followActiveTabZoom(document.documentElement, () => updateReadingModeUI()).catch(() => {});
    }

    const input = document.getElementById('talk-input') as HTMLTextAreaElement | null;
    const counter = document.getElementById('char-counter') as HTMLSpanElement | null;
    const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement | null;
    const readingToggleBtn = document.getElementById('reading-toggle-btn') as HTMLButtonElement | null;
    const pinBtn = document.getElementById('pin-toggle-btn') as HTMLButtonElement | null;
    const pinText = document.getElementById('pin-toggle-text');
    const answerContent = document.getElementById('answer-content') as HTMLDivElement | null;

    let isComposing = false;
    let hostSeq = 0;
    let currentRevision = 0;

    // Setup Pin / Unpin button
    if (pinBtn && pinText) {
      if (isSidepanel) {
        pinBtn.title = '取消釘選 (切回彈出視窗)';
        pinBtn.setAttribute('aria-label', '取消釘選');
        pinText.textContent = '取消釘選';
      } else {
        pinBtn.title = '釘選至側邊欄';
        pinBtn.setAttribute('aria-label', '釘選至側邊欄');
        pinText.textContent = '釘選';
      }

      pinBtn.addEventListener('click', async () => {
        const currentDraft = input?.value || '';
        pinBtn.disabled = true;
        try {
          const currentWindow = await chrome.windows?.getCurrent();
          const windowId = currentWindow?.id;

          if (isSidepanel) {
            // Unpin -> Switch to Popup
            const modeRes: any = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'ui/setMode',
                mode: 'popup',
                draft: currentDraft
              }, resolve);
            });
            if (!modeRes?.ok) {
              throw new Error(modeRes?.error || '儲存模式失敗');
            }

            let openSuccess = false;
            if (windowId && chrome.action?.openPopup) {
              try {
                await chrome.action.openPopup({ windowId });
                openSuccess = true;
              } catch (openErr: any) {
                const errMsg = String(openErr?.message || openErr);
                console.warn('[Popup] openPopup failed:', errMsg);
                if (errMsg.includes('inactive window') || errMsg.includes('focused')) {
                  openSuccess = true;
                } else {
                  // Rollback mode to sidepanel on real API failure
                  await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                      action: 'ui/setMode',
                      mode: 'sidepanel',
                      draft: currentDraft
                    }, resolve);
                  });
                  throw new Error(`開啟 Popup 失敗 (${errMsg})，已復原側邊欄偏好`);
                }
              }
            }

            // Only close sidepanel if openPopup succeeded
            if (openSuccess && windowId && (chrome as any).sidePanel?.close) {
              try {
                await (chrome as any).sidePanel.close({ windowId });
              } catch (closeErr) {
                console.warn('[Popup] sidePanel.close warning:', closeErr);
              }
            }
          } else {
            // Pin -> Switch to Sidepanel
            const modeRes: any = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'ui/setMode',
                mode: 'sidepanel',
                draft: currentDraft
              }, resolve);
            });
            if (!modeRes?.ok) {
              throw new Error(modeRes?.error || '儲存模式失敗');
            }

            let openSuccess = false;
            if (windowId && (chrome as any).sidePanel?.open) {
              try {
                await (chrome as any).sidePanel.open({ windowId });
                openSuccess = true;
              } catch (openErr: any) {
                console.warn('[Popup] sidePanel.open failed, initiating rollback:', openErr);
                // Rollback mode to popup
                await new Promise((resolve) => {
                  chrome.runtime.sendMessage({
                    action: 'ui/setMode',
                    mode: 'popup',
                    draft: currentDraft
                  }, resolve);
                });
                throw new Error(`開啟側邊欄失敗 (${openErr?.message || openErr})，已復原 Popup 偏好`);
              }
            }

            if (openSuccess) {
              window.close();
            }
          }
        } catch (err: any) {
          console.error('[Popup] Pin toggle failed:', err);
          pinBtn.disabled = false;
          const errorContainer = document.getElementById('error-container');
          const errorMsg = document.getElementById('error-message');
          if (errorContainer && errorMsg) {
            errorContainer.style.display = 'block';
            errorMsg.textContent = `切換失敗：${err?.message || err}`;
          }
        }
      });
    }

    const saveDraft = (text: string) => {
      hostSeq++;
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'ui/saveDraft',
          text,
          host: isSidepanel ? 'sidepanel' : 'popup',
          hostSeq,
          baseRevision: currentRevision
        }, (res) => {
          if (res?.ok && typeof res.revision === 'number') {
            currentRevision = Math.max(currentRevision, res.revision);
          }
        });
      }
    };

    if (input) {
      input.focus();
      setTimeout(() => input.focus(), 50);

      input.addEventListener('input', () => {
        const len = input.value.length;
        if (counter) {
          counter.textContent = `${len} / 300`;
        }
        if (!isComposing) {
          saveDraft(input.value);
        }
      });

      input.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      input.addEventListener('compositionend', () => {
        isComposing = false;
        saveDraft(input.value);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (isComposing || e.isComposing || e.keyCode === 229) {
            return;
          }
          e.preventDefault();

          if (isTalkBusy(currentLastTalk)) return;
          const rawText = input.value;
          if (rawText.trim().length === 0) return;

          const prevTalk = currentLastTalk;
          chrome.runtime.sendMessage({
            action: 'talk/submit',
            text: rawText,
            draftRevision: currentRevision,
            host: isSidepanel ? 'sidepanel' : 'popup',
            hostSeq
          }, (res) => {
            const outcome = submitOutcomeOf(res);
            if (outcome.kind === 'accepted') {
              submitPreviousSummary(prevTalk);
              renderTalkState(outcome.talk);
            } else if (outcome.kind === 'busy') {
              const status = document.getElementById('pip-mood');
              if (status) status.textContent = outcome.message;
            }
          });
        }
      });
    }

    const previousCard = document.getElementById('previous-card');
    previousCard?.addEventListener('click', () => {
      paintPreviousCard(previousCard.getAttribute('aria-expanded') !== 'true');
    });

    if (readingToggleBtn) {
      readingToggleBtn.addEventListener('click', () => {
        toggleReadingMode();
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

    if (answerContent) {
      initPronunciation(answerContent, { showToast: showSpeechToast });
    }

    // Read current state from storage
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const [resRuntime, resUi] = await Promise.all([
        chrome.storage.local.get('runtime:v1'),
        chrome.storage.local.get('ui:v1')
      ]);
      const runtime = resRuntime['runtime:v1'];
      const ui = resUi['ui:v1'];

      if (ui && typeof ui.revision === 'number') {
        currentRevision = Math.max(currentRevision, ui.revision);
      }

      renderTalkState(runtime?.lastTalk || null);

      if (ui && typeof ui.draft === 'string' && input && !isTalkBusy(runtime?.lastTalk)) {
        if (!input.value) {
          input.value = ui.draft;
          if (counter) {
            counter.textContent = `${ui.draft.length} / 300`;
          }
        }
      }

      window.addEventListener('pagehide', clearHudTimer);

      // Listen for runtime & ui updates
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes['runtime:v1']) {
            renderTalkState(changes['runtime:v1'].newValue?.lastTalk || null);
          }
          if (changes['ui:v1']) {
            const nextUi = changes['ui:v1'].newValue;
            if (nextUi && typeof nextUi.revision === 'number') {
              currentRevision = Math.max(currentRevision, nextUi.revision);
            }
            if (nextUi && typeof nextUi.draft === 'string' && input && !isComposing) {
              if (!isTalkBusy(currentLastTalk) && input.value !== nextUi.draft) {
                input.value = nextUi.draft;
                if (counter) {
                  counter.textContent = `${nextUi.draft.length} / 300`;
                }
              }
            }
          }
        }
      });
    }
  } catch (err: any) {
    console.error('[Popup] Top-level initialization error boundary caught:', err);
    const pipMood = document.getElementById('pip-mood');
    if (pipMood) pipMood.textContent = '勇者暫時無法讀取狀態，但你仍可在此打字。';
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) {
      errorContainer.style.display = 'block';
      const msg = document.getElementById('error-message');
      if (msg) msg.textContent = '無法讀取本機狀態，請稍後重試。';
    }
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPopup().catch((e) => console.error('[Popup] init error:', e));
    });
  } else {
    initPopup().catch((e) => console.error('[Popup] init error:', e));
  }
}
