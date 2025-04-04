import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    id: number;
};

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
        id: bodyJson.id,
    };

    /* collect old meeting data */
    const { data: oldMeetingData, error: oldMeetingError } =
        await supabaseClient.from('meetings')
            .select(`*`)
            .eq('id', body.id);

    if (oldMeetingError || !oldMeetingData || !oldMeetingData.length) {
        return new Response('Error fetching old meeting data.', {
            status: 500,
        });
    }

    /* attempt to delete meeting and notify members */
    const { error: deleteMeetingError } = await supabaseClient.from('meetings')
        .delete()
        .eq('id', body.id);

    if (deleteMeetingError) {
        return new Response('Error deleting meeting.', { status: 500 });
    }

    /* notify members */
    /* email all members of organization */

    const startTime = datetime(oldMeetingData[0].start_time)
        .toZonedTime('America/New_York').format('MMMM d, YYYY, h:mm a');
    const endTime = datetime(oldMeetingData[0].end_time).toZonedTime(
        'America/New_York',
    ).format('MMMM d, YYYY, h:mm a');

    const emailText =
        `You are receiving this email because you are a member of {ORG_NAME}.
This email is to let you know that the meeting listed below is *CANCELED*
Title: ${oldMeetingData[0].title}
Description: ${oldMeetingData[0].description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${oldMeetingData[0].rooms?.name || 'Virtual'}` + footer;

    const emailSubject = `{ORG_NAME} canceled a meeting | Sigma`;

    const oldOrgId = oldMeetingData[0].organization_id;
    sendOrgEmail(oldOrgId, emailSubject, emailText);

    return new Response(
        JSON.stringify({
            done: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
