import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { sendMemberEmail, sendOrgEmail } from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    member_id: number;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        member_id,
    }: BodyType = await req.json();

    if (!member_id) {
        return new Response('Missing field', { status: 400 });
    }

    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    /* Failed to fetch supabase user */
    if (!user) {
        return new Response('Failed to fetch user.', { status: 500 });
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

    /* send error if failed to join organization */
    if (updateMemberError || !memberData || !memberData.length) {
        return new Response('Error updating member.', { status: 422 }); // unprocessable entity
    }

    /* if success, then send email to member */

    /* email member */

    const emailBody = `Hi {FIRST_NAME}!
            
Congrats! You are now a member of {ORG_NAME}.

We hope you enjoy your club experience at Stuy.` + footer;

    const emailSubject = `Membership Approved: {ORG_NAME} | Epsilon`;

    sendMemberEmail(member_id, emailSubject, emailBody);

    /* ALSO CHECK IF CLUB IS PENDING AND SHOULD IT BE UNLOCKED */
    const orgId = memberData[0].organizations.id;

    const { data: orgData, error: orgDataError } = await supabaseClient.from(
        'organizations',
    )
        .select(`
            state,
            memberships!inner (
                active
            )
        `)
        .eq('id', orgId);

    if (orgData && orgData.length && !orgDataError) {
        const org = orgData[0];

        type styp = {
            required_members: number;
        };
        const { data: siteSettings } = await supabaseAdmin.from('settings')
            .select(`
                required_members
            `)
            .returns<styp[]>();
        let required_members = 0;
        if (siteSettings) {
            required_members = siteSettings[0].required_members;
        }

        if (
            org.state === 'LOCKED' &&
            org.memberships.filter((m) => m.active).length >= required_members
        ) {
            /* SEND ORG ADMINS AN EMAIL ABOUT THIS */

            /* asynchronously email admins to prevent function from hanging on client */
            const emailText =
                `You are receiving this email because your organization {ORG_NAME} has been approved and unlocked.

You can begin creating meetings, making posts, and your organization will be displayed on the club catalog.

We hope you enjoy your club experience at Stuy!` + footer;
            const subject = `Organization Unlocked: {ORG_NAME} | Epsilon`;

            sendOrgEmail(orgId, subject, emailText, false, true);

            await supabaseAdmin.from('organizations')
                .update({ state: 'UNLOCKED' })
                .eq('id', orgId);
        }
    }

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
