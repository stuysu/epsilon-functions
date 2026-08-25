import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	organization_id: number;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { organization_id }: BodyType = await request.json();

	if (organization_id === 0) {
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

	if ((verifiedUsers?.length ?? 0) === 0) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	// This is the user that is stored in public.users
	const siteUser = verifiedUsers[0];

	/* Check if organization exists */
	const { data: orgData, error: orgExistsError } = await supabaseClient
		.from('organizations')
		.select(
			`
            id,
            name,
            url
        `
		)
		.eq('id', organization_id);

	if (orgExistsError !== null || (orgData?.length ?? 0) === 0) {
		return new Response('Organization does not exist.', { status: 404 }); // Org not found 404
	}

	/* Attempt to join organization (table constraint prevents duplicate members already) */
	type joinOrgType = {
		id: number;
		role: string;
		role_name?: string;
		active: boolean;
		users: {
			id: number;
			first_name: string;
			last_name: string;
			email: string;
			picture: string;
			is_faculty: boolean;
		};
	};
	const { data: joinOrgData, error: joinOrgError } = await supabaseClient
		.from('memberships')
		.insert({
			organization_id,
			user_id: siteUser.id,
		})
		.select(
			`
            id,
            role,
            role_name,
            active,
            users (
                id,
                first_name,
                last_name,
                email,
                picture,
                is_faculty
            )
        `
		)
		.overrideTypes<joinOrgType[], { merge: false }>();

	/* Send error if failed to join organization */
	if (joinOrgError) {
		return new Response('Error joining organization', { status: 422 }); // Unprocessable entity
	}

	/* If success, then send email to organization admins */

	/* email admins */
	const emailBody =
		`You are receiving this message because you are an admin of ${orgData[0].name}
        
This email is to let you know that ${siteUser.first_name} ${siteUser.last_name} has requested to join ${
			orgData[0].name
		}. You can approve their request at ${Deno.env.get('SITE_URL')}/${
			orgData[0].url
		}/admin/member-requests` + footer;
	const emailSubject = `${orgData[0].name}: New Join Request | Epsilon`;

	console.log('[JOIN_ORG] calling sendOrgEmail');
	await sendOrgEmail(organization_id, emailSubject, emailBody, false, true);
	console.log('[JOIN_ORG] sendOrgEmail done');

	return Response.json(
		{
			...joinOrgData[0],
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
