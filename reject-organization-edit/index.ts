import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	organization_id: number;
	edit_id: number;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { organization_id, edit_id }: BodyType = await request.json();

	if (organization_id === 0 || edit_id === 0) {
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

	type OrgTyp = {
		name: string;
	};

	/* Get org data */
	const { data: orgData, error: fetchError } = await supabaseClient
		.from('organizations')
		.select(
			`
            name
        `
		)
		.eq('id', organization_id)
		.overrideTypes<OrgTyp[], { merge: false }>();

	if (fetchError) {
		return new Response('Failed to get organization.', { status: 500 });
	}

	const rejectedOrgName = orgData[0].name;

	/* Try deleting edit */
	const { error: editDeleteError } = await supabaseClient
		.from('organizationedits')
		.delete()
		.eq('id', edit_id);

	if (editDeleteError !== null) {
		return new Response(
			'Failed to delete pre-existing edit. Please contact it@stuysu.org as soon as possible.',
			{ status: 500 }
		);
	}

	/* Email admins */
	const emailBody =
		`Your organization update request for ${rejectedOrgName} was rejected.
		For more information, please check your club admin panel's messages tab.` +
		footer;

	const emailSubject = `${rejectedOrgName}: Update Rejected | Epsilon`;

	void sendOrgEmail(organization_id, emailSubject, emailBody, false, true);

	return Response.json(
		{
			success: true,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
