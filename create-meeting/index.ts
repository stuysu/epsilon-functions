import { withCors } from '../_shared/cors.ts';
import {
    checkAdvisor,
    ERR_MAX_ROOMS,
    isApprovedClub,
    isSiteAdmin,
    isValidMeeting,
    MEETING_CAP_CODE,
    roomRequiresAdvisor,
    sendOrgEmail,
} from '../_shared/utils.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    dbErrorStatus,
    isId,
    LIMITS,
    readJson,
    textProblem,
} from '../_shared/http.ts';
import { getCaller } from '../_shared/auth.ts';
import { meetingEmailText } from '../_shared/emails.ts';
type BodyType = {
    organization_id: number;
    title: string;
    description: string;
    room_id?: number | null;
    start_time: string;
    end_time: string;
    is_public: boolean;
    notify_faculty?: boolean;
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
    const { authUser: user, user: siteUser } = caller;

    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }
    if (
        bodyJson.room_id !== undefined && bodyJson.room_id !== null &&
        !isId(bodyJson.room_id)
    ) {
        return new Response('Invalid room.', { status: 400 });
    }
    if (
        bodyJson.advisor !== undefined && bodyJson.advisor !== null &&
        typeof bodyJson.advisor !== 'string'
    ) {
        return new Response('Invalid advisor.', { status: 400 });
    }
    const textError = textProblem(
        bodyJson.title,
        'Meeting title',
        LIMITS.meetingTitle,
    ) ?? textProblem(
        bodyJson.description,
        'Meeting description',
        LIMITS.meetingDescription,
        false,
    );
    if (textError) return new Response(textError, { status: 400 });
    const advisor = bodyJson.advisor?.trim() || null;
    const body: BodyType = {
        organization_id: bodyJson.organization_id,
        title: bodyJson.title.trim(),
        description: bodyJson.description ?? '',
        room_id: bodyJson.room_id,
        start_time: bodyJson.start_time,
        end_time: bodyJson.end_time,
        is_public: bodyJson.is_public,
        notify_faculty: bodyJson.notify_faculty,
        advisor: advisor,
    };

    if (!body.organization_id || !body.title) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(body.organization_id)) {
        return new Response('Invalid organization.', { status: 400 });
    }

    /* the insert below skips RLS, so check the caller's role here */
    if (!(await isSiteAdmin(user.email))) {
        const { data: leaderMembership, error: membershipError } =
            await supabaseAdmin
                .from('memberships')
                .select('id')
                .eq('organization_id', body.organization_id)
                .eq('user_id', siteUser.id)
                .eq('active', true)
                .in('role', ['ADMIN', 'CREATOR', 'ADVISOR'])
                .limit(1);
        if (membershipError) {
            return new Response('Failed to check permissions.', {
                status: 500,
            });
        }
        if (!leaderMembership || !leaderMembership.length) {
            return new Response(
                'You must be a leader or advisor of this organization to schedule its meetings.',
                { status: 403 },
            );
        }
        const approved = await isApprovedClub(body.organization_id);
        if (approved === null) {
            return new Response('Failed to check the Activity.', {
                status: 500,
            });
        }
        if (!approved) {
            return new Response(
                'Only approved Activities can schedule meetings.',
                { status: 403 },
            );
        }
    }

    /* time (+ room) validation */
    const validationError = await isValidMeeting(
        body.start_time,
        body.end_time,
        body.room_id,
        undefined,
        body.organization_id,
    );
    if (validationError) {
        return new Response(validationError, {
            status: 400,
        });
    }

    const advisorCheck = await checkAdvisor(body.advisor, body.room_id);
    if (advisorCheck.error) {
        return new Response(advisorCheck.error, { status: 400 });
    }
    body.advisor = advisorCheck.advisor;

    type rtyp = {
        id: number;
        is_public: boolean;
        title: string;
        description: string;
        advisor: string | null;
        start_time: string;
        end_time: string;
        rooms: {
            id: number;
            name: string;
            floor: number;
            approval_required: boolean;
        };
    };
    const { data: createMeetingData, error: createMeetingError } =
        await supabaseAdmin.from('meetings')
            .insert({
                organization_id: body.organization_id,
                title: body.title,
                description: body.description,
                room_id: body.room_id,
                start_time: body.start_time,
                end_time: body.end_time,
                is_public: body.is_public,
                advisor: body.advisor,
            })
            .select(returnSelect)
            .returns<rtyp[]>();

    /* the room was blocked after the check above */
    if (createMeetingError?.code === 'RB001') {
        return new Response('This room is blocked on that day.', {
            status: 409,
        });
    }
    if (createMeetingError?.code === MEETING_CAP_CODE) {
        return new Response(ERR_MAX_ROOMS, { status: 400 });
    }
    /* another booking for this room landed first */
    if (createMeetingError?.code === '23P01') {
        return new Response(
            'That room was just booked for this time. Choose another room or time.',
            { status: 409 },
        );
    }
    if (createMeetingError || !createMeetingData || !createMeetingData.length) {
        return new Response('Could not create meeting.', {
            status: dbErrorStatus(createMeetingError),
        });
    }

    /* send out emails */
    const emailText = meetingEmailText(
        'This email is to let you know of an upcoming meeting. The details of which are below.',
        createMeetingData[0],
    );

    const emailSubject = `{ORG_NAME} scheduled a meeting | Epsilon`;

    const emailFaculty = body.notify_faculty === true ||
        roomRequiresAdvisor(createMeetingData[0].rooms);

    let sent = true;
    if (bodyJson.silent !== true) {
        sent = await sendOrgEmail(
            body.organization_id,
            emailSubject,
            emailText,
            emailFaculty,
        );
    } else if (emailFaculty) {
        sent = await sendOrgEmail(
            body.organization_id,
            emailSubject,
            emailText,
            true,
            false,
            true,
        );
    }
    if (!sent) {
        console.error(
            `[create-meeting] email failed for meeting ${
                createMeetingData[0].id
            }`,
        );
    }

    return new Response(
        JSON.stringify({
            ...createMeetingData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
