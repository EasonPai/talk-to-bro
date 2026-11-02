// src/popup/zoom.ts
// Toolbar popups do not inherit the active tab's zoom, so mirror it manually.

export const POPUP_BASE_WIDTH_PX = 400;
export const POPUP_READING_BASE_WIDTH_PX = 560;
export const POPUP_MAX_WIDTH_PX = 800;
export const POPUP_MAX_HEIGHT_PX = 600;
const MIN_SCALE = 0.5;

let lastKnownZoom = 1;

export function getLastKnownZoom(): number {
  return lastKnownZoom;
}

export function setLastKnownZoom(zoom: number): void {
  lastKnownZoom = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function computePopupScale(tabZoom: number | undefined | null): number {
  if (typeof tabZoom !== 'number' || !Number.isFinite(tabZoom) || tabZoom <= 0) return 1;
  const maxScale = POPUP_MAX_WIDTH_PX / POPUP_BASE_WIDTH_PX;
  return Math.min(Math.max(tabZoom, MIN_SCALE), maxScale);
}

/**
 * Computes the CSS layout width (in unscaled CSS px) for reading mode.
 * The visible width is capped by min(560 * scale, 800, availableWidth).
 * The CSS layout width to set on document.body is visibleWidth / scale.
 */
export function computeReadingWidthPx(scale: number, availableWidth?: number): number {
  const effectiveScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
  const screenCap = (typeof availableWidth === 'number' && Number.isFinite(availableWidth) && availableWidth > 0)
    ? availableWidth
    : POPUP_MAX_WIDTH_PX;
  const visibleMax = Math.min(POPUP_READING_BASE_WIDTH_PX * effectiveScale, POPUP_MAX_WIDTH_PX, screenCap);
  return Math.round((visibleMax / effectiveScale) * 100) / 100;
}

export function applyPopupZoom(root: HTMLElement, tabZoom: number | undefined | null): number {
  const scale = computePopupScale(tabZoom);
  setLastKnownZoom(scale);
  root.style.setProperty('--ttb-zoom', String(scale));
  root.style.zoom = String(scale);
  return scale;
}

/**
 * Applies layout width and mode attributes to body according to reading mode and scale.
 */
export function applyPopupLayout(root: HTMLElement, readingMode: boolean, tabZoom?: number | null): void {
  const scale = computePopupScale(tabZoom ?? lastKnownZoom);
  root.style.setProperty('--ttb-zoom', String(scale));
  root.style.zoom = String(scale);

  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;

  body.dataset.mode = readingMode ? 'reading' : 'compact';
  body.dataset.readingMode = String(readingMode);
  if (readingMode) {
    body.classList.add('reading-mode');
    const availW = (typeof window !== 'undefined' && (window.screen?.availWidth || window.screen?.width)) || POPUP_MAX_WIDTH_PX;
    const cssW = computeReadingWidthPx(scale, availW);
    body.style.width = `${cssW}px`;
  } else {
    body.classList.remove('reading-mode');
    body.style.removeProperty('width');
  }
}

/** Applies the active tab zoom now and keeps following it while the popup is open. */
export async function followActiveTabZoom(root: HTMLElement, onZoom?: (newZoom: number) => void): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  const initialZoom = await chrome.tabs.getZoom(tabId);
  setLastKnownZoom(initialZoom);
  applyPopupZoom(root, initialZoom);
  onZoom?.(initialZoom);
  chrome.tabs.onZoomChange.addListener((info) => {
    if (info.tabId === tabId) {
      setLastKnownZoom(info.newZoomFactor);
      applyPopupZoom(root, info.newZoomFactor);
      onZoom?.(info.newZoomFactor);
    }
  });
}
