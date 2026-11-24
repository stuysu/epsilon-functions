import supabaseAdmin from './supabaseAdmin.ts';
import Transport, {
    type PooledTransport,
    pooledTransport,
} from './emailTransport.ts';
import { escapeHtml, footer, IT_EMAIL } from './strings.ts';
import { newYorkDate, newYorkMidnight, newYorkWeekday } from './time.ts';
import { fetchAllRows } from './rows.ts';

const MIN_LENGTH = 30; // minutes

type mtyp = {
    id: number;
    role: 'CREATOR' | 'ADMIN' | 'ADVISOR' | 'MEMBER';
    users: {
        id: number;
        first_name: string;
        email: string;
        is_faculty: boolean;
    };
    organizations: { name: string };
    membershipnotifications:
        | { allow_notifications: boolean }
        | { allow_notifications: boolean }[]
        | null;
};

/* members get email unless they turned it off */
const wantsEmail = (member: mtyp) => {
    const setting = Array.isArray(member.membershipnotifications)
        ? member.membershipnotifications[0]
        : member.membershipnotifications;
    return setting?.allow_notifications ?? true;
};

/* recipients per message, so no single send is huge */
const BCC_CHUNK = 50;
/* messages in flight at once */
export const SEND_CONCURRENCY = 10;

export const roomRequiresAdvisor = (
    room?: { approval_required?: boolean | null } | null,
) => room?.approval_required === true;

const ERR_MEETING_TIME = 'Invalid meeting time or length.';
const ERR_MEETING_ORDER = 'The meeting must end after it starts.';
const ERR_MEETING_DAYS = 'A meeting must start and end on the same day.';
export const ERR_MAX_ROOMS =
    'Due to high demand, only 5 future in-person meetings can be booked per club.';
/* raised by the room_meeting_cap trigger (057) */
export const MEETING_CAP_CODE = 'EP429';
const MAX_ROOM_MEETINGS = 5;
const ERR_ROOM = 'Invalid meeting room.';
const ERR_ROOM_BLOCKED = 'This room is blocked on that day.';
const ERR_ROOM_BOOKED =
    'That room was just booked for this time. Choose another room or time.';
const ERR = `Malformed request. Contact ${IT_EMAIL}.`;

const ERR_ADVISOR_REQUIRED =
    'This room requires a faculty advisor. Choose one from the list.';
const ERR_ADVISOR_INVALID =
    'The advisor must be a registered faculty member. Choose one from the list.';

const normalizeName = (name: string) =>
    name.replace(/\s+/g, ' ').trim().toLowerCase();

export const checkAdvisor = async (
    advisor?: string | null,
    roomId?: number | null,
    existingAdvisor?: string | null,
): Promise<{ advisor: string | null; error?: string }> => {
    let required = false;
    if (roomId) {
        const { data: room, error: roomError } = await supabaseAdmin
            .from('rooms')
            .select('approval_required')
            .eq('id', roomId)
            .single();
        if (roomError) {
            return {
                advisor: advisor ?? null,
                error: ERR + ' (Code: BAD_ROOM)',
            };
        }
        required = roomRequiresAdvisor(room);
    }

    const requested = advisor?.trim() || null;
    if (!requested) {
        return required
            ? { advisor: null, error: ERR_ADVISOR_REQUIRED }
            : { advisor: null };
    }

    const { data: faculty, error: facultyError } = await supabaseAdmin
        .from('users')
        .select('first_name, last_name')
        .eq('is_faculty', true);
    if (facultyError) {
        return {
            advisor: advisor ?? null,
            error: ERR + ' (Code: BAD_FACULTY)',
        };
    }

    const match = (faculty ?? []).find((member) =>
        normalizeName(`${member.first_name} ${member.last_name}`) ===
            normalizeName(requested)
    );
    if (match) {
        return { advisor: `${match.first_name} ${match.last_name}`.trim() };
    }

    if (
        !required && existingAdvisor &&
        normalizeName(existingAdvisor) === normalizeName(requested)
    ) {
        return { advisor: requested };
    }

    return { advisor: requested, error: ERR_ADVISOR_INVALID };
};

/* null when the lookup fails */
export const isRoomBlocked = async (
    room_id: number,
    start: Date,
    end: Date,
) => {
    const { data, error } = await supabaseAdmin
        .from('room_blocks')
        .select('room_id')
        .eq('room_id', room_id)
        .gte('blocked_on', newYorkDate(start))
        .lte('blocked_on', newYorkDate(new Date(end.getTime() - 1)))
        .limit(1);
    if (error) return null;
    return data.length > 0;
};

