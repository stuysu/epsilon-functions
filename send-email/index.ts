import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    recipient: {
        recipient_type: "INDIVIDUAL" | "ORGANIZATION",
        recipient_address: string | number
    },
    content: {
        content_type: 'TEMPLATE' | 'CUSTOM',
        content_title: string,
        content_body: string,
        content_parameters?: string[]
    }
}

const tempTemplates : {[k : string]: string} = {
    'MEETING_CREATE': 'Hey ${ARG1}! A new meeting has been created! \n${ARG2}\n${ARG3}\n${ARG4}' //ARG1 <- org name, ARG2 <- Title, ARG3 <- description, ARG4 <- time string
}

/* Crazy debugging method. Return this to see where the program breaks */
const createBreakpoint = (str : string) => {
    return new Response(
        JSON.stringify({
            done: true,
            identifier: str
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    )
}



Deno.serve(async (req : Request) => {
    // This is needed if you're planning to invoke your function from a browser.
    // tells browser what type of requests are allowed
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const { 
        recipient,
        recipient: { 
            recipient_type, 
            recipient_address 
        },
        content,
        content: {
            content_type,
            content_title,
            content_body,
            content_parameters
        }  
    } : BodyType = await req.json();

    if (!recipient || !content || !recipient_type || !recipient_address || !content_type || !content_title || !content_body) {
        return new Response("Missing field", { status: 400 })
    }

    if (recipient_type !== 'INDIVIDUAL' && recipient_type !== 'ORGANIZATION') {
        return new Response("Invalid recipient type.", { status: 400 });
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

    const siteUser = verifiedUsers[0];

    const { data: permissions, error: permissionsError } = await supabaseClient
        .from('permissions')
        .select(`
            permission
        `)
        .eq('user_id', siteUser.id);

    if (permissionsError) {
        return new Response("Failed to fetch user permissions.", { status: 500 })
    }

    /* If recipient is an individual, check if that person is within our system. Only allow inter-system messages */
    if (recipient_type === 'INDIVIDUAL') {
        const { data: validRecipient, error: validRecipientError } = await supabaseClient
            .from('users')
            .select(`id`)
            .eq('email', recipient_address);
        
        if (validRecipientError) {
            return new Response("Failed to fetch recipient user.", { status: 500 });
        }

        if (!validRecipient || !validRecipient.length) {
            return new Response("Recipient is not a valid user.", { status: 401 });
        }
    }
    
    /* check if user has an admin role */
    let isAdmin = false;
    (permissions || []).map(p => {
        if (p.permission === 'ADMIN') {
            isAdmin = true;
        }
    });

    if (!isAdmin && content_type === 'CUSTOM') {
        return new Response("Invalid permissions for custom emails.", { status: 401 })
    }

    if (!isAdmin) {
        const { data: adminOrgs, error: adminOrgsError } = await supabaseClient
            .from('memberships')
            .select(`
                id,
                organization_id
            `)
            .eq('user_id', siteUser.id)
            .in('role', ['ADMIN', 'CREATOR']);
        
        if (adminOrgsError) {
            return new Response("Failed to fetch user organizations.", { status: 500 });
        }

        const adminOrgIds : number[] = adminOrgs.map(o => o.organization_id);

        if (recipient_type === 'ORGANIZATION') {
            /* check if user is an organization admin of the organization they are sending emails to. If not, no email access. */
            if (!adminOrgIds.includes(Number(recipient_address))) {
                return new Response("Invalid permissions for sending emails.", { status: 401 })
            }
        } else {
            /* Can only use api to email people in the same club (even individuals) */
            type ctyp = { // correct type
                id: number,
                organization_id: number,
                users: {
                    email: string
                }
            }

            /* if recipient is in a club that the sender is an admin in, able to send */
            const { data: recipientMemberships, error: rmError } = await supabaseClient
                .from('memberships')
                .select(`
                    id,
                    organization_id,
                    users!inner (
                        email
                    )
                `)
                .eq('users.email', recipient_address)
                .in('organization_id', adminOrgIds)
                .returns<ctyp[]>();

            if (rmError) {
                return new Response("Failed to fetch user organizations.", { status: 500 })
            }

            if (!recipientMemberships || !recipientMemberships.length) {
                return new Response("Invalid permissions for sending emails.", { status: 401 })
            }
        }
    }

    let body = "";

    if (content_type === 'CUSTOM') {
        body = content_body;
    } else if (content_type === 'TEMPLATE') {
        body = tempTemplates[content_body];
        content_parameters?.map((arg, i) => {
            body = body.replace(`\${ARG${i+1}}`, arg);
        });
    } else {
        return new Response("Invalid content type.", { status: 400 });
    }
    
    const recipients = [];
    if (recipient_type === 'INDIVIDUAL') {
        recipients.push(recipient_address)
    } else if (recipient_type === 'ORGANIZATION') {
        /* get all members from organization */
        type ct = { // correct type
            active: boolean,
            users: {
                email: string,
                active: boolean,
                is_faculty: boolean
            }
        }
        const { data: orgMembers, error: orgMembersError } = await supabaseClient.from('memberships')
            .select(`
                active,
                users (
                    email,
                    active,
                    is_faculty
                )`
            )
            .eq('organization_id', Number(recipient_address))
            .returns<ct[]>();
        
        
        if (orgMembersError) {
            return new Response("Failed to fetch organization members.", { status: 500 });
        }

        (orgMembers).map((member : ct) => {
            if (member.active && member.users.active && !member.users.is_faculty) recipients.push(member.users.email)
        });
    }

    for (const emailAddress of recipients) {
        try {
            await new Promise<void>((resolve, reject) => {
                Transport.sendMail({
                    from: Deno.env.get('NODEMAILER_FROM')!,
                    to: emailAddress,
                    subject: content_title,
                    text: body,
                }, (error : Error) => {
                    if (error) {
                        return reject(error)
                    }
            
                    resolve()
                })
            })
        } catch (error) {
            return new Response(error.message, { status: 500 })
        }
    }

    return new Response(
        JSON.stringify({
            done: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    )
})