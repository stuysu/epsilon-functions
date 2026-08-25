import { datetime } from 'ptera';
import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { getMeetingValidationError, sendOrgEmail } from '../_shared/utils.ts';

// import { createCalendarEvent } from '../_shared/google/calendar.ts'; doesn't work

type BodyType = {
	organization_id: number;
	title: string;
	description: string;
	room_id?: number | undefined;
	start_time: string;
	end_time: string;
	is_public: boolean;
	notify_faculty?: boolean;
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

	if (verifiedUsers === undefined || verifiedUsers.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	const bodyJson = (await request.json()) as BodyType;
	const advisor = bodyJson.advisor?.trim() ?? null;
	const body: BodyType = {
		organization_id: bodyJson.organization_id,
		title: bodyJson.title,
		description: bodyJson.description,
		room_id: bodyJson.room_id,
		start_time: bodyJson.start_time,
		end_time: bodyJson.end_time,
		is_public: bodyJson.is_public,
		notify_faculty: bodyJson.notify_faculty,
		advisor: advisor ?? undefined,
	};

	/* Time (+ room) validation */
	const validationError = await getMeetingValidationError(
		body.start_time,
		body.end_time,
		body.room_id,
		undefined,
		body.organization_id
	);
	if (validationError !== null) {
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
		rooms: {
			id: number;
			name: string;
			floor: number;
		};
	};
	const { data: meetingData, error: meetingError } = await supabaseClient
		.from('meetings')
		.insert({
			organization_id: body.organization_id,
			title: body.title,
			description: body.description,
			room_id: body.room_id,
			start_time: body.start_time,
			end_time: body.end_time,
			is_public: body.is_public,
			advisor: body.advisor ?? undefined,
		})
		.select(returnSelect)
		.overrideTypes<Rtyp[], { merge: false }>();

	if (
		meetingError !== null ||
		meetingData === undefined ||
		meetingData.length === 0
	) {
		return new Response('Could not create meeting.', { status: 500 });
	}

	/* Send out emails */
	const startTime = datetime(meetingData[0].start_time)
		.toZonedTime('America/New_York')
		.format('MMMM d, YYYY, h:mm a');
	const endTime = datetime(meetingData[0].end_time)
		.toZonedTime('America/New_York')
		.format('MMMM d, YYYY, h:mm a');

	const ORG_NAME = '{ORG_NAME}';
	const emailText =
		`You are receiving this email because you are a member of ${ORG_NAME}.
This email is to let you know of an upcoming meeting. The details of which are below.
Title: ${body.title}
Description: ${body.description}
Start Date: ${startTime} EST
End Date: ${endTime} EST
Room: ${meetingData[0].rooms?.name ?? 'Virtual'}
Advisor: ${meetingData[0].advisor ?? 'None'}` + footer;

	const emailSubject = '{ORG_NAME} scheduled a meeting | Epsilon';

	void sendOrgEmail(
		body.organization_id,
		emailSubject,
		emailText,
		body.notify_faculty
	);

	/* Asynchronously create calendar event
    [DOESN'T WORK FOR NOW]
    type ctyp = {
        id: number,
        name: string,
        url: string,
        googlecalendars: {
            id: number,
            calendar_id: string
        }
    }

    const { data: orgData, error: orgError } = await supabaseClient.from('organizations')
        .select(`
            id,
            name,
            googlecalendars!inner (
                id,
                calendar_id
            )
        `)
        .eq('id', body.organization_id)
        .overrideTypes<ctyp[], {merge: false}>();

    if (orgError || !orgData || !orgData.length) {
        console.log("Error fetching organization data.");
    } else {
        createCalendarEvent(
            orgData[0].googlecalendars.calendar_id,
            {
                name: body.title,
                description: body.description,
                start: meetingData[0].start_time,
                end: meetingData[0].end_time,
                location: meetingData[0].rooms?.name || "Virtual",
                source: {
                    title: `Meeting by ${orgData[0].name} | StuyActivities`,
			        url: `${Deno.env.get('SITE_URL')}/${orgData[0].url}/meetings`
                }
            }
        );
    }
    */

	return Response.json(
		{
			...meetingData[0],
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
