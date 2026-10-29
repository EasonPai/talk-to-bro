// tests/unit/selectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS, queryOne, queryAll } from '../../src/adapter/selectors.ts';

test('DOM Selectors - Candidate arrays exist with fallbacks for all required keys', () => {
  const requiredKeys = [
    'editor',
    'sendButton',
    'stopButton',
    'userTurn',
    'userTurnText',
    'modelTurn',
    'modelBody',
    'modelDone',
    'signIn'
  ] as const;

  for (const key of requiredKeys) {
    const candidates = SELECTORS[key];
    assert.ok(Array.isArray(candidates), `SELECTORS.${key} must be an array`);
    assert.ok(candidates.length >= 2, `SELECTORS.${key} must have multiple fallback candidates`);
    for (const sel of candidates) {
      assert.equal(typeof sel, 'string');
      assert.ok(sel.length > 0);
    }
  }
});

test('DOM Selectors - queryOne and queryAll fallback behavior in mock DOM', () => {
  // Create a minimal mock DOM ParentNode
  const elements: Record<string, any> = {};

  const mockNode = {
    querySelector: (selector: string) => elements[selector] || null,
    querySelectorAll: (selector: string) => elements[selector] ? [elements[selector]] : []
  } as any;

  // Nothing matches
  assert.equal(queryOne('editor', mockNode), null);
  assert.deepEqual(queryAll('editor', mockNode), []);

  // Primary doesn't match, fallback matches
  elements['#mock-editor'] = { id: 'mock-editor', tagName: 'DIV' };
  const found = queryOne('editor', mockNode);
  assert.ok(found);
  assert.equal((found as any).id, 'mock-editor');

  const allFound = queryAll('editor', mockNode);
  assert.equal(allFound.length, 1);
  assert.equal((allFound[0] as any).id, 'mock-editor');

  // Primary matches first
  const primarySel = SELECTORS.editor[0];
  elements[primarySel] = { id: 'primary-editor' };
  const primaryFound = queryOne('editor', mockNode);
  assert.equal((primaryFound as any).id, 'primary-editor');
});
