const $ = (id) => document.getElementById(id);

let currentPage = null;
let siteUrl = null;

const log = (msg, cls = '') => {
  const line = document.createElement('div');
  line.textContent = msg;
  if (cls) line.className = cls;
  $('log').appendChild(line);
  $('log').scrollTop = $('log').scrollHeight;
};

async function detectCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    setPageError('No active tab');
    return;
  }

  const url = new URL(tab.url);
  if (!url.hostname.endsWith('.atlassian.net')) {
    setPageError('Not on a Confluence page. Open the Confluence page you want to export, then click the extension icon.');
    return;
  }
  siteUrl = `${url.protocol}//${url.hostname}`;

  let pageId = null;
  const pagesMatch = url.pathname.match(/\/pages\/(\d+)/);
  if (pagesMatch) {
    pageId = pagesMatch[1];
  } else {
    // Try to grab it from the page (short links like /wiki/x/xxxx or live docs)
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const meta = document.querySelector('meta[name="ajs-page-id"]');
          if (meta) return meta.content;
          const m = location.href.match(/\/pages\/(\d+)/);
          return m ? m[1] : null;
        }
      });
      if (result) pageId = result;
    } catch (e) { /* ignore */ }
  }

  if (!pageId) {
    setPageError('Could not detect a page ID on this URL. Open the full page URL (with /pages/{id}/) and try again.');
    return;
  }

  try {
    const resp = await apiFetch(`/wiki/rest/api/content/${pageId}?expand=space`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    currentPage = { id: pageId, title: data.title, spaceKey: data.space?.key };
    $('current-page').textContent = `${data.title}  (space: ${data.space?.key || '?'})`;
    $('export-btn').disabled = false;
  } catch (err) {
    setPageError(`Could not read page: ${err.message}. Make sure you are logged in to Confluence in this tab.`);
  }
}

function setPageError(msg) {
  const el = $('current-page');
  el.textContent = msg;
  el.classList.add('error');
  $('export-btn').disabled = true;
}

async function apiFetch(path) {
  return fetch(`${siteUrl}${path}`, {
    credentials: 'include',
    headers: { 'Accept': 'application/json', 'X-Atlassian-Token': 'no-check' }
  });
}

async function fetchPage(pageId) {
  const resp = await apiFetch(`/wiki/rest/api/content/${pageId}?expand=body.export_view`);
  if (!resp.ok) throw new Error(`Fetch page ${pageId}: HTTP ${resp.status}`);
  return resp.json();
}

async function fetchChildren(pageId) {
  const results = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const resp = await apiFetch(`/wiki/rest/api/content/${pageId}/child/page?limit=${limit}&start=${start}`);
    if (!resp.ok) throw new Error(`Fetch children ${pageId}: HTTP ${resp.status}`);
    const data = await resp.json();
    const batch = data.results || [];
    results.push(...batch);
    if (batch.length < limit) break;
    start += limit;
  }
  return results;
}

async function fetchPageTree(pageId, depth, maxDepth, counter) {
  const data = await fetchPage(pageId);
  counter.n++;
  log(`  [${counter.n}] ${data.title}`);
  const node = {
    id: data.id,
    title: data.title,
    body: data.body?.export_view?.value || '',
    children: []
  };
  if (maxDepth === 0 || depth < maxDepth) {
    const kids = await fetchChildren(pageId);
    for (const k of kids) {
      node.children.push(await fetchPageTree(k.id, depth + 1, maxDepth, counter));
    }
  }
  return node;
}

function safeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Rewrite relative Confluence URLs in HTML to absolute so links still resolve.
function rewriteUrls(html) {
  return html.replace(/(src|href)="\/(wiki|s|download)\//g, `$1="${siteUrl}/$2/`);
}

// Fetch every <img> src in the HTML, encode as base64, and inline as data URLs.
async function inlineImages(html) {
  const imgSrcRegex = /<img\b[^>]*?\bsrc="([^"]+)"/gi;
  const urls = new Set();
  let m;
  while ((m = imgSrcRegex.exec(html)) !== null) urls.add(m[1]);
  if (urls.size === 0) return html;

  const map = new Map();
  let done = 0;
  for (const u of urls) {
    try {
      const abs = u.startsWith('http') ? u : `${siteUrl}${u.startsWith('/') ? '' : '/'}${u}`;
      const resp = await fetch(abs, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      map.set(u, dataUrl);
    } catch (err) {
      log(`    image failed (${u.slice(0, 60)}): ${err.message}`, 'err');
    }
    done++;
  }
  return html.replace(imgSrcRegex, (full, src) => {
    const rep = map.get(src);
    return rep ? full.replace(`src="${src}"`, `src="${rep}"`) : full;
  });
}

function wrapDoc(title, html) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Calibri, sans-serif; font-size: 11pt; color: #172b4d; }
  h1, h2, h3, h4, h5, h6 { font-family: "Calibri Light", sans-serif; color: #2f5496; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  table { border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1px solid #999; padding: 4pt 6pt; vertical-align: top; }
  th { background: #f4f5f7; }
  code, pre { font-family: Consolas, "Courier New", monospace; background: #f4f5f7; }
  pre { padding: 8pt; border: 1px solid #dfe1e6; white-space: pre-wrap; }
  img { max-width: 16cm; }
  a { color: #0052cc; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${html}
</body>
</html>`;
}

function wrapHtml(title, html) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #172b4d; line-height: 1.5; }
  h1, h2, h3, h4 { color: #0052cc; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f4f5f7; }
  code, pre { font-family: Consolas, "Courier New", monospace; background: #f4f5f7; }
  pre { padding: 10px; border-radius: 4px; overflow-x: auto; }
  img { max-width: 100%; }
  a { color: #0052cc; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${html}
</body>
</html>`;
}

async function addTreeToZip(zip, node, format, embedImages, path = '') {
  const folderName = safeFilename(node.title);
  const ext = format === 'doc' ? 'doc' : 'html';

  let body = rewriteUrls(node.body);
  if (embedImages) body = await inlineImages(body);

  const content = format === 'doc' ? wrapDoc(node.title, body) : wrapHtml(node.title, body);

  if (node.children.length > 0) {
    const folderPath = path ? `${path}/${folderName}` : folderName;
    zip.file(`${folderPath}/${folderName}.${ext}`, content);
    for (const child of node.children) {
      await addTreeToZip(zip, child, format, embedImages, folderPath);
    }
  } else {
    const filePath = path ? `${path}/${folderName}.${ext}` : `${folderName}.${ext}`;
    zip.file(filePath, content);
  }
}

$('export-btn').addEventListener('click', async () => {
  if (!currentPage) return;

  const format = $('format').value;
  const includeChildren = $('include-children').checked;
  const embedImages = $('embed-images').checked;
  const rawDepth = parseInt($('max-depth').value, 10) || 0;
  const maxDepth = includeChildren ? rawDepth : 1;

  const btn = $('export-btn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Exporting…';
  $('progress').style.display = 'block';
  $('progress-fill').style.width = '0%';
  $('progress-text').textContent = '0%';
  $('log').textContent = '';

  try {
    log(`Fetching page tree from "${currentPage.title}"…`);
    const counter = { n: 0 };
    const tree = await fetchPageTree(currentPage.id, 0, maxDepth === 0 ? 999 : maxDepth, counter);
    log(`Fetched ${counter.n} page(s).`, 'ok');

    log('Building ZIP…');
    const zip = new JSZip();
    await addTreeToZip(zip, tree, format, embedImages);

    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        $('progress-fill').style.width = `${meta.percent}%`;
        $('progress-text').textContent = `${Math.round(meta.percent)}%`;
      }
    );

    const url = URL.createObjectURL(blob);
    const filename = `${safeFilename(currentPage.title)}-export.zip`;
    await new Promise((resolve, reject) => {
      chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    log(`Saved: ${filename}`, 'ok');
    btn.textContent = 'Done!';
  } catch (err) {
    log(`ERROR: ${err.message}`, 'err');
    btn.textContent = 'Export failed';
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }, 3000);
  }
});

detectCurrentPage();
