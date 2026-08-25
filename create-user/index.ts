import corsHeaders from '../_shared/cors.ts';
import { createTypedClient } from '../_shared/supabaseClient.ts';

type BodyType = {
	first_name: string;
	last_name: string;
	email: string;
	grad_year: number | undefined;
	is_faculty: boolean;
};

Deno.serve(async (request: Request) => {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	const authHeader = request.headers.get('Authorization')!;
	const supabaseClient = createTypedClient(authHeader);

	const bodyJson = (await request.json()) as BodyType;
	const body: BodyType = {
		first_name: bodyJson.first_name,
		last_name: bodyJson.last_name,
		email: bodyJson.email,
		grad_year: bodyJson.grad_year ?? undefined,
		is_faculty: bodyJson.is_faculty,
	};

	/** Check if user already exists */

	const { data: userData, error: userError } = await supabaseClient
		.from('users')
		.select()
		.eq('email', body.email);

	if (userData && userData.length > 0) {
		return Response.json(
			{ error: 'User already exists' },
			{
				status: 400,
				headers: corsHeaders,
			}
		);
	}

	const { error: userCreateError } = await supabaseClient
		.from('users')
		.insert(body)
		.select();

	if (userCreateError !== null) {
		return Response.json(
			{
				error: 'Error creating user',
				details: {
					message: userCreateError?.message,
					hint: userCreateError?.hint,
					code: userCreateError?.code,
					details: userCreateError?.details,
				},
			},
			{ status: 500, headers: corsHeaders }
		);
	}

	return Response.json(
		{
			success: true,
		},
		{
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		}
	);
});
