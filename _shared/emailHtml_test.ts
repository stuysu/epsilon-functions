import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import {
    emailDocument,
    emailTitle,
    markdownToHtml,
    textToHtml,
} from './emailHtml.ts';

Deno.test('raw HTML is escaped and unsafe links dropped', () => {
    const html = markdownToHtml(
        '<script>alert(1)</script> [x](javascript:alert(1)) <u>under</u>',
    );
    ok(html.includes('&lt;script&gt;'));
    ok(!html.includes('<script>'));
    ok(!html.includes('href="javascript:'));
    ok(html.includes('<u>under</u>'));
});

Deno.test('images become links and address labels stay honest', () => {
    const html = markdownToHtml(
        '![pic](https://img.example/a.png) [https://good.example](https://evil.example)',
    );
    ok(html.includes('>pic (image)</a>'));
    ok(!html.includes('<img'));
    ok(html.includes('>https://evil.example</a>'));
    ok(!html.includes('good.example'));
});

Deno.test('headings move down one and a repeated title is dropped', () => {
    const html = markdownToHtml('# Club Fair\n\n## Details', 'Club Fair');
    ok(!html.includes('Club Fair'));
    ok(html.includes('<h3'));
});

Deno.test('huge tables fall back to plain rows', () => {
    const row = '|' + ' x |'.repeat(60);
    const table = [row, '|' + ' --- |'.repeat(60), ...Array(50).fill(row)]
        .join('\n');
    ok(!markdownToHtml(table).includes('<table'));
    ok(markdownToHtml('| a |\n|---|\n| 1 |').includes('<table'));
});

Deno.test('textToHtml links addresses and keeps paragraphs', () => {
    eq(
        textToHtml('Hi a@b.org\nsee https://x.example/path.\n\nBye <3'),
        '<p dir="auto" style="margin:0 0 12px">Hi <a href="mailto:a@b.org" style="color:#1a5fb4">a@b.org</a><br>see <a href="https://x.example/path" style="color:#1a5fb4">https://x.example/path</a>.</p>\n<p dir="auto" style="margin:0 0 12px">Bye &lt;3</p>',
    );
});

Deno.test('emailDocument escapes the title', () => {
    const doc = emailDocument(emailTitle('A & <B>'), {
        title: 'A & <B>',
        preview: 'Preview',
    });
    ok(doc.includes('<title>A &amp; &lt;B&gt;</title>'));
    ok(doc.includes(
        '<h1 dir="auto" style="font-size:22px;margin:0 0 12px">A &amp; &lt;B&gt;</h1>',
    ));
});
