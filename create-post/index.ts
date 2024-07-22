import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
    organization_id: number;
    title: string;
    description: string;
};

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

    const bodyJson = await req.json();
    const body: BodyType = {
        organization_id: bodyJson.organization_id,
        title: bodyJson.title,
        description: bodyJson.description,
    };

    /* create post */
    const { data: postData, error: postError } = await supabaseClient.from(
        'posts',
    )
        .insert(body)
        .select();

    if (postError || !postData || !postData.length) {
        return new Response('Error creating post.', { status: 500 });
    }

    /* email all members of organization */

    const emailText = `${body.title}\n\n${body.description}`;
    const emailSubject = `${body.title} | {ORG_NAME}`;

    await sendOrgEmail(body.organization_id, emailSubject, emailText);

    return new Response(
        JSON.stringify({
            ...postData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
