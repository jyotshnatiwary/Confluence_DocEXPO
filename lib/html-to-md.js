// html-to-md.js - Small, dependency-free HTML -> Markdown converter for
// Confluence export_view HTML. Exposes window.CBE_htmlToMarkdown(html).

(function () {
  const BLOCK = new Set(['p','h1','h2','h3','h4','h5','h6','ul','ol','pre','blockquote','table','hr','div','section','article','header','footer','figure','figcaption']);

  function esc(s) {
    return s.replace(/([\\`*_{}\[\]()#+\-!>|])/g, '\\$1');
  }

  function collapseWs(s) {
    return s.replace(/[\t\r\n ]+/g, ' ');
  }

  function inline(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += esc(collapseWs(child.textContent));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      switch (tag) {
        case 'strong':
        case 'b':
          out += '**' + inline(child).trim() + '**';
          break;
        case 'em':
        case 'i':
          out += '*' + inline(child).trim() + '*';
          break;
        case 'u':
          out += '<u>' + inline(child) + '</u>';
          break;
        case 's':
        case 'strike':
        case 'del':
          out += '~~' + inline(child).trim() + '~~';
          break;
        case 'code':
          out += '`' + child.textContent + '`';
          break;
        case 'br':
          out += '  \n';
          break;
        case 'a': {
          const href = child.getAttribute('href') || '';
          const text = inline(child).trim() || href;
          out += href ? '[' + text + '](' + href + ')' : text;
          break;
        }
        case 'img': {
          const src = child.getAttribute('src') || '';
          const alt = child.getAttribute('alt') || '';
          out += '![' + alt + '](' + src + ')';
          break;
        }
        case 'span':
        default:
          out += inline(child);
      }
    }
    return out;
  }

  function listItems(listNode, ordered, depth) {
    const indent = '  '.repeat(depth);
    let out = '';
    let idx = 1;
    for (const li of listNode.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const marker = ordered ? (idx + '. ') : '- ';
      idx++;

      // Collect direct inline content vs nested lists / blocks
      let firstLine = '';
      const nested = [];
      for (const c of li.childNodes) {
        if (c.nodeType === 1) {
          const t = c.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') {
            nested.push(listItems(c, t === 'ol', depth + 1));
            continue;
          }
          if (BLOCK.has(t) && t !== 'p') {
            nested.push(blocks(c, depth + 1));
            continue;
          }
        }
        // Inline / text / <p>
        if (c.nodeType === 1 && c.tagName.toLowerCase() === 'p') {
          firstLine += inline(c);
        } else {
          firstLine += (c.nodeType === 1) ? inline(c) : esc(collapseWs(c.textContent));
        }
      }
      out += indent + marker + firstLine.trim() + '\n';
      for (const n of nested) out += n;
    }
    return out;
  }

  function table(node) {
    const rows = node.querySelectorAll('tr');
    if (!rows.length) return '';
    let out = '';
    let widths = 0;
    rows.forEach((row, ri) => {
      const cells = row.querySelectorAll('th,td');
      widths = Math.max(widths, cells.length);
      const parts = [];
      cells.forEach((cell) => {
        parts.push(inline(cell).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim() || ' ');
      });
      out += '| ' + parts.join(' | ') + ' |\n';
      if (ri === 0) {
        out += '|' + Array(cells.length).fill(' --- ').join('|') + '|\n';
      }
    });
    // Handle tables with no <th> row (add a synthetic header separator after row 0)
    return out + '\n';
  }

  function blocks(root, listDepth = 0) {
    let out = '';
    for (const child of root.childNodes) {
      if (child.nodeType === 3) {
        const t = collapseWs(child.textContent).trim();
        if (t) out += esc(t) + '\n\n';
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      switch (tag) {
        case 'h1': out += '# '      + inline(child).trim() + '\n\n'; break;
        case 'h2': out += '## '     + inline(child).trim() + '\n\n'; break;
        case 'h3': out += '### '    + inline(child).trim() + '\n\n'; break;
        case 'h4': out += '#### '   + inline(child).trim() + '\n\n'; break;
        case 'h5': out += '##### '  + inline(child).trim() + '\n\n'; break;
        case 'h6': out += '###### ' + inline(child).trim() + '\n\n'; break;
        case 'p': {
          const text = inline(child).trim();
          if (text) out += text + '\n\n';
          break;
        }
        case 'br':
          out += '\n';
          break;
        case 'hr':
          out += '---\n\n';
          break;
        case 'ul':
          out += listItems(child, false, listDepth) + '\n';
          break;
        case 'ol':
          out += listItems(child, true, listDepth) + '\n';
          break;
        case 'pre': {
          const code = child.textContent.replace(/\r\n/g, '\n');
          out += '```\n' + code.replace(/\n+$/, '') + '\n```\n\n';
          break;
        }
        case 'blockquote': {
          const inner = blocks(child).trim();
          if (inner) out += inner.split('\n').map(l => l ? '> ' + l : '>').join('\n') + '\n\n';
          break;
        }
        case 'table':
          out += table(child);
          break;
        case 'img': {
          const src = child.getAttribute('src') || '';
          const alt = child.getAttribute('alt') || '';
          out += '![' + alt + '](' + src + ')\n\n';
          break;
        }
        default:
          out += blocks(child, listDepth);
      }
    }
    return out;
  }

  window.CBE_htmlToMarkdown = function (title, html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const body = doc.body || doc.documentElement;
    const bodyMd = blocks(body).replace(/\n{3,}/g, '\n\n').trim();
    const header = title ? ('# ' + title + '\n\n') : '';
    return header + bodyMd + '\n';
  };
})();
