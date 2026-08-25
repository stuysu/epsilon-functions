import type { Database } from './database.types.ts';
import { createClient } from '@supabase/supabase-js';

export const createTypedClient = (authHeader: string) =>
	createClient<Database>(
		Deno.env.get('SUPABASE_URL') ?? '',
		Deno.env.get('SUPABASE_ANON_KEY') ?? '',
		{
			global: {
				headers: { Authorization: authHeader },
			},
		}
	);
