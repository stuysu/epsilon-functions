import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import * as jose from 'jose';
import { withCors } from '../_shared/cors.ts';
import { fetchAllRows } from '../_shared/rows.ts';

/* VOTE_PUBLIC_KEY: the vote site's RS256 key (SPKI PEM); VOTE_JWT_ISSUER and
   VOTE_JWT_AUDIENCE are checked when set */
const PUBLIC_KEY = Deno.env.get('VOTE_PUBLIC_KEY')?.replace(/\\n/g, '\n');
const ISSUER = Deno.env.get('VOTE_JWT_ISSUER') || undefined;
const AUDIENCE = Deno.env.get('VOTE_JWT_AUDIENCE') || undefined;

type VotePayload = {
    user?: {
        adminPrivileges?: boolean;
        firstName?: string;
        lastName?: string;
        email?: string;
    };
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });

let key: CryptoKey | null = null;

Deno.serve(withCors(async (req: Request) => {
    const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)
        ?.[1];
    if (!jwt) {
        return json({
            success: false,
            error: 'Missing authorization JWT header',
        }, 401);
    }

    if (!PUBLIC_KEY) {
        console.error('[export-voters] VOTE_PUBLIC_KEY is not set');
        return json({ success: false, error: 'Not configured' }, 503);
    }

    let user: VotePayload['user'];
    try {
        key ??= await jose.importSPKI(PUBLIC_KEY, 'RS256');
        const { payload } = await jose.jwtVerify<VotePayload>(jwt, key, {
            algorithms: ['RS256'],
            issuer: ISSUER,
            audience: AUDIENCE,
        });
        user = payload.user;
    } catch (err) {
        console.error('[export-voters] rejected token', err);
        return json({ success: false, error: 'Invalid token' }, 401);
    }

    if (!user?.adminPrivileges) {
        return json({
            success: false,
            error: 'Not allowed to access this endpoint',
        }, 403);
    }

    const webhook = Deno.env.get('NOTIFICATION_WEBHOOK');
    if (webhook) {
        try {
            await fetch(webhook, {
                method: 'POST',
                body: JSON.stringify({
                    content: `${
                        (new Date()).toISOString()
                    }: ${user.firstName} ${user.lastName} (${user.email}) accessed export-voters. If they are not from the BOE, panic!!`,
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        } catch (err) {
            console.error(err);
        }
    }

    type VoterRow = {
        first_name: string;
        last_name: string;
        email: string;
        grad_year: number;
        active: boolean;
        is_faculty: boolean;
    };
    const { data, error } = await fetchAllRows((from, to) =>
        supabaseAdmin.from('users')
            .select(
                'first_name, last_name, email, grad_year, active, is_faculty',
            )
            .eq('active', true)
            .eq('is_faculty', false)
            .order('id')
            .range(from, to)
            .returns<VoterRow[]>()
    );
    if (error) {
        console.error('[export-voters] users fetch failed', error);
        return json({ success: false, error: 'Failed to fetch users' }, 500);
    }

    return json({
        success: true,
        data: data.map((u) => ({
            firstName: u.first_name,
            lastName: u.last_name,
            email: u.email,
            gradYear: u.grad_year,
            active: u.active,
            isFaculty: u.is_faculty,
        })),
    });
}));
