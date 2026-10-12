import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    room_id: number;
    organization_id: number;
    start_time: string;
    end_time: string;
    title?: string;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        room_id,
        organization_id,
        start_time,
        end_time,
        title,
    }: BodyType = await req.json();

    if (!room_id || !organization_id || !start_time || !end_time) {
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

    /*
    check if there is any interference with time and room.
    if there are any other meetings, kick them out and bcc it@stuysu.org.
    */

    const { data: meetings, error: meetingFetchError } = await supabaseClient
        .rpc('get_booked_rooms', {
            meeting_start: start_time,
            meeting_end: end_time,
        })
        .returns<{ room_id: number; meeting_id: number }[]>();

    if (meetingFetchError || !meetings) {
        return new Response('Failed to fetch meetings', { status: 500 });
    }

    // check if room is AIS-locked on the booking day
    const { data: roomData, error: roomFetchError } = await supabaseClient
        .from('rooms')
        .select('ais_days')
        .eq('id', room_id)
        .single();

    if (roomFetchError || !roomData) {
        return new Response('Failed to fetch room.', { status: 500 });
    }

    const daysOfWeek = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
    ];
    /* the day it falls on in New York, not wherever the server runs */
    const bookingDay = daysOfWeek[
        datetime(new Date(start_time)).toZonedTime('America/New_York').weekDay()
    ];

    if (roomData.ais_days && roomData.ais_days.includes(bookingDay)) {
        return new Response(
            'This room is reserved for AIS on this day and cannot be booked.',
            { status: 400 },
        );
    }

    /* the admin can name the meeting, otherwise it keeps the default (the column is VARCHAR(500)) */
    const reason = typeof title === 'string' ? title.trim().slice(0, 500) : '';
    const meetingTitle = reason || 'Reserved Meeting';

    const bookedMeetings = meetings as unknown as {
        room_id: number;
        meeting_id: number;
    }[];
    const conflictingMeetingIds = bookedMeetings
        .filter((meeting) => meeting.room_id === room_id)
        .map((meeting) => meeting.meeting_id);

    if (conflictingMeetingIds.length) {
        const { data: removedMeetings, error: orgError } = await supabaseClient
            .from('meetings')
            .delete()
            .in('id', conflictingMeetingIds)
            .select(`
                title,
                start_time,
                rooms (
                    name
                ),
                organizations!inner (
                    name,
                    id
                )
            `)
            .returns<
                {
                    title: string;
                    start_time: string;
                    rooms: { name: string } | null;
                    organizations: { name: string; id: number };
                }[]
            >();

        if (orgError || !removedMeetings) {
            console.error('Failed to fetch org.');
            return new Response('Failed to notify conflicting rooms.', {
                status: 500,
            });
        }

        const roomName = removedMeetings[0]?.rooms?.name || 'the room';

        /* tell them why, if the admin gave a title for the reservation */
        const cause = reason
            ? `because ${roomName} was reserved for "${reason}"`
            : `due to a conflict with another meeting in ${roomName}`;

        const meetingsByOrg: {
            [organizationId: number]: typeof removedMeetings;
        } = {};
        for (const meeting of removedMeetings) {
            (meetingsByOrg[meeting.organizations.id] ??= []).push(meeting);
        }

        for (const [orgId, orgMeetings] of Object.entries(meetingsByOrg)) {
            const emailBody = `Dear {ORG_NAME} member,

This email is to let you know that the following meeting(s) of {ORG_NAME} have been cancelled by administrators ${cause}:
${
                orgMeetings.map((meeting) =>
                    `${meeting.title} at ${
                        datetime(meeting.start_time).toZonedTime(
                            'America/New_York',
                        ).format('MMMM d, YYYY, h:mm a')
                    }`
                ).join('\n')
            }

We sincerely apologize for the inconvenience.` + footer;

            await sendOrgEmail(
                Number(orgId),
                `{ORG_NAME}: Meeting(s) Cancelled | Epsilon`,
                emailBody,
                false,
                false,
            );
        }
    }

    const { error: reserveError } = await supabaseClient.from('meetings')
        .insert({
            room_id,
            organization_id,
            start_time: datetime(start_time).toISO(),
            end_time: datetime(end_time).toISO(),
            title: meetingTitle,
            description: 'This meeting was reserved by an admin.',
        });

    if (reserveError) {
        return new Response('Failed to reserve room.', { status: 500 });
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
