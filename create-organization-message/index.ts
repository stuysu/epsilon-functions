import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import corsHeaders from '../_shared/cors.ts';
import Transport from '../_shared/emailTransport.ts';

type BodyType = {
    organization_id: number;
    content: string;
}

/* accepts JSON */
Deno.serve(async (req : Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const {
        organization_id,
        content
    } : BodyType = await req.json();

    if (!organization_id || !content) {
        return new Response("Missing field", { status: 400 })
    }

    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
    );

    const jwt = authHeader.split(" ")[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    /* Failed to fetch supabase user */
    if (!user) {
        return new Response("Failed to fetch user.", { status: 500 });
    }

    /* check if user is a verified user. Verified user = the userdata that the site uses */
    const { data: verifiedUsers, error: verifiedUsersError } = await supabaseClient.from('users')
        .select(`*`)
        .eq('email', user.email);
    
    if (verifiedUsersError) {
        return new Response("Failed to fetch users associated email.", { status: 500 });
    }

    if (!verifiedUsers || !verifiedUsers.length) {
        return new Response("User is unauthorized.", { status: 401 });
    }

    const siteUser = verifiedUsers[0];

    /* create org message */
    type orgTyp = {
        id: number,
        organizations: {
            name: string,
            url: string
        }
    }
    const { data: orgData, error: createError } = await supabaseClient.from('orgmessages')
        .insert({
            organization_id: organization_id,
            user_id: siteUser.id,
            content: content
        })
        .select(`
            id,
            organizations!inner (
                name,
                url
            )
        `)
        .returns<orgTyp[]>();
    
    
    if (createError || !orgData || !orgData.length) {
        return new Response("Error creating organization message.", { status: 500 });
    }

    const orgName = orgData[0].organizations.name;
    const orgUrl = orgData[0].organizations.url;

    type orgAdminType = {
        id: number,
        role: 'ADMIN' | 'CREATOR',
        users: {
            id: number,
            first_name: string,
            email: string
        }
    };

    /* email admins of organization except for current user */
    const { data: orgAdmins, error: orgAdminError } = await supabaseClient.from('memberships')
        .select(`
            id,
            role,
            users!inner (
                id,
                first_name,
                email
            )
        `)
        .eq('organization_id', organization_id)
        .in('role', ['ADMIN', 'CREATOR'])
        .returns<orgAdminType[]>();

    /* asynchronously email admins to prevent function from hanging on client */

    if (orgAdminError || !orgAdmins || !orgAdmins.length) {
        console.log("Unable to email org admins.");
        return new Response("Failed to email org admins.", { status: 500 });
    }

    for (const admin of orgAdmins) {
        if (admin.users.id === siteUser.id) continue;

        const emailBody =
`Hi ${admin.users.first_name}!

There is a new message for ${orgName}.

${siteUser.first_name} ${siteUser.last_name}: ${content}

You can view this message at ${Deno.env.get('SITE_URL')}/${orgUrl}/admin/messages.

If you have any questions, please email clubpub@stuysu.org.

Best,

The Epsilon Team.
`

        /* don't use await here. let this operation perform asynchronously */
        Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: admin.users.email,
            subject: `${orgName} New Message | Epsilon`,
            text: emailBody,
        })
        .catch((error : unknown) => {
            if (error instanceof Error) {
                console.error(`Failed to send email: ` + error.message);
            } else {
                console.error('Unexpected error', error);
            }
        })
    }

    // success!
    return new Response(
        JSON.stringify({
            success: true,
            id: orgData[0].id
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    );
})