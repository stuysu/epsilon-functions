import * as jose from 'https://deno.land/x/jose@v5.9.6/index.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

Deno.serve(async (request: Request) => {
	const jwt = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (jwt === null) {
		return Response.json(
			{
				success: false,
				error: 'Missing authorization JWT header',
			},
			{
				headers: { 'Content-Type': 'application/json' },
				status: 401,
			}
		);
	}

	// Send GraphQL request to fetch validated Publickey
	const response = await fetch('https://vote.stuysu.org/api/graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			query: '{publicKey {key expiration}}',
			variables: {},
		}),
	});
	const responseJson = await response.json();
	const {
		data: { publicKey },
	} = responseJson;
	const { key, expiration } = publicKey;

	if (new Date() > new Date(expiration)) {
		return Response.json(
			{
				success: false,
				error: 'Public key from vote.stuysu.org has expired',
			},
			{
				headers: { 'Content-Type': 'application/json' },
				status: 401,
			}
		);
	}

	// Verify JWT provided by the user
	try {
		const ecPublicKey = await jose.importSPKI(key, 'RS256');
		const {
			payload: { user: userPayload },
		} = await jose.jwtVerify(jwt!, ecPublicKey);

		const typedPayload = userPayload as {
			adminPrivileges: boolean;
			firstName: string;
			lastName: string;
			email: string;
		};

		if (!typedPayload.adminPrivileges) {
			return Response.json(
				{
					success: false,
					error: 'Not allowed to access this endpoint',
				},
				{
					headers: { 'Content-Type': 'application/json' },
					status: 401,
				}
			);
		}

		const notificationWebhook = Deno.env.get('NOTIFICATION_WEBHOOK');
		if (notificationWebhook !== undefined && notificationWebhook !== '') {
			try {
				const _response = await fetch(notificationWebhook, {
					method: 'POST',
					body: JSON.stringify({
						content: `${new Date().toISOString()}: ${typedPayload.firstName} ${typedPayload.lastName} (${typedPayload.email}) accessed export-voters. If they are not from the BOE, panic!!`,
					}),
					headers: {
						'Content-Type': 'application/json',
					},
				});
			} catch (error_) {
				console.error(error_);
			}
		}

		type user = {
			first_name: string;
			last_name: string;
			email: string;
			grad_year: number | undefined;
			active: boolean | undefined;
			is_faculty: boolean;
		};
		let { data, error } = await supabaseAdmin
			.from('users')
			.select(
				`
            first_name,
            last_name,
            email,
            grad_year,
            active,
            is_faculty
        `
			)
			.eq('active', true)
			.eq('is_faculty', false);
		if (error !== null) {
			throw error instanceof Error ? error : new Error(String(error));
		}

		data ??= [];

		return Response.json({
			success: true,
			data: data.map((u: user) => ({
				firstName: u.first_name,
				lastName: u.last_name,
				email: u.email,
				gradYear: u.grad_year,
				active: u.active,
				isFaculty: u.is_faculty,
			})),
		});
	} catch (error) {
		console.error(error);
		return Response.json(
			{
				success: false,
				error:
					((error as Error).message ?? '') === ''
						? 'Unknown error (fun!)'
						: (error as Error).message,
			},
			{
				headers: { 'Content-Type': 'application/json' },
				status: 401,
			}
		);
	}
});
