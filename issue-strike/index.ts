import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	organization_id: number;
	reason: string;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { organization_id, reason }: BodyType = await request.json();

	if (organization_id === 0 || reason === '') {
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

	// This is the user that is stored in public.users
	const siteUser = verifiedUsers[0];

	/* Hand out strike */
	type styp = {
		id: number;
		reason: string;
		users: {
			first_name: string;
			last_name: string;
			picture: string;
		};
		organizations: {
			name: string;
			url: string;
		};
	};

	const { data: strikeData, error: strikeError } = await supabaseClient
		.from('strikes')
		.insert({
			organization_id,
			admin_id: siteUser.id,
			reason,
		})
		.select(
			`
            id,
            reason,
            users!inner(
                first_name,
                last_name,
                picture
            ),
            organizations!inner (
                name,
                url
            )
        `
		)
		.overrideTypes<styp[], { merge: false }>();

	if (strikeError) {
		return new Response('Failed to issue strike.', { status: 500 });
	}

	/* Asynchronously email admins to prevent function from hanging on client */

	const ORG_NAME = '{ORG_NAME}';
	const emailBody =
		`You are receiving this message because you are an admin of ${ORG_NAME}.
        
This email is to let you know that your organization has be given a strike for the following reason:
${reason}

You can view this strike at ${Deno.env.get('SITE_URL')}/${
			strikeData[0].organizations.url
		}/admin/strikes

If you would like to dispute this strike, please contact clubpub@stuysu.org.
` + footer;
	const emailSubject = '{ORG_NAME}: Strike Received | Epsilon';

	void sendOrgEmail(organization_id, emailSubject, emailBody, false, true);

	return Response.json(
		{
			id: strikeData[0].id,
			reason,
			users: {
				first_name: strikeData[0].users.first_name,
				last_name: strikeData[0].users.last_name,
				picture: strikeData[0].users.picture,
			},
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
