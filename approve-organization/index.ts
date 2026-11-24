import {
    fetchMemberRequirement,
    isSiteAdmin,
    sendOrgEmail,
} from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { emailNewAdvisor } from '../_shared/advisorEmail.ts';
import { footer } from '../_shared/strings.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import { isId } from '../_shared/http.ts';

type BodyType = {
    organization_id: number;
};

Deno.serve(withCors(async (req: Request) => {
    const reqBody: BodyType | null = await req.json().catch(() => null);
    const organization_id = reqBody?.organization_id;

    if (!isId(organization_id)) {
        return new Response('Missing field', { status: 400 });
    }

    const required_members = await fetchMemberRequirement();

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    if (!(await isSiteAdmin(user.email))) {
        return new Response('Permission denied.', { status: 403 });
    }

    const { data: currentOrg, error: currentOrgError } = await supabaseClient
        .from('organizations')
        .select('state')
        .eq('id', organization_id)
        .maybeSingle();

    if (currentOrgError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }

    if (!currentOrg) {
        return new Response('Organization not found.', { status: 404 });
    }

    if (currentOrg.state !== 'PENDING') {
        return new Response('Organization is not pending approval.', {
            status: 409,
        });
    }

    type orgTyp = {
        name: string;
        faculty_email: string | null;
    };

    const { count, error: countError } = await supabaseClient
        .from('memberships')
        .select(`user_id`, { count: 'exact', head: true })
        .eq('organization_id', organization_id)
        .eq('active', true)
        .neq('role', 'ADVISOR');
    /* a wrong count would lock or unlock the club by mistake */
    if (countError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }
    const org_members = count ?? 0;

    const newState = org_members >= required_members ? 'UNLOCKED' : 'LOCKED';
    const { data: orgData, error: approveError } = await supabaseClient.from(
        'organizations',
    )
        .update({
            state: newState,
            rejected_at: null,
        })
        .eq('id', organization_id)
        .eq('state', 'PENDING')
        .select(`
            name,
            faculty_email
        `)
        .returns<orgTyp[]>();

    if (approveError) {
        return new Response('Failed to approve organization.', { status: 500 });
    }

    if (!orgData || !orgData.length) {
        return new Response('Organization is not pending approval.', {
            status: 409,
        });
    }

    const approvedOrgName = orgData[0].name;

    await logAdminAction(siteUser, {
        action: 'approve_charter',
        targetType: 'organization',
        targetId: organization_id,
        details: { organization: approvedOrgName, state: newState },
    });

    const { data: advisorResult, error: advisorError } = await supabaseAdmin
        .rpc('add_charter_advisor', { org_id: organization_id });
    if (advisorError) {
        console.error('[APPROVE_ORGANIZATION] advisor failed', advisorError);
    } else if (advisorResult === 'added' && orgData[0].faculty_email) {
        await emailNewAdvisor(
            organization_id,
            orgData[0].faculty_email,
            (name) =>
                `${name} named you as its faculty advisor, and its charter has just been approved.`,
        );
    }

    /* send emails  */
    const emailBody =
        `Congratulations! ${approvedOrgName} has been approved. You are now an official Stuyvesant club!

${
            org_members < required_members
                ? `Once your club is unlocked at ${required_members} members, y`
                : 'Y'
        }ou can start advertising your club, recruiting members, and holding meetings. We hope you enjoy your club experience at Stuy.` +
        footer;

    const subject = `${approvedOrgName}: Charter Approved | Epsilon`;

    if (!await sendOrgEmail(organization_id, subject, emailBody, false, true)) {
        console.error(
            `[approve-organization] email failed for org ${organization_id}`,
        );
    }

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
