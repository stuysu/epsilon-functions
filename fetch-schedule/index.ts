import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';

Deno.serve(withCors(async (req: Request) => {
    const url = new URL(req.url);
    const name = url.searchParams.get('name');

    if (!name) {
        return new Response('Missing schedule name field', { status: 400 });
    }

    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );

    const { data: scheduleData, error: scheduleError } = await supabaseClient
        .from('schedules')
        .select('schedule')
        .eq('name', name)
        .single();

    if (scheduleError) {
        return new Response('Failed to fetch schedule.', {
            // PGRST116: no schedule with that name
            status: scheduleError.code === 'PGRST116' ? 404 : 500,
        });
    }

    return new Response(
        JSON.stringify(scheduleData.schedule),
        { headers: { 'Content-Type': 'application/json' } },
    );
}));
