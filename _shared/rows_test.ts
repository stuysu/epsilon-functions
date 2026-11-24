import { deepStrictEqual as eq } from 'node:assert/strict';
import { fetchAllRows } from './rows.ts';

const fakeTable = (size: number, failAt?: number) => {
    const rows = Array.from({ length: size }, (_, i) => i);
    const calls: [number, number][] = [];
    const page = (from: number, to: number) => {
        calls.push([from, to]);
        if (failAt !== undefined && from >= failAt) {
            return Promise.resolve({ data: null, error: 'boom' });
        }
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    };
    return { rows, calls, page };
};

Deno.test('reads every page', async () => {
    const t = fakeTable(2500);
    const { data, error } = await fetchAllRows(t.page);
    eq(error, null);
    eq(data, t.rows);
    eq(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

Deno.test('a full last page asks once more', async () => {
    const t = fakeTable(2000);
    const { data } = await fetchAllRows(t.page);
    eq(data.length, 2000);
    eq(t.calls.length, 3);
});

Deno.test('empty table', async () => {
    const t = fakeTable(0);
    eq(await fetchAllRows(t.page), { data: [], error: null });
});

Deno.test('stops at an error and returns what it had', async () => {
    const t = fakeTable(2500, 1000);
    const { data, error } = await fetchAllRows(t.page);
    eq(error, 'boom');
    eq(data.length, 1000);
});
