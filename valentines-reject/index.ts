import corsHeaders from '../_shared/cors.ts';
import transport from '../_shared/emailTransport.ts';
import { footer } from '../_shared/strings.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';
import { safeSupabaseQuery } from '../_shared/utils.ts';

type BodyType = {
	message_id: number;
	reason?: string;
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

	const body = (await request.json()) as BodyType;

	if (body.message_id === undefined || body.message_id === null) {
		return new Response('No message id provided.', { status: 400 });
	}

	const { data: messageData, error: messageDataError } = await supabaseClient
		.from('valentinesmessages')
		.select('sender,receiver,message,verified_by,verified_at')
		.eq('id', body.message_id)
		.single();

	if (messageDataError !== null) {
		return new Response('Failed to fetch message', {
			status: 500,
		});
	}

	if (messageData.verified_by !== null && messageData.verified_at !== null) {
		return new Response('Message already approved.', { status: 400 });
	}

	try {
		const sender = await safeSupabaseQuery<{
			email: string;
			first_name: string;
		}>(
			supabaseClient
				.from('users')
				.select('email,first_name')
				.eq('id', messageData.sender)
				.single()
		);
		if (!sender) {
			throw new Error('Sender not found');
		}

		const receiver = await safeSupabaseQuery<{
			email: string;
		}>(
			supabaseClient
				.from('users')
				.select('email')
				.eq('id', messageData.receiver)
				.single()
		);
		if (!receiver) {
			throw new Error('Receiver not found');
		}

		const text =
			`Hi ${sender.first_name},

Your message has been removed from Epsilon Valentines with the following reason: ${
				body.reason ?? '[no reason provided]'
			}

Below are the details of the message in question:
Recipient: ${receiver.email}
Content: ${messageData.message === null || messageData.message === '' ? '[empty message]' : messageData.message}

You may submit a new message if desired.` + footer;
		await transport.sendMail({
			from: Deno.env.get('NODEMAILER_FROM')!,
			to: sender.email,
			subject: '[Epsilon Valentines] Message Removed',
			text,
		});
		const { error: messageDeleteError } = await supabaseClient
			.from('valentinesmessages')
			.delete()
			.eq('id', body.message_id);

		if (messageDeleteError !== null) {
			return new Response('Failed to delete message', {
				status: 500,
			});
		}

		return Response.json(
			{},
			{
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch {
		return new Response('Failed to fetch users', { status: 500 });
	}
});
