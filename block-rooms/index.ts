import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import { footer } from '../_shared/strings.ts';

type BodyType = {
    date: string;
    room_ids: number[];
    reason?: string;
};

type CancelledMeeting = {
    id: number;
    title: string;
    start_time: string;
    room_name: string;
    organization_id: number;
};

Deno.serve(withCors(async (req: Request) => {
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
    if (!user) {
        return new Response('Not signed in.', { status: 401 });
    }

    if (!(await isSiteAdmin(user.email))) {
        return new Response('Only site admins can block rooms.', {
            status: 403,
        });
    }

    let body: BodyType;
    try {
        body = await req.json();
    } catch {
        return new Response('Invalid request body.', { status: 400 });
    }
    const { date, room_ids, reason } = body ?? {};

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response('Invalid date.', { status: 400 });
    }
    if (
        !Array.isArray(room_ids) || !room_ids.length ||
        !room_ids.every((id) => Number.isInteger(id))
    ) {
        return new Response('Pick at least one room.', { status: 400 });
    }
    const note = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

    /* the database blocks the rooms and cancels the meetings in one go */
    const { data, error } = await supabaseClient.rpc('block_rooms', {
        day: date,
        room_ids,
        reason: note || null,
    });
    if (error || !data) {
        return new Response(error?.message || 'Failed to block rooms.', {
            status: 400,
        });
    }

    const result = data as {
        blocked: number[];
        cancelled: CancelledMeeting[];
    };

    const byOrg: { [organizationId: number]: CancelledMeeting[] } = {};
    for (const meeting of result.cancelled) {
        (byOrg[meeting.organization_id] ??= []).push(meeting);
    }

    const day = datetime(`${date}T12:00:00`).format('MMMM d, YYYY');
    const cause = (meetings: CancelledMeeting[]) => {
        const closed = new Set(meetings.map((meeting) =>
                meeting.room_name
            )).size > 1
            ? 'the rooms are closed'
            : 'the room is closed';
        return note
            ? `because ${closed} on ${day} for "${note}"`
            : `because ${closed} on ${day}`;
    };

    /* all at once, so a slow mail server can't time out the later clubs */
    const orgIds = Object.keys(byOrg).map(Number);
    const sent = await Promise.allSettled(orgIds.map((orgId) =>
        sendOrgEmail(
            orgId,
            `{ORG_NAME}: Meeting(s) Cancelled | Epsilon`,
            `Dear {ORG_NAME} member,

This email is to let you know that the following meeting(s) of {ORG_NAME} have been cancelled by administrators ${
                cause(byOrg[orgId])
            }:

${
                byOrg[orgId].map((meeting) =>
                    `${meeting.title} in room ${meeting.room_name} on ${
                        datetime(meeting.start_time).toZonedTime(
                            'America/New_York',
                        ).format('MMMM d, YYYY, h:mm a')
                    }`
                ).join('\n')
            }

We sincerely apologize for the inconvenience.` + footer,
            false,
            false,
        )
    ));
    const unemailed = orgIds.filter((_, i) => {
        const result = sent[i];
        return result.status === 'rejected' || !result.value;
    });
    if (unemailed.length) {
        console.error('Failed to email organizations', unemailed);
    }

    return new Response(
        JSON.stringify({
            blocked: result.blocked,
            cancelled: result.cancelled.length,
            unemailed,
        }),
        { headers: { 'Content-Type': 'application/json' } },
    );
}));
