import supabaseAdmin from './supabaseAdmin.ts';
const MIN_LENGTH = 30; // minutes

export const isValidMeeting = async (
    start_time: string,
    end_time: string,
    room_id?: number | null,
    meeting_id?: number,
) => {
    // validate dates
    if (!start_time || !end_time) {
        return false;
    }
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (
        isNaN(start.getTime()) || isNaN(end.getTime()) || // invalid timestamps
        start.getTime() < (new Date()).getTime() || // meeting starts in past
        end.getTime() - start.getTime() < MIN_LENGTH * 60 * 1000 // meeting is too short (including "negative" length)
    ) {
        return false;
    }

    type roomMeta = {
        room_id: number;
        meeting_id: number;
    };

    // check room availability
    if (room_id) {
        let { data: meetings, error: meetingFetchError } = await supabaseAdmin
            .rpc('get_booked_rooms', {
                meeting_start: start_time,
                meeting_end: end_time,
            })
            .returns<roomMeta[]>();

        // failed to fetch
        if (meetingFetchError || !meetings) {
            return false;
        }

        // editing meeting, exclude the original meeting
        if (meeting_id) {
            meetings = meetings.filter((meeting) =>
                meeting.meeting_id !== meeting_id
            );
        }

        // room is booked at that time
        if (meetings.find((meeting) => meeting.room_id === room_id)) {
            return false;
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
            return false;
        }

        if (!roomData.available_days.includes(dayOfWeek)) {
            return false;
        }
    }

    return true;
};
