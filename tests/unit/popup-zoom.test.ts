// tests/unit/popup-zoom.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePopupScale,
  computeReadingWidthPx,
  applyPopupZoom,
  applyPopupLayout,
  POPUP_BASE_WIDTH_PX,
  POPUP_READING_BASE_WIDTH_PX,
  POPUP_MAX_WIDTH_PX
} from '../../src/popup/zoom.ts';

test('computePopupScale maps tab zoom to popup scale', () => {
  assert.equal(computePopupScale(0.75), 0.75);
  assert.equal(computePopupScale(1), 1);
  assert.equal(computePopupScale(1.5), 1.5);
  assert.equal(computePopupScale(2), 2);
});

test('computePopupScale clamps width to the 800px popup limit and falls back to 1', () => {
  assert.equal(POPUP_BASE_WIDTH_PX * computePopupScale(2.5), 800);
  assert.ok(POPUP_BASE_WIDTH_PX * computePopupScale(5) <= POPUP_MAX_WIDTH_PX);
  assert.equal(computePopupScale(0.1), 0.5);
  assert.equal(computePopupScale(undefined), 1);
  assert.equal(computePopupScale(NaN), 1);
  assert.equal(computePopupScale(0), 1);
});

test('applyPopupZoom sets zoom and --ttb-zoom on the root', () => {
  const props: Record<string, string> = {};
  const root = { style: { setProperty: (k: string, v: string) => { props[k] = v; }, zoom: '' } } as unknown as HTMLElement;
  assert.equal(applyPopupZoom(root, 1.5), 1.5);
  assert.equal(props['--ttb-zoom'], '1.5');
  assert.equal(root.style.zoom, '1.5');
});

test('computeReadingWidthPx computes unscaled CSS width for reading mode', () => {
  // 100% zoom: min(560*1, 800) = 560 visible px -> 560 CSS px
  assert.equal(computeReadingWidthPx(1), 560);

  // 125% zoom: min(560*1.25, 800) = 700 visible px -> 700 / 1.25 = 560 CSS px
  assert.equal(computeReadingWidthPx(1.25), 560);

  // 150% zoom: min(560*1.5, 800) = 800 visible px -> 800 / 1.5 = 533.33 CSS px
  assert.equal(computeReadingWidthPx(1.5), 533.33);

  // 200% zoom: min(560*2, 800) = 800 visible px -> 800 / 2 = 400 CSS px
  assert.equal(computeReadingWidthPx(2), 400);

  // Clamped by available screen width
  assert.equal(computeReadingWidthPx(1, 500), 500);
  assert.equal(computeReadingWidthPx(1.5, 600), 400); // 600 / 1.5 = 400
});

test('applyPopupLayout toggles compact vs reading layout styles', () => {
  const props: Record<string, string> = {};
  const root = {
    style: {
      setProperty: (k: string, v: string) => { props[k] = v; },
      zoom: ''
    }
  } as unknown as HTMLElement;

  // Mock global document if not present
  const originalDoc = (globalThis as any).document;
  const originalWin = (globalThis as any).window;

  const mockBody = {
    dataset: {} as Record<string, string>,
    classList: {
      add: (c: string) => { mockBody.classes.add(c); },
      remove: (c: string) => { mockBody.classes.delete(c); }
    },
    classes: new Set<string>(),
    style: {
      width: '',
      removeProperty: (p: string) => { if (p === 'width') mockBody.style.width = ''; }
    }
  };

  (globalThis as any).document = { body: mockBody } as any;
  (globalThis as any).window = { screen: { availWidth: 1440, width: 1440 } } as any;

  try {
    // 1. Reading mode at 100%
    applyPopupLayout(root, true, 1);
    assert.equal(mockBody.dataset.mode, 'reading');
    assert.equal(mockBody.dataset.readingMode, 'true');
    assert.ok(mockBody.classes.has('reading-mode'));
    assert.equal(mockBody.style.width, '560px');
    assert.equal(props['--ttb-zoom'], '1');

    // 2. Compact mode
    applyPopupLayout(root, false, 1);
    assert.equal(mockBody.dataset.mode, 'compact');
    assert.equal(mockBody.dataset.readingMode, 'false');
    assert.ok(!mockBody.classes.has('reading-mode'));
    assert.equal(mockBody.style.width, '');

    // 3. Reading mode at 150%
    applyPopupLayout(root, true, 1.5);
    assert.equal(mockBody.dataset.mode, 'reading');
    assert.equal(mockBody.style.width, '533.33px');
    assert.equal(props['--ttb-zoom'], '1.5');
  } finally {
    (globalThis as any).document = originalDoc;
    (globalThis as any).window = originalWin;
  }
});
