import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

Deno.serve(async (request: Request) => {
	const url = new URL(request.url);
	const name = url.searchParams.get('name');

	if (name === null || name === '') {
		return new Response('Missing schedule name field', { status: 400 });
	}

	const { data: scheduleData, error: scheduleError } = await supabaseAdmin
		.from('schedules')
		.select('schedule')
		.eq('name', name)
		.single();

	if (scheduleError !== null) {
		return new Response('Failed to fetch schedule.', { status: 500 });
	}

	return Response.json(scheduleData.schedule, {
		headers: { 'Content-Type': 'application/json' },
	});
});
