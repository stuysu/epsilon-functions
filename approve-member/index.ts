import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

type BodyType = {
    member_id: number;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        member_id,
    }: BodyType = await req.json();

    if (!member_id) {
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

    /* RLS takes care of any permissions */

    /* update member */
    type omtyp = {
        organizations: {
            id: number;
            name: string;
        };
    };
    const { data: memberData, error: updateMemberError } = await supabaseClient
        .from('memberships')
        .update({ active: true })
        .eq('id', member_id)
        .select(`
                organizations!inner (
                    id,
                    name
                )
            `)
        .returns<omtyp[]>();

    /* send error if failed to join organization */
    if (updateMemberError || !memberData || !memberData.length) {
        return new Response('Error updating member.', { status: 422 }); // unprocessable entity
    }

    /* if success, then send email to member */

    /* asynchronously email member to prevent stalling client */
    type utyp = {
        organization_id: number;
        users: {
            first_name: string;
            email: string;
        };
    };
    type otyp = {
        name: string;
    };
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
        .then(async (resp) => {
            const { data: orgMember, error: orgMemberError } = resp;
            if (orgMemberError || !orgMember || !orgMember.length) {
                console.error('Unable to email member.');
                return;
            }

            const member = orgMember[0];

            const { data: orgData, error: orgDataError } = await supabaseClient
                .from('organizations')
                .select('name')
                .eq('id', member.organization_id)
                .returns<otyp[]>();
            if (orgDataError || !orgData || !orgData.length) {
                console.error('Unable to find member organization.');
                return;
            }

            const emailBody = `Hi ${member.users.first_name}!
            
Congrats! You're now a member of ${orgData[0].name}

We hope you enjoy your club experience at Stuy.

With Love

The Epsilon Team

If you need any technical assistance, email us at it@stuysu.org. If you have general questions about Clubs & Pubs, reach out to us at clubpub@stuysu.org.
`;

            /* don't use await here. let this operation perform asynchronously */
            Transport.sendMail({
                from: Deno.env.get('NODEMAILER_FROM')!,
                to: member.users.email,
                subject: `Membership Approved ${orgData[0].name} | Epsilon`,
                text: emailBody,
            })
                .catch((error: unknown) => {
                    if (error instanceof Error) {
                        console.error(`Failed to send email: ` + error.message);
                    } else {
                        console.error('Unexpected error', error);
                    }
                });
        });

    /* ALSO CHECK IF CLUB IS PENDING AND SHOULD IT BE UNLOCKED */
    const orgId = memberData[0].organizations.id;
    const orgName = memberData[0].organizations.name;

    const { data: orgData, error: orgDataError } = await supabaseClient.from(
        'organizations',
    )
        .select(`
            state,
            memberships!inner (
                active
            )
        `)
        .eq('id', orgId);

    if (orgData && orgData.length && !orgDataError) {
        const org = orgData[0];

        type styp = {
            required_members: number;
        };
        const { data: siteSettings } = await supabaseAdmin.from('settings')
            .select(`
                required_members
            `)
            .returns<styp[]>();
        let required_members = 0;
        if (siteSettings) {
            required_members = siteSettings[0].required_members;
        }

        if (
            org.state === 'LOCKED' &&
            org.memberships.filter((m) => m.active).length >= required_members
        ) {
            /* SEND ORG ADMINS AN EMAIL ABOUT THIS */
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
                .eq('organization_id', orgId)
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

You are receiving this email because your organization ${orgName} has been approved and unlocked.

You can begin creating meetings, making posts, and your organization will be displayed on the club catalog.

We hope you enjoy your club experience at Stuy!

With Love,

The Epsilon Team
`;

                        Transport.sendMail({
                            from: Deno.env.get('NODEMAILER_FROM')!,
                            to: admin.users.email,
                            subject:
                                `Organization Unlocked ${orgName} | Epsilon`,
                            text: emailBody,
                        })
                            .catch((error: unknown) => {
                                if (error instanceof Error) {
                                    console.error(
                                        `Failed to send email: ` +
                                            error.message,
                                    );
                                } else {
                                    console.error('Unexpected error', error);
                                }
                            });
                    }
                });

            await supabaseAdmin.from('organizations')
                .update({ state: 'UNLOCKED' })
                .eq('id', orgId);
        }
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
