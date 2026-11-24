import { deepStrictEqual as eq } from 'node:assert/strict';
import { isClubPictureUrl, validateCharter } from './charter.ts';

Deno.test('keywords: at most 3, each at most 50 characters', () => {
    eq(validateCharter({ keywords: 'chess,board games,strategy' }, false), []);
    eq(validateCharter({ keywords: 'a,b,c,d' }, false), [
        'Use at most 3 keywords.',
    ]);
    eq(validateCharter({ keywords: 'x'.repeat(50) }, false), []);
    eq(validateCharter({ keywords: `ok,${'x'.repeat(51)}` }, false), [
        'Each keyword must be at most 50 characters.',
    ]);
});

Deno.test('keywords: only text (or null)', () => {
    for (const keywords of [['a', 'b', 'c', 'd'], { a: 1 }, true, 5]) {
        eq(validateCharter({ keywords }, false), ['Keywords must be text.']);
    }
    eq(validateCharter({ keywords: null }, false), []);
});

Deno.test('meeting days: Monday to Friday only', () => {
    eq(validateCharter({ meeting_days: ['MONDAY', 'FRIDAY'] }, false), []);
    for (const day of ['SATURDAY', 'monday', 5]) {
        eq(validateCharter({ meeting_days: ['MONDAY', day] }, false), [
            'Pick meeting days from Monday to Friday.',
        ]);
    }
});

Deno.test("edit pictures: only this club's folder on our storage", () => {
    const base = 'https://base.example.org';
    const folder = `${base}/storage/v1/object/public/public-files/org-pictures`;
    eq(
        isClubPictureUrl(7, `${folder}/7/1700-test-club-profile.webp`, base),
        true,
    );
    for (
        const url of [
            `${folder}/8/1700-test-club-profile.webp`,
            `${folder}/70/x.png`,
            `${folder}/7/`,
            `${folder}/7/sub/x.png`,
            `${folder}/7/../8/x.png`,
            `${folder}/7/x.png?y=1`,
            `https://evil.example/storage/v1/object/public/public-files/org-pictures/7/x.png`,
            `${base}.evil.example/storage/v1/object/public/public-files/org-pictures/7/x.png`,
            'javascript:alert(1)',
        ]
    ) {
        eq(isClubPictureUrl(7, url, base), false, url);
    }
});
