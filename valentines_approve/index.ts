import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';

type BodyType = {
    message_id: number;
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization')!;

    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    if (!user) {
        return new Response('Failed to fetch user.', { status: 500 });
    }

    const { data: verifiedUser, error: verifiedUserError } =
        await supabaseClient
            .from('permissions')
            .select('permission')
            .eq('user_id', user.id)
            .single();
    
    if (verifiedUserError) {
        return new Response('Failed to fetch user id.', {
            status: 500,
        });
    }
        
    if (!verifiedUser) {
        return new Response('User is unauthorized.', { status: 401 });
    }

    if(verifiedUser.permission !== "ADMIN" && verifiedUser.permission !== "VALENTINES") {
        return new Response("Permission Denied", { status: 403 });
    }

    const bodyJson = await req.json();

    const body: BodyType = {
        message_id: bodyJson.message_id, 
    };

    const { data: messageData, error: messageDataError } =
        await supabaseClient
            .from("valentinesmessages")
            .select("verified_at")
            .eq("id", body.message_id)
            .single();
    
    if (messageDataError) {
        return new Response('Failed to fetch message', {
            status: 500,
        });
    }

    if(messageData.verified_at !== null) {
        return new Response("Letter already approved!", { status: 304 });
    }

    const currentTime = datetime().toZonedTime('America/New_York').toISO();

    const { error: messageUpdateError } = await supabaseClient
        .from("valentinesmessages")
        .update({ verified_at: currentTime, verified_by: user.id })
        .eq("id", body.message_id);

    if (messageUpdateError) {
        return new Response('Failed to update message', {
            status: 500,
        });
    }

    return new Response(
        JSON.stringify({}),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});


