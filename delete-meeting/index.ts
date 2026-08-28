import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { nyISO, sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	id: number;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
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

	if (verifiedUsers === undefined || verifiedUsers.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	const bodyJson = (await request.json()) as BodyType;
	const body: BodyType = {
		id: bodyJson.id,
	};

	/* Collect old meeting data */
	const { data: oldMeetingData, error: oldMeetingError } = await supabaseClient
		.from('meetings')
		.select(
			`
                *,
                rooms (
                    name
                )
            `
		)
		.eq('id', body.id);

	if (
		oldMeetingError !== null ||
		oldMeetingData === undefined ||
		oldMeetingData.length === 0
	) {
		return new Response('Error fetching old meeting data.', {
			status: 500,
		});
	}

	/* Attempt to delete meeting and notify members */
	const { error: meetingDeleteError } = await supabaseClient
		.from('meetings')
		.delete()
		.eq('id', body.id);

	if (meetingDeleteError !== null) {
		return new Response('Error deleting meeting.', { status: 500 });
	}

	/* Notify members */
	/* email all members of organization */

	const startTime = nyISO(oldMeetingData[0].start_time);
	const endTime = nyISO(oldMeetingData[0].end_time);

	const emailText =
		// eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation
		`You are receiving this email because you are a member of {ORG_NAME}.
This email is to let you know that the meeting listed below is *CANCELED*
Title: ${oldMeetingData[0].title}
Description: ${oldMeetingData[0].description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${oldMeetingData[0].rooms?.name ?? 'Virtual'}
Advisor: ${oldMeetingData[0].advisor ?? 'None'}` + footer;

	const emailSubject = '{ORG_NAME} canceled a meeting | Epsilon';

	const oldOrgId = oldMeetingData[0].organization_id;
	void sendOrgEmail(oldOrgId, emailSubject, emailText);

	return Response.json(
		{
			done: true,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
