import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	room_id: number;
	organization_id: number;
	start_time: string;
	end_time: string;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { room_id, organization_id, start_time, end_time }: BodyType =
		await request.json();

	if (
		room_id === 0 ||
		organization_id === 0 ||
		start_time === '' ||
		end_time === ''
	) {
		return new Response('Missing field', { status: 400 });
	}

	const authHeader = request.headers.get('Authorization')!;
	const supabaseClient = createTypedClient(authHeader);

	const jwt = authHeader.split(' ', 2)[1];
	const { data: userData } = await supabaseClient.auth.getUser(jwt);
	const { user } = userData;

	/* Failed to fetch supabase user */
	if (user === null) {
		return new Response('Failed to fetch user.', { status: 500 });
	}

	/* Check if user is a verified user. Verified user = the userdata that the site uses */
	const { data: verifiedUsers, error: verifiedUsersError } =
		await supabaseClient.from('users').select('*').eq('email', user.email!);

	if (verifiedUsersError !== null) {
		return new Response('Failed to fetch users associated email.', {
			status: 500,
		});
	}

	if (verifiedUsers?.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	/* Validation via RLS */

	/*
    check if there is any interference with time and room.
    if there are any other meetings, kick them out and bcc it@stuysu.org.
    */

	const { data: meetings, error: meetingFetchError } = await supabaseClient
		.rpc('get_booked_rooms', {
			meeting_start: start_time,
			meeting_end: end_time,
		})
		.overrideTypes<
			Array<{ room_id: number; meeting_id: number }>,
			{ merge: false }
		>();

	if (meetingFetchError !== null || meetings === null) {
		return new Response('Failed to fetch meetings', { status: 500 });
	}

	// Check if room is AIS-locked on the booking day
	const { data: roomData, error: roomFetchError } = await supabaseClient
		.from('rooms')
		.select('ais_days')
		.eq('id', room_id)
		.single();

	if (roomFetchError !== null || roomData === null) {
		return new Response('Failed to fetch room.', { status: 500 });
	}

	const daysOfWeek = [
		'SUNDAY',
		'MONDAY',
		'TUESDAY',
		'WEDNESDAY',
		'THURSDAY',
		'FRIDAY',
		'SATURDAY',
	];
	const bookingDay = daysOfWeek[new Date(start_time).getDay()];

	if (roomData.ais_days?.includes(bookingDay)) {
		return new Response(
			'This room is reserved for AIS on this day and cannot be booked.',
			{
				status: 400,
			}
		);
	}

	const conflictingMeeting = meetings.find(
		(meeting) => meeting.room_id === room_id
	);

	if (conflictingMeeting) {
		const { data: orgData, error: orgError } = await supabaseClient
			.from('meetings')
			.delete()
			.eq('id', conflictingMeeting.meeting_id)
			.select(
				`
                title,
                organizations!inner (
                    name,
                    id
                )    
            `
			)
			.overrideTypes<
				Array<{ title: string; organizations: { name: string; id: number } }>,
				{ merge: false }
			>();

		if (orgError !== null || orgData === null) {
			console.error('Failed to fetch org.');
			return new Response('Failed to notify conflicting rooms.', {
				status: 500,
			});
		}

		const orgId = orgData[0].organizations.id;

		const emailBody =
			`Your meeting, ${
				orgData[0].title
			}, has been cancelled by admininstrators due to a conflict with another meeting.

We sincerely apologize for the inconvenience, and we hope you are able to schedule the meeting in a different room.` +
			footer;

		const emailSubject = '{ORG_NAME}: Meeting Removed | Epsilon';

		void sendOrgEmail(orgId, emailSubject, emailBody, false, true);
	}

	const { error: reserveError } = await supabaseClient.from('meetings').insert({
		room_id,
		organization_id,
		start_time: new Date(start_time).toISOString(),
		end_time: new Date(end_time).toISOString(),
		title: 'Reserved Meeting',
		description: 'This meeting was reserved by an admin.',
	});

	if (reserveError) {
		return new Response('Failed to reserve room.', { status: 500 });
	}

	return Response.json(
		{
			success: true,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
