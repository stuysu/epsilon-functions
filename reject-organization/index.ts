import Transport from '../_shared/emailTransport.ts';
import { withCors } from '../_shared/cors.ts';
import { fetchAllRows } from '../_shared/rows.ts';
import { getCaller } from '../_shared/auth.ts';
import { isSiteAdmin } from '../_shared/utils.ts';
import { footer, siteUrl } from '../_shared/strings.ts';
import { isId, readJson } from '../_shared/http.ts';
import { logAdminAction } from '../_shared/adminLog.ts';

Deno.serve(withCors(async (req: Request) => {
    const body = await readJson(req);
    const organization_id = body?.organization_id;

    if (!isId(organization_id)) {
        return new Response('Missing field', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    if (!(await isSiteAdmin(user.email))) {
        return new Response('Permission denied.', { status: 403 });
    }

    /* the charter stays, so its leaders can fix it and resubmit */
    const { data: rejected, error: rejectError } = await supabaseClient
        .from('organizations')
        .update({
            state: 'REJECTED',
            rejected_at: new Date().toISOString(),
        })
        .eq('id', organization_id)
        .eq('state', 'PENDING')
        .select('name, url');

    if (rejectError) {
        console.error('[reject-organization] update failed', rejectError);
        return new Response('Failed to reject organization.', { status: 500 });
    }

    if (!rejected?.length) {
        const { data: exists } = await supabaseClient.from('organizations')
            .select('id')
            .eq('id', organization_id)
            .maybeSingle();
        return exists
            ? new Response('Only pending organizations can be rejected.', {
                status: 409,
            })
            : new Response('Organization not found.', { status: 404 });
    }

    const { name, url } = rejected[0];

    await logAdminAction(siteUser, {
        action: 'reject_charter',
        targetType: 'organization',
        targetId: organization_id,
        details: { organization: name },
    });

    type orgAdminType = {
        id: number;
        users: {
            first_name: string;
            email: string;
        };
    };

    const { data: orgAdmins, error: orgAdminError } = await fetchAllRows((
        from,
        to,
    ) => supabaseClient.from('memberships')
        .select(`
                id,
                users!inner (
                    first_name,
                    email
                )
            `)
        .eq('organization_id', organization_id)
        .eq('active', true)
        .eq('users.active', true)
        .in('role', ['ADMIN', 'CREATOR'])
        .order('id')
        .range(from, to)
        .returns<orgAdminType[]>()
    );

    /* already rejected, so report success even if no one can be emailed */
    if (orgAdminError || !orgAdmins.length) {
        console.error(
            '[reject-organization] no leaders to email',
            orgAdminError?.message,
        );
    }

    const site = siteUrl();
    const sent = await Promise.allSettled(
        orgAdmins.map((admin) =>
            Transport.sendMail({
                from: Deno.env.get('NODEMAILER_FROM')!,
                to: admin.users.email,
                subject: `${name}: Charter Needs Changes | Epsilon`,
                text: `Hi ${admin.users.first_name}!

The Student Union reviewed your charter for ${name} and sent it back for changes. Check your club's Messages on Epsilon for what to change:
${site}/${url}/admin/messages

Then edit the charter and send it back for review here:
${site}/${url}/admin/org-edits` + footer,
            })
        ),
    );
    const failed = sent.filter((result) => result.status === 'rejected');
    if (failed.length) {
        console.error(
            `[reject-organization] ${failed.length} of ${sent.length} emails failed`,
            (failed[0] as PromiseRejectedResult).reason?.message,
        );
    }

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
