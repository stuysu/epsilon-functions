/* reusable corsHeaders */
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
        'authorization, x-client-info, apikey, content-type',
};

/*
 * Wraps a request handler so that every response it returns (success and
 * error alike, including uncaught exceptions) carries corsHeaders, and answers
 * CORS preflight (OPTIONS) requests. Headers the handler already set are left
 * untouched.
 *
 * The API gateway (Kong) also adds CORS headers in production; this keeps the
 * functions correct when called without it (e.g. directly on the runtime).
 */
export function withCors(
    handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
    return async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: corsHeaders });
        }

        let res: Response;
        try {
            res = await handler(req);
        } catch (err) {
            // same status/body the runtime sends for an uncaught error
            console.error(err);
            return new Response('Internal Server Error', {
                status: 500,
                headers: corsHeaders,
            });
        }
        const headers = new Headers(res.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
            if (!headers.has(key)) headers.set(key, value);
        }
        return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
        });
    };
}

export default corsHeaders;
