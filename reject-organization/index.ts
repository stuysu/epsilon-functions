import corsHeaders from '../_shared/cors.ts';
import transport from '../_shared/emailTransport.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';

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

	type OrgTyp = {
		name: string;
	};

	const { data: orgData, error: orgFetchError } = await supabaseClient
		.from('organizations')
		.select(
			`
            name
        `
		)
		.eq('id', organization_id)
		.overrideTypes<OrgTyp[], { merge: false }>();

	if (orgFetchError !== null) {
		return new Response('Failed to approve organization.', { status: 500 });
	}

	const rejectedOrgName = orgData[0].name;

	type orgAdminType = {
		id: number;
		role: 'ADMIN' | 'CREATOR';
		users: {
			first_name: string;
			email: string;
		};
	};

	const { data: orgAdmins, error: orgAdminError } = await supabaseClient
		.from('memberships')
		.select(
			`
            id,
            role,
            users!inner (
                first_name,
                email
            )
        `
		)
		.eq('organization_id', organization_id)
		.in('role', ['ADMIN', 'CREATOR'])
		.overrideTypes<orgAdminType[], { merge: false }>();

	/* Reject organization */
	const { error: rejectError } = await supabaseClient
		.from('organizations')
		.delete()
		.eq('id', organization_id);

	if (rejectError !== null) {
		return new Response('Failed to reject organization.', { status: 500 });
	}

	/* Email admins */

	if (orgAdminError !== null || (orgAdmins?.length ?? 0) === 0) {
		console.log('Unable to email org admins.');
		return new Response('Failed to email org admins.', { status: 500 });
	}

	for (const admin of orgAdmins) {
		const emailBody =
			`Hi ${admin.users.first_name}!

Your charter for ${rejectedOrgName} has been rejected.` + footer;

		void transport
			.sendMail({
				from: Deno.env.get('NODEMAILER_FROM')!,
				to: admin.users.email,
				subject: `${rejectedOrgName}: Charter Rejected | Epsilon`,
				text: emailBody,
			})
			.catch((error: unknown) => {
				if (error instanceof Error) {
					console.error('Failed to send email: ' + error.message);
				} else {
					console.error('Unexpected error', error);
				}
			});
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