/* only these clubs schedule meetings and post; null when the lookup fails */
export const isApprovedClub = async (orgId: number) => {
    const { data, error } = await supabaseAdmin.from('organizations')
        .select('state')
        .eq('id', orgId)
        .maybeSingle();
    if (error) return null;
    return data?.state === 'UNLOCKED' || data?.state === 'ADMIN';
};

export const isSiteAdmin = async (email?: string | null) => {
    if (!email) return false;
    const { data, error } = await supabaseAdmin
        .from('permissions')
        .select('permission, users!inner ( email )')
        .eq('permission', 'ADMIN')
        .eq('users.email', email)
        .limit(1);
    return !error && !!data && data.length > 0;
};

export type PastPolicy = 'none' | 'started' | 'any';

export const isValidMeeting = async (
    start_time: string,
    end_time: string,
    room_id?: number | null,
    meeting_id?: number,
    organization_id?: number | null,
    pastPolicy: PastPolicy = 'none',
) => {
    // validate dates
    if (
        !start_time || !end_time || typeof start_time !== 'string' ||
        typeof end_time !== 'string'
    ) {
        return ERR_MEETING_TIME;
    }
    const start = new Date(start_time);
    const end = new Date(end_time);
    const nowMs = (new Date()).getTime();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return ERR_MEETING_TIME;
    }
    if (end.getTime() <= start.getTime()) return ERR_MEETING_ORDER;
    /* room days, AIS days and the site's scheduler are all per day */
    if (newYorkDate(start) !== newYorkDate(new Date(end.getTime() - 1))) {
        return ERR_MEETING_DAYS;
    }
    if (
        (pastPolicy === 'none' && start.getTime() < nowMs) || // meeting starts in past
        (pastPolicy === 'started' && end.getTime() <= nowMs) ||
        end.getTime() - start.getTime() < MIN_LENGTH * 60 * 1000 // meeting is too short
    ) {
        return ERR_MEETING_TIME;
    }

    type roomMeta = {
        room_id: number;
        meeting_id: number;
    };

    // check room availability
    if (room_id) {
        if (!organization_id) return ERR + ' (Code: BAD_ORG)';

        const { data: existing, error: existingError } = meeting_id
            ? await supabaseAdmin
                .from('meetings')
                .select('room_id, start_time, end_time')
                .eq('id', meeting_id)
                .maybeSingle()
            : { data: null, error: null };
        if (existingError) return ERR + ' (Code: BAD_MEETING)';

        const { data: organization, error: organizationFetchError } =
            await supabaseAdmin.from('organizations').select('state').eq(
                'id',
                organization_id,
            ).limit(1).single();
        if (organizationFetchError) {
            console.error(
                '[isValidMeeting] org fetch failed',
                organizationFetchError.code,
                organizationFetchError.message,
            );
            return ERR + ' (Code: BAD_ORG_FETCH)';
        }

        /* counted from the start of today in New York; a meeting that
           already had a room from today on is already counted (the
           room_meeting_cap trigger makes the final call) */
        const today = newYorkDate(new Date());
        const alreadyCounted = !!existing?.room_id &&
            newYorkDate(new Date(existing.start_time)) >= today;
        if (organization?.state !== 'ADMIN' && !alreadyCounted) {
            const { count, error: pendingMeetingFetchError } =
                await supabaseAdmin
                    .from('meetings')
                    .select('id', { count: 'exact', head: true })
                    .eq('organization_id', organization_id)
                    .not('room_id', 'is', null)
                    .neq('id', meeting_id || -1)
                    .gte('start_time', newYorkMidnight(today));
            // failed to fetch
            if (pendingMeetingFetchError) {
                return ERR + ' (Code: BAD_PEND)';
            }
            if ((count ?? 0) >= MAX_ROOM_MEETINGS) return ERR_MAX_ROOMS;
        }

        const { data: meetings, error: meetingFetchError } = await supabaseAdmin
            .rpc('get_booked_rooms', {
                meeting_start: start_time,
                meeting_end: end_time,
            })
            .returns<roomMeta[]>();

        // failed to fetch
        if (meetingFetchError) {
            return ERR + ' (Code: BAD_BOOKED)';
        }

        // editing meeting, exclude the original meeting
        let bookedRooms: roomMeta[] = Array.isArray(meetings) ? meetings : [];
        if (meeting_id) {
            bookedRooms = bookedRooms.filter((meeting) =>
                Number(meeting.meeting_id) !== Number(meeting_id)
            );
        }

        // room is booked at that time
        /* compare as numbers so a room_id sent as a string can't slip past */
        if (
            bookedRooms.find((meeting) =>
                Number(meeting.room_id) === Number(room_id)
            )
        ) {
            return ERR_ROOM_BOOKED;
        }

        /* a meeting already in the room keeps it while it stays on the same
        days (Force Reserve bookings, or meetings booked before a block or an
        AIS day), so only the clash check above applies */
        const keepsRoom = !!existing &&
            Number(existing.room_id) === Number(room_id) &&
            newYorkDate(start) >=
                newYorkDate(new Date(existing.start_time)) &&
            newYorkDate(new Date(end.getTime() - 1)) <=
                newYorkDate(
                    new Date(new Date(existing.end_time).getTime() - 1),
                );
        if (keepsRoom) return '';

        const blocked = await isRoomBlocked(Number(room_id), start, end);
        if (blocked === null) return ERR + ' (Code: BAD_BLOCKS)';
        if (blocked) return ERR_ROOM_BLOCKED;

        /* the day it falls on in New York, not wherever the server runs */
        const dayOfWeek = newYorkWeekday(start);

        const { data: roomData, error: roomFetchError } = await supabaseAdmin
            .from('rooms')
            .select('*')
            .eq('id', room_id)
            .limit(1)
            .single();
        // failed to fetch
        if (!roomData || roomFetchError) {
            return ERR;
        }

        const { data: grants, error: grantsFetchError } = await supabaseAdmin
            .from('room_grants')
            .select('organization_id')
            .eq('room_id', room_id);
        if (grantsFetchError) {
            return ERR + ' (Code: BAD_GRANTS)';
        }

        const hasGrant = (grants ?? []).some((g) =>
            g.organization_id === organization_id
        );
        const isWeekend = dayOfWeek === 'SATURDAY' || dayOfWeek === 'SUNDAY';
        if (
            isWeekend ||
            (roomData.ais_days ?? []).includes(dayOfWeek) ||
            (!hasGrant && !roomData.available_days.includes(dayOfWeek))
        ) {
            return ERR_ROOM;
        }
    }

    return '';
};

