import { withCors } from '../_shared/cors.ts';
import { fetchAllRows } from '../_shared/rows.ts';
import { getCaller } from '../_shared/auth.ts';
import Transport from '../_shared/emailTransport.ts';
import { escapeHtml, footer, siteUrl } from '../_shared/strings.ts';
import {
    dbErrorStatus,
    isId,
    LIMITS,
    readJson,
    textProblem,
} from '../_shared/http.ts';
import { markdownToText } from '../_shared/markdown.ts';
import {
    emailDocument,
    emailLink,
    markdownToHtml,
    textToHtml,
} from '../_shared/emailHtml.ts';

type BodyType = {
    organization_id: number;
    content: string;
};

/* accepts JSON */
Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        organization_id,
        content,
    }: BodyType = bodyJson;

    if (!organization_id || !content) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(organization_id)) {
        return new Response('Invalid organization.', { status: 400 });
    }
    const contentError = textProblem(content, 'Message', LIMITS.orgMessage);
    if (contentError) return new Response(contentError, { status: 400 });

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, user: siteUser } = caller;

    /* create org message */
    type orgTyp = {
        id: number;
        organizations: {
            name: string;
            url: string;
        };
    };
    const { data: orgData, error: createError } = await supabaseClient.from(
        'orgmessages',
    )
        .insert({
            organization_id: organization_id,
            user_id: siteUser.id,
            content: content,
        })
        .select(`
            id,
            organizations!inner (
                name,
                url
            )
        `)
        .returns<orgTyp[]>();

    if (createError || !orgData || !orgData.length) {
        return new Response('Error creating organization message.', {
            status: dbErrorStatus(createError),
        });
    }

    const orgName = orgData[0].organizations.name;
    const orgUrl = orgData[0].organizations.url;

    type orgAdminType = {
        id: number;
        role: 'ADMIN' | 'CREATOR';
        users: {
            id: number;
            first_name: string;
            email: string;
        };
    };

    /* email admins of organization except for current user */
    const { data: orgAdmins, error: orgAdminError } = await fetchAllRows((
        from,
        to,
    ) => supabaseClient.from('memberships')
        .select(`
                id,
                role,
                users!inner (
                    id,
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

    /* the message is saved either way, so a retry would only duplicate it */
    if (orgAdminError || !orgAdmins.length) {
        console.error(
            `[create-organization-message] org=${organization_id} no leaders to email`,
            orgAdminError?.code ?? '',
        );
    }

    const sender = `${siteUser.first_name} ${siteUser.last_name}`;
    const messageUrl = `${siteUrl()}/${orgUrl}/admin/messages`;
    const messageHtml = markdownToHtml(content);
    const messageText = markdownToText(content);
    const subject = `${orgName}: New Administrator Message | Epsilon`;

    const recipients = orgAdmins.filter((admin) =>
        admin.users.id !== siteUser.id
    );
    const sent = await Promise.allSettled(recipients.map((admin) => {
        const greeting = `Hi ${admin.users.first_name}!

There is a new message for ${orgName}.`;

        const emailBody = `${greeting}

${sender}: ${messageText}

You can view this message at ${messageUrl}${footer}`;
        const emailHtml = emailDocument(
            `${textToHtml(greeting)}
<p style="margin:0 0 4px;font-weight:700">${escapeHtml(sender)}:</p>
<div style="margin:0 0 12px;padding:8px 12px 0;border-left:3px solid #d0d0d0">${messageHtml}</div>
<p style="margin:0 0 12px">${
                emailLink(messageUrl, 'View the message on Epsilon')
            }</p>
${textToHtml(footer)}`,
            { title: subject, preview: `${sender}: ${messageText}` },
        );

        return Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: admin.users.email,
            subject,
            text: emailBody,
            html: emailHtml,
        });
    }));
    const failed = sent.filter((result) => result.status === 'rejected');
    if (failed.length) {
        console.error(
            `[create-organization-message] ${failed.length} of ${sent.length} emails failed`,
            (failed[0] as PromiseRejectedResult).reason?.message,
        );
    }

    // success!
    return new Response(
        JSON.stringify({
            success: true,
            id: orgData[0].id,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
