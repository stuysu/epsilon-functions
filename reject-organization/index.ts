import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Transport from '../_shared/emailTransport.ts';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import { isSiteAdmin } from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';

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

    type orgTyp = {
        name: string;
        state: string;
    };

    const { data: orgData, error: orgFetchError } = await supabaseClient.from(
        'organizations',
    )
        .select(`
            name,
            state
        `)
        .eq('id', organization_id)
        .returns<orgTyp[]>();

    if (orgFetchError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }

    if (!orgData || !orgData.length) {
        return new Response('Organization not found.', { status: 404 });
    }

    // only charters still awaiting review can be rejected; rejecting deletes
    // the organization, so an approved club must not go through here
    if (orgData[0].state !== 'PENDING') {
        return new Response('Only pending organizations can be rejected.', {
            status: 409,
        });
    }

    const rejectedOrgName = orgData[0].name;

    type orgAdminType = {
        id: number;
        role: 'ADMIN' | 'CREATOR';
        users: {
            first_name: string;
            email: string;
        };
    };

    const { data: orgAdmins, error: orgAdminError } = await supabaseClient.from(
        'memberships',
    )
        .select(`
            id,
            role,
            users!inner (
                first_name,
                email
            )
        `)
        .eq('organization_id', organization_id)
        .eq('active', true)
        .in('role', ['ADMIN', 'CREATOR'])
        .returns<orgAdminType[]>();

    /* reject organization */
    const { data: rejectedOrgs, error: rejectError } = await supabaseClient
        .from('organizations')
        .delete()
        .eq('id', organization_id)
        .eq('state', 'PENDING')
        .select('id');

    if (rejectError) {
        return new Response('Failed to reject organization.', { status: 500 });
    }

    /* someone approved it between the check above and this delete */
    if (!rejectedOrgs || !rejectedOrgs.length) {
        return new Response('Only pending organizations can be rejected.', {
            status: 409,
        });
    }

    /* email admins */

    /* the organization is already deleted, so report success even if the
       admins can't be emailed */
    if (orgAdminError || !orgAdmins || !orgAdmins.length) {
        console.log('Unable to email org admins.');
    }

    for (const admin of orgAdmins ?? []) {
        const emailBody = `Hi ${admin.users.first_name}!

Your charter for ${rejectedOrgName} has been rejected.` + footer;

        Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: admin.users.email,
            subject: `${rejectedOrgName}: Charter Rejected | Epsilon`,
            text: emailBody,
        })
            .catch((error: unknown) => {
                if (error instanceof Error) {
                    console.error(`Failed to send email: ` + error.message);
                } else {
                    console.error('Unexpected error', error);
                }
            });
    }

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
