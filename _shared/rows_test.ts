import { deepStrictEqual as eq } from 'node:assert/strict';
import { fetchAllRows } from './rows.ts';

/* a table of `size` rows behind a PostgREST that returns at most `cap` rows
   per request, whatever range it is asked for */
const fakeTable = (size: number, cap = 1000, failAt?: number) => {
    const rows = Array.from({ length: size }, (_, i) => i);
    const calls: [number, number][] = [];
    const page = (from: number, to: number) => {
        calls.push([from, to]);
        if (failAt !== undefined && from >= failAt) {
            return Promise.resolve({ data: null, error: 'boom' });
        }
        const end = Math.min(to + 1, from + cap);
        return Promise.resolve({ data: rows.slice(from, end), error: null });
    };
    return { rows, calls, page };
};

Deno.test('reads every page', async () => {
    const t = fakeTable(2500);
    const { data, error } = await fetchAllRows(t.page);
    eq(error, null);
    eq(data, t.rows);
    eq(t.calls, [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

Deno.test('an exactly full last page asks once more', async () => {
    const t = fakeTable(2000);
    const { data } = await fetchAllRows(t.page);
    eq(data.length, 2000);
    eq(t.calls.length, 3);
});

Deno.test('a server cap below the page size still reads every row', async () => {
    const t = fakeTable(2500, 400);
    const { data, error } = await fetchAllRows(t.page);
    eq(error, null);
    eq(data, t.rows);
    eq(t.calls.length, 8);
});

Deno.test('empty table asks once', async () => {
    const t = fakeTable(0);
    eq(await fetchAllRows(t.page), { data: [], error: null });
    eq(t.calls.length, 1);
});

Deno.test('stops at an error and returns what it had', async () => {
    const t = fakeTable(2500, 1000, 1000);
    const { data, error } = await fetchAllRows(t.page);
    eq(error, 'boom');
    eq(data.length, 1000);
});
