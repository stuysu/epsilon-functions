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

/* A row id: a whole number that fits an integer column (1e308 doesn't). */
export const isId = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) > 0 &&
    (value as number) <= 2147483647;

/* Maps a PostgREST / Postgres error to the status code the caller should get. */
export const dbErrorStatus = (error?: { code?: string } | null): number => {
    const code = error?.code ?? '';
    if (code === '42501') return 403; // row-level security / insufficient privilege
    if (code === 'PGRST116') return 404; // .single() matched no row
    if (code === '40P01') return 409; // deadlock: lost to a change at the same time
    if (
        code.startsWith('22') || // bad value, e.g. text where a number belongs
        code.startsWith('23') || // constraint violation (not null, foreign key, unique, check)
        code === '42703' || // unknown column
        code === 'PGRST204' // unknown column
    ) return 400;
    return 500;
};

export const BUSY =
    'Something else changed this at the same moment. Try again.';

/* our SQL functions raise these codes with messages meant for people */
const RAISED_STATUS: Record<string, number> = {
    P0001: 400,
    EP400: 400,
    EP403: 403,
    EP404: 404,
    EP409: 409,
    EP429: 400,
};

/* Answers a failed RPC without passing on raw database errors. */
export const rpcErrorResponse = (
    error: { code?: string; message?: string } | null,
    fallback: string,
): Response => {
    const status = RAISED_STATUS[error?.code ?? ''];
    if (status && error?.message) {
        return new Response(error.message, { status });
    }
    if (error?.code === '40P01') {
        return new Response(BUSY, { status: 409 });
    }
    console.error(fallback, error);
    return new Response(fallback, { status: dbErrorStatus(error) });
};

/* longest text the functions accept */
export const LIMITS = {
    meetingTitle: 500, // meetings.title is VARCHAR(500)
    meetingDescription: 5000,
    postTitle: 200,
    postDescription: 20000,
    orgMessage: 5000,
    strikeReason: 2000,
};

/* The problem with a text field, or null when it's fine. */
export const textProblem = (
    value: unknown,
    label: string,
    max: number,
    required = true,
): string | null => {
    if (value === undefined || value === null) {
        return required ? `${label} is required.` : null;
    }
    if (typeof value !== 'string') return `${label} must be text.`;
    if (required && !value.trim()) return `${label} is required.`;
    if (value.length > max) {
        return `${label} must be at most ${max} characters.`;
    }
    return null;
};
