import { nyISO } from '../_shared/utils.ts';
import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { getMeetingValidationError, sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	title: string;
	description: string;
	room_id?: number | undefined;
	start_time: string;
	end_time: string;
	is_public: boolean;
	advisor?: string | undefined;
};

const returnSelect = `
            id,
            is_public,
            title,
            description,
            advisor,
            start_time,
            end_time,
            organization_id,
            rooms (
                id,
                name,
                floor
            )
        `;

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

	if (verifiedUsers === null || verifiedUsers.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	const bodyJson =
		await request.json(); /* BodyJson here also includes: notify-faculty and id <- meeting id */

	const advisor = bodyJson.advisor?.trim() ?? null;

	const body: BodyType = {
		title: bodyJson.title,
		description: bodyJson.description,
		room_id: bodyJson.room_id,
		start_time: bodyJson.start_time,
		end_time: bodyJson.end_time,
		is_public: bodyJson.is_public,
		advisor,
	};

	/* Removed backend validation because it already exists in RLS */

	const validationError = await getMeetingValidationError(
		body.start_time,
		body.end_time,
		body.room_id,
		bodyJson.id,
		bodyJson.organization_id
	);
	if (validationError !== null && validationError !== '') {
		return new Response(validationError, {
			status: 400,
		});
	}

	type Rtyp = {
		id: number;
		is_public: boolean;
		title: string;
		description: string;
		advisor: string | undefined;
		start_time: string;
		end_time: string;
		organization_id: number;
		rooms: {
			id: number;
			name: string;
			floor: number;
		};
	};
	const { data: updateMeetingData, error: updateMeetingError } =
		await supabaseClient
			.from('meetings')
			.update(body)
			.eq('id', bodyJson.id)
			.select(returnSelect)
			.overrideTypes<Rtyp[], { merge: false }>();

	if (
		updateMeetingError !== null ||
		updateMeetingData === null ||
		updateMeetingData.length === 0
	) {
		return new Response('Could not update meeting.', { status: 500 });
	}

	/* Asynchronously email all members of organization */

	const startTime = nyISO(updateMeetingData[0].start_time)
		;
	const endTime = nyISO(updateMeetingData[0].end_time)
		;

	const emailText =
		// eslint-disable-next-line unicorn/no-incorrect-template-string-interpolation
		`You are receiving this email because you are a member of {ORG_NAME}.
This email is to let you know of an updated meeting. The details of which are below.
Title: ${body.title}
Description: ${body.description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${updateMeetingData[0].rooms?.name ?? 'Virtual'}
Advisor: ${updateMeetingData[0].advisor ?? 'None'}` + footer;

	const emailSubject = '{ORG_NAME} updated a meeting | Epsilon';

	void sendOrgEmail(
		updateMeetingData[0].organization_id,
		emailSubject,
		emailText
	);

	return Response.json(
		{
			...updateMeetingData[0],
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
