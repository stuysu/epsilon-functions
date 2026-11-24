import { isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { footer, IT_EMAIL } from '../_shared/strings.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import { isId } from '../_shared/http.ts';
import { removeClubPicture } from '../_shared/picture.ts';

type BodyType = {
    organization_id: number;
    edit_id: number;
};

Deno.serve(withCors(async (req: Request) => {
    const reqBody: BodyType | null = await req.json().catch(() => null);
    const organization_id = reqBody?.organization_id;
    const edit_id = reqBody?.edit_id;

    if (!isId(organization_id) || !isId(edit_id)) {
        return new Response('Missing field', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    if (!(await isSiteAdmin(user.email))) {
        return new Response('Permission denied.', { status: 403 });
    }

    type orgTyp = {
        name: string;
        picture: string | null;
    };

    /* get org data */
    const { data: orgData, error: fetchError } = await supabaseClient.from(
        'organizations',
    )
        .select(`
            name,
            picture
        `)
        .eq('id', organization_id)
        .returns<orgTyp[]>();

    if (fetchError) {
        return new Response('Failed to get organization.', { status: 500 });
    }

    if (!orgData || !orgData.length) {
        return new Response('Organization not found.', { status: 404 });
    }

    const rejectedOrgName = orgData[0].name;

    /* Try deleting edit (must belong to this organization) */
    const { data: deletedEdits, error: deleteEditError } = await supabaseClient
        .from('organizationedits')
        .delete()
        .eq('id', edit_id)
        .eq('organization_id', organization_id)
        .select('id, picture');

    if (!deleteEditError && (!deletedEdits || !deletedEdits.length)) {
        return new Response('Organization edit not found.', { status: 404 });
    }

    if (deleteEditError) {
        return new Response(
            `Failed to delete pre-existing edit. Please contact ${IT_EMAIL} as soon as possible.`,
            { status: 500 },
        );
    }

    /* the picture uploaded for this edit, unless the club uses it */
    const editPicture = deletedEdits[0].picture;
    if (editPicture && editPicture !== orgData[0].picture) {
        await removeClubPicture(organization_id, editPicture);
    }

    await logAdminAction(siteUser, {
        action: 'reject_charter_edit',
        targetType: 'organization',
        targetId: organization_id,
        details: { organization: rejectedOrgName },
    });

    /* email admins */
    const emailBody =
        `Your organization update request for ${rejectedOrgName} was rejected.
For more information, please check your club admin panel's messages tab.` +
        footer;

    const emailSubject = `${rejectedOrgName}: Update Rejected | Epsilon`;

    if (
        !await sendOrgEmail(
            organization_id,
            emailSubject,
            emailBody,
            false,
            true,
        )
    ) {
        console.error(
            `[reject-organization-edit] email failed for org ${organization_id}`,
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
