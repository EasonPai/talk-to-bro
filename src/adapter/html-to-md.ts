// src/adapter/html-to-md.ts
// Gemini HTML to Markdown Serializer using bundled Turndown + GFM
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Creates and configures a TurndownService instance tailored for Gemini DOM.
 */
export function createTurndownInstance(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    br: ''
  });

  // Attach GitHub Flavored Markdown (tables, strikethrough, task lists)
  turndown.use(gfm);

  // Custom rule: Paragraph inside list item should not introduce excessive blank lines
  turndown.addRule('paragraphInListItem', {
    filter: (node) => node.nodeName === 'P' && !!node.parentNode && node.parentNode.nodeName === 'LI',
    replacement: (content) => content
  });

  // Custom rule: 2-space indented list items for clean nested lists
  turndown.addRule('customListItem', {
    filter: 'li',
    replacement: (content, node) => {
      let prefix = '- ';
      const parent = node.parentNode as HTMLElement | null;
      if (parent && parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + '. ';
      }
      let depth = 0;
      let p = parent;
      while (p) {
        if (p.nodeName === 'UL' || p.nodeName === 'OL') {
          depth++;
        }
        p = p.parentNode as HTMLElement | null;
      }
      const indent = '  '.repeat(Math.max(0, depth - 1));
      return indent + prefix + content.trim() + '\n';
    }
  });

  // Custom rule: GFM table separator with :---
  turndown.addRule('gfmTableRowWithColons', {
    filter: 'tr',
    replacement: (content, node) => {
      let borderCells = '';
      const isHeading = node.parentNode && node.parentNode.nodeName === 'THEAD';
      if (isHeading) {
        const ths = Array.from(node.childNodes).filter((n: any) => n.nodeType === 1);
        borderCells = '| ' + ths.map(() => ':---').join(' | ') + ' |';
      }
      return '\n' + content + (borderCells ? '\n' + borderCells : '');
    }
  });

  // Custom rule: Gemini fenced code block with language attribute strictly preserving indentation and content
  turndown.addRule('geminiCodeBlock', {
    filter: (node) => node.nodeName === 'PRE',
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector('code');
      const codeText = code ? code.textContent : node.textContent;
      const langMatch = code && code.className ? code.className.match(/language-(\w+)/) : null;
      const lang = langMatch ? langMatch[1] : '';
      let text = codeText || '';
      // Strip only leading newline immediately following <code>
      if (text.startsWith('\n')) text = text.slice(1);
      else if (text.startsWith('\r\n')) text = text.slice(2);
      // Ensure single trailing newline before closing fence
      if (!text.endsWith('\n')) text += '\n';
      return '\n\n```' + lang + '\n' + text + '```\n\n';
    }
  });

  // Custom rule: sup element preservation with unescaped bracket indicators
  turndown.addRule('sup', {
    filter: 'sup',
    replacement: (content) => content.replace(/\\\[/g, '[').replace(/\\\]/g, ']')
  });

  return turndown;
}

const EXCLUDE_SELECTORS = [
  'model-thoughts',
  'button',
  'mat-icon',
  '.code-block-decoration'
];

/**
 * Converts a Gemini model response HTML string or HTMLElement into clean Markdown.
 * Strips model thoughts, buttons, icons, and decoration while preserving
 * code blocks, tables, lists, formatting, and visible citations/source links.
 */
export function htmlToMarkdown(htmlStringOrElement: string | HTMLElement): string {
  const turndown = createTurndownInstance();

  if (typeof htmlStringOrElement === 'string') {
    let cleanHtml = htmlStringOrElement;
    cleanHtml = cleanHtml.replace(/<model-thoughts[\s\S]*?<\/model-thoughts>/gi, '');
    cleanHtml = cleanHtml.replace(/<button[\s\S]*?<\/button>/gi, '');
    cleanHtml = cleanHtml.replace(/<mat-icon[\s\S]*?<\/mat-icon>/gi, '');
    cleanHtml = cleanHtml.replace(/<div[^>]*class="[^"]*code-block-decoration[^"]*"[\s\S]*?<\/div>/gi, '');

    // Convert raw newlines inside paragraphs to <br> without affecting <pre>
    cleanHtml = cleanHtml.replace(/(<pre[\s\S]*?<\/pre>)|(\n(?=[^\s<]))/gi, (match, pre) => {
      return pre ? pre : '<br>';
    });

    const md = turndown.turndown(cleanHtml);
    return cleanMarkdown(md);
  }

  // Cloned HTMLElement to prevent mutating live page DOM
  const root = htmlStringOrElement.cloneNode(true) as HTMLElement;

  for (const sel of EXCLUDE_SELECTORS) {
    const els = root.querySelectorAll(sel);
    els.forEach(el => el.remove());
  }

  // Pre-process text newlines to <br> outside <pre>
  if (typeof document !== 'undefined' && typeof NodeFilter !== 'undefined' && typeof document.createTreeWalker === 'function') {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) {
      let p = current.parentElement;
      let inPre = false;
      while (p) {
        if (p.nodeName === 'PRE') {
          inPre = true;
          break;
        }
        p = p.parentElement;
      }
      if (!inPre && current.nodeValue && current.nodeValue.includes('\n')) {
        textNodes.push(current as Text);
      }
    }

    for (const node of textNodes) {
      const val = node.nodeValue || '';
      if (val.includes('\n')) {
        const parts = val.split('\n');
        const frag = document.createDocumentFragment();
        parts.forEach((part, idx) => {
          if (idx > 0) frag.appendChild(document.createElement('br'));
          if (part) frag.appendChild(document.createTextNode(part));
        });
        node.parentNode?.replaceChild(frag, node);
      }
    }
  }

  const md = turndown.turndown(root);
  return cleanMarkdown(md);
}

/**
 * Normalizes Markdown line endings and collapses multiple blank lines outside code blocks.
 */
function cleanMarkdown(md: string): string {
  const parts = md.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\r\n/g, '\n')
      .replace(/\n[ \t]+\n/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n');
  }
  return parts.join('').trim();
}
