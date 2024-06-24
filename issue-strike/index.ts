import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    organization_id: number,
    reason: string
}

Deno.serve(async (req : Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const {
        organization_id,
        reason
    } : BodyType = await req.json();

    if (!organization_id || !reason) {
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

    // this is the user that is stored in public.users
    const siteUser = verifiedUsers[0];

    /* hand out strike */
    type styp = {
        id: number,
        reason: string,
        users: {
            first_name: string,
            last_name: string,
            picture: string
        },
        organizations: {
            name: string,
            url: string
        }
    }

    type orgAdminType = {
        id: number,
        role: 'ADMIN' | 'CREATOR',
        users: {
            first_name: string,
            email: string
        }
    };

    const { data: strikeData, error: strikeError } = await supabaseClient.from("strikes")
        .insert({
            organization_id,
            admin_id: siteUser.id,
            reason
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
        return new Response("Failed to issue strike.", { status: 500 });
    }
    
    /* asynchronously email admins to prevent function from hanging on client */
    supabaseClient.from('memberships')
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
        .returns<orgAdminType[]>()
        .then(resp => {
            const { data: orgAdmins, error: orgAdminError } = resp;
            if (orgAdminError || !orgAdmins || !orgAdmins.length) {
                console.log("Unable to email org admins.");
                return;
            }

            const orgData = strikeData[0].organizations

            for (const admin of orgAdmins) {
                const emailBody =
`Hi ${admin.users.first_name}!
        
You are receiving this message because you are an admin of ${orgData.name}
        
This email is to let you know that your organization has be given a strike for the following reason:
${reason}

You can view this strike at ${Deno.env.get('SITE_URL')}/${orgData.url}/admin/strikes

If you would like to dispute this strike, please contact clubpub@stuysu.org.
`
        
                /* don't use await here. let this operation perform asynchronously */
                Transport.sendMail({
                    from: Deno.env.get('NODEMAILER_FROM')!,
                    to: admin.users.email,
                    subject: `You have been given a strike ${orgData.name} | Epsilon`,
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
        })

    return new Response(
        JSON.stringify({
            id: strikeData[0].id,
            reason,
            users: {
                first_name: strikeData[0].users.first_name,
                last_name: strikeData[0].users.last_name,
                picture: strikeData[0].users.picture
            },
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    )
})