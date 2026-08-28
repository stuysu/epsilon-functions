import corsHeaders from '../_shared/cors.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { nyISO } from '../_shared/utils.ts';

type BodyType = {
	message_id: number;
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

	if (user === null) {
		return new Response('Failed to fetch user.', { status: 500 });
	}

	const { data: verifiedUser, error: verifiedUserError } = await supabaseClient
		.from('permissions')
		.select('permission,users!inner(id)')
		.eq('users.email', user.email!)
		.maybeSingle();

	if (verifiedUserError !== null) {
		console.log(verifiedUserError);
		return new Response('Failed to fetch user id.', {
			status: 500,
		});
	}

	if (!verifiedUser) {
		return new Response('User is unauthorized.', { status: 401 });
	}

	if (
		verifiedUser.permission !== 'ADMIN' &&
		verifiedUser.permission !== 'VALENTINES'
	) {
		return new Response('Permission Denied', { status: 403 });
	}

	const bodyJson = (await request.json()) as BodyType;

	const body: BodyType = {
		message_id: bodyJson.message_id,
	};

	const { data: messageData, error: messageDataError } = await supabaseClient
		.from('valentinesmessages')
		.select('verified_at')
		.eq('id', body.message_id)
		.single();

	if (messageDataError !== null) {
		return new Response('Failed to fetch message', {
			status: 500,
		});
	}

	if (messageData.verified_at !== null) {
		return new Response('Letter already approved!', { status: 400 });
	}

	const currentTime = nyISO();

	const { error: messageUpdateError } = await supabaseClient
		.from('valentinesmessages')
		.update({
			verified_at: currentTime,
			verified_by: verifiedUser.users.id,
		})
		.eq('id', body.message_id);

	if (messageUpdateError) {
		console.log(messageUpdateError);
		return new Response('Failed to update message', {
			status: 500,
		});
	}

	return Response.json(
		{},
		{
			headers: { 'Content-Type': 'application/json' },
		}
	);
});
