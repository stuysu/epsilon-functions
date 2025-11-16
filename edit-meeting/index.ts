import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';

import { isValidMeeting } from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    title: string;
    description: string;
    room_id?: number | null;
    start_time: string;
    end_time: string;
    is_public: boolean;
    advisor?: string;
};

const returnSelect = `
            id,
            is_public,
            title,
            description,
            advisor,
            start_time,
            end_time,
            organization_id,
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

    const bodyJson = await req
        .json(); /* bodyJson here also includes: notify-faculty and id <- meeting id */

    const advisor =
        typeof bodyJson.advisor === "string" && bodyJson.advisor.trim().length > 0
            ? bodyJson.advisor.trim()
            : null;

    const body: BodyType = {
        title: bodyJson.title,
        description: bodyJson.description,
        room_id: bodyJson.room_id,
        start_time: bodyJson.start_time,
        end_time: bodyJson.end_time,
        is_public: bodyJson.is_public,
        advisor: advisor
    };

    /* removed backend validation because it already exists in RLS */

    const validationError = await isValidMeeting(
        body.start_time,
        body.end_time,
        body.room_id,
        bodyJson.id,
        bodyJson.organization_id,
    );
    if (validationError) {
        return new Response(
            validationError,
            {
                status: 400,
            },
        );
    }

    type rtyp = {
        id: number;
        is_public: boolean;
        title: string;
        description: string;
        advisor: string | null;
        start_time: string;
        end_time: string;
        organization_id: number;
        rooms: {
            id: number;
            name: string;
            floor: number;
        };
    };
    const { data: updateMeetingData, error: updateMeetingError } =
        await supabaseClient.from('meetings')
            .update(body)
            .eq('id', bodyJson.id)
            .select(returnSelect)
            .returns<rtyp[]>();

    if (updateMeetingError || !updateMeetingData || !updateMeetingData.length) {
        return new Response('Could not update meeting.', { status: 500 });
    }

    /* asynchronously email all members of organization */

    const startTime = datetime(updateMeetingData[0].start_time)
        .toZonedTime('America/New_York').format('MMMM d, YYYY, h:mm a');
    const endTime = datetime(updateMeetingData[0].end_time).toZonedTime(
        'America/New_York',
    ).format('MMMM d, YYYY, h:mm a');

    const emailText =
        `You are receiving this email because you are a member of {ORG_NAME}.
This email is to let you know of an updated meeting. The details of which are below.
Title: ${body.title}
Description: ${body.description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${updateMeetingData[0].rooms?.name || 'Virtual'}
Advisor: ${updateMeetingData[0].advisor || 'None'}` + footer;

    const emailSubject = `{ORG_NAME} updated a meeting | Epsilon`;

    sendOrgEmail(updateMeetingData[0].organization_id, emailSubject, emailText);

    return new Response(
        JSON.stringify({
            ...updateMeetingData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
