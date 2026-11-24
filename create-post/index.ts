import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { isApprovedClub, isSiteAdmin, sendOrgEmail } from '../_shared/utils.ts';
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
    emailTitle,
    markdownToHtml,
} from '../_shared/emailHtml.ts';

type BodyType = {
    organization_id: number;
    title: string;
    description: string;
};

Deno.serve(withCors(async (req: Request) => {
    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, authUser: user } = caller;

    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }
    const body: BodyType = {
        organization_id: bodyJson.organization_id,
        title: bodyJson.title,
        description: bodyJson.description,
    };

    if (!body.organization_id || !body.title || !body.description) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(body.organization_id)) {
        return new Response('Invalid organization.', { status: 400 });
    }
    const textError = textProblem(body.title, 'Post title', LIMITS.postTitle) ??
        textProblem(
            body.description,
            'Post description',
            LIMITS.postDescription,
        );
    if (textError) return new Response(textError, { status: 400 });

    /* RLS refuses these too; this says why */
    const approved = await isApprovedClub(body.organization_id);
    if (approved === null) {
        return new Response('Failed to check the Activity.', { status: 500 });
    }
    if (!approved && !(await isSiteAdmin(user.email))) {
        return new Response('Only approved Activities can post.', {
            status: 403,
        });
    }

    /* create post */
    const { data: postData, error: postError } = await supabaseClient.from(
        'posts',
    )
        .insert(body)
        .select();

    if (postError || !postData || !postData.length) {
        return new Response('Error creating post.', {
            status: dbErrorStatus(postError),
        });
    }

    /* email all members of organization */

    if (bodyJson.silent !== true) {
        const description = markdownToText(body.description);
        const emailText = `${body.title}\n\n${description}`;
        const emailSubject = `${body.title} | {ORG_NAME}`;
        const emailHtml = emailDocument(
            emailTitle(body.title) +
                markdownToHtml(body.description, body.title),
            { title: emailSubject, preview: description },
        );
        const sent = await sendOrgEmail(body.organization_id, emailSubject, {
            text: emailText,
            html: emailHtml,
        });
        if (!sent) {
            console.error(
                `[create-post] email failed for post ${postData[0].id}`,
            );
        }
    }

    return new Response(
        JSON.stringify({
            ...postData[0],
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
