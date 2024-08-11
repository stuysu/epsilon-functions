import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

type BodyType = {
    name: string;
    url: string;
    socials: string;
    mission: string;
    goals: string;
    benefit: string;
    keywords: string;
    tags: string[];
    appointment_procedures: string;
    uniqueness: string;
    meeting_description: string;
    meeting_schedule: string;
    meeting_days: string[];
    commitment_level: string;
    join_instructions: string;
    is_returning: boolean;
    returning_info: string;
    fair?: boolean;
};

const RESERVED_PATHS = [
    'catalog',
    'create',
    'about',
    'meetings',
    'rules',
    'archive',
    'modules',
    'admin',
    'attendance',
    'opportunities',
    'valentines',
    'today',
    'announcements',
];

/* accepts JSON */
Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
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

    const siteUser = verifiedUsers[0];
    const body: BodyType = await req.json();
    if (RESERVED_PATHS.indexOf(body.url) !== -1) {
        return new Response(
            'You may not register an Epsilon URL that is already in use.',
            { status: 400 },
        );
    }
    body.url = body.url.replace(' ', '-');

    const { data: orgData, error: orgCreateError } = await supabaseClient.from(
        'organizations',
    )
        .insert({
            ...body,
        })
        .select(`
            id
        `);

    if (orgCreateError || !orgData || !orgData.length) {
        return new Response(
            `Error creating organization. \`${(orgCreateError?.message ||
                orgCreateError?.code ||
                'Unknown error. Contact it@stuysu.org.')}\``,
            { status: 500 },
        );
    }

    /* CREATE CREATOR MEMBERSHIP FOR USER */
    const { error: membershipError } = await supabaseAdmin.from('memberships')
        .insert({
            organization_id: orgData[0].id,
            user_id: siteUser.id,
            role: 'CREATOR',
            active: true,
        });

    if (membershipError) {
        return new Response(
            'Error creating membership. Please contact it@stuysu.org as soon as possible.',
            { status: 500 },
        );
    }

    // success!
    return new Response(
        JSON.stringify({
            id: orgData[0].id,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
