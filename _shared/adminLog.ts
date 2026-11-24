import supabaseAdmin from './supabaseAdmin.ts';

export type AdminAction = {
    action: string;
    targetType?: 'organization' | 'room' | 'user' | 'meeting' | 'valentine';
    targetId?: number | null;
    /* names and short notes only, no emails */
    details?: Record<string, unknown>;
};

/* Adds a row to admin_actions. Never throws: the action already happened. */
export const logAdminAction = async (
    actor: { id: number } | { email: string },
    { action, targetType, targetId, details = {} }: AdminAction,
): Promise<void> => {
    try {
        let actorId: number | null = 'id' in actor ? actor.id : null;
        if ('email' in actor) {
            const { data } = await supabaseAdmin.from('users')
                .select('id')
                .eq('email', actor.email.trim().toLowerCase())
                .maybeSingle();
            actorId = data?.id ?? null;
        }
        const { error } = await supabaseAdmin.from('admin_actions').insert({
            actor_id: actorId,
            action,
            target_type: targetType ?? null,
            target_id: targetId ?? null,
            details,
        });
        if (error) console.error(`[adminLog] ${action} failed`, error.message);
    } catch (e) {
        console.error(`[adminLog] ${action} failed`, (e as Error)?.message);
    }
};
