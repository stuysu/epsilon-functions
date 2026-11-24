import { isSiteAdmin } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { isId, readJson, rpcErrorResponse } from '../_shared/http.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    type CancelledMeeting,
    emailCancelledMeetings,
} from '../_shared/emails.ts';

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    /* only site admins may force reserve (RLS alone would let club admins insert) */
    if (!(await isSiteAdmin(user.email))) {
        return new Response('Only site admins can force reserve rooms.', {
            status: 403,
        });
    }

    const body = await readJson(req);
    if (!body) {
        return new Response('Invalid request body.', { status: 400 });
    }
    const { room_id, organization_id, start_time, end_time, title } = body;

    if (!room_id || !organization_id || !start_time || !end_time) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(room_id) || !isId(organization_id)) {
        return new Response('Invalid room or organization.', { status: 400 });
    }
    const startMs = new Date(start_time).getTime();
    const endMs = new Date(end_time).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        return new Response('Invalid start or end time.', { status: 400 });
    }
    /* same message as force_reserve */
    if (endMs <= Date.now()) {
        return new Response(
            'This time has already ended. Choose a time that ends in the future.',
            { status: 400 },
        );
    }
    if (title !== undefined && title !== null && typeof title !== 'string') {
        return new Response('Invalid title.', { status: 400 });
    }

    /* the admin can name the meeting, otherwise it keeps the default (the column is VARCHAR(500)) */
    const reason = typeof title === 'string' ? title.trim().slice(0, 500) : '';

    /* cancels whatever overlaps and books the room in one transaction */
    const { data, error } = await supabaseClient.rpc('force_reserve', {
        target_room: room_id,
        target_org: organization_id,
        starts: new Date(startMs).toISOString(),
        ends: new Date(endMs).toISOString(),
        meeting_title: reason || null,
    });
    if (error || !data) {
        return rpcErrorResponse(error, 'Failed to reserve room.');
    }

    const result = data as {
        meeting_id: number;
        room_name: string;
        cancelled: CancelledMeeting[];
    };

    const { data: org } = await supabaseAdmin.from('organizations')
        .select('name')
        .eq('id', organization_id)
        .maybeSingle();
    await logAdminAction(siteUser, {
        action: 'force_reserve',
        targetType: 'room',
        targetId: room_id,
        details: {
            room: result.room_name,
            organization: org?.name ?? null,
            meeting_id: result.meeting_id,
            title: reason || null,
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            cancelled: result.cancelled.length,
        },
    });

    const room = `room ${result.room_name}`;
    /* tell them why, if the admin gave a title for the reservation */
    const unemailed = await emailCancelledMeetings(
        result.cancelled,
        () =>
            reason
                ? `because ${room} was reserved for "${reason}"`
                : `due to a conflict with another meeting in ${room}`,
    );

    return new Response(
        JSON.stringify({
            success: true,
            id: result.meeting_id,
            cancelled: result.cancelled.length,
            unemailed,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
