import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { isValidMeeting, sendOrgEmail } from '../_shared/utils.ts';

// import { createCalendarEvent } from '../_shared/google/calendar.ts'; doesn't work

type BodyType = {
    organization_id: number;
    title: string;
    description: string;
    room_id?: number | null;
    start_time: string;
    end_time: string;
    is_public: boolean;
    notify_faculty?: boolean;
};

const returnSelect = `
            id,
            is_public,
            title,
            description,
            start_time,
            end_time,
            rooms (
                id,
                name,
                floor
            )
        `;

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
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

    const bodyJson = await req.json();
    const body: BodyType = {
        organization_id: bodyJson.organization_id,
        title: bodyJson.title,
        description: bodyJson.description,
        room_id: bodyJson.room_id,
        start_time: bodyJson.start_time,
        end_time: bodyJson.end_time,
        is_public: bodyJson.is_public,
        notify_faculty: bodyJson.notify_faculty,
    };

    /* time (+ room) validation */
    const isValid = await isValidMeeting(
        body.start_time,
        body.end_time,
        body.room_id,
    );
    if (!isValid) {
        return new Response('Invalid meeting time, length, or room.', {
            status: 400,
        });
    }

    type rtyp = {
        id: number;
        is_public: boolean;
        title: string;
        description: string;
        start_time: string;
        end_time: string;
        rooms: {
            id: number;
            name: string;
            floor: number;
        };
    };
    const { data: createMeetingData, error: createMeetingError } =
        await supabaseClient.from('meetings')
            .insert({
                organization_id: body.organization_id,
                title: body.title,
                description: body.description,
                room_id: body.room_id,
                start_time: body.start_time,
                end_time: body.end_time,
                is_public: body.is_public,
            })
            .select(returnSelect)
            .returns<rtyp[]>();

    if (createMeetingError || !createMeetingData || !createMeetingData.length) {
        return new Response('Could not create meeting.', { status: 500 });
    }

    /* send out emails */
    const startTime = datetime(createMeetingData[0].start_time)
                .toZonedTime('America/New_York').format('MMMM d, YYYY, h:mm a');
            const endTime = datetime(createMeetingData[0].end_time).toZonedTime(
                'America/New_York',
            ).format('MMMM d, YYYY, h:mm a');

    const emailText =
        `You are receiving this email because you are a member of {ORG_NAME}
This email is to let you know of an upcoming meeting. The details of which are below.
Title: ${body.title}
Description: ${body.description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${createMeetingData[0].rooms?.name || 'Virtual'}`;

    const emailSubject = `{ORG_NAME} scheduled a meeting | Epsilon`;

    sendOrgEmail(body.organization_id, emailSubject, emailText, body.notify_faculty);

    /* asynchronously create calendar event
    [DOESN'T WORK FOR NOW]
    type ctyp = {
        id: number,
        name: string,
        url: string,
        googlecalendars: {
            id: number,
            calendar_id: string
        }
    }


    const { data: orgData, error: orgError } = await supabaseClient.from('organizations')
        .select(`
            id,
            name,
            googlecalendars!inner (
                id,
                calendar_id
            )
        `)
        .eq('id', body.organization_id)
        .returns<ctyp[]>();

    if (orgError || !orgData || !orgData.length) {
        console.log("Error fetching organization data.");
    } else {
        createCalendarEvent(
            orgData[0].googlecalendars.calendar_id,
            {
                name: body.title,
                description: body.description,
                start: createMeetingData[0].start_time,
                end: createMeetingData[0].end_time,
                location: createMeetingData[0].rooms?.name || "Virtual",
                source: {
                    title: `Meeting by ${orgData[0].name} | StuyActivities`,
			        url: `${Deno.env.get('SITE_URL')}/${orgData[0].url}/meetings`
                }
            }
        );
    }
    */

    return new Response(
        JSON.stringify({
            ...createMeetingData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
