// HTML versions of emails, sent alongside the plain text. Posts and SU chat
// messages are markdown; it's rendered with inline styles because most mail
// apps drop <style> blocks.
// @deno-types="@types/markdown-it"
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import { escapeHtml, siteUrl } from './strings.ts';
import { markdownToText, truncate } from './markdown.ts';

// Gmail hides anything past 102 KB behind "View entire message".
const MAX_HTML = 90000;
// markdown-it pads every table row out to the header's width, so a few lines
// of pipes can turn into megabytes of cells.
const MAX_TABLE_CELLS = 2000;

const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = 'Menlo,Consolas,monospace';
const LINE = '#d0d0d0';
const FILL = '#f2f2f2';

// Light fills also set their text colour, so they stay readable when a mail
// app darkens the page around them.
const STYLES: Record<string, string> = {
    h1: 'font-size:22px;margin:0 0 12px',
    h2: 'font-size:19px;margin:18px 0 8px',
    h3: 'font-size:17px;margin:16px 0 6px',
    h4: 'font-size:15px;margin:14px 0 4px',
    p: 'margin:0 0 12px',
    ul: 'margin:0 0 12px;padding-left:24px',
    ol: 'margin:0 0 12px;padding-left:24px',
    blockquote:
        `margin:0 0 12px;padding:0 0 0 12px;border-left:3px solid ${LINE};color:#555555`,
    code:
        `font-family:${MONO};font-size:13px;background:${FILL};color:#1a1a1a;padding:1px 4px;border-radius:4px`,
    mark: 'background:#fff1a6;color:#1a1a1a;padding:0 2px',
    table: 'border-collapse:collapse',
    th: `border:1px solid ${LINE};padding:4px 8px;background:${FILL};color:#1a1a1a;text-align:left`,
    td: `border:1px solid ${LINE};padding:4px 8px`,
    hr: `border:0;border-top:1px solid ${LINE};margin:16px 0`,
    a: 'color:#1a5fb4',
};
STYLES.h5 = STYLES.h6 = STYLES.h4;
const TEXT_BLOCKS = new Set([
    'p',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'td',
    'th',
]);
const PRE =
    `font-family:${MONO};font-size:13px;background:${FILL};color:#1a1a1a;padding:10px;border-radius:6px;white-space:pre-wrap;overflow-wrap:break-word;margin:0 0 12px`;

const SAFE_SCHEME = /^(https?|mailto|tel):/i;

const normalizeHref = (href: string) => {
    if (href.startsWith('//')) return `https:${href}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    if (/^[/#?.]/.test(href)) {
        const site = siteUrl();
        try {
            return site ? new URL(href, `${site}/`).href : href;
        } catch {
            return href;
        }
    }
    return `https://${href}`;
};

const hostOf = (value: string) => {
    try {
        const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
            ? value
            : `https://${value}`;
        return new URL(url).hostname.replace(/^www\./, '').replace(/\.$/, '');
    } catch {
        return null;
    }
};

const looksLikeUrl = (text: string) =>
    /^(https?:\/\/|www\.)\S+$|^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)+\.?(:\d+)?([/?#]\S*)?$/iu
        .test(text);

// Link text that reads as an address must match where the link goes.
const honestLabel = (label: string, href: string) => {
    const text = label.trim();
    return looksLikeUrl(text) && hostOf(text) !== hostOf(href) ? href : label;
};

const tableCells = (source: string) => {
    const lines = source.split('\n').map((line) =>
        line.replace(/^[ \t>]*/, '')
    );
    let cells = 0;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes('-') || !/^[|:\- \t]+$/.test(line)) continue;
        const columns = Math.max(
            lines[i - 1].split('|').length,
            line.split('|').length,
        );
        let rows = 1;
        while (i + rows < lines.length && lines[i + rows].trim()) rows++;
        cells += columns * rows;
        i += rows - 1;
    }
    return cells;
};

