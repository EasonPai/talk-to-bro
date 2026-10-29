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

test('DOM Normalization - NFC and newline equality preserves distinct spaces, tabs and detects empty drafts', async () => {
  const { normalizeText, isDraftEmpty } = await import('../../src/adapter/entry.ts');

  // Spaces and tabs must NOT be collapsed
  assert.notEqual(normalizeText('a  b'), normalizeText('a b'), 'Distinct double space must not equal single space');
  assert.notEqual(normalizeText('a\tb'), normalizeText('a b'), 'Tab must not equal space');
  assert.notEqual(normalizeText('  start space'), normalizeText('start space'), 'Leading space must not be stripped');

  // Newlines must be normalized (\r\n -> \n, \r -> \n)
  assert.equal(normalizeText('line1\r\nline2'), normalizeText('line1\nline2'));
  assert.equal(normalizeText('line1\rline2'), normalizeText('line1\nline2'));

  // NFC Unicode normalization
  assert.equal(normalizeText('e\u0301'), normalizeText('\u00e9'));

  // Separate isDraftEmpty checks
  assert.equal(isDraftEmpty(''), true);
  assert.equal(isDraftEmpty('   '), true);
  assert.equal(isDraftEmpty('\n\t  '), true);
  assert.equal(isDraftEmpty(null), true);
  assert.equal(isDraftEmpty(undefined), true);
  assert.equal(isDraftEmpty('hello'), false);
  assert.equal(isDraftEmpty(' a '), false);
});
