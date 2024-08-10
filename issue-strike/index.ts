import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    organization_id: number;
    reason: string;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        organization_id,
        reason,
    }: BodyType = await req.json();

    if (!organization_id || !reason) {
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

    // this is the user that is stored in public.users
    const siteUser = verifiedUsers[0];

    /* hand out strike */
    type styp = {
        id: number;
        reason: string;
        users: {
            first_name: string;
            last_name: string;
            picture: string;
        };
        organizations: {
            name: string;
            url: string;
        };
    };

    const { data: strikeData, error: strikeError } = await supabaseClient.from(
        'strikes',
    )
        .insert({
            organization_id,
            admin_id: siteUser.id,
            reason,
        })
        .select(`
            id,
            reason,
            users!inner(
                first_name,
                last_name,
                picture
            ),
            organizations!inner (
                name,
                url
            )
        `)
        .returns<styp[]>();

    if (strikeError) {
        return new Response('Failed to issue strike.', { status: 500 });
    }

    /* asynchronously email admins to prevent function from hanging on client */

    const emailBody =
        `You are receiving this message because you are an admin of {ORG_NAME}.
        
This email is to let you know that your organization has be given a strike for the following reason:
${reason}

You can view this strike at ${Deno.env.get('SITE_URL')}/${
            strikeData[0].organizations.url
        }/admin/strikes

If you would like to dispute this strike, please contact clubpub@stuysu.org.
` + footer;
    const emailSubject = `{ORG_NAME}: Strike Received | Epsilon`;

    sendOrgEmail(organization_id, emailSubject, emailBody, false, true);

    return new Response(
        JSON.stringify({
            id: strikeData[0].id,
            reason,
            users: {
                first_name: strikeData[0].users.first_name,
                last_name: strikeData[0].users.last_name,
                picture: strikeData[0].users.picture,
            },
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