/* who gets an org email: active members of active accounts */
const fetchMembers = async (filter: { orgId?: number; memberId?: number }) => {
    const query = () => {
        const q = supabaseAdmin
            .from('memberships')
            .select(`
            id,
            role,
            users!inner (
                id,
                first_name,
                email,
                is_faculty
            ),
            organizations!inner (
                name
            ),
            membershipnotifications (
                allow_notifications
            )
        `)
            .eq('active', true)
            .eq('users.active', true);
        return filter.memberId
            ? q.eq('id', filter.memberId)
            : q.eq('organization_id', filter.orgId!);
    };
    const { data, error } = await fetchAllRows((from, to) =>
        query().order('id').range(from, to).returns<mtyp[]>()
    );
    return { members: data, error };
};

/* Emails a club's members in BCC batches. False if any part failed. A
   shared pooled transport is left open for the caller to close. */
export const sendOrgEmail = async (
    orgId: number,
    subject: string,
    body: string | { text: string; html: string },
    notifyFaculty?: boolean,
    onlyAdmin?: boolean,
    onlyFaculty?: boolean,
    shared?: PooledTransport,
): Promise<boolean> => {
    let { text, html } = typeof body === 'string'
        ? { text: body, html: undefined }
        : body;
    const { members, error: membershipsError } = await fetchMembers({ orgId });

    if (membershipsError || !members.length) {
        if (membershipsError) {
            console.error(
                `[sendOrgEmail] org=${orgId} fetch error`,
                membershipsError.message || membershipsError,
            );
        }
        // no members is nothing to send, not a failure
        return !membershipsError;
    }

    const recipients = new Set<string>();
    const orgName = members[0].organizations.name;

    for (const member of members) {
        // do not notify faculty
        if (member.users.is_faculty && !notifyFaculty && !onlyFaculty) {
            continue;
        }

        if (onlyFaculty && !member.users.is_faculty) {
            continue;
        }

        if (
            onlyAdmin &&
            (member.role === 'MEMBER' || member.role === 'ADVISOR')
        ) {
            continue;
        }

        if (!wantsEmail(member)) {
            continue;
        }

        recipients.add(member.users.email.trim().toLowerCase());
    }

    // replacer functions, so a $ in the name isn't read as a pattern
    subject = subject.replace(/{ORG_NAME}/g, () => orgName);
    text = text.replace(/{ORG_NAME}/g, () => orgName);
    html = html?.replace(/{ORG_NAME}/g, () => escapeHtml(orgName));

    const from = Deno.env.get('NODEMAILER_FROM')!;
    const list = [...recipients];
    console.log(
        `[sendOrgEmail] org=${orgId} members=${members.length} recipients=${list.length} onlyAdmin=${!!onlyAdmin} notifyFaculty=${!!notifyFaculty}`,
    );

    const transport = shared ?? pooledTransport(SEND_CONCURRENCY);
    let failed = 0;
    let sent = 0;
    let failedSends = 0;
    /* nothing has gone through yet, so don't keep waiting on timeouts */
    const smtpDown = () => sent === 0 && failedSends >= 3;
    const chunks = Math.ceil(list.length / BCC_CHUNK);
    let next = 0;

    try {
        /* SEND_CONCURRENCY workers; taking the next index is synchronous,
           so each chunk is sent once */
        await Promise.all(
            Array.from(
                { length: Math.min(SEND_CONCURRENCY, chunks) },
                async () => {
                    while (next < chunks && !smtpDown()) {
                        const i = next++;
                        const bcc = list.slice(
                            i * BCC_CHUNK,
                            (i + 1) * BCC_CHUNK,
                        );
                        try {
                            await transport.sendMail({
                                from,
                                subject,
                                bcc,
                                text,
                                html,
                            });
                            sent++;
                        } catch (e) {
                            /* not retried, a failed send may still have gone out */
                            failed += bcc.length;
                            if (++failedSends === 1) {
                                console.error(
                                    `[sendOrgEmail] org=${orgId} send failed`,
                                    (e as Error)?.message || e,
                                );
                            }
                        }
                    }
                },
            ),
        );
        if (next < chunks) {
            failed += list.length - next * BCC_CHUNK;
            console.error(`[sendOrgEmail] org=${orgId} email server down`);
        }
    } finally {
        if (!shared) transport.close();
    }

    if (failed) {
        console.error(
            `[sendOrgEmail] org=${orgId} ${failed} of ${list.length} failed`,
        );
    }
    return failed === 0;
};

