// tests/unit/popup-zoom.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePopupScale, applyPopupZoom, POPUP_BASE_WIDTH_PX, POPUP_MAX_WIDTH_PX } from '../../src/popup/zoom.ts';

test('computePopupScale maps tab zoom to popup scale', () => {
  assert.equal(computePopupScale(0.75), 0.75);
  assert.equal(computePopupScale(1), 1);
  assert.equal(computePopupScale(1.5), 1.5);
  assert.equal(computePopupScale(2), 2);
});

test('computePopupScale clamps width to the 800px popup limit and falls back to 1', () => {
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
