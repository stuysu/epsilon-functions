import { isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { emailNewAdvisor } from '../_shared/advisorEmail.ts';
import { footer, IT_EMAIL } from '../_shared/strings.ts';
import {
    cleanCharter,
    EDITABLE_CHARTER_FIELDS,
    isClubPictureUrl,
    RESERVED_PATHS,
    validateCharter,
} from '../_shared/charter.ts';
import { publicBase, removeClubPicture } from '../_shared/picture.ts';
import { dbErrorStatus, isId, readJson } from '../_shared/http.ts';
import { logAdminAction } from '../_shared/adminLog.ts';

type BodyType = {
    organization_id: number;
    updated_fields: {
        [key: string]: unknown;
    };
    edit_id: number;
};

Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        organization_id,
        updated_fields,
        edit_id,
    }: BodyType = bodyJson;

    if (!organization_id || !updated_fields || !edit_id) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(organization_id) || !isId(edit_id)) {
        return new Response('Invalid organization or edit.', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user, user: siteUser } = caller;

    /* only site admins review charter edits */
    if (!(await isSiteAdmin(user.email))) {
        return new Response('User is unauthorized.', { status: 403 });
    }

    /* the edit must exist and belong to this organization */
    const { data: pendingEdit, error: editFetchError } = await supabaseClient
        .from('organizationedits')
        .select('*')
        .eq('id', edit_id)
        .eq('organization_id', organization_id)
        .maybeSingle();
    if (editFetchError) {
        return new Response('Failed to fetch organization edit.', {
            status: 500,
        });
    }
    if (!pendingEdit) {
        return new Response('Organization edit not found.', { status: 404 });
    }

    if (typeof updated_fields !== 'object' || Array.isArray(updated_fields)) {
        return new Response('Invalid updated fields.', { status: 400 });
    }
    const notEditable = Object.keys(updated_fields).filter((field) =>
        !EDITABLE_CHARTER_FIELDS.includes(field)
    );
    if (notEditable.length) {
        return new Response(
            `These fields can't be changed by a charter edit: ${
                notEditable.join(', ')
            }.`,
            { status: 400 },
        );
    }

    /* apply only what the request still asks for: a field the club saved
       directly since then is no longer pending, and one they changed again
       needs a fresh look */
    const stillPending: { [field: string]: unknown } = {};
    for (const [field, value] of Object.entries(updated_fields)) {
        /* charter edits never set fair; the column's old default isn't a change */
        if (field === 'fair') continue;
        const current = pendingEdit[field];
        if (current === null || current === undefined) continue;
        if (JSON.stringify(current) !== JSON.stringify(value)) {
            return new Response(
                'This request changed after you opened it. Reload to see the latest version.',
                { status: 409 },
            );
        }
        stillPending[field] = value;
    }

    /* everything in it was saved directly already */
    if (!Object.keys(stillPending).length) {
        await supabaseClient.from('organizationedits').delete()
            .eq('id', edit_id);
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const cleanedFields = cleanCharter(stillPending);

    const problems = validateCharter(cleanedFields, false);
    if (problems.length) {
        return new Response(problems.join(' '), { status: 400 });
    }

    if (
        typeof cleanedFields.url === 'string' &&
        RESERVED_PATHS.includes(cleanedFields.url)
    ) {
        return new Response(
            'You may not register an Epsilon URL that is already in use.',
            { status: 400 },
        );
    }

    /* leaders write edit requests directly, so the picture could be any URL */
    const newPicture = cleanedFields.picture;
    const changesPicture = 'picture' in cleanedFields;
    if (
        changesPicture && newPicture &&
        (typeof newPicture !== 'string' ||
            !isClubPictureUrl(organization_id, newPicture, publicBase()))
    ) {
        return new Response(
            'The new picture must be one uploaded for this club.',
            { status: 400 },
        );
    }
    const { data: oldOrg } = changesPicture
        ? await supabaseClient.from('organizations')
            .select('picture')
            .eq('id', organization_id)
            .maybeSingle()
        : { data: null };

    type orgTyp = {
        name: string;
    };

    /* UPDATE ORG */
    const { data: orgData, error: updateError } = await supabaseClient.from(
        'organizations',
    )
        .update(cleanedFields)
        .eq('id', organization_id)
        .select(`
            name
        `)
        .returns<orgTyp[]>();

    if (updateError) {
        return new Response('Failed to update organization.', {
            status: dbErrorStatus(updateError),
        });
    }

    /* nothing updated: either the org doesn't exist or RLS hid it */
    if (!orgData || !orgData.length) {
        const { data: org } = await supabaseClient.from('organizations')
            .select('id')
            .eq('id', organization_id);
        if (!org || !org.length) {
            return new Response('Organization not found.', { status: 404 });
        }
        return new Response('User is unauthorized.', { status: 403 });
    }

    const updatedOrgName = orgData[0].name;

    if (oldOrg?.picture && oldOrg.picture !== newPicture) {
        await removeClubPicture(organization_id, oldOrg.picture);
    }

    await logAdminAction(siteUser, {
        action: 'approve_charter_edit',
        targetType: 'organization',
        targetId: organization_id,
        details: {
            organization: updatedOrgName,
            fields: Object.keys(cleanedFields),
        },
    });

    if ('faculty_email' in cleanedFields) {
        const { data: advisorResult, error: advisorError } = await supabaseAdmin
            .rpc('add_charter_advisor', {
                org_id: organization_id,
            });
        if (advisorError) {
            console.error('[APPROVE_EDIT] advisor failed', advisorError);
        } else if (
            advisorResult === 'added' &&
            typeof cleanedFields.faculty_email === 'string'
        ) {
            await emailNewAdvisor(
                organization_id,
                cleanedFields.faculty_email,
                (name) =>
                    `${name} updated its charter to name you as its faculty advisor.`,
            );
        }
    }

    /* Try deleting edit */
    const { error: deleteEditError } = await supabaseClient.from(
        'organizationedits',
    )
        .delete()
        .eq('id', edit_id)
        .eq('organization_id', organization_id);

    const emailBody =
        `Your organization update request for ${updatedOrgName} has been approved.` +
        footer;
    const emailSubject = `${updatedOrgName}: Charter Update Approved | Epsilon`;

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
            `[approve-organization-edit] email failed for org ${organization_id}`,
        );
    }

    if (deleteEditError) {
        return new Response(
            `Failed to delete pre-existing edit. Please contact ${IT_EMAIL} as soon as possible.`,
            { status: 500 },
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
