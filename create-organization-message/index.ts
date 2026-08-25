import corsHeaders from '../_shared/cors.ts';
import transport from '../_shared/emailTransport.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';

type BodyType = {
	organization_id: number;
	content: string;
};

/* Accepts JSON */
Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { organization_id, content }: BodyType = await request.json();

	if (
		organization_id === undefined ||
		organization_id === null ||
		content === ''
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

	const siteUser = verifiedUsers[0];

	/* Create org message */
	type OrgTyp = {
		id: number;
		organizations: {
			name: string;
			url: string;
		};
	};
	const { data: orgData, error: orgMessageCreateError } = await supabaseClient
		.from('orgmessages')
		.insert({
			organization_id,
			user_id: siteUser.id,
			content,
		})
		.select(
			`
            id,
            organizations!inner (
                name,
                url
            )
        `
		)
		.overrideTypes<OrgTyp[], { merge: false }>();

	if (orgMessageCreateError !== null || (orgData?.length ?? 0) === 0) {
		return new Response('Error creating organization message.', {
			status: 500,
		});
	}

	const orgName = orgData[0].organizations.name;
	const orgUrl = orgData[0].organizations.url;

	type orgAdminType = {
		id: number;
		role: 'ADMIN' | 'CREATOR';
		users: {
			id: number;
			first_name: string;
			email: string;
		};
	};

	/* Email admins of organization except for current user */
	const { data: orgAdmins, error: orgAdminError } = await supabaseClient
		.from('memberships')
		.select(
			`
            id,
            role,
            users!inner (
                id,
                first_name,
                email
            )
        `
		)
		.eq('organization_id', organization_id)
		.in('role', ['ADMIN', 'CREATOR'])
		.overrideTypes<orgAdminType[], { merge: false }>();

	/* Asynchronously email admins to prevent function from hanging on client */

	if (orgAdminError !== null || (orgAdmins?.length ?? 0) === 0) {
		console.log('Unable to email org admins.');
		return new Response('Failed to email org admins.', { status: 500 });
	}

	for (const admin of orgAdmins) {
		if (admin.users.id === siteUser.id) {
			continue;
		}

		const emailBody =
			`Hi ${admin.users.first_name}!

There is a new message for ${orgName}.

${siteUser.first_name} ${siteUser.last_name}: ${content}

You can view this message at ${Deno.env.get('SITE_URL')}/${orgUrl}/admin/messages.` +
			footer;

		/* Don't use await here. let this operation perform asynchronously */
		void transport
			.sendMail({
				from: Deno.env.get('NODEMAILER_FROM')!,
				to: admin.users.email,
				subject: `${orgName}: New Administrator Message | Epsilon`,
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

	// Success!
	return Response.json(
		{
			success: true,
			id: orgData[0].id,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
