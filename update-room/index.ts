import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';

type BodyType = {
    room_id: number;
    name: string;
    floor: number;
    approval_required: boolean;
    comments: string;
    available_days: (
        | 'MONDAY'
        | 'TUESDAY'
        | 'WEDNESDAY'
        | 'THURSDAY'
        | 'FRIDAY'
        | 'SATURDAY'
        | 'SUNDAY'
    )[];
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        room_id,
        name,
        floor,
        approval_required,
        comments,
        available_days,
    }: BodyType = await req.json();

    if (!room_id || !available_days || !floor || !name) {
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

    /* validation via RLS */

    /* update room */
    const { error: roomUpdateError } = await supabaseClient.from('rooms')
        .update({
            name,
            floor,
            approval_required,
            comments,
            available_days: available_days.join(', '),
        })
        .eq('id', room_id);

    if (roomUpdateError) {
        return new Response('Failed to update room.', { status: 500 });
    }

    /* delete any meetings that are no longer valid, and update organization about them */
    const daysOfWeek: BodyType['available_days'] = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
    ];
    supabaseClient.from('meetings')
        .select(`
            id,
            title,
            start_time,
            end_time,
            rooms!inner (
                id,
                name
            ),
            organization_id  
        `)
        .eq('room_id', room_id)
        .then(async ({ data: meetings, error: meetingFetchError }) => {
            if (meetingFetchError || !meetings) {
                console.error('Failed to fetch meetings', meetingFetchError);
                return;
            }

            const orgUpdateData: {
                [id: number]: {
                    name: string;
                    admins: { users: { first_name: string; email: string } }[];
                    removedMeetings: {
                        id: number;
                        title: string;
                        start_time: string;
                        end_time: string;
                    }[];
                };
            } = {};

            for (const meeting of meetings) {
                const start = new Date(meeting.start_time);
                const dayOfWeek = daysOfWeek[start.getDay()];

                if (!available_days.includes(dayOfWeek)) {
                    /* delete meeting */
                    const { error: deleteMeetingError } = await supabaseClient
                        .from('meetings')
                        .delete()
                        .eq('id', meeting.id);

                    type mtyp = {
                        users: {
                            first_name: string;
                            email: string;
                        };
                    };

                    if (deleteMeetingError) continue;

                    /* meeting is no longer valid, need to update admins of org */
                    const { data: admins, error: adminFetchError } =
                        await supabaseClient.from('memberships')
                            .select(`
                            users!inner (
                                first_name,
                                email
                            )
                        `)
                            .eq('organization_id', meeting.organization_id)
                            .returns<mtyp[]>();

                    if (adminFetchError || !admins) {
                        console.error(
                            'Failed to fetch admins',
                            adminFetchError,
                        );
                        continue;
                    }

                    const { data: orgData, error: orgFetchError } =
                        await supabaseClient.from('organizations')
                            .select(`
                                id,
                                name    
                            `)
                            .eq('id', meeting.organization_id)
                            .limit(1)
                            .single();

                    if (orgFetchError || !orgData) {
                        console.error(
                            'Failed to fetch org data',
                            orgFetchError,
                        );
                        continue;
                    }

                    if (!orgUpdateData[orgData.id]) {
                        orgUpdateData[orgData.id] = {
                            name: orgData.name,
                            admins,
                            removedMeetings: [],
                        };
                    }

                    orgUpdateData[orgData.id].removedMeetings.push(meeting);
                }
            }

            for (const value of Object.values(orgUpdateData)) {
                for (const admin of value.admins) {
                    const emailBody = `
Hi ${admin.users.first_name},

This email is to let you know that the following meetings have been removed from ${value.name}:
${
                        value.removedMeetings.map((meeting) =>
                            `${meeting.title} at ${
                                datetime(meeting.start_time).toZonedTime(
                                    'America/New_York',
                                ).format('MMMM d, YYYY, h:mm a')
                            }`
                        ).join('\n')
                    }

This is due to the fact that the room they were initially held in are no longer available on the days that these meetings were scheduled.

We are deeply sorry for the inconvenience, and we hope you are able to reschedule the meetings to a different room
The Epsilon Team
                    `;
                    Transport.sendMail({
                        from: Deno.env.get('NODEMAILER_FROM')!,
                        to: admin.users.email,
                        subject: `Meetings removed for ${value.name} | Epsilon`,
                        text: emailBody,
                    });
                }
            }
        });
    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
