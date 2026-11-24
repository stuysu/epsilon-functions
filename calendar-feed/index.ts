// iCalendar feeds; links carry the user's private token (?token=), plus
// ?club=<url> for one club's meetings
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { withCors } from '../_shared/cors.ts';
import { buildCalendar, type IcsEvent } from '../_shared/ics.ts';
import { siteUrl } from '../_shared/strings.ts';

/* recent meetings stay, so they don't vanish from calendars as they end */
const PAST_DAYS = 30;
const MAX_EVENTS = 1000;

type MeetingRow = {
    id: number;
    title: string;
    description: string | null;
    start_time: string;
    end_time: string;
    updated_at: string | null;
    rooms: { name: string; floor: number | null } | null;
    organizations: { name: string; url: string };
};

const MEETING_COLUMNS = `
    id,
    title,
    description,
    start_time,
    end_time,
    updated_at,
    rooms ( name, floor ),
    organizations!inner ( name, url )
`;

const meetingsQuery = () =>
    supabaseAdmin.from('meetings').select(MEETING_COLUMNS);

/* upcoming meetings first, then the most recent ones, MAX_EVENTS in all */
const loadMeetings = async (
    query: () => ReturnType<typeof meetingsQuery>,
    since: string,
) => {
    const now = new Date().toISOString();
    const [upcoming, recent] = await Promise.all([
        query().gte('end_time', now).order('start_time')
            .limit(MAX_EVENTS).returns<MeetingRow[]>(),
        query().gte('end_time', since).lt('end_time', now)
            .order('start_time', { ascending: false })
            .limit(MAX_EVENTS).returns<MeetingRow[]>(),
    ]);
    const error = upcoming.error ?? recent.error;
    if (error) return { data: null, error };
    const soon = upcoming.data ?? [];
    const past = (recent.data ?? []).slice(0, MAX_EVENTS - soon.length);
    return { data: [...past.reverse(), ...soon], error: null };
};

const text = (body: string, status: number) =>
    new Response(body, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

const toEvent = (meeting: MeetingRow, withClub: boolean): IcsEvent => {
    const site = siteUrl();
    const clubPage = `${site}/${meeting.organizations.url}`;
    const room = meeting.rooms;
    return {
        uid: `meeting-${meeting.id}@epsilon.stuysu.org`,
        start: meeting.start_time,
        end: meeting.end_time,
        summary: withClub
            ? `${meeting.organizations.name}: ${meeting.title}`
            : meeting.title,
        description: [meeting.description?.trim(), clubPage]
            .filter(Boolean).join('\n\n'),
        location: room
            ? room.floor != null
                ? `Room ${room.name} (floor ${room.floor})`
                : `Room ${room.name}`
            : null,
        url: clubPage,
        updated: meeting.updated_at,
    };
};

const calendar = (
    req: Request,
    name: string,
    events: IcsEvent[],
    cache: string,
) => new Response(
    req.method === 'HEAD' ? null : buildCalendar({ name, events }),
    {
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'inline; filename="epsilon.ics"',
            'Cache-Control': cache,
            'X-Content-Type-Options': 'nosniff',
        },
    },
);

/* the club's public meetings, or all of them for its members; charters
   still in review only for their members */
const clubCalendar = async (
    req: Request,
    club: string,
    userId: number,
    since: string,
) => {
    if (!/^[a-z0-9-]{1,100}$/i.test(club)) return text('Club not found.', 404);
    const { data: org, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, name, state')
        .eq('url', club)
        .maybeSingle();
    if (orgError) {
        console.error('[calendar-feed] club lookup failed', orgError);
        return text('Failed to load the calendar.', 500);
    }
    if (!org) return text('Club not found.', 404);

    const { data: member, error: memberError } = await supabaseAdmin
        .from('memberships')
        .select('id')
        .eq('organization_id', org.id)
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();
    if (memberError) {
        console.error('[calendar-feed] membership failed', memberError);
        return text('Failed to load the calendar.', 500);
    }
    if (!member && ['PENDING', 'REJECTED'].includes(org.state)) {
        return text('Club not found.', 404);
    }

    const { data: meetings, error } = await loadMeetings(() => {
        const query = meetingsQuery().eq('organization_id', org.id);
        return member ? query : query.eq('is_public', true);
    }, since);
    if (error) {
        console.error('[calendar-feed] meetings failed', error);
        return text('Failed to load the calendar.', 500);
    }
    return calendar(
        req,
        `${org.name} | Epsilon`,
        (meetings ?? []).map((m) => toEvent(m, false)),
        'private, max-age=900',
    );
};

Deno.serve(withCors(async (req: Request) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return text('Open this link in a calendar app.', 405);
    }
    const params = new URL(req.url).searchParams;
    const club = params.get('club');
    const token = params.get('token');
    const since = new Date(Date.now() - PAST_DAYS * 864e5).toISOString();

    if (token === null) {
        return text(
            club !== null
                ? 'Club calendars need your personal link. Sign in on the club page to get it.'
                : 'Add ?token=<calendar token>.',
            club !== null ? 401 : 400,
        );
    }
    if (!/^[0-9a-f]{64}$/.test(token)) {
        return text('This calendar link is no longer valid.', 404);
    }
    const { data: owner, error: ownerError } = await supabaseAdmin
        .from('calendar_tokens')
        .select('user_id, hidden_organizations, users!inner ( active )')
        .eq('token', token)
        .eq('users.active', true)
        .maybeSingle();
    if (ownerError) {
        console.error('[calendar-feed] token lookup failed', ownerError);
        return text('Failed to load the calendar.', 500);
    }
    if (!owner) return text('This calendar link is no longer valid.', 404);

    if (club !== null) {
        return clubCalendar(req, club, owner.user_id, since);
    }

    const { data: memberships, error: membershipError } = await supabaseAdmin
        .from('memberships')
        .select('organization_id')
        .eq('user_id', owner.user_id)
        .eq('active', true);
    if (membershipError) {
        console.error(
            '[calendar-feed] memberships failed',
            membershipError,
        );
        return text('Failed to load the calendar.', 500);
    }
    const hidden = new Set<number>(owner.hidden_organizations ?? []);
    const orgIds = (memberships ?? [])
        .map((m) => m.organization_id)
        .filter((id) => !hidden.has(id));

    const { data: meetings, error } = orgIds.length
        ? await loadMeetings(
            () => meetingsQuery().in('organization_id', orgIds),
            since,
        )
        : { data: [] as MeetingRow[], error: null };
    if (error) {
        console.error('[calendar-feed] meetings failed', error);
        return text('Failed to load the calendar.', 500);
    }
    return calendar(
        req,
        'My clubs | Epsilon',
        (meetings ?? []).map((m) => toEvent(m, true)),
        'private, max-age=900',
    );
}));
