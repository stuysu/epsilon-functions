import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import * as jose from 'https://deno.land/x/jose@v5.9.6/index.ts';

Deno.serve(async (req: Request) => {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) {
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Missing authorization JWT header',
            }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            },
        );
    }

    // send GraphQL request to fetch validated Publickey
    const data = await fetch('https://vote.stuysu.org/api/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: `{publicKey {key expiration}}`,
            variables: {},
        }),
    });
    const { data: { publicKey: { key, expiration } } } = await data.json();

    if (new Date() > new Date(expiration)) {
        return new Response(
            JSON.stringify({
                success: false,
                error: 'Public key from vote.stuysu.org has expired',
            }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            },
        );
    }

    // verify JWT provided by the user
    try {
        const ecPublicKey = await jose.importSPKI(key, 'RS256');
        const { payload: { user: userPayload } } = await jose.jwtVerify(jwt, ecPublicKey);
        
        if (!userPayload.adminPrivileges) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Not allowed to access this endpoint',
                }),
                {
                    headers: { 'Content-Type': 'application/json' },
                    status: 401,
                },
            );
        }
        if (Deno.env.get('NOTIFICATION_WEBHOOK')) {
            try {
                const _res = await fetch(
                    Deno.env.get('NOTIFICATION_WEBHOOK') || '',
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            content: `${
                                (new Date()).toISOString()
                            }: ${userPayload.firstName} ${userPayload.lastName} (${userPayload.email}) accessed export-voters. If they are not from the BOE, panic!!`,
                        }),
                        headers: {
                            'Content-Type': 'application/json',
                        },
                    },
                );
            } catch (err) {
                console.error(err);
            }
        }

        type user = {
            first_name: string;
            last_name: string;
            email: string;
            grad_year: number;
            active: boolean;
            is_faculty: boolean;
        };
        let { data, error } = await supabaseAdmin.from('users').select(`
            first_name,
            last_name,
            email,
            grad_year,
            active,
            is_faculty
        `)
            .eq('active', true)
            .eq('is_faculty', false);
        if (error) throw error;
        if (!data) data = [];
        return new Response(JSON.stringify({
            success: true,
            data: data.map((u: user) => {
                return {
                    firstName: u.first_name,
                    lastName: u.last_name,
                    email: u.email,
                    gradYear: u.grad_year,
                    active: u.active,
                    isFaculty: u.is_faculty,
                };
            }),
        }));
    } catch (err) {
        console.error(err);
        return new Response(
            JSON.stringify({
                success: false,
                error: err.message || 'Unknown error (fun!)',
            }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            },
        );
    }
});
