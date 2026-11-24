import { footer } from './strings.ts';
import { formatNewYork } from './time.ts';
import { SEND_CONCURRENCY, sendOrgEmail } from './utils.ts';
import { pooledTransport } from './emailTransport.ts';

export type CancelledMeeting = {
    organization_id: number;
    title: string;
    start_time: string;
    room_name?: string | null;
};

/*
 * Tells each club which of its meetings were cancelled and why. `cause`
 * finishes "...have been cancelled by administrators ". All clubs are
 * emailed at once so a slow mail server can't time out the later ones.
 * Returns the clubs that couldn't be emailed.
 */
export const emailCancelledMeetings = async (
    meetings: CancelledMeeting[],
    cause: (orgMeetings: CancelledMeeting[]) => string,
    { withRoom = false } = {},
): Promise<number[]> => {
    const byOrg = new Map<number, CancelledMeeting[]>();
    for (const meeting of meetings) {
        const list = byOrg.get(meeting.organization_id) ?? [];
        list.push(meeting);
        byOrg.set(meeting.organization_id, list);
    }

    const orgIds = [...byOrg.keys()];
    if (!orgIds.length) return [];
    /* one pool for every club's email */
    const transport = pooledTransport(SEND_CONCURRENCY);
    const sent = await Promise.allSettled(orgIds.map((orgId) => {
        const orgMeetings = byOrg.get(orgId)!;
        const list = orgMeetings.map((meeting) =>
            withRoom && meeting.room_name
                ? `${meeting.title} in room ${meeting.room_name} on ${
                    formatNewYork(meeting.start_time)
                }`
                : `${meeting.title} at ${formatNewYork(meeting.start_time)}`
        ).join('\n');
        return sendOrgEmail(
            orgId,
            `{ORG_NAME}: Meeting(s) Cancelled | Epsilon`,
            `Dear {ORG_NAME} member,

This email is to let you know that the following meeting(s) of {ORG_NAME} have been cancelled by administrators ${
                cause(orgMeetings)
            }:

${list}

We sincerely apologize for the inconvenience.` + footer,
            false,
            false,
            false,
            transport,
        );
    }));
    transport.close();

    const unemailed = orgIds.filter((_, i) => {
        const result = sent[i];
        return result.status === 'rejected' || !result.value;
    });
    if (unemailed.length) {
        console.error('Failed to email organizations', unemailed);
    }
    return unemailed;
};

type MeetingDetails = {
    title: string;
    description: string;
    start_time: string;
    end_time: string;
    advisor?: string | null;
    rooms?: { name: string } | null;
};

/* the details email for a scheduled, updated or cancelled meeting */
export const meetingEmailText = (news: string, meeting: MeetingDetails) =>
    `You are receiving this email because you are a member of {ORG_NAME}.
${news}
Title: ${meeting.title}
Description: ${meeting.description}
Start Date: ${formatNewYork(meeting.start_time)}
End Date: ${formatNewYork(meeting.end_time)}
Room: ${meeting.rooms?.name || 'Virtual'}
Advisor: ${meeting.advisor || 'None'}` + footer;
