import { sendOrgEmail } from '../_shared/utils.ts';
import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { footer, siteUrl } from '../_shared/strings.ts';
import { logAdminAction } from '../_shared/adminLog.ts';
import {
    dbErrorStatus,
    isId,
    LIMITS,
    readJson,
    textProblem,
} from '../_shared/http.ts';

type BodyType = {
    organization_id: number;
    reason: string;
};

Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        organization_id,
        reason,
    }: BodyType = bodyJson;

    if (!organization_id || !reason) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(organization_id)) {
        return new Response('Invalid organization.', { status: 400 });
    }
    const reasonError = textProblem(reason, 'Reason', LIMITS.strikeReason);
    if (reasonError) return new Response(reasonError, { status: 400 });

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, user: siteUser } = caller;

    /* hand out strike */
    type styp = {
        id: number;
        reason: string;
        users: {
            first_name: string;
            last_name: string;
            picture: string;
        };
        organizations: {
            name: string;
            url: string;
        };
    };

    const { data: strikeData, error: strikeError } = await supabaseClient.from(
        'strikes',
    )
        .insert({
            organization_id,
            admin_id: siteUser.id,
            reason,
        })
        .select(`
            id,
            reason,
            users!inner(
                first_name,
                last_name,
                picture
            ),
            organizations!inner (
                name,
                url
            )
        `)
        .returns<styp[]>();

    if (strikeError) {
        return new Response('Failed to issue strike.', {
            status: dbErrorStatus(strikeError),
        });
    }

    await logAdminAction(siteUser, {
        action: 'issue_strike',
        targetType: 'organization',
        targetId: organization_id,
        details: { organization: strikeData[0].organizations.name, reason },
    });

    const emailBody =
        `You are receiving this message because you are an admin of {ORG_NAME}.
        
This email is to let you know that your organization has be given a strike for the following reason:
${reason}

You can view this strike at ${siteUrl()}/${
            strikeData[0].organizations.url
        }/audit

If you would like to dispute this strike, please contact clubpub@stuysu.org.
` + footer;
    const emailSubject = `{ORG_NAME}: Strike Received | Epsilon`;

    if (
        !await sendOrgEmail(
            organization_id,
            emailSubject,
            emailBody,
            false,
            true,
        )
    ) {
        console.error(`[issue-strike] email failed for org ${organization_id}`);
    }

    return new Response(
        JSON.stringify({
            id: strikeData[0].id,
            reason,
            users: {
                first_name: strikeData[0].users.first_name,
                last_name: strikeData[0].users.last_name,
                picture: strikeData[0].users.picture,
            },
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
