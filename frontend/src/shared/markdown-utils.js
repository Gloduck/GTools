const MARKDOWN_STYLE = `<style data-markdown-renderer>
.markdown-rendered { color: inherit; font: inherit; line-height: 1.55; overflow-wrap: anywhere; word-break: normal; }
.markdown-rendered > * { margin: 0 0 0.75em; }
.markdown-rendered > *:last-child { margin-bottom: 0; }
.markdown-rendered h1,
.markdown-rendered h2,
.markdown-rendered h3,
.markdown-rendered h4,
.markdown-rendered h5,
.markdown-rendered h6 { margin: 1em 0 0.5em; color: inherit; font-weight: 700; line-height: 1.25; }
.markdown-rendered h1 { font-size: 1.7em; }
.markdown-rendered h2 { font-size: 1.45em; }
.markdown-rendered h3 { font-size: 1.25em; }
.markdown-rendered h4 { font-size: 1.1em; }
.markdown-rendered h5,
.markdown-rendered h6 { font-size: 1em; }
.markdown-rendered p { margin: 0 0 0.75em; }
.markdown-rendered ul,
.markdown-rendered ol { margin: 0 0 0.75em; padding-left: 1.5em; list-style-position: outside; }
.markdown-rendered ul { list-style: disc; }
.markdown-rendered ol { list-style: decimal; }
.markdown-rendered ul ul { list-style-type: circle; }
.markdown-rendered ul ul ul { list-style-type: square; }
.markdown-rendered li > ul,
.markdown-rendered li > ol { margin: 0.25em 0 0; }
.markdown-rendered li + li { margin-top: 0.25em; }
.markdown-rendered blockquote { margin: 0 0 0.75em; padding: 0 0 0 0.85em; border-left: 0.25em solid var(--border, #d0d7de); color: var(--muted, #57606a); }
.markdown-rendered pre { margin: 0 0 0.75em; overflow: auto; padding: 0.85em; border: 1px solid var(--border, #d0d7de); border-radius: 6px; background: var(--editor, #f6f8fa); color: inherit; line-height: 1.45; }
.markdown-rendered code { font-family: Consolas, 'Courier New', monospace; font-size: 0.92em; }
.markdown-rendered :not(pre) > code { padding: 0.15em 0.35em; border-radius: 4px; background: var(--input, rgba(175, 184, 193, 0.2)); }
.markdown-rendered a { color: var(--accent-strong, #0969da); text-decoration: underline; text-underline-offset: 0.15em; }
.markdown-rendered img { max-width: 100%; height: auto; border-radius: 4px; }
.markdown-rendered hr { height: 1px; margin: 1em 0; border: 0; background: var(--border, #d0d7de); }
.markdown-rendered table { display: block; width: 100%; margin: 0 0 0.75em; overflow: auto; border-spacing: 0; border-collapse: collapse; }
.markdown-rendered th,
.markdown-rendered td { padding: 0.4em 0.65em; border: 1px solid var(--border, #d0d7de); }
.markdown-rendered th { background: var(--input, #f6f8fa); font-weight: 700; }
.markdown-rendered tr:nth-child(2n) td { background: rgba(127, 127, 127, 0.08); }
.markdown-rendered .task-list-item { list-style: none; }
.markdown-rendered .task-list-item input { margin: 0 0.35em 0 -1.3em; vertical-align: middle; }
</style>`;
const BLACKLISTED_HTML_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base']);
const URL_HTML_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite', 'background']);

function renderMarkdown(content) {
    return `${MARKDOWN_STYLE}<div class="markdown-rendered">${renderMarkdownContent(content)}</div>`;
}

function renderMarkdownContent(content) {
    const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        if (!line.trim()) {
            index++;
            continue;
        }

        const fence = line.match(/^\s*```([^`]*)\s*$/);
        if (fence) {
            const codeLines = [];
            const language = fence[1].trim().split(/\s+/)[0];
            index++;
            while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
                codeLines.push(lines[index]);
                index++;
            }
            if (index < lines.length) index++;
            const className = language ? ` class="language-${escapeAttribute(language.replace(/[^\w-]/g, ''))}"` : '';
            html.push(`<pre><code${className}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        if (isTableStart(lines, index)) {
            const table = parseMarkdownTable(lines, index);
            html.push(table.html);
            index = table.nextIndex;
            continue;
        }

        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
            html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
            index++;
            continue;
        }

        if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            html.push('<hr>');
            index++;
            continue;
        }

        if (/^\s{0,3}>/.test(line)) {
            const quoteLines = [];
            while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
                index++;
            }
            html.push(`<blockquote>${renderMarkdownContent(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        const list = parseMarkdownList(lines, index);
        if (list) {
            html.push(list.html);
            index = list.nextIndex;
            continue;
        }

        const paragraphLines = [];
        while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
            paragraphLines.push(lines[index].trim());
            index++;
        }
        if (paragraphLines.length) {
            html.push(`<p>${paragraphLines.map(renderInlineMarkdown).join('<br>')}</p>`);
        } else {
            html.push(`<p>${renderInlineMarkdown(line.trim())}</p>`);
            index++;
        }
    }

    return html.join('');
}

