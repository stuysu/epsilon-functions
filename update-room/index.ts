import corsHeaders from '../_shared/cors.ts';
import transport from '../_shared/emailTransport.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { nyISO } from '../_shared/utils.ts';

type BodyType = {
	room_id: number;
	name: string;
	floor: number;
	approval_required: boolean;
	comments: string;
	available_days: Array<
		| 'MONDAY'
		| 'TUESDAY'
		| 'WEDNESDAY'
		| 'THURSDAY'
		| 'FRIDAY'
		| 'SATURDAY'
		| 'SUNDAY'
	>;
	ais_days: string[];
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const {
		room_id,
		name,
		floor,
		approval_required,
		comments,
		available_days,
		ais_days,
	}: BodyType = await request.json();

	if (
		room_id === 0 ||
		available_days.length === 0 ||
		floor === 0 ||
		name === ''
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

	if (verifiedUsers === null || verifiedUsers.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	/* Validation via RLS */

	/* update room */
	const { error: roomUpdateError } = await supabaseClient
		.from('rooms')
		.update({
			name,
			floor,
			approval_required,
			comments,
			available_days,
			ais_days,
		})
		.eq('id', room_id);

	if (roomUpdateError) {
		return new Response('Failed to update room.', { status: 500 });
	}

	/* Delete any meetings that are no longer valid, and update organization about them */
	const daysOfWeek: BodyType['available_days'] = [
		'SUNDAY',
		'MONDAY',
		'TUESDAY',
		'WEDNESDAY',
		'THURSDAY',
		'FRIDAY',
		'SATURDAY',
	];
	await supabaseClient
		.from('meetings')
		.select(
			`
            id,
            title,
            start_time,
            end_time,
            rooms!inner (
                id,
                name
            ),
            organization_id  
        `
		)
		.eq('room_id', room_id)
		.then(async ({ data: meetings, error: meetingFetchError }) => {
			if (meetingFetchError !== null || meetings === null) {
				console.error('Failed to fetch meetings', meetingFetchError);
				return;
			}

			const orgUpdateData: Record<
				number,
				{
					name: string;
					admins: Array<{ users: { first_name: string; email: string } }>;
					removedMeetings: Array<{
						id: number;
						title: string;
						start_time: string;
						end_time: string;
					}>;
				}
			> = {};

			for (const meeting of meetings) {
				const start = new Date(meeting.start_time);
				const dayOfWeek = daysOfWeek[start.getDay()];

				if (!available_days.includes(dayOfWeek)) {
					/* Delete meeting */
					// eslint-disable-next-line no-await-in-loop
					const { error: meetingDeleteError } = await supabaseClient
						.from('meetings')
						.delete()
						.eq('id', meeting.id);

					type Mtyp = {
						users: {
							first_name: string;
							email: string;
						};
					};

					if (meetingDeleteError !== null) {
						continue;
					}

					/* Meeting is no longer valid, need to update admins of org */
					// eslint-disable-next-line no-await-in-loop
					const { data: admins, error: adminFetchError } = await supabaseClient
						.from('memberships')
						.select(
							`
                            users!inner (
                                first_name,
                                email
                            )
                        `
						)
						.eq('organization_id', meeting.organization_id)
						.overrideTypes<Mtyp[], { merge: false }>();

					if (adminFetchError !== null || admins === null) {
						console.error('Failed to fetch admins', adminFetchError);
						continue;
					}

					// eslint-disable-next-line no-await-in-loop
					const { data: orgData, error: orgFetchError } = await supabaseClient
						.from('organizations')
						.select(
							`
                                id,
                                name    
                            `
						)
						.eq('id', meeting.organization_id)
						.limit(1)
						.single();

					if (orgFetchError !== null || orgData === null) {
						console.error('Failed to fetch org data', orgFetchError);
						continue;
					}

					orgUpdateData[orgData.id] ??= {
						name: orgData.name,
						admins,
						removedMeetings: [],
					};

					orgUpdateData[orgData.id].removedMeetings.push(meeting);
				}
			}

			for (const value of Object.values(orgUpdateData)) {
				for (const admin of value.admins) {
					const emailBody =
						`
Hi ${admin.users.first_name},

This email is to let you know that the following meetings have been removed from ${value.name}:
${value.removedMeetings
	.map((meeting) => `${meeting.title} at ${nyISO(meeting.start_time)}`)
	.join('\n')}

This is because the room(s) they were originally scheduled for have been taken out of service.

We are sincerely apologize for the inconvenience, and we hope you are able to reschedule the meetings in a different room.` +
						footer;
					void transport.sendMail({
						from: Deno.env.get('NODEMAILER_FROM')!,
						to: admin.users.email,
						subject: `Meetings removed for ${value.name} | Epsilon`,
						text: emailBody,
					});
				}
			}
		});
	return Response.json(
		{
			success: true,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
