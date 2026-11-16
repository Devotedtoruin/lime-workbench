// Pure XSS-safe Markdown-to-HTML converter for the Knowledge Notes workspace.
// Escapes all raw HTML first and restricts links exclusively to absolute http(s) URLs.

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return escapeHtml(parsed.href);
    }
  } catch { /* ignore invalid */ }
  return '';
}

function formatInline(raw) {
  let out = escapeHtml(raw);
  // Inline code first so markers inside backticks are preserved literally.
  const codeSlots = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSlots.length}\u0000`;
    codeSlots.push(`<code>${code}</code>`);
    return token;
  });

  // Safe external links [label](https://...)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const clean = safeHref(url);
    if (!clean) return label;
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold & Italic & Strikethrough
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Restore code spans
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeSlots[Number(idx)] || '');
  return out;
}

export function renderMarkdownSafe(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    return '<p class="md-empty">暂无正文内容，可在左侧开始撰写 Markdown 笔记。</p>';
  }

  const lines = text.split('\n');
  const html = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let listType = ''; // 'ul' | 'ol' | ''

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = '';
    }
  };

  for (const rawLine of lines) {
    const fence = rawLine.match(/^```([\w-]*)\s*$/);
    if (fence) {
      closeList();
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || '';
        codeLines = [];
      } else {
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
        html.push(`<pre${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    if (/^(?:---|\*\*\*|___)\s*$/.test(line)) {
      closeList();
      html.push('<hr />');
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${formatInline(quote[1])}</blockquote>`);
      continue;
    }

    const taskItem = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskItem) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        html.push('<ul class="md-task-list">');
      }
      const checked = taskItem[1].toLowerCase() === 'x';
      html.push(`<li class="${checked ? 'is-checked' : ''}"><span class="md-check">${checked ? '✓' : ''}</span><span>${formatInline(taskItem[2])}</span></li>`);
      continue;
    }

    const ulItem = line.match(/^[-*+]\s+(.+)$/);
    if (ulItem) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${formatInline(ulItem[1])}</li>`);
      continue;
    }

    const olItem = line.match(/^\d+\.\s+(.+)$/);
    if (olItem) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${formatInline(olItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${formatInline(line)}</p>`);
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();
  return html.join('\n');
}

export function noteWordStats(text) {
  const clean = String(text || '').trim();
  if (!clean) return { chars: 0, lines: 0, readMinutes: 0 };
  const chars = clean.replace(/\s+/g, '').length;
  const lines = clean.split(/\r?\n/).length;
  const readMinutes = Math.max(1, Math.ceil(chars / 360));
  return { chars, lines, readMinutes };
}
