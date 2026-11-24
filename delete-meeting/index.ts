import { withCors } from '../_shared/cors.ts';
import { isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { getCaller } from '../_shared/auth.ts';
import { meetingEmailText } from '../_shared/emails.ts';
import { isId, readJson } from '../_shared/http.ts';

type BodyType = {
    id: number;
};

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user } = caller;

    const bodyJson = await readJson(req);
    if (!bodyJson || typeof bodyJson !== 'object' || !isId(bodyJson.id)) {
        return new Response('Missing or invalid field: id', { status: 400 });
    }
    const body: BodyType = {
        id: bodyJson.id,
    };

    /* collect old meeting data */
    const { data: oldMeetingData, error: oldMeetingError } =
        await supabaseClient.from('meetings')
            .select(`
                *,
                rooms (
                    name
                )
            `)
            .eq('id', body.id);

    if (oldMeetingError) {
        return new Response('Error fetching old meeting data.', {
            status: 500,
        });
    }

    if (!oldMeetingData || !oldMeetingData.length) {
        return new Response('Meeting not found.', { status: 404 });
    }

    /* only club leaders, advisors or site admins may delete (mirrors RLS) */
    const { data: orgAdminRows, error: orgAdminError } = await supabaseAdmin
        .from('memberships')
        .select('id, users!inner ( email )')
        .eq('organization_id', oldMeetingData[0].organization_id)
        .eq('users.email', user.email)
        .eq('active', true)
        .in('role', ['ADMIN', 'CREATOR', 'ADVISOR'])
        .limit(1);

    if (orgAdminError) {
        return new Response('Error checking permissions.', { status: 500 });
    }

    const siteAdmin = await isSiteAdmin(user.email);
    if (!orgAdminRows?.length && !siteAdmin) {
        return new Response('Permission denied.', { status: 403 });
    }

    /* ended meetings keep their attendance (mirrors RLS) */
    if (!siteAdmin && new Date(oldMeetingData[0].end_time) <= new Date()) {
        return new Response(
            "This meeting has already ended, so it can't be deleted.",
            { status: 403 },
        );
    }

    /* attempt to delete meeting and notify members */
    const { data: deletedMeetings, error: deleteMeetingError } =
        await supabaseClient.from('meetings')
            .delete()
            .eq('id', body.id)
            .select('id');

    if (deleteMeetingError) {
        return new Response('Error deleting meeting.', { status: 500 });
    }

    if (!deletedMeetings || !deletedMeetings.length) {
        return new Response('Permission denied.', { status: 403 });
    }

    /* email all members of organization */
    const emailText = meetingEmailText(
        'This email is to let you know that the meeting listed below is *CANCELED*',
        oldMeetingData[0],
    );

    const emailSubject = `{ORG_NAME} canceled a meeting | Epsilon`;

    /* faculty always hear about cancellations, like new meetings; silent
       only skips members, and nobody is told about ones already over */
    const oldOrgId = oldMeetingData[0].organization_id;
    if (
        new Date(oldMeetingData[0].end_time) > new Date() &&
        !await sendOrgEmail(
            oldOrgId,
            emailSubject,
            emailText,
            true,
            false,
            bodyJson.silent === true,
        )
    ) {
        console.error(`[delete-meeting] email failed for meeting ${body.id}`);
    }

    return new Response(
        JSON.stringify({
            done: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
