// src/popup/pronunciation.ts
// Handles word tokenization, DOM wrapping, event delegation, and Web Speech API pronunciation.

export const CANDIDATE_CHUNK_REGEX = /[A-Za-z0-9_]+(?:['’\-][A-Za-z0-9_]+)*/g;
export const VALID_SPEAKABLE_WORD_REGEX = /^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/;
export const PHONETIC_REGEX = /(?:(?:英|美|UK|US|KK|DJ)\s*)?(?:\[|\/)[a-zA-Z\u0250-\u02AF\u00C0-\u00FF\u0100-\u017F\u0300-\u036F\u1DC0-\u1DFFˈˌː:\.\,\-\s'’\(\)]+(?:\]|\/)/g;

const EXCLUDED_TAGS = new Set([
  'A',
  'PRE',
  'CODE',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT'
]);

const SHOW_TEXT = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
const FILTER_ACCEPT = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_ACCEPT : 1;
const FILTER_REJECT = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_REJECT : 2;
const FILTER_SKIP = typeof NodeFilter !== 'undefined' ? NodeFilter.FILTER_SKIP : 3;

/**
 * Checks if a candidate word is a valid speakable English word.
 * Must consist solely of ASCII letters with optional internal straight/curly apostrophes or hyphens.
 * Must NOT contain digits (e.g. MP3, UTF-8, 123) or underscores.
 */
export function isSpeakableWord(word: string): boolean {
  return VALID_SPEAKABLE_WORD_REGEX.test(word);
}

/**
 * Resolves an English voice from the available voice list.
 * Priority: en-US default voice -> en-US voice -> any en-* voice -> null.
 */
export function findEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;
  return (
    voices.find((v) => (v.lang === 'en-US' || v.lang === 'en_US') && v.default) ||
    voices.find((v) => v.lang === 'en-US' || v.lang === 'en_US') ||
    voices.find((v) => v.lang?.toLowerCase().startsWith('en')) ||
    null
  );
}

/**
 * Traverses text nodes within container, excluding links, code blocks, buttons,
 * and wraps speakable English words in <span class="speakable-word" data-word="...">.
 * Uses only standard DOM APIs (no HTML string concatenation).
 */
export function wrapSpeakableWords(container: HTMLElement): void {
  if (!container) return;

  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createTreeWalker !== 'function') return;

  const walker = doc.createTreeWalker(
    container,
    SHOW_TEXT,
    {
      acceptNode(node: Node): number {
        // Check if any ancestor between node and container is excluded
        let curr: HTMLElement | null = node.parentElement;
        while (curr && curr !== container) {
          if (EXCLUDED_TAGS.has(curr.tagName) || curr.classList?.contains('no-pronounce')) {
            return FILTER_REJECT;
          }
          if (curr.classList?.contains('speakable-word')) {
            return FILTER_REJECT;
          }
          curr = curr.parentElement;
        }

        const text = node.nodeValue || '';
        if (!/[A-Za-z\u0250-\u02AF\[\/]/.test(text)) {
          return FILTER_SKIP;
        }

        return FILTER_ACCEPT;
      }
    }
  );

  const textNodesToProcess: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodesToProcess.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  interface TokenSpan {
    type: 'word' | 'phonetic';
    text: string;
    start: number;
    end: number;
  }

  for (const textNode of textNodesToProcess) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    const originalText = textNode.nodeValue || '';
    const spans: TokenSpan[] = [];

    // 1. Match phonetics
    PHONETIC_REGEX.lastIndex = 0;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = PHONETIC_REGEX.exec(originalText)) !== null) {
      spans.push({
        type: 'phonetic',
        text: pMatch[0],
        start: pMatch.index,
        end: pMatch.index + pMatch[0].length
      });
    }

    // 2. Match candidate speakable words not overlapping phonetics
    CANDIDATE_CHUNK_REGEX.lastIndex = 0;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = CANDIDATE_CHUNK_REGEX.exec(originalText)) !== null) {
      const start = cMatch.index;
      const end = start + cMatch[0].length;
      const overlaps = spans.some((s) => Math.max(start, s.start) < Math.min(end, s.end));
      if (!overlaps && isSpeakableWord(cMatch[0])) {
        spans.push({
          type: 'word',
          text: cMatch[0],
          start,
          end
        });
      }
    }

    if (spans.length === 0) continue;

    // Sort spans in document order
    spans.sort((a, b) => a.start - b.start);

    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;

    for (const span of spans) {
      if (span.start > lastIndex) {
        fragment.appendChild(doc.createTextNode(originalText.slice(lastIndex, span.start)));
      }

      if (span.type === 'word') {
        const el = doc.createElement('span');
        el.className = 'speakable-word';
        el.dataset.word = span.text;
        el.textContent = span.text;
        fragment.appendChild(el);
      } else {
        const el = doc.createElement('span');
        el.className = 'phonetic';
        el.textContent = span.text;
        fragment.appendChild(el);
      }

      lastIndex = span.end;
    }

    if (lastIndex < originalText.length) {
      fragment.appendChild(doc.createTextNode(originalText.slice(lastIndex)));
    }

    parent.replaceChild(fragment, textNode);
  }

  alignPhonetics(container);
}

/**
 * Ensures any phonetic block is positioned immediately adjacent to the right of its target speakable-word.
 */
