import supabaseAdmin from './supabaseAdmin.ts';

export const isValidMeeting = async (
    start_time: string,
    end_time: string,
    room_id?: number,
    meeting_id?: number,
) => {
    if (!start_time || !end_time) {
        return false;
    }

    type roomMeta = {
        room_id: number;
        meeting_id: number;
    };

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

    if (meeting_id) {
        meetings = meetings.filter((meeting) =>
            meeting.meeting_id !== meeting_id
        );
    }

    // room is booked at that time
    if (meetings.find((meeting) => meeting.room_id === room_id)) {
        return false;
    }

    // day of week is not valid
    const day = new Date(start_time);
    const daysOfWeek = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
    ];
    const dayOfWeek = daysOfWeek[day.getDay()];

    const { data: roomData, error: roomFetchError } = await supabaseAdmin
        .from('rooms')
        .select('*')
        .eq('id', room_id)
        .limit(1)
        .single();
    if (!roomData || roomFetchError) {
        return false;
    }

    if (!roomData.available_days.includes(dayOfWeek)) {
        return false;
    }

    return true;
};
