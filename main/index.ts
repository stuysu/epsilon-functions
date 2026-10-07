// @ts-ignore - JSR imports are resolved natively at runtime by Deno
import * as jose from "jsr:@panva/jose@6";

declare const EdgeRuntime: any;

console.log("main function started");

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

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";

function getAuthToken(req: Request) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
        throw new Error("Missing authorization header");
    }
    const [bearer, token] = authHeader.split(" ");
    if (bearer !== "Bearer") {
        throw new Error(`Auth header is not 'Bearer {token}'`);
    }
    return token;
}

async function verifyJWT(jwt: string): Promise<boolean> {
    try {
        if (SUPABASE_JWKS) {
            const JWKS = jose.createLocalJWKSet(SUPABASE_JWKS);
            await jose.jwtVerify(jwt, JWKS);
            return true;
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

Deno.serve(async (req: Request) => {
    if (req.method !== "OPTIONS" && VERIFY_JWT) {
        try {
            const token = getAuthToken(req);
            const isValidJWT = await verifyJWT(token);

            if (!isValidJWT) {
                return new Response(JSON.stringify({ msg: "Invalid JWT" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }
        } catch (e: any) {
            console.error(e);
            return new Response(JSON.stringify({ msg: (e as any).toString() }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }
    }

    const url = new URL(req.url);
    const { pathname } = url;
    const path_parts = pathname.split("/");
    const service_name = path_parts[1];

    if (!service_name || service_name === "") {
        const error = { msg: "missing function name in request" };
        return new Response(JSON.stringify(error), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const servicePath = `/home/deno/functions/${service_name}`;
    console.error(`serving the request with ${servicePath}`);

    const memoryLimitMb = 150;
    const workerTimeoutMs = 1 * 60 * 1000;
    const noModuleCache = false;
    const importMapPath = null;
    const envVarsObj = Deno.env.toObject();
    const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]]);

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
    } catch (e: any) {
        const error = { msg: (e as any).toString() };
        return new Response(JSON.stringify(error), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
