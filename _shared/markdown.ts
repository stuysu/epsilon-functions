// Posts and SU chat messages are written in markdown, but emails go out as
// plain text, so strip the syntax that reads badly there.
const MAX_LENGTH = 20000;
const MARK = '';

// Bold, highlight and strikethrough, unwrapped again for nested ones like
// **==text==**. Spans are capped so unclosed markers can't make this slow.
const PAIRED = /(\*\*|__|==|~~)(?=\S)([^\n]{0,1000}?\S)\1/g;
const unwrapPaired = (_: string, _marker: string, inner: string): string =>
    inner.replace(PAIRED, unwrapPaired);

// Cut long posts short without splitting an emoji in half.
export const truncate = (text: string): string => {
    if (text.length <= MAX_LENGTH) return text;
    const end = /[\uD800-\uDBFF]/.test(text[MAX_LENGTH - 1])
        ? MAX_LENGTH - 1
        : MAX_LENGTH;
    return `${text.slice(0, end)}…`;
};

export const markdownToText = (markdown: string): string => {
    const source = truncate(markdown.replaceAll(MARK, ''));

    // set escaped characters aside so they aren't read as syntax
    const escaped: string[] = [];
    const text = source.replace(
        /\\([\\`*_{}[\]()#+\-.!<>|~=])/g,
        (_, ch) => `${MARK}${escaped.push(ch) - 1}${MARK}`,
    );

    return text
        // underline/highlight tags the editor writes
        .replace(/<\/?(u|mark)>/g, '')
        // headings
        .replace(/^#{1,6}[ \t]+/gm, '')
        // code fences and inline code
        .replace(/^[ \t]*```[^\n]*\n?/gm, '')
        .replace(/`([^`\n]+)`/g, '$1')
        // quotes
        .replace(/^([ \t]*)(?:>[ \t]?)+/gm, '$1│ ')
        // tables: drop the divider row (any dash count, under a row with
        // a pipe), separate cells with dots
        .replace(
            /(?<=^[^\n]*\|[^\n]*\n)[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?)?[ \t]*(?:\n|$)/gm,
            '',
        )
        .replace(
            /^[ \t]*\|([^\n]*)\|[ \t]*$/gm,
            (_, cells: string) =>
                cells.split('|').map((c) => c.trim()).join(' · '),
        )
        // dividers
        .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '──────────')
        // bullets and task lists
        .replace(
            /^([ \t]*)[*+-][ \t]+\[( |x)\][ \t]+/gm,
            (_, indent, done) => `${indent}${done === 'x' ? '☑' : '☐'} `,
        )
        .replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')
        // links and images: keep the URL readable
        .replace(
            /(!?)\[([^\]\n]{0,500})\]\((?:<([^>\n]{1,2000})>|([^)\s]{1,2000}))\)/g,
            (_, image, label, bracketed, bare) => {
                const url = bracketed ?? bare;
                const href = /^[a-z][a-z0-9+.-]*:/i.test(url)
                    ? url
                    : `https://${url.replace(/^\/\//, '')}`;
                if (image) return `${label || 'Image'} (image: ${href})`;
                // a label that is itself an address only shows the real one
                return !label || label === url || href.endsWith(label) ||
                        /^(https?:\/\/|www\.)/i.test(label)
                    ? href
                    : `${label} (${href})`;
            },
        )
        // bold, highlight, strikethrough, italic
        .replace(PAIRED, unwrapPaired)
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]{0,1000}?\S)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w_])_(?=\S)([^_\n]{0,1000}?\S)_(?!\w)/g, '$1$2')
        .replace(
            new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
            (match, i) => escaped[Number(i)] ?? match,
        );
};
