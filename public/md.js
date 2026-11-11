// A small Markdown reader for the marketing reports: headings, tables, lists, bold, code and web links.
// Everything is escaped first, so a report can never run script on the page. Also loads in Node for the tests.
(function (root) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function inline(t) {
    return esc(t)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

  function render(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s+|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i])) { para.push(inline(lines[i])); i++; }
      if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
      else i++;
    }
    return out.join('\n');
  }

  const api = { render, inline, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MD = api;
})(typeof window !== 'undefined' ? window : globalThis);
