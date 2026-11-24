import supabaseAdmin from './supabaseAdmin.ts';
import Transport from './emailTransport.ts';
import { footer, siteUrl } from './strings.ts';
import { emailDocument, emailLink, textToHtml } from './emailHtml.ts';

type Advisor = {
    users: { first_name: string | null; email: string };
};

/* ASCII only; kept in sync with add_organization_advisor (058) */
const EMAIL =
    /^[a-z0-9._%+!#$&*\/=?^{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/* a different address, not just different case or spacing */
export const sameEmail = (a: unknown, b: unknown) =>
    typeof a === 'string' && typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase();

// Emails a faculty member a club named as its advisor. `result` is what the
// database returned: 'added' says they're listed now; 'no_account' (charter)
// and 'invited' (roster) say they'll be listed once their faculty account is
// set up, which adds them automatically (058). Other results send nothing.
// Those go to any address, so claim_advisor_invite_email limits them.
// Returns whether they've been emailed (now or in the last 30 days). Never
// throws: a failed email shouldn't undo the change.
export const emailNewAdvisor = async (
    orgId: number,
    advisorEmail: string,
    result: unknown,
    reason: (orgName: string) => string,
): Promise<boolean> => {
    if (result !== 'added' && result !== 'no_account' && result !== 'invited') {
        return false;
    }
    try {
        const wanted = advisorEmail.trim().toLowerCase();
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
        if (!org) return false;

        const site = siteUrl();
        let to: string, name: string | null, next: string, link: string;
        if (result === 'added') {
            const advisor = advisors?.find((a) =>
                a.users.email.toLowerCase() === wanted.toLowerCase()
            )?.users;
            if (!advisor) return false;
            to = advisor.email;
            name = advisor.first_name;
            link = emailLink(
                `${site}/${org.url}`,
                `View ${org.name} on Epsilon`,
            );
            next = `You can see the club on Epsilon at ${site}/${org.url}`;
        } else {
            if (!EMAIL.test(wanted)) return false;
            const { data: claim, error } = await supabaseAdmin.rpc(
                'claim_advisor_invite_email',
                { org_id: orgId, invitee: wanted },
            );
            if (error) throw error;
            if (claim !== 'send') return claim === 'recent';
            to = wanted;
            name = null;
            link = emailLink(site, 'Open Epsilon');
            next =
                `You'll be listed as its advisor as soon as your Epsilon account is set up. If you can't sign in to Epsilon at ${site} with your school Google account, email clubpub@stuysu.org and we'll set it up.`;
        }

        const subject = result === 'added'
            ? `${org.name}: You're now a faculty advisor | Epsilon`
            : `${org.name}: You've been named its faculty advisor | Epsilon`;
        const greeting = `Hi${name ? ` ${name}` : ''},`;
        const why = reason(org.name);
        const mistake = result === 'added'
            ? "If you aren't this club's advisor, email clubpub@stuysu.org and we'll take you off."
            : "If you aren't this club's advisor, you can ignore this email or let clubpub@stuysu.org know.";

        await Transport.sendMail({
            from: Deno.env.get('NODEMAILER_FROM')!,
            to,
            subject,
            text: `${greeting}

${why} ${next}

${mistake}${footer}`,
            html: emailDocument(
                `${
                    textToHtml(
                        `${greeting}\n\n${why}${
                            result === 'added' ? '' : ` ${next}`
                        }`,
                    )
                }
<p style="margin:0 0 12px">${link}</p>
${textToHtml(mistake + footer)}`,
                { title: subject, preview: why },
            ),
        });
        return true;
    } catch (error) {
        console.error('[emailNewAdvisor] failed', error);
        return false;
    }
};
