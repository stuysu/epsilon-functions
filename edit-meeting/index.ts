import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';
import { roomRequiresAdvisor, sendOrgEmail } from '../_shared/utils.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';

import {
    checkAdvisor,
    isSiteAdmin,
    isValidMeeting,
    type PastPolicy,
} from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

type BodyType = {
    title: string;
    description: string;
    room_id?: number | null;
    start_time: string;
    end_time: string;
    is_public: boolean;
    advisor?: string | null;
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
                floor,
                approval_required
            )
        `;

Deno.serve(async (req: Request) => {
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

    /* bodyJson here also includes: notify-faculty and id <- meeting id */
    let bodyJson;
    try {
        bodyJson = await req.json();
    } catch {
        return new Response('Invalid request body.', { status: 400 });
    }
    if (!bodyJson || typeof bodyJson !== 'object') {
        return new Response('Invalid request body.', { status: 400 });
    }
    if (!Number.isInteger(bodyJson.id) || bodyJson.id <= 0) {
        return new Response('Missing or invalid meeting id.', { status: 400 });
    }
    if (
        bodyJson.advisor !== undefined && bodyJson.advisor !== null &&
        typeof bodyJson.advisor !== 'string'
    ) {
        return new Response('Invalid advisor.', { status: 400 });
    }

    const advisorOmitted = bodyJson.advisor === undefined;
    const advisor = bodyJson.advisor?.trim() || null;

    const body: BodyType = {
        title: bodyJson.title,
        description: bodyJson.description,
        room_id: bodyJson.room_id,
        start_time: bodyJson.start_time,
        end_time: bodyJson.end_time,
        is_public: bodyJson.is_public,
        advisor: advisor,
    };

    const { data: existingMeeting } = await supabaseClient.from('meetings')
        .select('start_time, end_time, advisor, room_id, organization_id')
        .eq('id', bodyJson.id)
        .maybeSingle();

    if (!existingMeeting) {
        return new Response('Meeting not found.', { status: 404 });
    }

    /* the meeting's org comes from the DB, never from the request body */
    const organizationId: number = existingMeeting.organization_id;
    if (
        bodyJson.organization_id !== undefined &&
        bodyJson.organization_id !== null &&
        Number(bodyJson.organization_id) !== organizationId
    ) {
        return new Response(
            'organization_id does not match the meeting.',
            { status: 400 },
        );
    }

    const siteAdmin = await isSiteAdmin(user.email);
    if (!siteAdmin) {
        const { data: adminMembership, error: membershipError } =
            await supabaseAdmin
                .from('memberships')
                .select('id')
                .eq('organization_id', organizationId)
                .eq('user_id', verifiedUsers[0].id)
                .in('role', ['ADMIN', 'CREATOR'])
                .limit(1);
        if (membershipError) {
            return new Response('Failed to check permissions.', {
                status: 500,
            });
        }
        if (!adminMembership || !adminMembership.length) {
            return new Response(
                'You must be an admin of this organization to edit its meetings.',
                { status: 403 },
            );
        }
    }
    const now = new Date();
    if (!siteAdmin && new Date(existingMeeting.end_time) <= now) {
        return new Response(
            'This meeting has already ended and can no longer be edited.',
            { status: 403 },
        );
    }

    let pastPolicy: PastPolicy = 'none';
    if (siteAdmin) {
        pastPolicy = 'any';
    } else if (
        new Date(existingMeeting.start_time) <= now &&
        new Date(body.start_time).getTime() ===
            new Date(existingMeeting.start_time).getTime()
    ) {
        pastPolicy = 'started';
    }

    const validationError = await isValidMeeting(
        body.start_time,
        body.end_time,
        body.room_id,
        bodyJson.id,
        organizationId,
        pastPolicy,
    );
    if (validationError) {
        return new Response(
            validationError,
            {
                status: 400,
            },
        );
    }

    const advisorCheck = await checkAdvisor(
        advisorOmitted ? existingMeeting.advisor : body.advisor,
        body.room_id === undefined ? existingMeeting.room_id : body.room_id,
        existingMeeting.advisor,
    );
    if (advisorCheck.error) {
        return new Response(advisorCheck.error, { status: 400 });
    }
    if (advisorOmitted) {
        delete body.advisor;
    } else {
        body.advisor = advisorCheck.advisor;
    }

    const { data: oldMeeting } = await supabaseClient.from('meetings')
        .select('room_id')
        .eq('id', bodyJson.id)
        .single();

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
            approval_required: boolean;
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

    const movedToAdvisorRoom =
        roomRequiresAdvisor(updateMeetingData[0].rooms) &&
        updateMeetingData[0].rooms.id !== oldMeeting?.room_id;

    const emailFaculty = bodyJson.notify_faculty === true ||
        movedToAdvisorRoom;

    if (bodyJson.silent !== true) {
        await sendOrgEmail(
            updateMeetingData[0].organization_id,
            emailSubject,
            emailText,
            emailFaculty,
        );
    } else if (emailFaculty) {
        await sendOrgEmail(
            updateMeetingData[0].organization_id,
            emailSubject,
            emailText,
            true,
            false,
            true,
        );
    }

    return new Response(
        JSON.stringify({
            ...updateMeetingData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
