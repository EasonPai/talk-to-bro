// tests/unit/html-to-md.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToMarkdown } from '../../src/adapter/html-to-md.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLDENS_DIR = path.join(__dirname, '../fixtures/goldens');

test('HTML to Markdown - Golden: case1-table converts table with proper alignment', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case1-table.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case1-table.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Golden: case2-nested-lists converts nested lists with 2-space indentation', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case2-nested-lists.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case2-nested-lists.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Golden: case3-formatting converts bold, italic, code, blockquote', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case3-formatting.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case3-formatting.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Golden: case4-codeblock strips decoration and preserves language and code indentation', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case4-codeblock.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case4-codeblock.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Golden: case1-real-ledger converts complex production ledger turn', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case1-real-ledger.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case1-real-ledger.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Golden: case5-citations-m4 preserves visible citations and sources while stripping noise', () => {
  const html = fs.readFileSync(path.join(GOLDENS_DIR, 'case5-citations-m4.html'), 'utf8');
  const expected = fs.readFileSync(path.join(GOLDENS_DIR, 'case5-citations-m4.md'), 'utf8').trim();
  const actual = htmlToMarkdown(html);
  assert.equal(actual, expected);
});

test('HTML to Markdown - Code blocks preserve internal whitespace and indentation without global collapse', () => {
  const rawHtml = `
    <div>
      <p>Here is indented code:</p>
      <pre><code class="language-python">def solve():
    if True:
        # 8 spaces below
        return 42

    return 0</code></pre>
    </div>
  `;
  const actual = htmlToMarkdown(rawHtml);
  assert.ok(actual.includes('def solve():\n    if True:\n        # 8 spaces below\n        return 42\n\n    return 0'));
});
