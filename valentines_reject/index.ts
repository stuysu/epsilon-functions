import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';

import { datetime } from 'https://deno.land/x/ptera/mod.ts';
import Transport from '../_shared/emailTransport.ts';
import { footer } from '../_shared/strings.ts';
import { safeSupabaseQuery } from '../_shared/utils.ts';

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
            .select('permission,users!inner(id)')
            .eq('users.email', user.email)
            .maybeSingle();

    if (verifiedUserError) {
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

    const bodyJson = await req.json();

    const body: BodyType = {
        message_id: bodyJson.message_id,
    };
    if (!body.message_id) {
        return new Response('No message id provided.', { status: 400 });
    }

    const { data: messageData, error: messageDataError } = await supabaseClient
        .from('valentinesmessages')
        .select('sender,receiver,message,verified_by,verified_at')
        .eq('id', body.message_id)
        .single();

    if (messageDataError) {
        return new Response('Failed to fetch message', {
            status: 500,
        });
    }
    if (messageData.verified_by && messageData.verified_at) {
        return new Response('Message already approved.', { status: 400 });
    }
    try {
        const sender = await safeSupabaseQuery(
            supabaseClient.from('users')
                .select('email,first_name')
                .eq('id', messageData.sender)
                .single(),
        );
        const receiver = await safeSupabaseQuery(
            supabaseClient.from('users')
                .select('email')
                .eq('id', messageData.receiver)
                .single(),
        );
        const text = `Hi ${sender.first_name},

Your message has been removed from Epsilon Valentines with the following reason: REASON

Below are the details of the message in question:
Recipient: ${receiver.email}
Content: ${messageData.message || '[empty message]'}

You may submit a new message if desired.` + footer;
        await Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: sender.email,
            subject: '[Epsilon Valentines] Message Removed',
            text,
        });
        const { error: messageDeleteError } = await supabaseClient
            .from('valentinesmessages')
            .delete()
            .eq('id', body.message_id);

        if (messageDeleteError) {
            return new Response('Failed to delete message', {
                status: 500,
            });
        }

        return new Response(
            JSON.stringify({}),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (_error) {
        return new Response('Failed to fetch users', { status: 500 });
    }
});
