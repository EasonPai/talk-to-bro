// tests/unit/extract-target.test.ts
// Verifies target-scoped model turn extraction with multi-turn DOM fixture
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, findTargetModelTurn } from '../../src/adapter/entry.ts';
import { SELECTORS } from '../../src/adapter/selectors.ts';

/**
 * Creates a mock DOM simulating a conversation history with multiple turns:
 * Turn 1: User prompt "ledger" -> Model response "Ledger analysis"
 * Turn 2: User prompt "meticulous" -> Model response "Meticulous analysis"
 */
function createMockMultiTurnDom() {
  const elements: Record<string, any[]> = {
    userTurn: [],
    modelTurn: [],
    modelBody: []
  };

  // Create node hierarchy
  class MockElement {
    nodeType: number = 1;
    nodeName: string;
    tagName: string;
    attributes: Record<string, string>;
    textContent: string;
    innerHTML: string;
    parentElement: MockElement | null;
    children: MockElement[];

    constructor(
      tagName: string,
      attributes: Record<string, string> = {},
      textContent: string = '',
      innerHTML: string = '',
      parentElement: MockElement | null = null,
      children: MockElement[] = []
    ) {
      this.nodeType = 1;
      this.nodeName = tagName.toUpperCase();
      this.tagName = tagName.toUpperCase();
      this.attributes = attributes;
      this.textContent = textContent;
      this.innerHTML = innerHTML;
      this.parentElement = parentElement;
      this.children = children;
    }

    getAttribute(name: string) {
      return this.attributes[name] || null;
    }

    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    }

    querySelector(selector: string) {
      for (const child of this.children) {
        if (child.matches(selector)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    }

    querySelectorAll(selector: string): MockElement[] {
      const results: MockElement[] = [];
      for (const child of this.children) {
        if (child.matches(selector)) results.push(child);
        results.push(...child.querySelectorAll(selector));
      }
      return results;
    }

    matches(selector: string) {
      if (selector === this.tagName.toLowerCase()) return true;
      if (selector.startsWith('.') && this.attributes['class']?.includes(selector.slice(1))) return true;
      if (selector.startsWith('[data-turn-type=') && this.attributes['data-turn-type']) return true;
      return false;
    }

    cloneNode(deep = true) {
      const cloned = new MockElement(this.tagName, { ...this.attributes }, this.textContent, this.innerHTML);
      if (deep) {
        cloned.children = this.children.map(c => {
          const cc = c.cloneNode(true);
          cc.parentElement = cloned;
          return cc;
        });
      }
      return cloned;
    }

    // Node.compareDocumentPosition simulation based on index in root
    compareDocumentPosition(other: MockElement): number {
      const root = getRoot(this);
      const all = collectAll(root);
      const idxThis = all.indexOf(this);
      const idxOther = all.indexOf(other);
      if (idxThis < idxOther) {
        return 4; // Node.DOCUMENT_POSITION_FOLLOWING
      } else if (idxThis > idxOther) {
        return 2; // Node.DOCUMENT_POSITION_PRECEDING
      }
      return 0;
    }
  }

  function getRoot(el: MockElement): MockElement {
    let curr = el;
    while (curr.parentElement) curr = curr.parentElement;
    return curr;
  }

  function collectAll(el: MockElement): MockElement[] {
    const list = [el];
    for (const c of el.children) list.push(...collectAll(c));
    return list;
  }

  const container = new MockElement('DIV', { class: 'chat-history' });

  // Turn 1
  const u1 = new MockElement('USER-QUERY', { class: 'user-query', 'data-ttb-talk-id': 'talk-1' }, 'ledger', '<div class="query-text">ledger</div>', container);
  const m1Body = new MockElement('DIV', { class: 'model-body-content' }, 'Ledger analysis', '<p>Ledger analysis</p>');
  const m1 = new MockElement('MODEL-RESPONSE', { class: 'model-response' }, 'Ledger analysis', '<p>Ledger analysis</p>', container, [m1Body]);
  m1Body.parentElement = m1;

  // Turn 2 (Later unrelated turn)
  const u2 = new MockElement('USER-QUERY', { class: 'user-query', 'data-ttb-talk-id': 'talk-2' }, 'meticulous', '<div class="query-text">meticulous</div>', container);
  const m2Body = new MockElement('DIV', { class: 'model-body-content' }, 'Meticulous analysis', '<p>Meticulous analysis</p>');
  const m2 = new MockElement('MODEL-RESPONSE', { class: 'model-response' }, 'Meticulous analysis', '<p>Meticulous analysis</p>', container, [m2Body]);
  m2Body.parentElement = m2;

  container.children = [u1, m1, u2, m2];

  // Set global document mock for queryAll
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => {
      const userTurnSels = SELECTORS.userTurn;
      const modelTurnSels = SELECTORS.modelTurn;
      const modelBodySels = SELECTORS.modelBody;

      if (userTurnSels.includes(sel)) return [u1, u2];
      if (modelTurnSels.includes(sel)) return [m1, m2];
      if (modelBodySels.includes(sel)) return [m1Body, m2Body];
      return [];
    },
    querySelector: (sel: string) => {
      if (sel === 'editor' || SELECTORS.editor.includes(sel)) return { innerText: '' };
      return null;
    }
  };

  return { container, u1, m1, u2, m2, m1Body, m2Body };
}

test('Adapter Target Scope - extract binds strictly to target Talk user turn and ignores subsequent responses', () => {
  const { u1, m1, u2, m2 } = createMockMultiTurnDom();

  // Extract specifically for talk-1 ('ledger')
  const res1 = extract({ talkId: 'talk-1', text: 'ledger' });
  assert.equal(res1.error, undefined);
  assert.ok(res1.markdown?.includes('Ledger analysis'), 'Must extract response for talk-1');
  assert.ok(!res1.markdown?.includes('Meticulous analysis'), 'Must NOT extract response for talk-2');

  // Extract specifically for talk-2 ('meticulous')
  const res2 = extract({ talkId: 'talk-2', text: 'meticulous' });
  assert.equal(res2.error, undefined);
  assert.ok(res2.markdown?.includes('Meticulous analysis'), 'Must extract response for talk-2');
  assert.ok(!res2.markdown?.includes('Ledger analysis'), 'Must NOT extract response for talk-1');

  // Extract for non-existent / unmatched talk fails gracefully
  const resUnmatched = extract({ talkId: 'talk-unknown', text: 'unknown word' });
  assert.equal(resUnmatched.error, 'EXTRACT_FAILED');
});
