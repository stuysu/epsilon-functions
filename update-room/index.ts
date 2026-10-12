import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

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
    ais_days: string[];
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
        ais_days,
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
    const { data: updatedRooms, error: roomUpdateError } = await supabaseClient
        .from('rooms')
        .update({
            name,
            floor,
            approval_required,
            comments,
            available_days: available_days.join(', '),
            ais_days,
        })
        .eq('id', room_id)
        .select('id');

    if (roomUpdateError) {
        return new Response('Failed to update room.', { status: 500 });
    }

    if (!updatedRooms || !updatedRooms.length) {
        return new Response('User is unauthorized.', { status: 403 });
    }

    const daysOfWeek: BodyType['available_days'] = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
    ];
    const { data: meetings, error: meetingFetchError } = await supabaseClient
        .from('meetings')
        .select(`
            id,
            title,
            start_time,
            organization_id
        `)
        .eq('room_id', room_id)
        .gte('start_time', new Date().toISOString());

    if (meetingFetchError || !meetings) {
        console.error('Failed to fetch meetings', meetingFetchError);
        return new Response('Failed to update meetings.', { status: 500 });
    }

    const cancelledMeetings: {
        [organizationId: number]: { title: string; start_time: string }[];
    } = {};

    for (const meeting of meetings) {
        const dayOfWeek = daysOfWeek[
            datetime(new Date(meeting.start_time)).toZonedTime(
                'America/New_York',
            ).weekDay()
        ];

        if (available_days.includes(dayOfWeek)) continue;

        const { data: cancelled, error: cancelError } = await supabaseClient
            .from('meetings')
            .delete()
            .eq('id', meeting.id)
            .select('id');

        if (cancelError || !cancelled || !cancelled.length) {
            console.error('Failed to cancel meeting', cancelError);
            continue;
        }

        (cancelledMeetings[meeting.organization_id] ??= []).push(meeting);
    }

    for (
        const [organizationId, orgMeetings] of Object.entries(cancelledMeetings)
    ) {
        const emailBody = `Dear {ORG_NAME} member,

This email is to let you know that the following meeting(s) of {ORG_NAME} have been cancelled by administrators due to room ${name} no longer being available:
${
            orgMeetings.map((meeting) =>
                `${meeting.title} at ${
                    datetime(meeting.start_time).toZonedTime(
                        'America/New_York',
                    ).format('MMMM d, YYYY, h:mm a')
                }`
            ).join('\n')
        }

We sincerely apologize for the inconvenience.` +
            footer;

        await sendOrgEmail(
            Number(organizationId),
            `{ORG_NAME}: Meeting(s) Cancelled | Epsilon`,
            emailBody,
            false,
            false,
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
