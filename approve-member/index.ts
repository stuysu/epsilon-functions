import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    member_id: number
}

Deno.serve(async (req : Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const {
        member_id
    } : BodyType = await req.json();

    if (!member_id) {
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

    /* RLS takes care of any permissions */

    /* update member */
    const { error: updateMemberError } = await supabaseClient
            .from("memberships")
            .update({ active: true })
            .eq("id", member_id);

    /* send error if failed to join organization */
    if (updateMemberError) {
        return new Response("Error updating member.", { status: 422 }) // unprocessable entity
    }

    /* if success, then send email to member */

    /* asynchronously email member to prevent stalling client */
    type utyp = {
        organization_id: number,
        users: {
            first_name: string,
            email: string
        }
    }
    type otyp = {
        name: string
    }
    supabaseClient.from('memberships')
        .select(`
            organization_id,
            users!inner (
                first_name,
                email
            )
        `)
        .eq('id', member_id)
        .returns<utyp[]>()
        .then(async resp => {
            const { data: orgMember, error: orgMemberError } = resp;
            if (orgMemberError || !orgMember || !orgMember.length) {
                console.error("Unable to email member.");
                return;
            }

            const member = orgMember[0];

            const { data: orgData, error: orgDataError } = await supabaseClient.from('organizations')
                .select('name')
                .eq('id', member.organization_id)
                .returns<otyp[]>();
            if (orgDataError || !orgData || !orgData.length) {
                console.error("Unable to find member organization.");
                return;
            }

            const emailBody = `Hi ${member.users.first_name}!
            
Congrats! You're now a member of ${orgData[0].name}

We hope you enjoy your club experience at Stuy.

With Love

The Epsilon Team

If you need any technical assistance, email us at it@stuysu.org. If you have general questions about Clubs & Pubs, reach out to us at clubpub@stuysu.org.
`
    
            /* don't use await here. let this operation perform asynchronously */
            Transport.sendMail({
                from: Deno.env.get('NODEMAILER_FROM')!,
                to: member.users.email,
                subject: `Membership Approved ${orgData[0].name} | Epsilon`,
                text: emailBody,
            })
            .catch((error : unknown) => {
                if (error instanceof Error) {
                    console.error(`Failed to send email: ` + error.message);
                } else {
                    console.error('Unexpected error', error);
                }
            });
        })

    return new Response(
        JSON.stringify({
            success: true
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    )
})