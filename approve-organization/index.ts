import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    fetchMemberRequirement,
    isSiteAdmin,
    sendOrgEmail,
} from '../_shared/utils.ts';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { footer } from '../_shared/strings.ts';

// import { initOrgCalendar } from '../_shared/google/calendar.ts'; REMOVE FOR NOW: DOESN'T WORK IN PRODUCTION

type BodyType = {
    organization_id: number;
};

const isId = (v: unknown): v is number =>
    Number.isInteger(v) && (v as number) > 0;

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const reqBody: BodyType | null = await req.json().catch(() => null);
    const organization_id = reqBody?.organization_id;

    if (!isId(organization_id)) {
        return new Response('Missing field', { status: 400 });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData?.user;

    const required_members = await fetchMemberRequirement();

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

    if (!(await isSiteAdmin(user.email))) {
        return new Response('Permission denied.', { status: 403 });
    }

    const { data: currentOrg, error: currentOrgError } = await supabaseClient
        .from('organizations')
        .select('state')
        .eq('id', organization_id)
        .maybeSingle();

    if (currentOrgError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }

    if (!currentOrg) {
        return new Response('Organization not found.', { status: 404 });
    }

    if (currentOrg.state !== 'PENDING') {
        return new Response('Organization is not pending approval.', {
            status: 409,
        });
    }

    type orgTyp = {
        name: string;
    };

    const { count } = await supabaseClient.from('memberships')
        .select(`user_id`, { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .eq('active', true)
        .neq('role', 'ADVISOR');
    const org_members = count ?? 0;

    const { data: orgData, error: approveError } = await supabaseClient.from(
        'organizations',
    )
        .update({
            state: org_members >= required_members ? 'UNLOCKED' : 'LOCKED',
        })
        .eq('id', organization_id)
        .eq('state', 'PENDING')
        .select(`
            name
        `)
        .returns<orgTyp[]>();

    if (approveError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }

    if (!orgData || !orgData.length) {
        return new Response('Organization is not pending approval.', {
            status: 409,
        });
    }

    const approvedOrgName = orgData[0].name;

    await supabaseAdmin.rpc('add_charter_advisor', { org_id: organization_id });

    /* send emails  */
    const emailBody =
        `Congratulations! ${approvedOrgName} has been approved. You are now an official Stuyvesant club!

${
            org_members < required_members
                ? `Once your club is unlocked at ${required_members} members, y`
                : 'Y'
        }ou can start advertising your club, recruiting members, and holding meetings. We hope you enjoy your club experience at Stuy.` +
        footer;

    const subject = `${approvedOrgName}: Charter Approved | Epsilon`;

    await sendOrgEmail(organization_id, subject, emailBody, false, true);

    /* asynchronously create a google calendar
    REMOVE FOR NOW: DOESN'T WORK IN PRODUCTION
    initOrgCalendar(organization_id)
    .catch((error : unknown) => {
        if (error instanceof Error) {
            console.error(`Failed to create calendar: ` + error.message);
        } else {
            console.error('Unexpected error', error);
        }
    });
    */

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
