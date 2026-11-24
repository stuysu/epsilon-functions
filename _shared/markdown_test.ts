import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import { markdownToText, truncate } from './markdown.ts';

Deno.test('markdownToText strips syntax and keeps links readable', () => {
    eq(
        markdownToText(
            '# Hello\n\n**bold** and ==mark== and [site](example.com)\n\n- one\n- [x] done\n\n> quote\n\n\\*not italic\\*',
        ),
        'Hello\n\nbold and mark and site (https://example.com)\n\n• one\n☑ done\n\n│ quote\n\n*not italic*',
    );
});

Deno.test('tables and images', () => {
    eq(markdownToText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a · b\n1 · 2');
    // short or aligned dividers aren't bullets or cells
    eq(markdownToText('| a | b |\n| - | - |\n| 1 | 2 |'), 'a · b\n1 · 2');
    eq(markdownToText('| a | b |\n|:-|-:|\n| 1 | 2 |'), 'a · b\n1 · 2');
    eq(markdownToText('a | b\n- | -\n1 | 2'), 'a | b\n1 | 2');
    // without a table above, they stay a bullet and a divider
    eq(markdownToText('- | -\n\n---'), '• | -\n\n──────────');
    eq(
        markdownToText('![logo](https://x.example/a.png)'),
        'logo (image: https://x.example/a.png)',
    );
});

Deno.test('a label that is an address shows the real one', () => {
    eq(
        markdownToText('[https://good.example](https://evil.example)'),
        'https://evil.example',
    );
});

Deno.test('truncate never splits an emoji', () => {
    const long = 'a'.repeat(19999) + '😀' + 'b';
    const cut = truncate(long);
    ok(cut.endsWith('…'));
    ok(!/[\uD800-\uDBFF]…$/.test(cut));
    eq(truncate('short'), 'short');
});
