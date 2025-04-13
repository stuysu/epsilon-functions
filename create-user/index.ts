import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import corsHeaders from '../_shared/cors.ts';

type BodyType = {
    first_name: string;
    last_name: string;
    email: string;
    grad_year: number | null;
    is_faculty: boolean;
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

    const bodyJson = await req.json();
    const body: BodyType = {
        first_name: bodyJson.first_name,
        last_name: bodyJson.last_name,
        email: bodyJson.email,
        grad_year: bodyJson.grad_year,
        is_faculty: bodyJson.is_faculty,
    };

    /** check if user already exists **/
    
    const { data: userData, error: userError } = await supabaseClient.from("users")
        .select()
        .eq("email", body.email);

    if (userData && userData.length > 0) {
        return new Response(JSON.stringify({ error: "User already exists" }), {
            status: 400,
            headers: corsHeaders,
        });
    }

    else {
        const { error: createUserError } = await supabaseClient.from("users")
            .insert(body)
            .select();
        
        if(createUserError) {
            return new Response(JSON.stringify({ error: "Error creating user", details: {
        message: createUserError?.message,
        hint: createUserError?.hint,
        code: createUserError?.code,
        details: createUserError?.details
      }
 }), { status: 500, headers: corsHeaders });
        }
    }
    
    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
    );
});
