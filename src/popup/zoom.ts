// src/popup/zoom.ts
// Toolbar popups do not inherit the active tab's zoom, so mirror it manually.

export const POPUP_BASE_WIDTH_PX = 360;
export const POPUP_MAX_WIDTH_PX = 800;
const MIN_SCALE = 0.5;

export function computePopupScale(tabZoom: number | undefined | null): number {
  if (typeof tabZoom !== 'number' || !Number.isFinite(tabZoom) || tabZoom <= 0) return 1;
  const maxScale = POPUP_MAX_WIDTH_PX / POPUP_BASE_WIDTH_PX;
  return Math.min(Math.max(tabZoom, MIN_SCALE), maxScale);
}

export function applyPopupZoom(root: HTMLElement, tabZoom: number | undefined | null): number {
  const scale = computePopupScale(tabZoom);
  root.style.setProperty('--ttb-zoom', String(scale));
  root.style.zoom = String(scale);
  return scale;
}

/** Applies the active tab zoom now and keeps following it while the popup is open. */
export async function followActiveTabZoom(root: HTMLElement): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  applyPopupZoom(root, await chrome.tabs.getZoom(tabId));
  chrome.tabs.onZoomChange.addListener((info) => {
    if (info.tabId === tabId) applyPopupZoom(root, info.newZoomFactor);
  });
}
