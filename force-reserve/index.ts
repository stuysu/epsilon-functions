import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    room_id: number;
    organization_id: number;
    start_time: string;
    end_time: string;
    title?: string;
};

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    const jwt = authHeader?.split(' ')[1];
    if (!authHeader || !jwt) {
        return new Response('Not signed in.', { status: 401 });
    }
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData?.user;

    /* no signed-in user (missing, expired or anon token) */
    if (!user) {
        return new Response('Not signed in.', { status: 401 });
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

    /* only site admins may force reserve (RLS alone would let club admins insert) */
    if (!(await isSiteAdmin(user.email))) {
        return new Response('Only site admins can force reserve rooms.', {
            status: 403,
        });
    }

    let body: BodyType;
    try {
        body = await req.json();
    } catch {
        return new Response('Invalid request body.', { status: 400 });
    }
    if (!body || typeof body !== 'object') {
        return new Response('Invalid request body.', { status: 400 });
    }
    const { room_id, organization_id, start_time, end_time, title } = body;

    if (!room_id || !organization_id || !start_time || !end_time) {
        return new Response('Missing field', { status: 400 });
    }
    if (!Number.isInteger(room_id) || !Number.isInteger(organization_id)) {
        return new Response('Invalid room or organization.', { status: 400 });
    }
    const startMs = new Date(start_time).getTime();
    const endMs = new Date(end_time).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        return new Response('Invalid start or end time.', { status: 400 });
    }

    const { data: organization, error: orgFetchError } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('id', organization_id)
        .maybeSingle();
    if (orgFetchError) {
        return new Response('Failed to fetch organization.', { status: 500 });
    }
    if (!organization) {
        return new Response('Organization not found.', { status: 404 });
    }

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
        .maybeSingle();

    if (roomFetchError) {
        return new Response('Failed to fetch room.', { status: 500 });
    }
    if (!roomData) {
        return new Response('Room not found.', { status: 404 });
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
        const { data: heldMeetings, error: heldError } = await supabaseClient
            .from('meetings')
            .select(`
                id,
                organizations!inner (
                    name,
                    state
                )
            `)
            .in('id', conflictingMeetingIds)
            .eq('organizations.state', 'ADMIN')
            .returns<
                { id: number; organizations: { name: string } }[]
            >();

        if (heldError || !heldMeetings) {
            return new Response('Failed to fetch meetings', { status: 500 });
        }

        /* an admin club holds the room: refuse before cancelling or emailing anyone */
        if (heldMeetings.length) {
            const holders = [
                ...new Set(
                    heldMeetings.map((meeting) => meeting.organizations.name),
                ),
            ].join(', ');

            return new Response(
                `This room is held by an admin club (${holders}) during that time, so it was not reserved.`,
                { status: 409 },
            );
        }

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

        const roomName = removedMeetings[0]?.rooms?.name;
        const room = roomName ? `room ${roomName}` : 'the room';

        /* tell them why, if the admin gave a title for the reservation */
        const cause = reason
            ? `because ${room} was reserved for "${reason}"`
            : `due to a conflict with another meeting in ${room}`;

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
            start_time: new Date(start_time).toISOString(),
            end_time: new Date(end_time).toISOString(),
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
}));
