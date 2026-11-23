// Posts and SU chat messages are written in markdown, but emails go out as
// plain text, so strip the syntax that reads badly there.
const MAX_LENGTH = 20000;
const MARK = '';

export const markdownToText = (markdown: string): string => {
    let source = markdown.replaceAll(MARK, '');
    if (source.length > MAX_LENGTH) {
        source = `${source.slice(0, MAX_LENGTH)}…`;
    }

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
        // bullets and task lists
        .replace(
            /^([ \t]*)[*+-][ \t]+\[( |x)\][ \t]+/gm,
            (_, indent, done) => `${indent}${done === 'x' ? '☑' : '☐'} `,
        )
        .replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')
        // links: keep the URL readable
        .replace(
            /\[([^\]\n]{1,500})\]\((?:<([^>\n]{1,2000})>|([^)\s]{1,2000}))\)/g,
            (_, label, bracketed, bare) => {
                const url = bracketed ?? bare;
                const href = /^[a-z][a-z0-9+.-]*:/i.test(url)
                    ? url
                    : `https://${url.replace(/^\/\//, '')}`;
                return label === url || href.endsWith(label)
                    ? href
                    : `${label} (${href})`;
            },
        )
        // bold, highlight, strikethrough, italic
        .replace(/(\*\*|__|==|~~)(?=\S)([^\n]*?\S)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
        .replace(
            new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
            (match, i) => escaped[Number(i)] ?? match,
        );
};