function isMarkdownBlockStart(lines, index) {
    const line = lines[index];
    return /^\s*```/.test(line)
        || isTableStart(lines, index)
        || /^\s{0,3}#{1,6}\s+/.test(line)
        || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
        || /^\s{0,3}>/.test(line)
        || /^\s{0,3}(?:[-*+]|\d+[.)])\s+/.test(line);
}

function parseMarkdownList(lines, startIndex) {
    const first = getMarkdownListItem(lines[startIndex]);
    if (!first || first.indent > 3) return null;

    return parseMarkdownListAt(lines, startIndex, first.indent);
}

function parseMarkdownListAt(lines, startIndex, baseIndent) {
    const first = getMarkdownListItem(lines[startIndex]);
    if (!first || first.indent !== baseIndent) return null;

    const listType = first.type;
    const items = [];
    let index = startIndex;
    while (index < lines.length) {
        const item = getMarkdownListItem(lines[index]);
        if (!item || item.indent !== baseIndent || item.type !== listType) break;

        index++;
        const contentLines = [item.text];
        const nestedHtml = [];
        while (index < lines.length) {
            const line = lines[index];
            if (!line.trim()) {
                index++;
                break;
            }

            const nextItem = getMarkdownListItem(line);
            if (nextItem) {
                if (nextItem.indent > baseIndent) {
                    const nested = parseMarkdownListAt(lines, index, nextItem.indent);
                    if (nested) {
                        nestedHtml.push(nested.html);
                        index = nested.nextIndex;
                        continue;
                    }
                }
                break;
            }

            if (countMarkdownIndent(line) > baseIndent) {
                contentLines.push(line.slice(Math.min(line.length, baseIndent + 2)).trimEnd());
                index++;
                continue;
            }

            break;
        }

        items.push(renderMarkdownListItem(item, contentLines, nestedHtml.join(''), listType));
    }

    return { html: `<${listType}>${items.join('')}</${listType}>`, nextIndex: index };
}

function renderMarkdownListItem(item, contentLines, nestedHtml, listType) {
    const task = contentLines.length === 1 ? item.text.match(/^\[([ xX])\]\s+(.+)$/) : null;
    if (task && listType === 'ul') {
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        return `<li class="task-list-item"><input type="checkbox" disabled${checked}> ${renderInlineMarkdown(task[2])}${nestedHtml}</li>`;
    }

    const content = contentLines
        .map((line) => line.trim())
        .filter((line, lineIndex) => line || lineIndex === 0)
        .map(renderInlineMarkdown)
        .join('<br>');
    return `<li>${content}${nestedHtml}</li>`;
}

function getMarkdownListItem(line) {
    const match = String(line || '').match(/^([ \t]*)((?:[-*+])|\d+[.)])\s+(.*)$/);
    if (!match) return null;
    return {
        indent: countMarkdownIndent(match[1]),
        marker: match[2],
        type: /^\d/.test(match[2]) ? 'ol' : 'ul',
        text: match[3],
    };
}

function countMarkdownIndent(line) {
    let indent = 0;
    const whitespace = String(line || '').match(/^[ \t]*/)[0];
    for (const char of whitespace) indent += char === '\t' ? 4 : 1;
    return indent;
}

function isTableStart(lines, index) {
    return index + 1 < lines.length && isTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
}

function isTableRow(line) {
    return line.includes('|') && splitTableRow(line).length > 1;
}

function isTableSeparator(line) {
    const cells = splitTableRow(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownTable(lines, startIndex) {
    const headers = splitTableRow(lines[startIndex]);
    const alignments = splitTableRow(lines[startIndex + 1]).map((cell) => {
        const value = cell.trim();
        if (value.startsWith(':') && value.endsWith(':')) return 'center';
        if (value.endsWith(':')) return 'right';
        if (value.startsWith(':')) return 'left';
        return '';
    });

    let index = startIndex + 2;
    const rows = [];
    while (index < lines.length && lines[index].trim() && isTableRow(lines[index]) && !isTableSeparator(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index++;
    }

    const renderCell = (tag, value, cellIndex) => {
        const align = alignments[cellIndex] ? ` style="text-align: ${alignments[cellIndex]}"` : '';
        return `<${tag}${align}>${renderInlineMarkdown(value || '')}</${tag}>`;
    };
    const thead = `<thead><tr>${headers.map((cell, cellIndex) => renderCell('th', cell, cellIndex)).join('')}</tr></thead>`;
    const tbody = rows.length
        ? `<tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => renderCell('td', row[cellIndex] || '', cellIndex)).join('')}</tr>`).join('')}</tbody>`
        : '';

    return { html: `<table>${thead}${tbody}</table>`, nextIndex: index };
}

