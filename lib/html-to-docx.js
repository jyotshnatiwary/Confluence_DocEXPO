// html-to-docx.js - Small, dependency-free HTML -> Office Open XML (.docx)
// generator for Confluence export_view HTML. Exposes
//   window.CBE_buildDocx(title, html, JSZip)  ->  Promise<Uint8Array>
//
// Produces a valid, minimal, structured .docx (word/document.xml + styles.xml
// + [Content_Types].xml + rels), compatible with Word, LibreOffice, Google
// Docs, and most translation engines including IBM Transition Engine.

(function () {

  // ------------------------------------------------------------------ XML utils

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Runs (<w:r>) — inline text with optional formatting flags.
  function runXml(text, fmt) {
    if (!text) return '';
    fmt = fmt || {};
    const rPr = [];
    if (fmt.bold)      rPr.push('<w:b/>');
    if (fmt.italic)    rPr.push('<w:i/>');
    if (fmt.underline) rPr.push('<w:u w:val="single"/>');
    if (fmt.strike)    rPr.push('<w:strike/>');
    if (fmt.mono)      rPr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    if (fmt.color)     rPr.push('<w:color w:val="' + fmt.color + '"/>');
    if (fmt.sz)        rPr.push('<w:sz w:val="' + fmt.sz + '"/>');
    const rPrXml = rPr.length ? '<w:rPr>' + rPr.join('') + '</w:rPr>' : '';
    // xml:space="preserve" keeps leading/trailing spaces intact
    return '<w:r>' + rPrXml + '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
  }

  function breakRun() { return '<w:r><w:br/></w:r>'; }

  function paragraphXml(runsXml, opts) {
    opts = opts || {};
    const pPr = [];
    if (opts.style) pPr.push('<w:pStyle w:val="' + opts.style + '"/>');
    if (opts.numId != null) {
      pPr.push('<w:numPr><w:ilvl w:val="' + (opts.ilvl || 0) + '"/><w:numId w:val="' + opts.numId + '"/></w:numPr>');
    }
    if (opts.indent) pPr.push('<w:ind w:left="' + opts.indent + '"/>');
    if (opts.align) pPr.push('<w:jc w:val="' + opts.align + '"/>');
    const pPrXml = pPr.length ? '<w:pPr>' + pPr.join('') + '</w:pPr>' : '';
    return '<w:p>' + pPrXml + (runsXml || '') + '</w:p>';
  }

  // ------------------------------------------------------------------ inline walker

  // Walk element children producing an XML string of runs, honouring
  // current formatting context (bold/italic/etc).
  function inlineRuns(node, fmt) {
    fmt = fmt || {};
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/[\t\r\n]+/g, ' ');
        if (t) out += runXml(t, fmt);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      const nextFmt = Object.assign({}, fmt);
      switch (tag) {
        case 'strong':
        case 'b':      nextFmt.bold = true;      out += inlineRuns(child, nextFmt); break;
        case 'em':
        case 'i':      nextFmt.italic = true;    out += inlineRuns(child, nextFmt); break;
        case 'u':      nextFmt.underline = true; out += inlineRuns(child, nextFmt); break;
        case 's':
        case 'strike':
        case 'del':    nextFmt.strike = true;    out += inlineRuns(child, nextFmt); break;
        case 'code':   nextFmt.mono = true;      out += inlineRuns(child, nextFmt); break;
        case 'a': {
          const href = child.getAttribute('href') || '';
          const linkFmt = Object.assign({}, fmt, { color: '0563C1', underline: true });
          const linkRuns = inlineRuns(child, linkFmt);
          out += linkRuns;
          if (href && !child.textContent.includes(href) && child.textContent.trim() !== href) {
            out += runXml(' (' + href + ')', fmt);
          }
          break;
        }
        case 'br': out += breakRun(); break;
        case 'img': {
          const alt = child.getAttribute('alt') || '';
          out += runXml('[image' + (alt ? ': ' + alt : '') + ']', Object.assign({}, fmt, { italic: true, color: '808080' }));
          break;
        }
        case 'span':
        case 'font':
        case 'small':
        case 'mark':
        default:
          out += inlineRuns(child, fmt);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ block walker

  function isHeading(tag) { return tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6'; }

  // Lists: we register a numId per list to reference numbering.xml.
  // For simplicity we use a single numbered list definition (numId=1)
  // and a single bulleted list definition (numId=2). Nested lists reuse
  // the same numId with a higher ilvl.
  const BULLET_NUM_ID = 2;
  const ORDER_NUM_ID  = 1;

  function listBlocks(listNode, ordered, ilvl) {
    let out = '';
    for (const li of listNode.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      // First paragraph = inline content of <li>
      let liRuns = '';
      const nested = [];
      for (const c of li.childNodes) {
        if (c.nodeType === 1) {
          const t = c.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') {
            nested.push(listBlocks(c, t === 'ol', Math.min(ilvl + 1, 8)));
            continue;
          }
          if (t === 'p') { liRuns += inlineRuns(c); continue; }
        }
        // text or inline element
        if (c.nodeType === 1) liRuns += inlineRuns(c);
        else if (c.nodeType === 3) {
          const txt = c.textContent.replace(/\s+/g, ' ');
          if (txt.trim()) liRuns += runXml(txt);
        }
      }
      out += paragraphXml(liRuns || runXml(' '), {
        style: 'ListParagraph',
        numId: ordered ? ORDER_NUM_ID : BULLET_NUM_ID,
        ilvl: ilvl
      });
      for (const n of nested) out += n;
    }
    return out;
  }

  function tableXml(node) {
    const rows = node.querySelectorAll('tr');
    if (!rows.length) return '';
    // Determine grid width
    let cols = 0;
    rows.forEach(r => { cols = Math.max(cols, r.querySelectorAll('th,td').length); });
    if (!cols) return '';

    let grid = '<w:tblGrid>';
    for (let i = 0; i < cols; i++) grid += '<w:gridCol w:w="' + Math.floor(9000 / cols) + '"/>';
    grid += '</w:tblGrid>';

    let out = '<w:tbl>' +
      '<w:tblPr>' +
      '<w:tblW w:type="dxa" w:w="9000"/>' +
      '<w:tblBorders>' +
        '<w:top w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:left w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:bottom w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:right w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:insideH w:val="single" w:sz="4" w:color="999999"/>' +
        '<w:insideV w:val="single" w:sz="4" w:color="999999"/>' +
      '</w:tblBorders>' +
      '</w:tblPr>' +
      grid;

    rows.forEach((row) => {
      out += '<w:tr>';
      const cells = row.querySelectorAll('th,td');
      cells.forEach((cell) => {
        const isHeader = cell.tagName.toLowerCase() === 'th';
        const cellW = Math.floor(9000 / cols);
        const runs = inlineRuns(cell, isHeader ? { bold: true } : {});
        out += '<w:tc>' +
          '<w:tcPr><w:tcW w:type="dxa" w:w="' + cellW + '"/>' +
          (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F4F5F7"/>' : '') +
          '</w:tcPr>' +
          paragraphXml(runs || runXml(' ')) +
          '</w:tc>';
      });
      out += '</w:tr>';
    });
    out += '</w:tbl>';
    // Word requires an empty paragraph after a table
    out += paragraphXml('');
    return out;
  }

  function walkBlocks(root, listDepth) {
    listDepth = listDepth || 0;
    let out = '';
    for (const child of root.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, ' ').trim();
        if (t) out += paragraphXml(runXml(t));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (isHeading(tag)) {
        out += paragraphXml(inlineRuns(child), { style: 'Heading' + tag[1] });
        continue;
      }
      switch (tag) {
        case 'p': {
          const runs = inlineRuns(child);
          out += paragraphXml(runs || runXml(' '));
          break;
        }
        case 'br':
          out += paragraphXml('');
          break;
        case 'hr':
          out += paragraphXml(runXml('_______________________________________'), { align: 'center' });
          break;
        case 'ul':
          out += listBlocks(child, false, listDepth);
          break;
        case 'ol':
          out += listBlocks(child, true, listDepth);
          break;
        case 'pre': {
          const code = child.textContent.replace(/\r\n/g, '\n');
          for (const line of code.split('\n')) {
            out += paragraphXml(runXml(line, { mono: true }), { style: 'CodeBlock' });
          }
          break;
        }
        case 'blockquote':
          out += walkBlocks(child, listDepth).replace(/<w:p>/g, '<w:p><w:pPr><w:ind w:left="720"/><w:pStyle w:val="Quote"/></w:pPr>').replace(/<w:pPr><w:ind w:left="720"\/><w:pStyle w:val="Quote"\/><\/w:pPr><w:pPr>/g, '<w:pPr><w:ind w:left="720"/><w:pStyle w:val="Quote"/>');
          break;
        case 'table':
          out += tableXml(child);
          break;
        case 'img': {
          const alt = child.getAttribute('alt') || '';
          out += paragraphXml(runXml('[image' + (alt ? ': ' + alt : '') + ']', { italic: true, color: '808080' }));
          break;
        }
        case 'figure':
        case 'section':
        case 'article':
        case 'div':
        case 'header':
        case 'footer':
        case 'main':
        case 'aside':
          out += walkBlocks(child, listDepth);
          break;
        default:
          // Unknown element: try inline first, if it has block children walk them
          const hasBlock = Array.from(child.children).some(c => ['p','ul','ol','table','pre','blockquote','div'].includes(c.tagName.toLowerCase()) || isHeading(c.tagName.toLowerCase()));
          if (hasBlock) out += walkBlocks(child, listDepth);
          else {
            const runs = inlineRuns(child);
            if (runs) out += paragraphXml(runs);
          }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ static docx parts

  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '</Relationships>';

  const SETTINGS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:zoom w:percent="100"/>' +
    '<w:defaultTabStop w:val="720"/>' +
    '<w:characterSpacingControl w:val="doNotCompress"/>' +
    '</w:settings>';

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults>' +
      '<w:rPrDefault><w:rPr>' +
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
        '<w:sz w:val="22"/>' +
        '<w:lang w:val="en-US"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="40"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="28"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="Heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/><w:color w:val="2F5496"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="Heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="Heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F5F7"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>' +
    '</w:styles>';

  const NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    // Abstract format for numbered list (ordered)
    '<w:abstractNum w:abstractNumId="0">' +
      lvlXml(0, 'decimal', '%1.', 720) +
      lvlXml(1, 'lowerLetter', '%2.', 1440) +
      lvlXml(2, 'lowerRoman', '%3.', 2160) +
      lvlXml(3, 'decimal', '%4.', 2880) +
      lvlXml(4, 'lowerLetter', '%5.', 3600) +
    '</w:abstractNum>' +
    // Abstract format for bullet list
    '<w:abstractNum w:abstractNumId="1">' +
      bulletLvl(0, '•', 720) +
      bulletLvl(1, '◦', 1440) +
      bulletLvl(2, '▪', 2160) +
      bulletLvl(3, '•', 2880) +
      bulletLvl(4, '◦', 3600) +
    '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '</w:numbering>';

  function lvlXml(i, fmt, text, indent) {
    return '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/>' +
      '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="' + indent + '" w:hanging="360"/></w:pPr></w:lvl>';
  }
  function bulletLvl(i, char, indent) {
    return '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="' + char + '"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="' + indent + '" w:hanging="360"/></w:pPr>' +
      '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' +
      '</w:lvl>';
  }

  function coreXml(title) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xmlEsc(title || '') + '</dc:title>' +
      '<dc:creator>Confluence Bulk Exporter</dc:creator>' +
      '<cp:lastModifiedBy>Confluence Bulk Exporter</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  const APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Confluence Bulk Exporter</Application>' +
    '</Properties>';

  // ------------------------------------------------------------------ public API

  window.CBE_buildDocx = async function (title, html, JSZip) {
    const parsed = new DOMParser().parseFromString(html || '', 'text/html');
    const bodyEl = parsed.body || parsed.documentElement;

    // Prepend a heading with the page title so Translation Engine sees it
    let bodyXml = paragraphXml(inlineRuns({ childNodes: [document.createTextNode(title || '')] }), { style: 'Heading1' });
    bodyXml += walkBlocks(bodyEl);
    if (!bodyXml.includes('<w:p')) bodyXml = paragraphXml(runXml(' '));

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + bodyXml +
      '<w:sectPr>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
        '<w:cols w:space="720"/>' +
        '<w:docGrid w:linePitch="360"/>' +
      '</w:sectPr>' +
      '</w:body></w:document>';

    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('word/document.xml', documentXml);
    zip.file('word/_rels/document.xml.rels', DOC_RELS);
    zip.file('word/styles.xml', STYLES);
    zip.file('word/numbering.xml', NUMBERING);
    zip.file('word/settings.xml', SETTINGS);
    zip.file('docProps/core.xml', coreXml(title));
    zip.file('docProps/app.xml', APP_XML);

    return zip.generateAsync({
      type: 'uint8array',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  };
})();
