import {
    createClient,
    type SupabaseClient,
    type User,
} from '@supabase/supabase-js';

export type SiteUser = {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    is_faculty: boolean;
    active: boolean;
};

export type Caller = {
    /* acts as the caller, so RLS applies */
    client: SupabaseClient;
    authUser: User & { email: string };
    /* their row in public.users */
    user: SiteUser;
};

/* The signed-in caller, or the response to send when there isn't one. */
export const getCaller = async (req: Request): Promise<Caller | Response> => {
    const authHeader = req.headers.get('Authorization');
    const jwt = authHeader?.match(/^Bearer (\S+)$/)?.[1];
    if (!authHeader || !jwt) {
        return new Response('Not signed in.', { status: 401 });
    }
    const client = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );

    const { data } = await client.auth.getUser(jwt);
    const authUser = data?.user;
    /* missing, expired or anon token */
    if (!authUser?.email) {
        return new Response('Not signed in.', { status: 401 });
    }

    const { data: users, error } = await client.from('users')
        .select('id, first_name, last_name, email, is_faculty, active')
        .eq('email', authUser.email)
        .limit(1)
        .returns<SiteUser[]>();
    if (error) {
        console.error('[getCaller] users lookup failed', error);
        return new Response('Failed to fetch users associated email.', {
            status: 500,
        });
    }
    if (!users?.length) {
        return new Response('User is unauthorized.', { status: 401 });
    }

    return {
        client,
        authUser: authUser as User & { email: string },
        user: users[0],
    };
};
