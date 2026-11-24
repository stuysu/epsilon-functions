import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    {
        global: {
            headers: {
                Authorization: `Bearer ${
                    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
                }`,
            },
        },
    },
);

export default supabaseAdmin;
