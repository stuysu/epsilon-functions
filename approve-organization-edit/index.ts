import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    organization_id: number;
    updated_fields: {
        [key: string]: any;
    };
    edit_id: number;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        organization_id,
        updated_fields,
        edit_id,
    }: BodyType = await req.json();

    if (!organization_id || !updated_fields || !edit_id) {
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

    type orgTyp = {
        name: string;
    };

    /* UPDATE ORG */
    const { data: orgData, error: updateError } = await supabaseClient.from(
        'organizations',
    )
        .update(updated_fields)
        .eq('id', organization_id)
        .select(`
            name
        `)
        .returns<orgTyp[]>();

    if (updateError) {
        return new Response('Failed to update organization.', { status: 500 });
    }

    const updatedOrgName = orgData[0].name;

    /* Try deleting edit */
    const { error: deleteEditError } = await supabaseClient.from(
        'organizationedits',
    )
        .delete()
        .eq('id', edit_id);

    type orgAdminType = {
        id: number;
        role: 'ADMIN' | 'CREATOR';
        users: {
            first_name: string;
            email: string;
        };
    };

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
        .then((resp) => {
            const { data: orgAdmins, error: orgAdminError } = resp;
            if (orgAdminError || !orgAdmins || !orgAdmins.length) {
                console.log('Unable to email org admins.');
                return;
            }

            for (const admin of orgAdmins) {
                const emailBody = `Hi ${admin.users.first_name}!

Your organization update request for ${updatedOrgName} has been approved.

Best,

The Epsilon Team

For technical concerns, please contact it@stuysu.org. For general questions about clubs & pubs, email clubpub@stuysu.org.
`;

                /* don't use await here. let this operation perform asynchronously */
                Transport.sendMail({
                    from: Deno.env.get('NODEMAILER_FROM')!,
                    to: admin.users.email,
                    subject: `${updatedOrgName} Update Approved | Epsilon`,
                    text: emailBody,
                })
                    .catch((error: unknown) => {
                        if (error instanceof Error) {
                            console.error(
                                `Failed to send email: ` + error.message,
                            );
                        } else {
                            console.error('Unexpected error', error);
                        }
                    });
            }
        });

    if (deleteEditError) {
        return new Response(
            'Failed to delete pre-existing edit. Please contact it@stuysu.org as soon as possible.',
            { status: 500 },
        );
    }

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