const createRenderer = () => {
    const md = new MarkdownIt('default', {
        html: false,
        linkify: true,
        breaks: true,
    }).use(markPlugin);
    const rules = md.renderer.rules;
    // Match the site: only link addresses that start with a scheme, and show
    // punycode as written so lookalike domains stay visible.
    md.linkify.set({ fuzzyLink: false });
    md.normalizeLinkText = (text) => text;

    // The editor writes underline as <u>; it and <mark> are the only tags kept.
    const allowedTag = /<\/?(u|mark)>/iy;
    md.inline.ruler.before('html_inline', 'allowed_tags', (state, silent) => {
        if (state.src.charCodeAt(state.pos) !== 0x3c) return false;
        allowedTag.lastIndex = state.pos;
        const match = allowedTag.exec(state.src);
        if (!match) return false;
        if (!silent) {
            const tag = match[0].toLowerCase();
            state.push('html_inline', '', 0).content = tag === '<mark>'
                ? HIGHLIGHT
                : tag === '</mark>'
                ? '</span>'
                : tag;
        }
        state.pos += match[0].length;
        return true;
    });

    md.core.ruler.push('email', (state) => {
        const tokens = state.tokens;
        // Drop an opening heading that repeats the post title.
        const title = state.env?.title?.trim().toLowerCase();
        if (
            title && tokens[0]?.type === 'heading_open' &&
            tokens[1]?.content.trim().toLowerCase() === title
        ) tokens.splice(0, 3);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            // The email title is the h1, so headings in the body move down one.
            if (/^h[1-6]$/.test(token.tag)) {
                token.tag = `h${Math.min(Number(token.tag[1]) + 1, 6)}`;
            }
            style(token);
            // no gap under a sub-list, before the next item
            if (
                /^(bullet|ordered)_list_open$/.test(token.type) &&
                tokens[i - 1]?.type === 'paragraph_close' &&
                tokens[i - 1].hidden
            ) {
                token.attrSet(
                    'style',
                    `${token.attrGet('style')};margin-bottom:0`,
                );
            }
            if (token.type !== 'inline' || !token.children) continue;

            // task list items
            const first = token.children[0];
            if (
                tokens[i - 2]?.type === 'list_item_open' &&
                first?.type === 'text'
            ) {
                const task = /^\[([ xX])\](?:\s+|$)/.exec(first.content);
                if (task) {
                    first.content = (task[1] === ' ' ? '☐ ' : '☑ ') +
                        first.content.slice(task[0].length);
                    tokens[i - 2].attrSet('style', 'list-style:none');
                }
            }

            const children = token.children;
            for (let j = 0; j < children.length; j++) {
                const child = children[j];
                style(child);
                if (child.type !== 'link_open') continue;
                let end = j + 1;
                while (
                    end < children.length && children[end].type !== 'link_close'
                ) end++;

                const href = normalizeHref(child.attrGet('href') ?? '');
                if (!SAFE_SCHEME.test(href)) {
                    // keep the text, drop the link
                    children.splice(end, 1);
                    children.splice(j--, 1);
                    continue;
                }
                child.attrSet('href', href);

                const inner = children.slice(j + 1, end);
                for (const c of inner) {
                    if (c.type === 'image') c.meta = { inLink: true };
                }
                const label = inner
                    .filter((c) =>
                        ['text', 'code_inline', 'image'].includes(c.type)
                    )
                    .map((c) => c.content)
                    .join('');
                if (honestLabel(label, href) !== label) {
                    const text = new state.Token('text', '', 0);
                    text.content = href;
                    children.splice(j + 1, inner.length, text);
                }
            }
        }
    });

    // Remote images would let a sender log who opened the email, so link them.
    rules.mark_open = () => HIGHLIGHT;
    rules.mark_close = () => '</span>';
    rules.table_open = (tokens, idx, options, _env, self) =>
        `<div style="overflow-x:auto;margin:0 0 12px">${
            self.renderToken(tokens, idx, options)
        }`;
    rules.table_close = (tokens, idx, options, _env, self) =>
        `${self.renderToken(tokens, idx, options)}</div>\n`;

    rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const alt =
            self.renderInlineAsText(token.children ?? [], options, env) ||
            'Image';
        const src = normalizeHref(token.attrGet('src') ?? '');
        if (token.meta?.inLink || !/^https?:/i.test(src)) {
            return escapeHtml(alt);
        }
        return `<a href="${escapeHtml(src)}" style="${STYLES.a}">${
            escapeHtml(honestLabel(alt, src))
        } (image)</a>`;
    };

    const pre: MarkdownIt['renderer']['rules']['fence'] = (tokens, idx) =>
        `<pre style="${PRE}">${escapeHtml(tokens[idx].content)}</pre>\n`;
    rules.fence = pre;
    rules.code_block = pre;
    return md;
};