function splitTableRow(row) {
    let value = row.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);

    const cells = [];
    let current = '';
    let inCode = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === '`') inCode = !inCode;
        if (char === '|' && !inCode && value[i - 1] !== '\\') {
            cells.push(current.replace(/\\\|/g, '|').trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.replace(/\\\|/g, '|').trim());
    return cells;
}

function renderInlineMarkdown(content) {
    const tokens = [];
    const createToken = (html) => {
        const token = `\u0000${tokens.length}\u0000`;
        tokens.push(html);
        return token;
    };

    let html = String(content || '')
        .replace(/`([^`\n]+)`/g, (_, code) => createToken(`<code>${escapeHtml(code)}</code>`))
        .replace(/<\/?[a-zA-Z][^>\n]*>/g, (tag) => createToken(sanitizeHtmlTag(tag)));

    html = escapeHtml(html);

    html = html
        .replace(/!\[([^\]]*)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, url) => {
            const safeUrl = safeMarkdownUrl(url, true);
            return safeUrl ? `<img src="${escapeAttribute(safeUrl)}" alt="${escapeAttribute(alt)}">` : alt;
        })
        .replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text, url) => {
            const safeUrl = safeMarkdownUrl(url, false);
            return safeUrl ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
        })
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>');

    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
}

function sanitizeHtmlTag(tag) {
    const match = String(tag || '').match(/^<\s*(\/?)\s*([a-zA-Z][\w:-]*)([^>]*)>$/);
    if (!match) return escapeHtml(tag);

    const [, closingSlash, rawName, rawAttributes] = match;
    const tagName = rawName.toLowerCase();
    if (BLACKLISTED_HTML_TAGS.has(tagName)) return escapeHtml(tag);
    if (closingSlash) return `</${tagName}>`;

    const selfClosing = /\/\s*$/.test(rawAttributes);
    const attributes = sanitizeHtmlAttributes(rawAttributes.replace(/\/\s*$/, ''));
    return `<${tagName}${attributes}${selfClosing ? ' /' : ''}>`;
}

function sanitizeHtmlAttributes(attributes) {
    return String(attributes || '').replace(/\s+([^\s"'=<>`]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g, (fullMatch, rawName, rawValue) => {
        const name = rawName.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') return '';
        if (rawValue == null) return ` ${rawName}`;

        const unquotedValue = rawValue.replace(/^(["'])(.*)\1$/, '$2');
        if (URL_HTML_ATTRIBUTES.has(name) && !safeMarkdownUrl(unquotedValue, name === 'src')) return '';
        return ` ${rawName}=${escapeAttributeValue(rawValue)}`;
    });
}

function escapeAttributeValue(value) {
    const quote = value.startsWith("'") ? "'" : '"';
    const unquotedValue = value.replace(/^(["'])(.*)\1$/, '$2');
    return `${quote}${escapeHtml(unquotedValue).replace(/'/g, '&#39;')}${quote}`;
}

function safeMarkdownUrl(url, allowDataImage) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/[\u0000-\u001f\u007f]/.test(value) || /\s/.test(value)) return '';
    const lowerValue = value.toLowerCase();
    if (allowDataImage && /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);base64,/.test(lowerValue)) return value;
    if (/^(?:https?:|mailto:|tel:)/i.test(value)) return value;
    const normalized = value.replace(/\\/g, '/');
    if (!/^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(normalized)) return value;
    return '';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
}

const MarkdownUtils = {
    renderMarkdown,
    escapeHtml,
};

export { MarkdownUtils };
