import { deepStrictEqual as eq } from 'node:assert/strict';
import * as jose from 'jose';
import { type FetchLike, verifyVoteToken } from './voteKey.ts';

const newKeyPair = async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
    return { pem: await jose.exportSPKI(publicKey), privateKey };
};

const tokenFrom = (privateKey: CryptoKey) =>
    new jose.SignJWT({
        user: { adminPrivileges: true, email: 'student@stuy.edu' },
    })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

const voteSite = (key: string) => {
    const fetch: FetchLike = () =>
        Promise.resolve(
            new Response(
                JSON.stringify({ data: { publicKey: { key } } }),
                { headers: { 'Content-Type': 'application/json' } },
            ),
        );
    return fetch;
};

Deno.test('verifies with the key the vote site serves', async () => {
    const pair = await newKeyPair();
    const result = await verifyVoteToken(await tokenFrom(pair.privateKey), {
        fetch: voteSite(pair.pem),
    });
    if (!result.ok) throw result.error;
    eq(result.payload.user?.email, 'student@stuy.edu');
});

Deno.test('uses the live key even when a stale fallback is set', async () => {
    const current = await newKeyPair();
    const stale = await newKeyPair();
    const result = await verifyVoteToken(await tokenFrom(current.privateKey), {
        fetch: voteSite(current.pem),
        fallback: stale.pem,
    });
    eq(result.ok, true);
});

Deno.test('falls back to VOTE_PUBLIC_KEY when the vote site is down', async () => {
    const pair = await newKeyPair();
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    const result = await verifyVoteToken(await tokenFrom(pair.privateKey), {
        fetch,
        fallback: pair.pem,
    });
    eq(result.ok, true);
});

Deno.test('falls back when the vote site hangs', async () => {
    const pair = await newKeyPair();
    let timed = false;
    const fetch: FetchLike = (_input, init) => {
        timed = init?.signal instanceof AbortSignal;
        return Promise.reject(new Error('aborted'));
    };
    const result = await verifyVoteToken(await tokenFrom(pair.privateKey), {
        fetch,
        fallback: pair.pem,
    });
    eq(timed, true);
    eq(result.ok, true);
});

Deno.test('rejects a token signed with neither key', async () => {
    const pair = await newKeyPair();
    const impostor = await newKeyPair();
    const result = await verifyVoteToken(await tokenFrom(impostor.privateKey), {
        fetch: voteSite(pair.pem),
        fallback: pair.pem,
    });
    eq(result.ok, false);
});