type Token = ReturnType<MarkdownIt['parse']>[number];
function style(token: Token) {
    if (token.nesting < 0) return;
    if (TEXT_BLOCKS.has(token.tag)) token.attrSet('dir', 'auto');
    const css = STYLES[token.tag];
    if (!css) return;
    const existing = token.attrGet('style');
    token.attrSet('style', existing ? `${css};${existing}` : css);
}

const HIGHLIGHT = `<span style="${STYLES.mark}">`;
const md = createRenderer();
const mdWithoutTables = createRenderer().disable('table');

// title: the post title, so a first heading repeating it is dropped
export const markdownToHtml = (markdown: string, title?: string): string => {
    const source = truncate(markdown);
    const renderer = tableCells(source) > MAX_TABLE_CELLS
        ? mdWithoutTables
        : md;
    const html = renderer.render(source, { title });
    return html.length > MAX_HTML ? textToHtml(markdownToText(markdown)) : html;
};

export const emailTitle = (title: string): string =>
    `<h1 dir="auto" style="${STYLES.h1}">${escapeHtml(title)}</h1>`;

export const emailLink = (href: string, label: string): string =>
    `<a href="${escapeHtml(href)}" style="${STYLES.a}">${
        escapeHtml(label)
    }</a>`;

// For the fixed parts of an email: paragraphs, line breaks, links, addresses.
const linkUrls = (text: string) => {
    let out = '';
    let last = 0;
    for (
        const match of text.matchAll(
            /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
        )
    ) {
        const href = match[0].includes('://') ? match[0] : `mailto:${match[0]}`;
        out += escapeHtml(text.slice(last, match.index)) +
            emailLink(href, match[0]);
        last = match.index + match[0].length;
    }
    return out + escapeHtml(text.slice(last));
};

export const textToHtml = (text: string): string =>
    text
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) =>
            `<p dir="auto" style="${STYLES.p}">${
                linkUrls(paragraph).replace(/\n/g, '<br>')
            }</p>`
        )
        .join('\n');

// The preview line inbox lists show next to the subject.
const preheader = (text: string) =>
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${
        escapeHtml(text.replace(/\s+/g, ' ').trim().slice(0, 140))
    }${'&nbsp;&zwnj;'.repeat(60)}</div>`;

export const emailDocument = (
    body: string,
    { title, preview }: { title: string; preview: string },
): string =>
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
@media (prefers-color-scheme: dark) {
  a { color: #8ab4f8 !important; }
  blockquote { color: inherit !important; }
}
</style>
<!--[if mso]><style>body,div,p,li,td,th,h1,h2,h3,h4{font-family:Arial,sans-serif !important}</style><![endif]-->
</head>
<body style="margin:0;padding:0">
${preheader(preview)}
<div style="font-family:${FONT};font-size:15px;line-height:1.5;max-width:640px;padding:16px;overflow-wrap:break-word">
${body}
</div>
</body>
</html>`;
