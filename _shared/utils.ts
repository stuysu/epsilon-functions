import supabaseAdmin from './supabaseAdmin.ts';
import Transport from './emailTransport.ts';

const MIN_LENGTH = 30; // minutes

type mtyp = {
    role: 'CREATOR' | 'ADMIN' | 'FACULTY' | 'MEMBER';
    users: {
        first_name: string;
        email: string;
        is_faculty: boolean;
    };
    organizations: { name: string };
};

const ERR_MEETING_TIME = 'Invalid meeting time or length.';
const ERR_MAX_ROOMS =
    'Due to high demand, only 5 future in-person meetings can be booked per club.';
const ERR_ROOM = 'Invalid meeting room.';
const ERR = 'Malformed request. Contact it@stuysu.org.';

export const isValidMeeting = async (
    start_time: string,
    end_time: string,
    room_id?: number | null,
    meeting_id?: number,
    organization_id?: number | null,
) => {
    // validate dates
    if (!start_time || !end_time) {
        return ERR_MEETING_TIME;
    }
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (
        isNaN(start.getTime()) || isNaN(end.getTime()) || // invalid timestamps
        start.getTime() < (new Date()).getTime() || // meeting starts in past
        end.getTime() - start.getTime() < MIN_LENGTH * 60 * 1000 // meeting is too short (including "negative" length)
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
        const now = new Date();
        let { data: pendingMeetings, error: pendingMeetingFetchError } =
            await supabaseAdmin
                .from('meetings')
                .select()
                .eq('organization_id', organization_id)
                .not('room_id', 'is', null)
                .gte(
                    'start_time',
                    `${now.getFullYear()}-${
                        now.getMonth() + 1
                    }-${now.getDate()}`,
                );
        // failed to fetch
        if (pendingMeetingFetchError) {
            return ERR + ' (Code: BAD_PEND)';
        }
        if (pendingMeetings.length >= 5) return ERR_MAX_ROOMS;

        let { data: meetings, error: meetingFetchError } = await supabaseAdmin
            .rpc('get_booked_rooms', {
                meeting_start: start_time,
                meeting_end: end_time,
            })
            .returns<roomMeta[]>();

        // failed to fetch
        if (meetingFetchError) {
            return ERR + '(Code: BAD_MEET)';
        }

        // editing meeting, exclude the original meeting
        if (meeting_id) {
            meetings = meetings.filter((meeting) =>
                meeting.meeting_id !== meeting_id
            );
        }

        // room is booked at that time
        if (meetings.find((meeting) => meeting.room_id === room_id)) {
            return ERR_ROOM;
        }

        // check if room is available on that day of week
        const daysOfWeek = [
            'SUNDAY',
            'MONDAY',
            'TUESDAY',
            'WEDNESDAY',
            'THURSDAY',
            'FRIDAY',
            'SATURDAY',
        ];
        const dayOfWeek = daysOfWeek[start.getDay()];

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

        if (!roomData.available_days.includes(dayOfWeek)) {
            return ERR_ROOM;
        }
    }

    return '';
};

export const sendOrgEmail = async (
    orgId: number,
    subject: string,
    text: string,
    notifyFaculty?: boolean,
    onlyAdmin?: boolean,
) => {
    const { data: memberData, error: memberError } = await supabaseAdmin.from(
        'memberships',
    )
        .select(`
            role,
            users!inner (
                first_name,
                email,
                is_faculty
            ),
            organizations!inner (
                name
            )
        `)
        .eq('organization_id', orgId)
        .returns<mtyp[]>();

    if (memberError || !memberData || !memberData.length) {
        console.log('Error fetching members.');
        return;
    }

    const recipientEmails = [];
    const orgName = memberData[0].organizations.name;

    for (const member of memberData) {
        // do not notify faculty
        if (member.users.is_faculty && !notifyFaculty) {
            continue;
        }

        if (
            onlyAdmin &&
            (member.role === 'MEMBER' || member.role === 'FACULTY')
        ) {
            continue;
        }

        recipientEmails.push(member.users.email);
    }

    subject = subject.replace(/{ORG_NAME}/g, orgName);
    text = text.replace(/{ORG_NAME}/g, orgName);

    await Transport.sendMail({
        from: Deno.env.get('NODEMAILER_FROM')!,
        bcc: recipientEmails,
        subject,
        text,
    });
};

export const sendMemberEmail = async (
    memberId: number,
    subject: string,
    text: string,
) => {
    const { data: memberData, error: memberError } = await supabaseAdmin.from(
        'memberships',
    )
        .select(`
            role,
            users!inner (
                first_name,
                email,
                is_faculty
            ),
            organizations!inner (
                name
            )
        `)
        .eq('id', memberId)
        .limit(1)
        .returns<mtyp[]>()
        .single();

    if (memberError || !memberData) {
        console.log('Error fetching member.');
        return;
    }

    subject = subject.replace(/{ORG_NAME}/g, memberData.organizations.name);
    text = text.replace(/{ORG_NAME}/g, memberData.organizations.name);

    subject = subject.replace(/{FIRST_NAME}/g, memberData.users.first_name);
    text = text.replace(/{FIRST_NAME}/g, memberData.users.first_name);

    await Transport.sendMail({
        from: Deno.env.get('NODEMAILER_FROM')!,
        to: memberData.users.email,
        subject,
        text,
    });
};