/* Emails one member. False if it couldn't be sent. */
export const sendMemberEmail = async (
    memberId: number,
    subject: string,
    text: string,
): Promise<boolean> => {
    const { members, error } = await fetchMembers({ memberId });
    if (error) {
        console.error('[sendMemberEmail] fetch error', error.message || error);
        return false;
    }
    const member = members[0];
    // inactive, or turned email off
    if (!member || !wantsEmail(member)) return true;

    subject = subject.replace(/{ORG_NAME}/g, () => member.organizations.name);
    text = text.replace(/{ORG_NAME}/g, () => member.organizations.name);

    subject = subject.replace(/{FIRST_NAME}/g, () => member.users.first_name);
    text = text.replace(/{FIRST_NAME}/g, () => member.users.first_name);

    try {
        await Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: member.users.email,
            subject,
            text,
        });
        return true;
    } catch (e) {
        console.error(
            `[sendMemberEmail] membership=${memberId} failed`,
            (e as Error)?.message || e,
        );
        return false;
    }
};

export const fetchMemberRequirement = async () => {
    type styp = {
        setting_value: number;
    };
    const { data } = await supabaseAdmin.from('settings')
        .select(`
                setting_value
            `).eq('name', 'required_members')
        .single()
        .returns<styp>();
    return data?.setting_value || 0;
};

export const safeSupabaseQuery = async <T>(
    query: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T> => {
    const { data, error } = await query;
    if (error) {
        throw error;
    }
    return data as T;
};

export const unlockOrganizationIfReady = async (orgId: number) => {
    const { data: org } = await supabaseAdmin.from('organizations')
        .select('state')
        .eq('id', orgId)
        .maybeSingle();

    if (org?.state !== 'LOCKED') return;

    const { count } = await supabaseAdmin.from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('active', true)
        .neq('role', 'ADVISOR');

    if ((count ?? 0) >= await fetchMemberRequirement()) {
        const emailText =
            `You are receiving this email because your organization {ORG_NAME} has been approved and unlocked.

You can begin creating meetings, making posts, and your organization will be displayed on the club catalog.

We hope you enjoy your club experience at Stuy!` + footer;
        const subject = `Organization Unlocked: {ORG_NAME} | Epsilon`;

        const { data: unlocked } = await supabaseAdmin.from('organizations')
            .update({ state: 'UNLOCKED' })
            .eq('id', orgId)
            .eq('state', 'LOCKED')
            .select('id');

        if (
            unlocked?.length &&
            !await sendOrgEmail(orgId, subject, emailText, false, true)
        ) {
            console.error(`[unlock] org=${orgId} email failed`);
        }
    }
};
