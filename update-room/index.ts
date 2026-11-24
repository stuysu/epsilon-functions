import { withCors } from '../_shared/cors.ts';
import { isId, readJson, rpcErrorResponse } from '../_shared/http.ts';
import { getCaller } from '../_shared/auth.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import {
    type CancelledMeeting,
    emailCancelledMeetings,
} from '../_shared/emails.ts';

const isDayList = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((day) => typeof day === 'string');

Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        room_id,
        name,
        floor,
        approval_required,
        comments,
        available_days,
        ais_days,
    } = bodyJson;

    /* floor 0 is a real floor, so only a missing floor is an error */
    if (!room_id || !available_days || floor == null || !name) {
        return new Response('Missing field', { status: 400 });
    }
    if (
        !isId(room_id) || !Number.isInteger(floor) ||
        typeof name !== 'string'
    ) {
        return new Response('Invalid room.', { status: 400 });
    }
    if (!isDayList(available_days)) {
        return new Response('Invalid available days.', { status: 400 });
    }
    if (ais_days != null && !isDayList(ais_days)) {
        return new Response('Invalid AIS days.', { status: 400 });
    }
    if (comments != null && typeof comments !== 'string') {
        return new Response('Invalid comments.', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;

    /* saves the room and, only for days taken off it, cancels the meetings
       that can't stay (the function checks the caller is a site admin) */
    const { data, error } = await caller.client.rpc('update_room', {
        target_room: room_id,
        room_name: name,
        room_floor: floor,
        room_approval_required: approval_required ?? null,
        room_comments: comments ?? null,
        room_available_days: available_days,
        room_ais_days: ais_days ?? null,
    });
    if (error?.code === '23505') {
        return new Response('A room with that name already exists.', {
            status: 400,
        });
    }
    if (error || !data) {
        return rpcErrorResponse(error, 'Failed to update room.');
    }

    const { cancelled, room_name: saved } = data as {
        cancelled: CancelledMeeting[];
        room_name: string;
    };
    await logAdminAction(caller.user, {
        action: 'update_room',
        targetType: 'room',
        targetId: room_id,
        details: {
            room: saved,
            available_days: available_days,
            cancelled: cancelled.length,
        },
    });
    const unemailed = await emailCancelledMeetings(
        cancelled,
        () => `due to room ${saved} no longer being available`,
    );

    return new Response(
        JSON.stringify({
            success: true,
            cancelled: cancelled.length,
            unemailed,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