export function alignPhonetics(container: HTMLElement): void {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  const phonetics = Array.from(container.querySelectorAll('.phonetic')) as HTMLElement[];
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  for (const ph of phonetics) {
    if (ph.previousElementSibling?.classList?.contains('speakable-word')) {
      continue;
    }
    const block = ph.parentElement;
    if (!block || block === container) continue;
    const prevBlock = block.previousElementSibling as HTMLElement | null;
    if (prevBlock && typeof prevBlock.querySelectorAll === 'function') {
      const words = prevBlock.querySelectorAll('.speakable-word');
      if (words.length > 0) {
        const targetWord = words[words.length - 1];
        if (targetWord.parentNode && typeof targetWord.parentNode.insertBefore === 'function') {
          targetWord.parentNode.insertBefore(doc.createTextNode(' '), targetWord.nextSibling);
          targetWord.parentNode.insertBefore(ph, targetWord.nextSibling);
          if (block && !block.textContent?.trim() && typeof block.remove === 'function') {
            block.remove();
          }
        }
      }
    }
  }
}

let activePlayToken = 0;

export interface SpeechPlayerOptions {
  showToast?: (message: string) => void;
  speechSynthesis?: SpeechSynthesis;
  voiceTimeoutMs?: number;
}

function dispatchUtterance(
  synth: SpeechSynthesis,
  word: string,
  voice: SpeechSynthesisVoice | null,
  token: number,
  showToast: (msg: string) => void
): void {
  try {
    const utt = new SpeechSynthesisUtterance(word);
    utt.lang = 'en-US';
    utt.rate = 1.0;
    if (voice) {
      utt.voice = voice;
    }

    utt.onerror = (e: SpeechSynthesisErrorEvent) => {
      // If a newer utterance was triggered, ignore cancellations from this older one
      if (token !== activePlayToken) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return;

      showToast('語音播放失敗');
    };

    synth.speak(utt);
  } catch (err) {
    console.error('[Pronunciation] speak failed:', err);
    showToast('語音播放失敗');
  }
}

/**
 * Plays English pronunciation using Web Speech API (SpeechSynthesis).
 * Cancels any active utterance before playing new word.
 * Distinguishes old cancelled utterances from genuine errors.
 * Handles delayed asynchronous voice loading and bounded timeout when voices are empty.
 */
export function speakWord(word: string, options: SpeechPlayerOptions = {}): void {
  const synth = options.speechSynthesis || (typeof window !== 'undefined' ? window.speechSynthesis : undefined);
  const showToast = options.showToast || ((msg: string) => console.warn('[Pronunciation]', msg));
  const voiceTimeoutMs = typeof options.voiceTimeoutMs === 'number' ? options.voiceTimeoutMs : 1000;

  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    showToast('瀏覽器未支援語音播放');
    return;
  }

  const token = ++activePlayToken;

  try {
    synth.cancel();
  } catch (e) {
    console.warn('[Pronunciation] synth.cancel error:', e);
  }

  const immediateVoices = synth.getVoices?.() || [];

  if (immediateVoices.length > 0) {
    const voice = findEnglishVoice(immediateVoices);
    if (!voice) {
      showToast('找不到可用的英文語音');
      return;
    }
    dispatchUtterance(synth, word, voice, token, showToast);
    return;
  }

  // Voices list is initially empty. Wait for voiceschanged with bounded timeout.
  let resolved = false;
  let timeoutId: any = null;

  const cleanup = () => {
    resolved = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (typeof synth.removeEventListener === 'function') {
      synth.removeEventListener('voiceschanged', onVoicesChanged);
    } else if (synth.onvoiceschanged === onVoicesChanged) {
      synth.onvoiceschanged = null;
    }
  };

  const onVoicesChanged = () => {
    if (resolved) return;
    cleanup();
    if (token !== activePlayToken) return; // Newest-click priority preserved

    const loadedVoices = synth.getVoices?.() || [];
    const voice = findEnglishVoice(loadedVoices);
    if (!voice) {
      showToast('找不到可用的英文語音');
      return;
    }
    dispatchUtterance(synth, word, voice, token, showToast);
  };

  if (typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', onVoicesChanged);
  } else {
    synth.onvoiceschanged = onVoicesChanged;
  }

  timeoutId = setTimeout(() => {
    if (resolved) return;
    cleanup();
    if (token !== activePlayToken) return; // Newest-click priority preserved

    const finalVoices = synth.getVoices?.() || [];
    const voice = findEnglishVoice(finalVoices);
    if (!voice) {
      showToast('找不到可用的英文語音');
      return;
    }
    dispatchUtterance(synth, word, voice, token, showToast);
  }, voiceTimeoutMs);
}

export interface PronunciationDelegateOptions {
  showToast?: (message: string) => void;
  speechSynthesis?: SpeechSynthesis;
}

/**
 * Attaches delegated click listener on container to handle word pronunciation.
 * Prevents pronunciation on drag selection or when active text selection exists.
 * Returns cleanup function.
 */
export function initPronunciation(
  container: HTMLElement,
  options: PronunciationDelegateOptions = {}
): () => void {
  if (!container) return () => {};

  let pointerStartX = 0;
  let pointerStartY = 0;
  let hasPointerDown = false;

  const onPointerDown = (e: MouseEvent | PointerEvent) => {
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    hasPointerDown = true;
  };

  const onClick = (e: MouseEvent) => {
    // 1. Check if user is dragging or making a selection
    if (hasPointerDown) {
      const dragDistance = Math.hypot(e.clientX - pointerStartX, e.clientY - pointerStartY);
      hasPointerDown = false;
      if (dragDistance > 5) {
        return;
      }
    }

    // 2. Check active non-collapsed selection
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }

    // 3. Find target speakable word
    const target = (e.target as HTMLElement | null)?.closest?.('.speakable-word') as HTMLElement | null;
    if (!target) return;

    // 4. Ensure target is not within links, code, or buttons
    if (target.closest('a, button, pre, code')) return;

    const word = target.dataset.word || target.textContent?.trim();
    if (!word) return;

    speakWord(word, options);
  };

  container.addEventListener('pointerdown', onPointerDown, { passive: true });
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('click', onClick);
  };
}
