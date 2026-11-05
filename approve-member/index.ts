import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    sendMemberEmail,
    unlockOrganizationIfReady,
} from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';
import { readJson } from '../_shared/http.ts';

type BodyType = {
    member_id: number;
};

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        member_id,
    }: BodyType = bodyJson;

    if (!member_id) {
        return new Response('Missing field', { status: 400 });
    }

    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader?.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    /* Failed to fetch supabase user */
    if (!user) {
        return new Response('Failed to fetch user.', { status: 401 });
    }

    /* check if user is a verified user. Verified user = the userdata that the site uses */
    const { data: verifiedUsers, error: verifiedUsersError } =
        await supabaseClient.from('users')
            .select('*')
            .eq('email', user.email);

    if (verifiedUsersError) {
        return new Response('Failed to fetch users associated email.', {
            status: 500,
        });
    }

    if (!verifiedUsers || !verifiedUsers.length) {
        return new Response('User is unauthorized.', { status: 401 });
    }

    /* RLS takes care of any permissions */

    /* update member */
    type omtyp = {
        organizations: {
            id: number;
            name: string;
        };
    };
    const { data: memberData, error: updateMemberError } = await supabaseClient
        .from('memberships')
        .update({ active: true })
        .eq('id', member_id)
        .select(`
                organizations!inner (
                    id,
                    name
                )
            `)
        .returns<omtyp[]>();

    if (updateMemberError) {
        return new Response('Error updating member.', { status: 422 }); // unprocessable entity
    }

    /* nothing updated: either there's no such membership, or RLS hid it
       because the caller isn't an active admin of that club */
    if (!memberData || !memberData.length) {
        const { data: existing } = await supabaseAdmin
            .from('memberships')
            .select('id')
            .eq('id', member_id)
            .maybeSingle();
        return existing
            ? new Response('You are not allowed to approve this member.', {
                status: 403,
            })
            : new Response('Membership not found.', { status: 404 });
    }

    /* if success, then send email to member */

    /* email member */

    const emailBody = `Hi {FIRST_NAME}!
            
Congrats! You are now a member of {ORG_NAME}.

We hope you enjoy your club experience at Stuy.` + footer;

    const emailSubject = `Membership Approved: {ORG_NAME} | Epsilon`;

    sendMemberEmail(member_id, emailSubject, emailBody);

    /* ALSO CHECK IF CLUB IS PENDING AND SHOULD IT BE UNLOCKED */
    await unlockOrganizationIfReady(memberData[0].organizations.id);

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
