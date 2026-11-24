import { withCors } from '../_shared/cors.ts';
import { getCaller } from '../_shared/auth.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';
import {
    sendMemberEmail,
    unlockOrganizationIfReady,
} from '../_shared/utils.ts';
import { footer } from '../_shared/strings.ts';
import { isId, readJson } from '../_shared/http.ts';

type BodyType = {
    member_id: number;
};

Deno.serve(withCors(async (req: Request) => {
    const bodyJson = await readJson(req);
    if (!bodyJson) {
        return new Response('Invalid JSON body.', { status: 400 });
    }

    const {
        member_id,
    }: BodyType = bodyJson;

    if (!member_id) {
        return new Response('Missing field', { status: 400 });
    }
    if (!isId(member_id)) {
        return new Response('Invalid member.', { status: 400 });
    }

    const caller = await getCaller(req);
    if (caller instanceof Response) return caller;
    const { client: supabaseClient } = caller;

    /* RLS takes care of any permissions */

    /* update member */
    type omtyp = {
        organizations: {
            id: number;
            name: string;
        };
    };
    const { data: memberData, error: updateMemberError } = await supabaseClient
        .from('memberships')
        .update({ active: true })
        .eq('id', member_id)
        .select(`
                organizations!inner (
                    id,
                    name
                )
            `)
        .returns<omtyp[]>();

    if (updateMemberError) {
        return new Response('Error updating member.', { status: 422 }); // unprocessable entity
    }

    /* nothing updated: either there's no such membership, or RLS hid it
       because the caller isn't an active admin of that club */
    if (!memberData || !memberData.length) {
        const { data: existing } = await supabaseAdmin
            .from('memberships')
            .select('id')
            .eq('id', member_id)
            .maybeSingle();
        return existing
            ? new Response('You are not allowed to approve this member.', {
                status: 403,
            })
            : new Response('Membership not found.', { status: 404 });
    }

    /* if success, then send email to member */

    /* email member */

    const emailBody = `Hi {FIRST_NAME}!
            
Congrats! You are now a member of {ORG_NAME}.

We hope you enjoy your club experience at Stuy.` + footer;

    const emailSubject = `Membership Approved: {ORG_NAME} | Epsilon`;

    if (!await sendMemberEmail(member_id, emailSubject, emailBody)) {
        console.error(
            `[approve-member] email failed for membership ${member_id}`,
        );
    }

    /* ALSO CHECK IF CLUB IS PENDING AND SHOULD IT BE UNLOCKED */
    await unlockOrganizationIfReady(memberData[0].organizations.id);

    return new Response(
        JSON.stringify({
            success: true,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
}));
