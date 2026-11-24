import supabaseAdmin from './supabaseAdmin.ts';
import Transport from './emailTransport.ts';
import { footer, siteUrl } from './strings.ts';
import { emailDocument, emailLink, textToHtml } from './emailHtml.ts';

type Advisor = {
    users: { first_name: string | null; email: string };
};

// Lets a faculty member know a club now lists them as its advisor. `reason`
// gets the club's name and says how they were added. Never throws: a failed
// email shouldn't undo adding the advisor.
export const emailNewAdvisor = async (
    orgId: number,
    advisorEmail: string,
    reason: (orgName: string) => string,
) => {
    try {
        const [{ data: org }, { data: advisors }] = await Promise.all([
            supabaseAdmin
                .from('organizations')
                .select('name, url')
                .eq('id', orgId)
                .maybeSingle(),
            supabaseAdmin
                .from('memberships')
                .select('users!inner(first_name, email)')
                .eq('organization_id', orgId)
                .eq('role', 'ADVISOR')
                .returns<Advisor[]>(),
        ]);
        const wanted = advisorEmail.trim().toLowerCase();
        const advisor = advisors?.find((a) =>
            a.users.email.toLowerCase() === wanted
        )?.users;
        if (!org || !advisor) return;

        const subject = `${org.name}: You're now a faculty advisor | Epsilon`;
        const greeting = `Hi${
            advisor.first_name ? ` ${advisor.first_name}` : ''
        },`;
        const why = reason(org.name);
        const clubUrl = `${siteUrl()}/${org.url}`;
        const mistake =
            "If you aren't this club's advisor, email clubpub@stuysu.org and we'll take you off.";

        await Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to: advisor.email,
            subject,
            text: `${greeting}

${why} You can see the club on Epsilon at ${clubUrl}

${mistake}${footer}`,
            html: emailDocument(
                `${textToHtml(`${greeting}\n\n${why}`)}
<p style="margin:0 0 12px">${
                    emailLink(clubUrl, `View ${org.name} on Epsilon`)
                }</p>
${textToHtml(mistake + footer)}`,
                { title: subject, preview: why },
            ),
        });
    } catch (error) {
        console.error('[emailNewAdvisor] failed', error);
    }
};
