// src/popup/pronunciation.ts
// Handles word tokenization, DOM wrapping, event delegation, and Web Speech API pronunciation.

export const CANDIDATE_CHUNK_REGEX = /[A-Za-z0-9_]+(?:['’\-][A-Za-z0-9_]+)*/g;
export const VALID_SPEAKABLE_WORD_REGEX = /^[A-Za-z]+(?:['’\-][A-Za-z]+)*$/;

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
        if (!/[A-Za-z]/.test(text)) {
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

  for (const textNode of textNodesToProcess) {
    const parent = textNode.parentNode;
    if (!parent) continue;

    const originalText = textNode.nodeValue || '';
    CANDIDATE_CHUNK_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let hasSpeakable = false;

    // Check if there is at least one speakable word in this text node
    while ((match = CANDIDATE_CHUNK_REGEX.exec(originalText)) !== null) {
      if (isSpeakableWord(match[0])) {
        hasSpeakable = true;
        break;
      }
    }

    if (!hasSpeakable) continue;

    // Reset regex for actual splitting and DOM creation
    CANDIDATE_CHUNK_REGEX.lastIndex = 0;
    const fragment = doc.createDocumentFragment();

    while ((match = CANDIDATE_CHUNK_REGEX.exec(originalText)) !== null) {
      const matchText = match[0];
      const matchIndex = match.index;

      // Text before match
      if (matchIndex > lastIndex) {
        fragment.appendChild(doc.createTextNode(originalText.slice(lastIndex, matchIndex)));
      }

      if (isSpeakableWord(matchText)) {
        const span = doc.createElement('span');
        span.className = 'speakable-word';
        span.dataset.word = matchText;
        span.textContent = matchText;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(doc.createTextNode(matchText));
      }

      lastIndex = matchIndex + matchText.length;
    }

    // Trailing text after last match
    if (lastIndex < originalText.length) {
      fragment.appendChild(doc.createTextNode(originalText.slice(lastIndex)));
    }

    parent.replaceChild(fragment, textNode);
  }
}

let activePlayToken = 0;

export interface SpeechPlayerOptions {
  showToast?: (message: string) => void;
  speechSynthesis?: SpeechSynthesis;
}

/**
 * Plays English pronunciation using Web Speech API (SpeechSynthesis).
 * Cancels any active utterance before playing new word.
 * Distinguishes old cancelled utterances from genuine errors.
 */
export function speakWord(word: string, options: SpeechPlayerOptions = {}): void {
  const synth = options.speechSynthesis || (typeof window !== 'undefined' ? window.speechSynthesis : undefined);
  const showToast = options.showToast || ((msg: string) => console.warn('[Pronunciation]', msg));

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

  const voices = synth.getVoices?.() || [];
  let selectedVoice: SpeechSynthesisVoice | null = null;

  if (voices.length > 0) {
    selectedVoice = voices.find(v => (v.lang === 'en-US' || v.lang === 'en_US') && v.default)
      || voices.find(v => v.lang === 'en-US' || v.lang === 'en_US')
      || voices.find(v => v.lang.toLowerCase().startsWith('en'))
      || null;

    if (!selectedVoice) {
      showToast('找不到可用的英文語音');
      return;
    }
  }

  try {
    const utt = new SpeechSynthesisUtterance(word);
    utt.lang = 'en-US';
    utt.rate = 1.0;
    if (selectedVoice) {
      utt.voice = selectedVoice;
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
