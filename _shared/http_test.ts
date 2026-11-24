import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import {
    BUSY,
    dbErrorStatus,
    isId,
    LIMITS,
    readJson,
    rpcErrorResponse,
    textProblem,
} from './http.ts';

Deno.test('LIMITS are positive whole numbers', () => {
    for (const [name, max] of Object.entries(LIMITS)) {
        ok(Number.isInteger(max) && max > 0, name);
    }
    eq(LIMITS.meetingTitle, 500);
});

Deno.test('isId', () => {
    for (const good of [1, 42, 2147483647]) eq(isId(good), true, String(good));
    for (
        const bad of [
            0,
            -1,
            1.5,
            2147483648,
            1e308,
            2 ** 53 + 2,
            '1',
            null,
            NaN,
        ]
    ) {
        eq(isId(bad), false, String(bad));
    }
});

Deno.test('textProblem', () => {
    eq(textProblem(undefined, 'Title', 10), 'Title is required.');
    eq(textProblem(null, 'Title', 10, false), null);
    eq(textProblem(5, 'Title', 10), 'Title must be text.');
    eq(textProblem('   ', 'Title', 10), 'Title is required.');
    eq(textProblem('', 'Title', 10, false), null);
    eq(
        textProblem('a'.repeat(11), 'Title', 10),
        'Title must be at most 10 characters.',
    );
    eq(textProblem('a'.repeat(10), 'Title', 10), null);
});

Deno.test('dbErrorStatus', () => {
    eq(dbErrorStatus({ code: '42501' }), 403);
    eq(dbErrorStatus({ code: 'PGRST116' }), 404);
    eq(dbErrorStatus({ code: '23505' }), 400);
    eq(dbErrorStatus({ code: '22P02' }), 400);
    eq(dbErrorStatus({ code: 'PGRST204' }), 400);
    eq(dbErrorStatus({ code: '40P01' }), 409);
    eq(dbErrorStatus({ code: '08006' }), 500);
    eq(dbErrorStatus(null), 500);
});

Deno.test('rpcErrorResponse passes on only our own messages', async () => {
    const mine = rpcErrorResponse(
        { code: 'EP409', message: 'Taken.' },
        'Failed.',
    );
    eq(mine.status, 409);
    eq(await mine.text(), 'Taken.');

    const deadlock = rpcErrorResponse(
        { code: '40P01', message: 'deadlock detected' },
        'Failed.',
    );
    eq(deadlock.status, 409);
    eq(await deadlock.text(), BUSY);

    const error = console.error;
    console.error = () => {};
    try {
        const raw = rpcErrorResponse(
            { code: '23505', message: 'duplicate key value violates "x"' },
            'Failed.',
        );
        eq(raw.status, 400);
        eq(await raw.text(), 'Failed.');
    } finally {
        console.error = error;
    }
});

Deno.test('readJson only accepts objects', async () => {
    const req = (body: string) =>
        new Request('http://x', { method: 'POST', body });
    eq(await readJson(req('{"a":1}')), { a: 1 });
    eq(await readJson(req('[1,2]')), null);
    eq(await readJson(req('not json')), null);
    eq(await readJson(req('null')), null);
});
