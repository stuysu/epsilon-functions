import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import { isId, readJson } from '../_shared/http.ts';
import { emailNewAdvisor } from '../_shared/advisorEmail.ts';

type BodyType = {
    organization_id: number;
    advisor_email: string;
};

const fail = (message: string, status: number) =>
    new Response(message, { status });

// Adds a faculty advisor for a club admin and emails the advisor. Returns the
// result of add_organization_advisor ('added', 'no_account', ...).
Deno.serve(withCors(async (req: Request) => {
    const body: BodyType | null = await readJson(req);
    if (!body) return fail('Invalid JSON body.', 400);

    const { organization_id, advisor_email } = body;
    if (
        !isId(organization_id) ||
        typeof advisor_email !== 'string' || !advisor_email.trim()
    ) {
        return fail('Missing field', 400);
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient, user: siteUser } = caller;

    // the function checks the caller is one of the club's admins
    const { data: result, error } = await supabaseClient.rpc(
        'add_organization_advisor',
        { org_id: organization_id, advisor_email },
    );
    if (error) {
        return error.message.includes('Only organization admins')
            ? fail('Only club admins can add advisors.', 403)
            : fail('Failed to add advisor.', 500);
    }

    if (result === 'added') {
        const adder = [siteUser.first_name, siteUser.last_name]
            .filter(Boolean)
            .join(' ');
        await emailNewAdvisor(
            organization_id,
            advisor_email,
            (name) =>
                `${
                    adder || 'A club leader'
                } added you as the faculty advisor of ${name}.`,
        );
    }

    return new Response(JSON.stringify({ result }), {
        headers: { 'Content-Type': 'application/json' },
    });
}));
