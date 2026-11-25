import * as jose from 'jose';

/* vote.stuysu.org rotates and deletes its RS256 key pair every 30 days, so
   read the live key and keep VOTE_PUBLIC_KEY as the fallback */
const GRAPHQL_URL = 'https://vote.stuysu.org/api/graphql';
const PUBLIC_KEY_QUERY = '{publicKey {key expiration}}';
const TIMEOUT_MS = 5_000;

type VoteUser = {
    adminPrivileges?: boolean;
    firstName?: string;
    lastName?: string;
    email?: string;
};

type VotePayload = { user?: VoteUser };

export type FetchLike = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export type VerifyResult =
    | { ok: true; payload: VotePayload }
    | { ok: false; error: Error };

type KeyResponse = {
    data?: { publicKey?: { key?: string | null } | null } | null;
};

const toPem = (value?: string | null) =>
    value ? value.replace(/\\n/g, '\n') : null;

const readLive = async (fetchFn: FetchLike): Promise<string | null> => {
    try {
        const res = await fetchFn(GRAPHQL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: PUBLIC_KEY_QUERY, variables: {} }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as KeyResponse;
        const key = body?.data?.publicKey?.key;
        return typeof key === 'string' && key ? toPem(key) : null;
    } catch {
        return null;
    }
};

export const verifyVoteToken = async (
    jwt: string,
    options: { fallback?: string; fetch?: FetchLike } = {},
): Promise<VerifyResult> => {
    const keys = new Set([
        await readLive(options.fetch ?? fetch),
        toPem(options.fallback),
    ]);
    let lastError = new Error('no vote public key available');

    for (const pem of keys) {
        if (!pem) continue;
        try {
            const { payload } = await jose.jwtVerify<VotePayload>(
                jwt,
                await jose.importSPKI(pem, 'RS256'),
                { algorithms: ['RS256'] },
            );
            return { ok: true, payload };
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }

    return { ok: false, error: lastError };
};
