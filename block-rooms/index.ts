import { isSiteAdmin } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { isId, readJson, rpcErrorResponse } from '../_shared/http.ts';
import { formatDay } from '../_shared/time.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    type CancelledMeeting,
    emailCancelledMeetings,
} from '../_shared/emails.ts';

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;

    if (!(await isSiteAdmin(caller.authUser.email))) {
        return new Response('Only site admins can block rooms.', {
            status: 403,
        });
    }

    const body = await readJson(req);
    if (!body) {
        return new Response('Invalid request body.', { status: 400 });
    }
    const { date, room_ids, reason } = body;

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response('Invalid date.', { status: 400 });
    }
    if (
        !Array.isArray(room_ids) || !room_ids.length ||
        !room_ids.every(isId)
    ) {
        return new Response('Pick at least one room.', { status: 400 });
    }
    const note = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

    /* the database blocks the rooms and cancels the meetings in one go */
    const { data, error } = await caller.client.rpc('block_rooms', {
        day: date,
        room_ids,
        reason: note || null,
    });
    if (error || !data) {
        return rpcErrorResponse(error, 'Failed to block rooms.');
    }

    const result = data as {
        blocked: number[];
        cancelled: (CancelledMeeting & { room_name: string })[];
    };

    const { data: rooms } = result.blocked.length
        ? await supabaseAdmin.from('rooms').select('name').in(
            'id',
            result.blocked,
        )
        : { data: [] };
    await logAdminAction(caller.user, {
        action: 'block_rooms',
        targetType: 'room',
        targetId: result.blocked.length === 1 ? result.blocked[0] : null,
        details: {
            date,
            rooms: (rooms ?? []).map((r) => r.name),
            reason: note || null,
            cancelled: result.cancelled.length,
        },
    });

    const day = formatDay(date);
    const unemailed = await emailCancelledMeetings(
        result.cancelled,
        (meetings) => {
            const closed = new Set(meetings.map((m) => m.room_name)).size > 1
                ? 'the rooms are closed'
                : 'the room is closed';
            return note
                ? `because ${closed} on ${day} for "${note}"`
                : `because ${closed} on ${day}`;
        },
        { withRoom: true },
    );

    return new Response(
        JSON.stringify({
            blocked: result.blocked,
            cancelled: result.cancelled.length,
            unemailed,
        }),
        { headers: { 'Content-Type': 'application/json' } },
    );
}));
