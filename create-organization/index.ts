import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    cleanCharter,
    RESERVED_PATHS,
    validateCharter,
} from '../_shared/charter.ts';
import { dbErrorStatus, readJson } from '../_shared/http.ts';
import { IT_EMAIL } from '../_shared/strings.ts';
import { formatNewYork } from '../_shared/time.ts';
import {
    type ClubPicture,
    PICTURE_PROBLEM,
    readClubPicture,
    uploadClubPicture,
} from '../_shared/picture.ts';

type BodyType = {
    name: string;
    url: string;
    socials: string;
    mission: string;
    goals: string;
    purpose: string;
    keywords: string;
    tags: string[];
    appointment_procedures: string;
    uniqueness: string;
    meeting_description: string;
    meeting_schedule: string;
    meeting_days: string[];
    commitment_level: string;
    join_instructions: string;
    is_returning: boolean;
    returning_info: string;
    fair?: boolean;
    faculty_email?: string;
};

/* the charter as JSON, or multipart with the charter as JSON in `charter`
   and an optional `picture` file */
const readRequest = async (
    req: Request,
): Promise<{ fields: unknown; picture: File | null } | null> => {
    const type = req.headers.get('content-type') ?? '';
    if (!type.startsWith('multipart/form-data')) {
        return { fields: await readJson(req), picture: null };
    }
    try {
        const form = await req.formData();
        const charter = form.get('charter');
        const picture = form.get('picture');
        if (typeof charter !== 'string') return null;
        if (picture !== null && !(picture instanceof File)) return null;
        return { fields: JSON.parse(charter), picture };
    } catch {
        return null;
    }
};

Deno.serve(withCors(async (req: Request) => {
    type styp = {
        setting_value: number;
    };
    const { data } = await supabaseAdmin.from('settings')
        .select(`
                setting_value
            `).eq('name', 'charter_deadline')
        .single()
        .returns<styp>();
    if (data?.setting_value) {
        // setting_value is a unix timestamp in seconds (like valentines_deadline)
        const deadline = new Date(data.setting_value * 1000);
        if (new Date() > deadline) {
            return new Response(
                `Chartering for this year has been disabled as of ${
                    formatNewYork(deadline)
                }.`,
                { status: 403 },
            );
        }
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, user: siteUser } = caller;

    const request = await readRequest(req);
    const bodyJson = request?.fields;
    if (
        !bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson)
    ) {
        return new Response('Invalid request body.', { status: 400 });
    }
    const body: BodyType = cleanCharter(bodyJson as BodyType);

    const problems = validateCharter(body, true);
    if (problems.length) {
        return new Response(problems.join(' '), { status: 400 });
    }

    if (RESERVED_PATHS.includes(body.url.toLowerCase())) {
        return new Response(
            'You may not register an Epsilon URL that is already in use.',
            { status: 400 },
        );
    }

    let picture: ClubPicture | null = null;
    if (request?.picture) {
        picture = await readClubPicture(request.picture);
        if (!picture) return new Response(PICTURE_PROBLEM, { status: 400 });
    }

    const { data: orgData, error: orgCreateError } = await supabaseClient.from(
        'organizations',
    )
        .insert({
            name: body.name,
            url: body.url,
            socials: body.socials,
            mission: body.mission,
            goals: body.goals,
            purpose: body.purpose,
            keywords: body.keywords,
            tags: body.tags,
            appointment_procedures: body.appointment_procedures,
            uniqueness: body.uniqueness,
            meeting_description: body.meeting_description,
            meeting_schedule: body.meeting_schedule,
            meeting_days: body.meeting_days,
            commitment_level: body.commitment_level,
            join_instructions: body.join_instructions,
            is_returning: body.is_returning,
            returning_info: body.returning_info,
            fair: body.fair,
            faculty_email: body.faculty_email,
        })
        .select(`
            id
        `);

    if (orgCreateError?.code === '23505') {
        const field = /name/.test(orgCreateError.message) ? 'name' : 'URL';
        return new Response(
            `This ${field} is already in use. Go back and choose another.`,
            { status: 409 },
        );
    }
    if (orgCreateError || !orgData || !orgData.length) {
        console.error('[create-organization] insert failed', orgCreateError);
        return new Response(
            `Error creating organization. Contact ${IT_EMAIL}.`,
            { status: orgCreateError ? dbErrorStatus(orgCreateError) : 500 },
        );
    }
    const orgId: number = orgData[0].id;

    /* don't leave a club behind holding its name and URL */
    const undo = async () => {
        const { error } = await supabaseAdmin.from('organizations')
            .delete()
            .eq('id', orgId);
        if (error) console.error('[create-organization] undo failed', error);
    };

    /* CREATE CREATOR MEMBERSHIP FOR USER */
    const { error: membershipError } = await supabaseAdmin.from('memberships')
        .insert({
            organization_id: orgId,
            user_id: siteUser.id,
            role: 'CREATOR',
            active: true,
        });

    if (membershipError) {
        console.error(
            '[create-organization] membership failed',
            membershipError,
        );
        await undo();
        return new Response(
            `Error creating membership. Please contact ${IT_EMAIL} as soon as possible.`,
            { status: 500 },
        );
    }

    if (picture) {
        const uploaded = await uploadClubPicture(orgId, body.url, picture);
        const { error: pictureError } = uploaded
            ? await supabaseAdmin.from('organizations')
                .update({ picture: uploaded.url })
                .eq('id', orgId)
            : { error: null };
        if (!uploaded || pictureError) {
            if (pictureError) {
                console.error(
                    '[create-organization] picture failed',
                    pictureError,
                );
                await supabaseAdmin.storage.from('public-files')
                    .remove([uploaded!.path]);
            }
            await undo();
            return new Response(
                `Error uploading the picture. Try again, or contact ${IT_EMAIL}.`,
                { status: 500 },
            );
        }
    }

    // success!
    return new Response(
        JSON.stringify({
            id: orgId,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
