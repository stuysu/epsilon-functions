import { dbErrorStatus, readJson } from '../_shared/http.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders, { withCors } from '../_shared/cors.ts';

type BodyType = {
    first_name: string;
    last_name: string;
    email: string;
    grad_year: number | null;
    is_faculty: boolean;
};

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader?.split(' ')[1];
    const { data: authData } = await supabaseClient.auth.getUser(jwt);
    if (!authData.user) {
        return new Response(JSON.stringify({ error: 'Failed to fetch user.' }), {
            status: 401,
            headers: corsHeaders,
        });
    }

    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: corsHeaders,
        });
    }

    /* auth emails are lowercase, and the site looks users up by them */
    const email = typeof bodyJson.email === 'string'
        ? bodyJson.email.trim().toLowerCase()
        : '';
    if (!email) {
        return new Response(JSON.stringify({ error: 'Missing email.' }), {
            status: 400,
            headers: corsHeaders,
        });
    }

    /* grad_year is optional, but has to be a year when given */
    let grad_year: number | null = null;
    if (bodyJson.grad_year != null && bodyJson.grad_year !== '') {
        grad_year = Number(bodyJson.grad_year);
        if (
            !Number.isInteger(grad_year) || grad_year < 1900 ||
            grad_year > 9999
        ) {
            return new Response(
                JSON.stringify({ error: 'Invalid grad year.' }),
                { status: 400, headers: corsHeaders },
            );
        }
    }

    const body: BodyType = {
        first_name: bodyJson.first_name,
        last_name: bodyJson.last_name,
        email,
        grad_year,
        is_faculty: bodyJson.is_faculty,
    };

    /** check if user already exists (ignoring case, older rows may be mixed case) **/

    const { data: userData, error: userError } = await supabaseClient.from(
        'users',
    )
        .select('email')
        .ilike('email', email.replace(/[\\%_]/g, '\\$&'));

    if (userError) {
        return new Response(
            JSON.stringify({ error: 'Error checking for existing user' }),
            { status: dbErrorStatus(userError), headers: corsHeaders },
        );
    }

    if (userData.some((u) => u.email.toLowerCase() === email)) {
        return new Response(JSON.stringify({ error: 'User already exists' }), {
            status: 400,
            headers: corsHeaders,
        });
    } else {
        const { error: createUserError } = await supabaseClient.from('users')
            .insert(body)
            .select();

        if (createUserError) {
            return new Response(
                JSON.stringify({
                    error: 'Error creating user',
                    details: {
                        message: createUserError?.message,
                        hint: createUserError?.hint,
                        code: createUserError?.code,
                        details: createUserError?.details,
                    },
                }),
                {
                    status: dbErrorStatus(createUserError),
                    headers: corsHeaders,
                },
            );
        }
    }

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
    );
}));
