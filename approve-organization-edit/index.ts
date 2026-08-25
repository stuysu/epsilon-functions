import type { Database } from '../_shared/database.types.ts';
import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { sendOrgEmail } from '../_shared/utils.ts';

type BodyType = {
	organization_id: number;
	updated_fields: Record<string, any>;
	edit_id: number;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { organization_id, updated_fields, edit_id }: BodyType =
		await request.json();

	if (
		organization_id === 0 ||
		updated_fields === null ||
		updated_fields === undefined ||
		edit_id === 0
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

	if (
		verifiedUsers === null ||
		verifiedUsers === undefined ||
		verifiedUsers.length === 0
	) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	type OrgTyp = {
		name: string;
	};

	/* UPDATE ORG */
	const { data: orgData, error: updateError } = await supabaseClient
		.from('organizations')
		.update(
			updated_fields as Database['public']['Tables']['organizations']['Update']
		)
		.eq('id', organization_id)
		.select(
			`
            name
        `
		)
		.overrideTypes<OrgTyp[], { merge: false }>();

	if (updateError) {
		return new Response('Failed to update organization.', { status: 500 });
	}

	const updatedOrgName = orgData[0].name;

	/* Try deleting edit */
	const { error: editDeleteError } = await supabaseClient
		.from('organizationedits')
		.delete()
		.eq('id', edit_id);

	type orgAdminType = {
		id: number;
		role: 'ADMIN' | 'CREATOR';
		users: {
			first_name: string;
			email: string;
		};
	};

	/* Asynchronously email admins to prevent function from hanging on client */

	const emailBody =
		`Your organization update request for ${updatedOrgName} has been approved.` +
		footer;
	const emailSubject = `${updatedOrgName}: Charter Update Approved | Epsilon`;

	void sendOrgEmail(organization_id, emailSubject, emailBody, false, true);

	if (editDeleteError !== null) {
		return new Response(
			'Failed to delete pre-existing edit. Please contact it@stuysu.org as soon as possible.',
			{ status: 500 }
		);
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
