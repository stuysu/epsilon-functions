import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { dbErrorStatus, isId, readJson } from '../_shared/http.ts';
import { removeClubFolder } from '../_shared/picture.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

const GONE = 'This charter no longer exists.';

/* Deletes a charter and its pictures (a plain row delete leaves them in
   storage). RLS decides who may: its creator while PENDING or REJECTED, or a
   site admin. */
Deno.serve(withCors(async (req: Request) => {
    const body = await readJson(req);
    const organizationId = body?.organization_id;
    if (!isId(organizationId)) {
        return new Response('Missing field', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;

    /* read before the delete cascades them away */
    const [
        { data: org, error: orgError },
        { data: creator, error: roleError },
    ] = await Promise.all([
        supabaseAdmin.from('organizations')
            .select('name, url, state')
            .eq('id', organizationId)
            .maybeSingle(),
        supabaseAdmin.from('memberships')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('user_id', caller.user.id)
            .eq('role', 'CREATOR')
            .eq('active', true)
            .limit(1),
    ]);
    if (orgError || roleError) {
        console.error('[delete-charter] lookup failed', orgError ?? roleError);
        return new Response('Failed to delete the charter.', { status: 500 });
    }
    if (!org) return new Response(GONE, { status: 404 });

    const { data, error } = await caller.client.from('organizations')
        .delete()
        .eq('id', organizationId)
        .select('id');
    if (error) {
        console.error('[delete-charter] delete failed', error);
        return new Response('Failed to delete the charter.', {
            status: dbErrorStatus(error),
        });
    }
    if (!data?.length) {
        /* deleted meanwhile, e.g. a second click */
        const { data: still } = await supabaseAdmin.from('organizations')
            .select('id')
            .eq('id', organizationId)
            .maybeSingle();
        if (!still) return new Response(GONE, { status: 404 });
        return new Response(
            'Only the creator can delete a charter, and only while it is pending or rejected.',
            { status: 403 },
        );
    }

    /* a creator removing their own charter isn't an admin action */
    const ownCharter = !!creator?.length &&
        ['PENDING', 'REJECTED'].includes(org.state);
    if (!ownCharter) {
        await logAdminAction(caller.user, {
            action: 'delete_charter',
            targetType: 'organization',
            targetId: organizationId,
            details: { name: org.name, url: org.url, state: org.state },
        });
    }

    await removeClubFolder(organizationId);

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
