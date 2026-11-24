import { isSiteAdmin } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { emailNewAdvisor, sameEmail } from '../_shared/advisorEmail.ts';
import {
    cleanCharter,
    DIRECT_CHARTER_FIELDS,
    EDITABLE_CHARTER_FIELDS,
    RESERVED_PATHS,
    validateCharter,
    WEEKDAYS,
} from '../_shared/charter.ts';
import { dbErrorStatus, isId, readJson } from '../_shared/http.ts';
import {
    type ClubPicture,
    PICTURE_PROBLEM,
    readClubPicture,
    removeClubPicture,
    uploadClubPicture,
} from '../_shared/picture.ts';

/* clubs in these states can save some charter fields without review */
const DIRECT_STATES = ['UNLOCKED', 'ADMIN'];
/* charters still in review (or sent back) save every charter field */
const REVIEW_STATES = ['PENDING', 'REJECTED'];

/* JSON, or multipart with the JSON in `body` and a new `picture` file */
const readRequest = async (
    req: Request,
): Promise<{ body: unknown; picture: File | null } | null> => {
    const type = req.headers.get('content-type') ?? '';
    if (!type.startsWith('multipart/form-data')) {
        return { body: await readJson(req), picture: null };
    }
    try {
        const form = await req.formData();
        const body = form.get('body');
        const picture = form.get('picture');
        if (typeof body !== 'string') return null;
        if (picture !== null && !(picture instanceof File)) return null;
        return { body: JSON.parse(body), picture };
    } catch {
        return null;
    }
};

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const email = caller.authUser.email;

    const request = await readRequest(req);
    // deno-lint-ignore no-explicit-any
    const body = request?.body as any;
    const organizationId = body?.organization_id;
    const changes = body?.changes ?? {};
    const pictureFile = request?.picture ?? null;
    if (!isId(organizationId)) {
        return new Response('Invalid organization.', { status: 400 });
    }
    if (
        typeof changes !== 'object' || Array.isArray(changes) ||
        (!Object.keys(changes).length && !pictureFile)
    ) {
        return new Response('Nothing to save.', { status: 400 });
    }

    const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, name, url, state, faculty_email, picture')
        .eq('id', organizationId)
        .maybeSingle();
    if (orgError) {
        return new Response('Failed to fetch organization.', { status: 500 });
    }
    if (!organization) {
        return new Response('Organization not found.', { status: 404 });
    }

    const { data: leader, error: leaderError } = await supabaseAdmin
        .from('memberships')
        .select('id, users!inner(email)')
        .eq('organization_id', organizationId)
        .eq('users.email', email)
        .in('role', ['ADMIN', 'CREATOR'])
        .eq('active', true)
        .limit(1);
    if (leaderError) {
        return new Response('Failed to check your role.', { status: 500 });
    }
    if (!leader?.length && !(await isSiteAdmin(email))) {
        return new Response(
            "Only this Activity's leaders can edit its charter.",
            { status: 403 },
        );
    }

    const inReview = REVIEW_STATES.includes(organization.state);
    if (!inReview && !DIRECT_STATES.includes(organization.state)) {
        return new Response(
            'Charter changes for this Activity must be reviewed.',
            { status: 400 },
        );
    }

    const allowed = inReview ? EDITABLE_CHARTER_FIELDS : DIRECT_CHARTER_FIELDS;
    const reviewed = Object.keys(changes).filter((field) =>
        !allowed.includes(field)
    );
    if (pictureFile && !inReview) reviewed.push('picture');
    if (reviewed.length) {
        return new Response(
            inReview
                ? `${reviewed.join(', ')} can't be changed here.`
                : `Changes to ${reviewed.join(', ')} must be reviewed.`,
            { status: 400 },
        );
    }

    const fields = cleanCharter(changes);

    const problems = validateCharter(fields, false);
    /* a new picture comes as a file; the field itself can only remove it */
    if ('picture' in fields) {
        if (fields.picture !== null && fields.picture !== '') {
            problems.push('Upload the picture as a file.');
        } else {
            fields.picture = null;
        }
    }
    if ('fair' in fields && typeof fields.fair !== 'boolean') {
        problems.push('Club fair must be yes or no.');
    }
    if ('url' in fields) {
        if (typeof fields.url !== 'string' || !fields.url) {
            problems.push('URL is required.');
        } else if (RESERVED_PATHS.includes(fields.url)) {
            problems.push(
                'You may not register an Epsilon URL that is already in use.',
            );
        }
    }
    /* validateCharter checks the days themselves */
    if ('meeting_days' in fields) {
        const days = fields.meeting_days;
        if (days === null || (Array.isArray(days) && !days.length)) {
            problems.push(
                'Pick at least one meeting day from Monday to Friday.',
            );
        } else if (Array.isArray(days)) {
            fields.meeting_days = WEEKDAYS.filter((day) => days.includes(day));
        }
    }
    let picture: ClubPicture | null = null;
    if (pictureFile) {
        picture = await readClubPicture(pictureFile);
        if (!picture) problems.push(PICTURE_PROBLEM);
    }
    if (problems.length) {
        return new Response(problems.join(' '), { status: 400 });
    }

    /* the URL can't match another club's, or one waiting for approval */
    if (typeof fields.url === 'string' && fields.url !== organization.url) {
        const [{ data: taken }, { data: requested }] = await Promise.all([
            supabaseAdmin.from('organizations').select('id')
                .ilike('url', fields.url).neq('id', organizationId).limit(1),
            supabaseAdmin.from('organizationedits').select('id')
                .ilike('url', fields.url).neq('organization_id', organizationId)
                .limit(1),
        ]);
        if (taken?.length || requested?.length) {
            return new Response('This URL is already in use.', { status: 400 });
        }
    }
    if (typeof fields.name === 'string' && fields.name !== organization.name) {
        const { data: taken } = await supabaseAdmin.from('organizations')
            .select('id').ilike('name', fields.name).neq('id', organizationId)
            .limit(1);
        if (taken?.length) {
            return new Response('This name is already in use.', {
                status: 400,
            });
        }
    }

    let uploaded: { path: string; url: string } | null = null;
    if (picture) {
        uploaded = await uploadClubPicture(
            organizationId,
            fields.url ?? organization.url,
            picture,
        );
        if (!uploaded) {
            return new Response('Failed to upload the picture.', {
                status: 500,
            });
        }
        fields.picture = uploaded.url;
    }

    const { data: saved, error: updateError } = await supabaseAdmin
        .from('organizations')
        .update(fields)
        .eq('id', organizationId)
        .select('*')
        .single();
    if (updateError || !saved) {
        if (uploaded) {
            await supabaseAdmin.storage.from('public-files')
                .remove([uploaded.path]);
        }
        return new Response(
            updateError?.code === '23505'
                ? updateError.message.includes('name')
                    ? 'This name is already in use.'
                    : 'This URL is already in use.'
                : 'Failed to save changes.',
            { status: updateError ? dbErrorStatus(updateError) : 500 },
        );
    }

    if ('picture' in fields && organization.picture !== saved.picture) {
        await removeClubPicture(organizationId, organization.picture);
    }

    /* approval adds the advisor and clears requests for charters in review */
    if (inReview) {
        return new Response(JSON.stringify(saved), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (
        'faculty_email' in fields &&
        !sameEmail(fields.faculty_email, organization.faculty_email)
    ) {
        const { data: advisorResult, error: advisorError } = await supabaseAdmin
            .rpc('add_charter_advisor', {
                org_id: organizationId,
            });
        if (advisorError) {
            console.error('[UPDATE_CHARTER] advisor failed', advisorError);
        } else if (saved.faculty_email) {
            await emailNewAdvisor(
                organizationId,
                saved.faculty_email,
                advisorResult,
                (name) =>
                    `${name} updated its charter to name you as its faculty advisor.`,
            );
        }
    }

    /* a saved field replaces any older request to change it */
    const { data: pending } = await supabaseAdmin
        .from('organizationedits')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (pending) {
        const cleared = Object.fromEntries(
            Object.keys(fields).map((field) => [field, null]),
        );
        const left = EDITABLE_CHARTER_FIELDS.some((field) =>
            field !== 'fair' && !(field in cleared) &&
            pending[field] !== null && pending[field] !== undefined
        );
        const { error: editError } = left
            ? await supabaseAdmin.from('organizationedits').update(cleared)
                .eq('id', pending.id)
            : await supabaseAdmin.from('organizationedits').delete()
                .eq('id', pending.id);
        if (editError) {
            console.error(
                '[UPDATE_CHARTER] clearing request failed',
                editError,
            );
        }
    }

    return new Response(JSON.stringify(saved), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
