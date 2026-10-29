// src/popup/popup.ts

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('talk-input') as HTMLTextAreaElement | null;
  const counter = document.getElementById('char-counter') as HTMLSpanElement | null;

  if (input) {
    // F1: Ensure autofocus is unconditionally established
    input.focus();
    // In case Chrome popup animation delays focus
    setTimeout(() => input.focus(), 50);

    input.addEventListener('input', () => {
      const len = input.value.length;
      if (counter) {
        counter.textContent = `${len} / 300`;
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text) {
          console.log('[Popup] Talk submitted:', text);
          // To be wired to SW in M2
        }
      }
    });
  }
});
