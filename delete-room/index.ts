import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    room_id: number;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const {
        room_id,
    }: BodyType = await req.json();

    if (!room_id) {
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

    const { data: room, error: roomFetchError } = await supabaseClient
        .from('rooms')
        .select('name')
        .eq('id', room_id)
        .limit(1)
        .single();

    if (roomFetchError || !room) {
        return new Response('Failed to fetch room.', { status: 500 });
    }

    const { data: permitted, error: permittedError } = await supabaseClient
        .from('rooms')
        .update({ name: room.name })
        .eq('id', room_id)
        .select('id');

    if (permittedError) {
        return new Response('Failed to update room.', { status: 500 });
    }

    if (!permitted || !permitted.length) {
        return new Response('User is unauthorized.', { status: 403 });
    }

    const now = new Date().toISOString();

    const { data: cancelledMeetings, error: cancelError } = await supabaseClient
        .from('meetings')
        .delete()
        .eq('room_id', room_id)
        .gte('start_time', now)
        .select(`
                title,
                start_time,
                organization_id
            `);

    if (cancelError || !cancelledMeetings) {
        console.error('Failed to cancel meetings', cancelError);
        return new Response('Failed to cancel meetings.', { status: 500 });
    }

    const { error: detachError } = await supabaseClient
        .from('meetings')
        .update({ room_id: null })
        .eq('room_id', room_id);

    if (detachError) {
        console.error('Failed to remove room from meetings', detachError);
        return new Response('Failed to update meetings.', { status: 500 });
    }

    const { error: roomDeleteError } = await supabaseClient.from('rooms')
        .delete()
        .eq('id', room_id);

    if (roomDeleteError) {
        return new Response('Failed to delete room.', { status: 500 });
    }

    const removedMeetings: {
        [organizationId: number]: { title: string; start_time: string }[];
    } = {};

    for (const meeting of cancelledMeetings) {
        (removedMeetings[meeting.organization_id] ??= []).push(meeting);
    }

    for (
        const [organizationId, orgMeetings] of Object.entries(removedMeetings)
    ) {
        const emailBody = `Hi,

This email is to let you know that the following meetings of {ORG_NAME} have been cancelled by administrators:
${
            orgMeetings.map((meeting) =>
                `${meeting.title} at ${
                    datetime(meeting.start_time).toZonedTime(
                        'America/New_York',
                    ).format('MMMM d, YYYY, h:mm a')
                }`
            ).join('\n')
        }

This is because room ${room.name} has been taken out of service.

We sincerely apologize for the inconvenience, and we hope you are able to schedule the meetings in a different room.` +
            footer;

        await sendOrgEmail(
            Number(organizationId),
            `{ORG_NAME}: Meetings Removed | Epsilon`,
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
