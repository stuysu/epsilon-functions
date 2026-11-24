import { withCors } from '../_shared/cors.ts';
import { isId, readJson, rpcErrorResponse } from '../_shared/http.ts';
import { getCaller } from '../_shared/auth.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import {
    type CancelledMeeting,
    emailCancelledMeetings,
} from '../_shared/emails.ts';

Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const { room_id } = bodyJson;
    if (!room_id) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(room_id)) {
        return new Response('Invalid room.', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;

    /* cancels the room's upcoming meetings, detaches the rest and deletes
       it in one transaction (the function checks the caller is a site admin) */
    const { data, error } = await caller.client.rpc('delete_room', {
        target_room: room_id,
    });
    if (error || !data) {
        return rpcErrorResponse(error, 'Failed to delete room.');
    }

    const result = data as {
        room_name: string;
        cancelled: CancelledMeeting[];
    };

    await logAdminAction(caller.user, {
        action: 'delete_room',
        targetType: 'room',
        targetId: room_id,
        details: {
            room: result.room_name,
            cancelled: result.cancelled.length,
        },
    });

    const unemailed = await emailCancelledMeetings(
        result.cancelled,
        () => `due to room ${result.room_name} no longer being available`,
    );

    return new Response(
        JSON.stringify({
            success: true,
            cancelled: result.cancelled.length,
            unemailed,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
