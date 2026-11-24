/*
 * PostgREST caps each response at max_rows (1000), so read a query page by
 * page. `page` must order the rows so the pages don't overlap.
 */
const PAGE = 1000;

export const fetchAllRows = async <T, E>(
    page: (
        from: number,
        to: number,
    ) => PromiseLike<{ data: T[] | null; error: E | null }>,
): Promise<{ data: T[]; error: E | null }> => {
    const rows: T[] = [];
    for (;;) {
        const { data, error } = await page(rows.length, rows.length + PAGE - 1);
        if (error) return { data: rows, error };
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE) return { data: rows, error: null };
    }
};
