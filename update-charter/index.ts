import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isSiteAdmin } from '../_shared/utils.ts';
import corsHeaders, { withCors } from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import { emailNewAdvisor } from '../_shared/advisorEmail.ts';
import {
    cleanCharter,
    DIRECT_CHARTER_FIELDS,
    EDITABLE_CHARTER_FIELDS,
    RESERVED_PATHS,
    validateCharter,
} from '../_shared/charter.ts';
import { dbErrorStatus, readJson } from '../_shared/http.ts';

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

/* clubs in these states can save some charter fields without review */
const DIRECT_STATES = ['UNLOCKED', 'ADMIN'];

Deno.serve(withCors(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    const jwt = authHeader?.split(' ')[1];
    if (!authHeader || !jwt) {
        return new Response('Not signed in.', { status: 401 });
    }
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const email = userData?.user?.email;
    if (!email) {
        return new Response('Not signed in.', { status: 401 });
    }

    const body = await readJson(req);
    const organizationId = body?.organization_id;
    const changes = body?.changes;
    if (!Number.isInteger(organizationId)) {
        return new Response('Invalid organization.', { status: 400 });
    }
    if (
        !changes || typeof changes !== 'object' || Array.isArray(changes) ||
        !Object.keys(changes).length
    ) {
        return new Response('Nothing to save.', { status: 400 });
    }

    const reviewed = Object.keys(changes).filter((field) =>
        !DIRECT_CHARTER_FIELDS.includes(field)
    );
    if (reviewed.length) {
        return new Response(
            `Changes to ${reviewed.join(', ')} must be reviewed.`,
            { status: 400 },
        );
    }

    const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, url, state, faculty_email')
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

    if (!DIRECT_STATES.includes(organization.state)) {
        return new Response(
            'Charter changes for this Activity must be reviewed.',
            { status: 400 },
        );
    }

    const fields = cleanCharter(changes);

    const problems = validateCharter(fields, false);
    if ('url' in fields) {
        if (typeof fields.url !== 'string' || !fields.url) {
            problems.push('URL is required.');
        } else if (RESERVED_PATHS.includes(fields.url)) {
            problems.push(
                'You may not register an Epsilon URL that is already in use.',
            );
        }
    }
    if ('meeting_days' in fields) {
        const days = fields.meeting_days;
        if (
            !Array.isArray(days) || !days.length ||
            !days.every((day: unknown) =>
                typeof day === 'string' && WEEKDAYS.includes(day)
            )
        ) {
            problems.push(
                'Pick at least one meeting day from Monday to Friday.',
            );
        } else {
            fields.meeting_days = WEEKDAYS.filter((day) => days.includes(day));
        }
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

    const { data: saved, error: updateError } = await supabaseAdmin
        .from('organizations')
        .update(fields)
        .eq('id', organizationId)
        .select('*')
        .single();
    if (updateError || !saved) {
        return new Response(
            updateError?.code === '23505'
                ? 'This URL is already in use.'
                : 'Failed to save changes.',
            { status: updateError ? dbErrorStatus(updateError) : 500 },
        );
    }

    if (
        'faculty_email' in fields &&
        fields.faculty_email !== organization.faculty_email
    ) {
        const { data: advisorResult, error: advisorError } = await supabaseAdmin
            .rpc('add_charter_advisor', {
                org_id: organizationId,
            });
        if (advisorError) {
            console.error('[UPDATE_CHARTER] advisor failed', advisorError);
        } else if (advisorResult === 'added' && saved.faculty_email) {
            await emailNewAdvisor(
                organizationId,
                saved.faculty_email,
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
