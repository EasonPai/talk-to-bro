// markdown.js - Gemini DOM-to-Markdown Serializer

const EXCLUDE_SELECTORS = [
  'model-thoughts',
  'sources-list',
  'button',
  'mat-icon',
  '.code-block-decoration',
  'sup'
];

export function htmlToMarkdown(htmlStringOrElement) {
  let root;
  if (typeof htmlStringOrElement === 'string') {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(htmlStringOrElement, 'text/html');
      root = doc.body;
    } else {
      throw new Error('DOMParser required for string HTML conversion');
    }
  } else {
    root = htmlStringOrElement.cloneNode(true);
  }

  // 1. Remove excluded elements
  for (const sel of EXCLUDE_SELECTORS) {
    const els = root.querySelectorAll(sel);
    els.forEach(el => el.remove());
  }

  // 2. Recursive DOM serialization
  const rawMd = serializeNode(root);

  // 3. Clean up formatting: collapse excess blank lines and whitespace-only lines
  return rawMd
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function serializeNode(node, listDepth = 0, isOrdered = false, listIndex = 1) {
  if (!node) return '';

  if (node.nodeType === 3) { // Text node
    return node.nodeValue;
  }

  if (node.nodeType !== 1) { // Not an element
    return '';
  }

  const tag = node.tagName.toLowerCase();

  // Code block
  if (tag === 'pre') {
    const codeEl = node.querySelector('code');
    const codeText = codeEl ? codeEl.textContent : node.textContent;
    const lang = codeEl && codeEl.className ? (codeEl.className.match(/language-(\w+)/) || [])[1] || '' : '';
    return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`;
  }

  // Table handling
  if (tag === 'table') {
    return serializeTable(node);
  }

  // Lists
  if (tag === 'ul' || tag === 'ol') {
    const ordered = (tag === 'ol');
    let output = '\n';
    let idx = 1;
    for (const child of Array.from(node.children)) {
      if (child.tagName.toLowerCase() === 'li') {
        output += serializeListItem(child, listDepth, ordered, idx++) + '\n';
      }
    }
    return output + '\n';
  }

  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const prefix = '#'.repeat(level);
    return `\n${prefix} ${serializeChildren(node).trim()}\n\n`;
  }

  // Paragraph & Blockquote
  if (tag === 'p') {
    return `\n${serializeChildren(node).trim()}\n`;
  }
  if (tag === 'blockquote') {
    const inner = serializeChildren(node).trim();
    return `\n> ${inner.replace(/\n/g, '\n> ')}\n\n`;
  }

  // Inline formatting
  if (tag === 'strong' || tag === 'b') {
    return `**${serializeChildren(node).trim()}**`;
  }
  if (tag === 'em' || tag === 'i') {
    return `*${serializeChildren(node).trim()}*`;
  }
  if (tag === 'code') {
    return `\`${serializeChildren(node).trim()}\``;
  }
  if (tag === 'a') {
    const href = node.getAttribute('href') || '#';
    return `[${serializeChildren(node).trim()}](${href})`;
  }
  if (tag === 'br') {
    return '\n';
  }

  return serializeChildren(node, listDepth);
}

function serializeChildren(node, listDepth = 0) {
  let res = '';
  for (const child of Array.from(node.childNodes)) {
    res += serializeNode(child, listDepth);
  }
  return res;
}

function serializeListItem(liNode, depth, ordered, index) {
  const indent = '  '.repeat(depth);
  const prefix = ordered ? `${index}. ` : '- ';
  let text = '';
  let sublists = '';

  for (const child of Array.from(liNode.childNodes)) {
    if (child.nodeType === 1 && (child.tagName.toLowerCase() === 'ul' || child.tagName.toLowerCase() === 'ol')) {
      const subOrdered = child.tagName.toLowerCase() === 'ol';
      let subIdx = 1;
      for (const subLi of Array.from(child.children)) {
        if (subLi.tagName.toLowerCase() === 'li') {
          sublists += '\n' + serializeListItem(subLi, depth + 1, subOrdered, subIdx++);
        }
      }
    } else {
      text += serializeNode(child, depth);
    }
  }

  return `${indent}${prefix}${text.trim()}${sublists}`;
}

function serializeTable(tableNode) {
  const rows = Array.from(tableNode.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const tableData = [];
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('th, td')).map(c => serializeChildren(c).trim().replace(/\|/g, '\\|'));
    if (cells.length > 0) {
      tableData.push(cells);
    }
  }

  if (tableData.length === 0) return '';

  const maxCols = Math.max(...tableData.map(r => r.length));
  for (const row of tableData) {
    while (row.length < maxCols) row.push('');
  }

  let md = '\n';
  const header = tableData[0];
  md += '| ' + header.join(' | ') + ' |\n';
  md += '| ' + header.map(() => ':---').join(' | ') + ' |\n';

  for (let i = 1; i < tableData.length; i++) {
    md += '| ' + tableData[i].join(' | ') + ' |\n';
  }

  return md + '\n';
}
