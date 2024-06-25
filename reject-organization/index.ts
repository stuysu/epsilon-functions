import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    organization_id: number
}

Deno.serve(async (req : Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const {
        organization_id,
    } : BodyType = await req.json();

    if (!organization_id) {
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
        .select('*')
        .eq('email', user.email);
    
    if (verifiedUsersError) {
        return new Response("Failed to fetch users associated email.", { status: 500 });
    }

    if (!verifiedUsers || !verifiedUsers.length) {
        return new Response("User is unauthorized.", { status: 401 });
    }

    type orgTyp = {
        name: string
    }

    const { data: orgData, error: orgFetchError } = await supabaseClient.from('organizations')
        .select(`
            name
        `)
        .eq('id', organization_id)
        .returns<orgTyp[]>();
    
    if (orgFetchError) {
        return new Response("Failed to approve organization.", { status: 500 });
    }

    const rejectedOrgName = orgData[0].name;

    type orgAdminType = {
        id: number,
        role: 'ADMIN' | 'CREATOR',
        users: {
            first_name: string,
            email: string
        }
    };

    const { data: orgAdmins, error: orgAdminError } = await supabaseClient.from('memberships')
        .select(`
            id,
            role,
            users!inner (
                first_name,
                email
            )
        `)
        .eq('organization_id', organization_id)
        .in('role', ['ADMIN', 'CREATOR'])
        .returns<orgAdminType[]>();
    
    /* reject organization */
    const { error: rejectError } = await supabaseClient.from("organizations")
            .delete()
            .eq('id', organization_id)
    
    if (rejectError) {
        return new Response("Failed to reject organization.", { status: 500 });
    }

    /* asynchronously email admins to prevent function from hanging on client */

    if (orgAdminError || !orgAdmins || !orgAdmins.length) {
        console.log("Unable to email org admins.");
        return new Response("Failed to email org admins.", { status: 500 });
    }

    for (const admin of orgAdmins) {
        const emailBody =
`Hi ${admin.users.first_name}!

Your charter for ${rejectedOrgName} has been rejected.

If you have any questions, please email clubpub@stuysu.org.

Best,

The Epsilon Team.
`

        /* don't use await here. let this operation perform asynchronously */
        Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: admin.users.email,
            subject: `${rejectedOrgName} Rejected | Epsilon`,
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

    return new Response(
        JSON.stringify({
            success: true
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    )
})