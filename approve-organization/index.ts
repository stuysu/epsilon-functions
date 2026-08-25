import corsHeaders from '../_shared/cors.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { fetchMemberRequirement, sendOrgEmail } from '../_shared/utils.ts';

// import { initOrgCalendar } from '../_shared/google/calendar.ts'; REMOVE FOR NOW: DOESN'T WORK IN PRODUCTION

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

	const required_members = await fetchMemberRequirement();

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

	type OrgTyp = {
		name: string;
	};

	const { count: org_members } = await supabaseClient
		.from('memberships')
		.select('user_id', { count: 'exact' })
		.eq('organization_id', organization_id)
		.eq('active', true);

	const { data: orgData, error: approveError } = await supabaseClient
		.from('organizations')
		.update({
			state: (org_members ?? 0) >= required_members ? 'UNLOCKED' : 'LOCKED',
		})
		.eq('id', organization_id)
		.select(
			`
            name
        `
		)
		.overrideTypes<OrgTyp[], { merge: false }>();

	if (approveError !== null) {
		return new Response('Failed to approve organization.', { status: 500 });
	}

	const approvedOrgName = orgData[0].name;

	/* Send emails  */
	const emailBody =
		`Congratulations! ${approvedOrgName} has been approved. You are now an official Stuyvesant club!

${
	(org_members ?? 0) < (required_members ?? 0)
		? `Once your club is unlocked at ${required_members} members, y`
		: 'Y'
}ou can start advertising your club, recruiting members, and holding meetings. We hope you enjoy your club experience at Stuy.` +
		footer;

	const subject = `${approvedOrgName}: Charter Approved | Epsilon`;

	void sendOrgEmail(organization_id, subject, emailBody, true, true);

	/* Asynchronously create a google calendar
    REMOVE FOR NOW: DOESN'T WORK IN PRODUCTION
    initOrgCalendar(organization_id)
    .catch((error : unknown) => {
        if (error instanceof Error) {
            console.error(`Failed to create calendar: ` + error.message);
        } else {
            console.error('Unexpected error', error);
        }
    });
    */

	return Response.json(
		{
			success: true,
		},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
