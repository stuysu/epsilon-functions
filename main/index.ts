import * as jose from 'jose';

type UserWorker = { fetch: (req: Request) => Promise<Response> };
declare const EdgeRuntime: {
    userWorkers: {
        create: (options: Record<string, unknown>) => Promise<UserWorker>;
    };
};

console.log('main function started');

function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.keys && Array.isArray(parsed.keys)) {
            return parsed as jose.JSONWebKeySet;
        }
        return null;
    } catch {
        return null;
    }
}

const JWT_SECRET = Deno.env.get('JWT_SECRET');
const SUPABASE_JWKS = parseJwks(Deno.env.get('SUPABASE_JWKS'));
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true';

const FUNCTIONS_DIR = '/home/deno/functions';
/* function folders: lowercase letters, digits, - and _ (not _shared) */
const SERVICE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
/* calendar apps send no JWT; export-voters checks the vote site's own token */
const PUBLIC_FUNCTIONS = new Set(['calendar-feed', 'export-voters']);
/* only the router uses these, so workers don't get them */
const ROUTER_ONLY_ENV = ['JWT_SECRET', 'SUPABASE_JWKS', 'VERIFY_JWT'];

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

function getAuthToken(req: Request) {
    const [bearer, token] = (req.headers.get('authorization') ?? '').split(
        ' ',
    );
    return bearer === 'Bearer' && token ? token : null;
}

const isHs256 = (jwt: string) => {
    try {
        return jose.decodeProtectedHeader(jwt).alg === 'HS256';
    } catch {
        return false;
    }
};

async function verifyJWT(jwt: string): Promise<boolean> {
    try {
        if (SUPABASE_JWKS) {
            try {
                const JWKS = jose.createLocalJWKSet(SUPABASE_JWKS);
                await jose.jwtVerify(jwt, JWKS);
                return true;
            } catch (err) {
                /* the anon and service keys are HS256, signed with JWT_SECRET */
                if (!JWT_SECRET || !isHs256(jwt)) throw err;
            }
        }
        if (JWT_SECRET) {
            const encoder = new TextEncoder();
            const secretKey = encoder.encode(JWT_SECRET);
            await jose.jwtVerify(jwt, secretKey);
            return true;
        }
        return false;
    } catch (err) {
        console.error(err);
        return false;
    }
}

const exists = async (path: string) => {
    try {
        return (await Deno.stat(path)).isFile;
    } catch {
        return false;
    }
};

Deno.serve(async (req: Request) => {
    const service_name = new URL(req.url).pathname.split('/')[1];

    if (
        req.method !== 'OPTIONS' && VERIFY_JWT &&
        !PUBLIC_FUNCTIONS.has(service_name)
    ) {
        const token = getAuthToken(req);
        if (!token) {
            return json(
                { msg: 'Missing or invalid authorization header' },
                401,
            );
        }
        if (!(await verifyJWT(token))) {
            return json({ msg: 'Invalid JWT' }, 401);
        }
    }

    if (!service_name) {
        return json({ msg: 'missing function name in request' }, 400);
    }
    if (
        !SERVICE_NAME.test(service_name) || service_name === 'main' ||
        !(await exists(`${FUNCTIONS_DIR}/${service_name}/index.ts`))
    ) {
        return json({ msg: 'Function not found' }, 404);
    }

    const servicePath = `${FUNCTIONS_DIR}/${service_name}`;
    console.error(`serving the request with ${servicePath}`);

    const memoryLimitMb = 150;
    const workerTimeoutMs = 1 * 60 * 1000;
    const noModuleCache = false;
    const importMapPath = null;
    const envVars = Object.entries(Deno.env.toObject())
        .filter(([name]) => !ROUTER_ONLY_ENV.includes(name));

    const cpuTimeSoftLimitMs = 15000;
    const cpuTimeHardLimitMs = 20000;

    try {
        const worker = await EdgeRuntime.userWorkers.create({
            servicePath,
            memoryLimitMb,
            workerTimeoutMs,
            noModuleCache,
            importMapPath,
            envVars,
            cpuTimeSoftLimitMs,
            cpuTimeHardLimitMs,
        });
        return await worker.fetch(req);
    } catch (e) {
        console.error(`[main] ${service_name} failed`, e);
        return json({ msg: 'Internal Server Error' }, 500);
    }
});
