import corsHeaders from '../_shared/cors.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	organization_id: number;
	title: string;
	description: string;
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

	if (verifiedUsers === null || verifiedUsers.length === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	const bodyJson = (await request.json()) as BodyType;
	const body: BodyType = {
		organization_id: bodyJson.organization_id,
		title: bodyJson.title,
		description: bodyJson.description,
	};

	/* Create post */
	const { data: postData, error: postError } = await supabaseClient
		.from('posts')
		.insert(body)
		.select();

	if (postError !== null || postData === null || postData.length === 0) {
		return new Response('Error creating post.', { status: 500 });
	}

	/* Email all members of organization */

	const emailText = `${body.title}\n\n${body.description}`;
	const ORG_NAME = '{ORG_NAME}';
	const emailSubject = `${body.title} | ${ORG_NAME}`;

	void sendOrgEmail(body.organization_id, emailSubject, emailText);

	return Response.json(
		{
			...postData[0],
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
