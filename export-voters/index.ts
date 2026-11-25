import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { withCors } from '../_shared/cors.ts';
import { fetchAllRows } from '../_shared/rows.ts';
import { verifyVoteToken } from '../_shared/voteKey.ts';

/* the key is read live; VOTE_PUBLIC_KEY is the fallback when vote is down */

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status,
    });

Deno.serve(withCors(async (req: Request) => {
    const jwt = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)
        ?.[1];
    if (!jwt) {
        return json({
            success: false,
            error: 'Missing authorization JWT header',
        }, 401);
    }

    const verified = await verifyVoteToken(jwt, {
        fallback: Deno.env.get('VOTE_PUBLIC_KEY'),
    });
    if (!verified.ok) {
        console.error('[export-voters] rejected token', verified.error);
        return json({ success: false, error: 'Invalid token' }, 401);
    }
    const user = verified.payload.user;

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
