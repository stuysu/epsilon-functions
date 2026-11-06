/* helpers for answering with the right HTTP status */

/*
 * Reads the request body as a JSON object. Returns null if the body is
 * missing, isn't valid JSON, or isn't an object, so the caller can answer 400
 * instead of crashing with a 500.
 */
// deno-lint-ignore no-explicit-any
export const readJson = async (req: Request): Promise<any> => {
    try {
        const body = await req.json();
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            return body;
        }
    } catch {
        // not JSON
    }
    return null;
};

/* Maps a PostgREST / Postgres error to the status code the caller should get. */
export const dbErrorStatus = (error?: { code?: string } | null): number => {
    const code = error?.code ?? '';
    if (code === '42501') return 403; // row-level security / insufficient privilege
    if (code === 'PGRST116') return 404; // .single() matched no row
    if (
        code.startsWith('22') || // bad value, e.g. text where a number belongs
        code.startsWith('23') || // constraint violation (not null, foreign key, unique, check)
        code === '42703' || // unknown column
        code === 'PGRST204' // unknown column
    ) return 400;
    return 500;
};
