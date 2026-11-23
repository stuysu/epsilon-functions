import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import { readJson } from '../_shared/http.ts';
import { emailNewAdvisor } from '../_shared/advisorEmail.ts';

type BodyType = {
    organization_id: number;
    advisor_email: string;
};

const fail = (message: string, status: number) =>
    new Response(message, { status });

// Adds a faculty advisor for a club admin and emails the advisor. Returns the
// result of add_organization_advisor ('added', 'no_account', ...).
Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const body: BodyType | null = await readJson(req);
    if (!body) return fail('Invalid JSON body.', 400);

    const { organization_id, advisor_email } = body;
    if (
        !Number.isInteger(organization_id) ||
        typeof advisor_email !== 'string' || !advisor_email.trim()
    ) {
        return fail('Missing field', 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('User is unauthorized.', 401);
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    if (!userData.user) return fail('User is unauthorized.', 401);

    const { data: siteUser } = await supabaseClient
        .from('users')
        .select('first_name, last_name')
        .eq('email', userData.user.email)
        .maybeSingle();
    if (!siteUser) return fail('User is unauthorized.', 401);

    // the function checks the caller is one of the club's admins
    const { data: result, error } = await supabaseClient.rpc(
        'add_organization_advisor',
        { org_id: organization_id, advisor_email },
    );
    if (error) {
        return error.message.includes('Only organization admins')
            ? fail('Only club admins can add advisors.', 403)
            : fail('Failed to add advisor.', 500);
    }

    if (result === 'added') {
        const adder = [siteUser.first_name, siteUser.last_name]
            .filter(Boolean)
            .join(' ');
        await emailNewAdvisor(
            organization_id,
            advisor_email,
            (name) =>
                `${
                    adder || 'A club leader'
                } added you as the faculty advisor of ${name}.`,
        );
    }

    return new Response(JSON.stringify({ result }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
