import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import {
	fetchMemberRequirement,
	sendMemberEmail,
	sendOrgEmail,
} from '../_shared/utils.ts';

type BodyType = {
	member_id: number;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const { member_id }: BodyType = await request.json();

	if (member_id === 0) {
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

	/* RLS takes care of any permissions */

	/* update member */
	type omtyp = {
		organizations: {
			id: number;
			name: string;
		};
	};
	const { data: memberData, error: updateMemberError } = await supabaseClient
		.from('memberships')
		.update({ active: true })
		.eq('id', member_id)
		.select(
			`
                organizations!inner (
                    id,
                    name
                )
            `
		)
		.overrideTypes<omtyp[], { merge: false }>();

	/* Send error if failed to join organization */
	if (
		updateMemberError !== null ||
		memberData === null ||
		memberData.length === 0
	) {
		return new Response('Error updating member.', { status: 422 }); // Unprocessable entity
	}

	/* If success, then send email to member */

	/* email member */

	const emailBody =
		`Hi ${verifiedUsers[0].first_name}!
            
Congrats! You are now a member of ${memberData[0].organizations.name}.

		We hope you enjoy your club experience at Stuy.` + footer;

	const emailSubject = 'Membership Approved: {ORG_NAME} | Epsilon';

	void sendMemberEmail(member_id, emailSubject, emailBody);

	/* ALSO CHECK IF CLUB IS PENDING AND SHOULD IT BE UNLOCKED */
	const orgId = memberData[0].organizations.id;

	const { data: orgData, error: orgDataError } = await supabaseClient
		.from('organizations')
		.select(
			`
            state,
            memberships!inner (
                active
            )
        `
		)
		.eq('id', orgId);

	if (orgData && orgData.length > 0 && orgDataError === null) {
		const org = orgData[0];

		const required_members = await fetchMemberRequirement();

		if (
			org.state === 'LOCKED' &&
			org.memberships.filter((m) => m.active).length >= required_members
		) {
			/* SEND ORG ADMINS AN EMAIL ABOUT THIS */

			/* asynchronously email admins to prevent function from hanging on client */
			const emailText =
				`You are receiving this email because your organization ${memberData[0].organizations.name} has been approved and unlocked.

You can begin creating meetings, making posts, and your organization will be displayed on the club catalog.

			We hope you enjoy your club experience at Stuy!` + footer;
			const subject = 'Organization Unlocked: {ORG_NAME} | Epsilon';

			void sendOrgEmail(orgId, subject, emailText, false, true);

			await supabaseAdmin
				.from('organizations')
				.update({ state: 'UNLOCKED' })
				.eq('id', orgId);
		}
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
