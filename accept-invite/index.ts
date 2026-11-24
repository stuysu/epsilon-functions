import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { unlockOrganizationIfReady } from '../_shared/utils.ts';
import { isId, readJson } from '../_shared/http.ts';

type BodyType = {
    invite_id: number;
};

const fail = (message: string, status: number) =>
    new Response(message, { status });

Deno.serve(withCors(async (req: Request) => {
    const body: BodyType | null = await readJson(req);
    if (!body) return fail('Invalid JSON body.', 400);

    const { invite_id } = body;
    if (!isId(invite_id)) return fail('Missing field', 400);

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const siteUser = caller.user;

    const { data: invite, error: inviteError } = await supabaseAdmin
        .from('organization_invites')
        .select('id, organization_id, user_id, status')
        .eq('id', invite_id)
        .maybeSingle();
    if (inviteError) return fail('Failed to load the invitation.', 500);

    if (
        !invite || invite.user_id !== siteUser.id ||
        invite.status !== 'pending'
    ) {
        return fail('This invitation was not found.', 404);
    }

    const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('state')
        .eq('id', invite.organization_id)
        .maybeSingle();
    if (orgError) return fail('Failed to load the Activity.', 500);

    if (
        !organization ||
        ['PENDING', 'PUNISHED', 'REJECTED'].includes(organization.state)
    ) {
        return fail('This Activity is not accepting members right now.', 409);
    }

    // claim the invite first so a cancel that lands meanwhile can't be accepted
    const { data: claimed, error: claimError } = await supabaseAdmin
        .from('organization_invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id)
        .eq('status', 'pending')
        .select('id');
    if (claimError) return fail('Failed to accept the invitation.', 500);

    if (!claimed || !claimed.length) {
        return fail('This invitation was not found.', 404);
    }

    const { error: membershipError } = await supabaseAdmin
        .from('memberships')
        .upsert(
            {
                organization_id: invite.organization_id,
                user_id: siteUser.id,
                active: true,
            },
            { onConflict: 'organization_id,user_id' },
        );

    if (membershipError) {
        console.error(
            '[ACCEPT_INVITE] membership failed',
            membershipError.code,
        );
        const { error: undoError } = await supabaseAdmin
            .from('organization_invites')
            .update({ status: 'pending' })
            .eq('id', invite.id);
        if (undoError) {
            console.error('[ACCEPT_INVITE] undo failed', undoError.code);
        }
        return fail('Error joining organization.', 422);
    }

    await unlockOrganizationIfReady(invite.organization_id);

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
