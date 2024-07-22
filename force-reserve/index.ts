import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';

type BodyType = {
    room_id: number;
    organization_id: number;
    start_time: string;
    end_time: string;
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

    const conflictingMeeting = meetings.find((meeting) =>
        meeting.room_id === room_id
    );

    if (conflictingMeeting) {
        const { data: orgData, error: orgError } = await supabaseClient.from('meetings')
            .delete()
            .eq('id', conflictingMeeting.meeting_id)
            .select(`
                title,
                organizations!inner (
                    name,
                    id
                )    
            `)
            .returns<
                { title: string; organizations: { name: string; id: number } }[]
            >()

            if (orgError || !orgData) {
                console.error('Failed to fetch org.');
                return new Response('Failed to notify conflicting rooms.', { status: 500 });
            }

            const orgId = orgData[0].organizations.id;

            const emailBody = `Your meeting, ${orgData[0].title}, has been cancelled by admins due to a conflict with another meeting.

We deeply apologize for the inconvenience, and we hope you are able to schedule it to a different room.
The Epsilon Team
`;

            const emailSubject = `Meeting removed for {ORG_NAME} | Epsilon`;

            sendOrgEmail(orgId, emailSubject, emailBody, false, true);
    }

    const { error: reserveError } = await supabaseClient.from('meetings')
        .insert({
            room_id,
            organization_id,
            start_time: datetime(start_time).toISO(),
            end_time: datetime(end_time).toISO(),
            title: 'Reserved Meeting',
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
