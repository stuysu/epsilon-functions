import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { unlockOrganizationIfReady } from '../_shared/utils.ts';
import { readJson } from '../_shared/http.ts';

type BodyType = {
    invite_id: number;
};

const fail = (message: string, status: number) =>
    new Response(message, { status });

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const body: BodyType | null = await readJson(req);
    if (!body) return fail('Invalid JSON body.', 400);

    const { invite_id } = body;
    if (!Number.isInteger(invite_id)) return fail('Missing field', 400);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('User is unauthorized.', 401);
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    if (!user) return fail('User is unauthorized.', 401);

    const { data: siteUsers } = await supabaseClient
        .from('users')
        .select('id')
        .eq('email', user.email);

    if (!siteUsers || !siteUsers.length) {
        return fail('User is unauthorized.', 401);
    }

    const siteUser = siteUsers[0];

    const { data: invite } = await supabaseAdmin
        .from('organization_invites')
        .select('id, organization_id, user_id, status')
        .eq('id', invite_id)
        .maybeSingle();

    if (
        !invite || invite.user_id !== siteUser.id ||
        invite.status !== 'pending'
    ) {
        return fail('This invitation was not found.', 404);
    }

    const { error: membershipError } = await supabaseAdmin
        .from('memberships')
        .upsert(
            {
                organization_id: invite.organization_id,
                user_id: siteUser.id,
                active: true,
            },
            { onConflict: 'organization_id,user_id' },
        );

    if (membershipError) {
        console.error('[ACCEPT_INVITE] membership failed', membershipError);
        return fail('Error joining organization.', 422);
    }

    await supabaseAdmin.from('organization_invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id);

    await unlockOrganizationIfReady(invite.organization_id);

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
