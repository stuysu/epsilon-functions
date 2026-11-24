import { withCors } from '../_shared/cors.ts';
import {
    checkAdvisor,
    ERR_MAX_ROOMS,
    isApprovedClub,
    isSiteAdmin,
    isValidMeeting,
    MEETING_CAP_CODE,
    type PastPolicy,
    roomRequiresAdvisor,
    sendOrgEmail,
} from '../_shared/utils.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    BUSY,
    dbErrorStatus,
    isId,
    LIMITS,
    readJson,
    textProblem,
} from '../_shared/http.ts';
import { getCaller } from '../_shared/auth.ts';
import { meetingEmailText } from '../_shared/emails.ts';
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

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    /* bodyJson here also includes: notify-faculty and id <- meeting id */
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid request body.', { status: 400 });
    }
    if (!isId(bodyJson.id)) {
        return new Response('Missing or invalid meeting id.', { status: 400 });
    }
    if (
        bodyJson.advisor !== undefined && bodyJson.advisor !== null &&
        typeof bodyJson.advisor !== 'string'
    ) {
        return new Response('Invalid advisor.', { status: 400 });
    }

    if (
        bodyJson.room_id !== undefined && bodyJson.room_id !== null &&
        !isId(bodyJson.room_id)
    ) {
        return new Response('Invalid room.', { status: 400 });
    }
    if (
        bodyJson.title !== undefined &&
        (typeof bodyJson.title !== 'string' || !bodyJson.title.trim())
    ) {
        return new Response('Missing meeting title.', { status: 400 });
    }
    const textError = textProblem(
        bodyJson.title,
        'Meeting title',
        LIMITS.meetingTitle,
        false,
    ) ?? textProblem(
        bodyJson.description,
        'Meeting description',
        LIMITS.meetingDescription,
        false,
    );
    if (textError) return new Response(textError, { status: 400 });
    const advisorOmitted = bodyJson.advisor === undefined;
    const advisor = bodyJson.advisor?.trim() || null;

    const body: BodyType = {
        title: bodyJson.title?.trim(),
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
                .eq('user_id', siteUser.id)
                .eq('active', true)
                .in('role', ['ADMIN', 'CREATOR', 'ADVISOR'])
                .limit(1);
        if (membershipError) {
            return new Response('Failed to check permissions.', {
                status: 500,
            });
        }
        if (!adminMembership || !adminMembership.length) {
            return new Response(
                'You must be a leader or advisor of this organization to edit its meetings.',
                { status: 403 },
            );
        }
        const approved = await isApprovedClub(organizationId);
        if (approved === null) {
            return new Response('Failed to check the Activity.', {
                status: 500,
            });
        }
        if (!approved) {
            return new Response(
                'Only approved Activities can edit meetings.',
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

    /* when the room isn't being changed, still check the meeting's current
       room against the new times */
    const validationError = await isValidMeeting(
        body.start_time,
        body.end_time,
        body.room_id === undefined ? existingMeeting.room_id : body.room_id,
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
    /* permissions were checked above; direct leader updates are blocked by RLS */
    const { data: updateMeetingData, error: updateMeetingError } =
        await supabaseAdmin.from('meetings')
            .update(body)
            .eq('id', bodyJson.id)
            .select(returnSelect)
            .returns<rtyp[]>();

    /* the room was blocked after the check above */
    if (updateMeetingError?.code === 'RB001') {
        return new Response('This room is blocked on that day.', {
            status: 409,
        });
    }
    if (updateMeetingError?.code === MEETING_CAP_CODE) {
        return new Response(ERR_MAX_ROOMS, { status: 400 });
    }
    /* another booking for this room landed first */
    if (updateMeetingError?.code === '23P01') {
        return new Response(
            'That room was just booked for this time. Choose another room or time.',
            { status: 409 },
        );
    }
    if (updateMeetingError?.code === '40P01') {
        return new Response(BUSY, { status: 409 });
    }
    /* deleted since we read it, e.g. by Force Reserve */
    if (!updateMeetingError && updateMeetingData?.length === 0) {
        return new Response('This meeting was cancelled.', { status: 404 });
    }
    if (updateMeetingError || !updateMeetingData || !updateMeetingData.length) {
        console.error('[edit-meeting] update failed', updateMeetingError);
        return new Response('Could not update meeting.', {
            status: dbErrorStatus(updateMeetingError),
        });
    }

    /* email all members of organization */
    const emailText = meetingEmailText(
        'This email is to let you know of an updated meeting. The details of which are below.',
        updateMeetingData[0],
    );

    const emailSubject = `{ORG_NAME} updated a meeting | Epsilon`;

    const movedToAdvisorRoom =
        roomRequiresAdvisor(updateMeetingData[0].rooms) &&
        updateMeetingData[0].rooms.id !== existingMeeting.room_id;

    const emailFaculty = bodyJson.notify_faculty === true ||
        movedToAdvisorRoom;

    let sent = true;
    if (bodyJson.silent !== true) {
        sent = await sendOrgEmail(
            updateMeetingData[0].organization_id,
            emailSubject,
            emailText,
            emailFaculty,
        );
    } else if (emailFaculty) {
        sent = await sendOrgEmail(
            updateMeetingData[0].organization_id,
            emailSubject,
            emailText,
            true,
            false,
            true,
        );
    }
    if (!sent) {
        console.error(`[edit-meeting] email failed for meeting ${bodyJson.id}`);
    }

    return new Response(
        JSON.stringify({
            ...updateMeetingData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
