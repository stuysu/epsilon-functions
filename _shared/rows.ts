/* PostgREST caps each response at max_rows, so a short page does not mean the
   end of the table: walk by the rows received and stop on an empty page.
   `page` must order the rows so the pages don't overlap. */
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
        const batch = data ?? [];
        if (!batch.length) return { data: rows, error: null };
        rows.push(...batch);
    }
};
