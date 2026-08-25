import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';

type BodyType = {
	name: string;
	url: string;
	socials: string;
	mission: string;
	goals: string;
	benefit: string;
	keywords: string;
	tags: string[];
	appointment_procedures: string;
	uniqueness: string;
	meeting_description: string;
	meeting_schedule: string;
	meeting_days: string[];
	commitment_level: string;
	join_instructions: string;
	is_returning: boolean;
	returning_info: string;
	fair?: boolean;
	faculty_email?: string;
};

const RESERVED_PATHS = new Set([
	'catalog',
	'create',
	'about',
	'meetings',
	'rules',
	'archive',
	'modules',
	'admin',
	'attendance',
	'opportunities',
	'valentines',
	'today',
	'announcements',
]);

/* Accepts JSON */
Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const authHeader = request.headers.get('Authorization')!;
	const supabaseClient = createTypedClient(authHeader);

	type styp = {
		setting_value: number;
	};
	const { data } = await supabaseAdmin
		.from('settings')
		.select(
			`
                setting_value
            `
		)
		.eq('name', 'charter_deadline')
		.single()
		.overrideTypes<styp, { merge: false }>();
	if (data?.setting_value !== undefined && data?.setting_value !== 0) {
		const deadline = new Date(data.setting_value);
		if (new Date() > deadline) {
			return new Response(
				`Chartering for this year has been disabled as of ${deadline.toLocaleString()}.`,
				{ status: 403 }
			);
		}
	}

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

	const siteUser = verifiedUsers[0];
	const body: BodyType = await request.json();
	if (RESERVED_PATHS.has(body.url)) {
		return new Response(
			'You may not register an Epsilon URL that is already in use.',
			{
				status: 400,
			}
		);
	}

	body.url = body.url.replace(' ', '-');

	const { data: orgData, error: orgCreateError } = await supabaseClient
		.from('organizations')
		.insert({
			...body,
		}).select(`
            id
        `);

	if (orgCreateError !== null || orgData === null || orgData.length === 0) {
		return new Response(
			`Error creating organization. \`${
				orgCreateError?.message ??
				orgCreateError?.code ??
				'Unknown error. Contact it@stuysu.org.'
			}\``,
			{ status: 500 }
		);
	}

	/* CREATE CREATOR MEMBERSHIP FOR USER */
	const { error: membershipError } = await supabaseAdmin
		.from('memberships')
		.insert({
			organization_id: orgData[0].id,
			user_id: siteUser.id,
			role: 'CREATOR',
			active: true,
		});

	if (membershipError !== null) {
		return new Response(
			'Error creating membership. Please contact it@stuysu.org as soon as possible.',
			{ status: 500 }
		);
	}

	// Success!
	return Response.json(
		{
			id: orgData[0].id,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
