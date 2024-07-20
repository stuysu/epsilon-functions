import { google } from 'npm:googleapis';
import auth from './oAuth2.ts';
import supabaseAdmin from '../supabaseAdmin.ts';

const CalendarApi = google.calendar({ version: 'v3' });

export const initOrgCalendar = async (orgId: number) => {
    const { data: orgData, error: orgFetchError } = await supabaseAdmin.from(
        'organizations',
    )
        .select(`*`)
        .eq('id', orgId)
        .limit(1)
        .single();

    if (orgFetchError || !orgData) {
        throw new Error('Failed to fetch organization data');
    }

    if (orgData.state === 'PENDING') {
        throw new Error('Organization is pending approval');
    }

    /* check if calendar exists */
    const { data: calendarData } = await supabaseAdmin.from('googlecalendars')
        .select(`*`)
        .eq('org_url', orgData.url)
        .limit(1)
        .single();

    if (calendarData) {
        return calendarData.id;
    }

    /* if it doesn't exist, create it, add it to database, and share with all members in organization */
    const calData = {
        summary: orgData.name,
        timeZone: 'America/New_York',
    };

    const response = await CalendarApi.calendars.insert({
        requestBody: calData,
        auth,
    }) as any;

    const { error: insertError } = await supabaseAdmin.from('googlecalendars')
        .insert({
            org_url: orgData.url,
            calendar_id: response.data.id,
        });

    if (insertError) {
        throw new Error('Failed to insert calendar into database');
    }

    /* share with members */
    supabaseAdmin.from('memberships')
        .select(`
            id,
            users!inner (
                email
            )    
        `)
        .eq('organization_id', orgId)
        .returns<{ id: number; users: { email: string } }[]>()
        .then((resp) => {
            const { data: orgMembers, error: orgMemberError } = resp;

            if (orgMemberError || !orgMembers || !orgMembers.length) {
                console.log('Failed to add organization members to calendar.');
                return;
            }

            // add members here
            orgMembers.map((member) =>
                shareCalendar(response.data.id, member.users.email)
            );
        });

    return response.data.id;
};

export async function shareCalendar(calendarId: string, email: string) {
    const rule = {
        role: 'reader',
        scope: {
            type: 'user',
            value: email,
        },
    };

    let response;

    try {
        response = await CalendarApi.acl.insert({
            calendarId,
            requestBody: rule,
            auth,
        });

        console.log('Calendar shared:', response);
    } catch (error) {
        console.error('Error sharing calendar: ', error);
    }

    return response;
}

export async function removeCalendarAccess(calendarId: string, email: string) {
    await CalendarApi.acl.delete({
        calendarId,
        ruleId: `user:${email}`,
        auth,
    });
}

export async function createCalendarEvent(
    calendarId: string,
    event: {
        name: string;
        description: string;
        start: string;
        end: string;
        location: string;
        source: { title: string; url: string };
    },
) {
    const response = await CalendarApi.events.insert({
        calendarId,
        sendUpdates: 'all',
        conferenceDataVersion: 0,
        requestBody: {
            end: {
                dateTime: event.end,
                timeZone: 'America/New_York',
            },
            start: {
                dateTime: event.start,
                timeZone: 'America/New_York',
            },
            summary: name,
            reminders: {
                useDefault: true,
            },
            description: event.description,
            source: {
                title: event.source.title,
                url: event.source.url,
            },
            location: event.location,
            attendees: [
                {
                    email: calendarId,
                    resource: true,
                },
            ],
        },
        auth,
    });

    return response;
}

export async function updateCalendarEvent(
    calendarId: string,
    eventId: string,
    event: {
        name: string;
        description: string;
        start: string;
        end: string;
        location: string;
        source: { title: string; url: string };
    },
) {
    const response = await CalendarApi.events.update({
        calendarId,
        eventId,
        sendUpdates: 'all',
        conferenceDataVersion: 0,
        requestBody: {
            end: {
                dateTime: event.end,
                timeZone: 'America/New_York',
            },
            start: {
                dateTime: event.start,
                timeZone: 'America/New_York',
            },
            summary: name,
            reminders: {
                useDefault: true,
            },
            description: event.description,
            source: {
                title: event.source.title,
                url: event.source.url,
            },
            location: event.location,
            attendees: [
                {
                    email: calendarId,
                    resource: true,
                },
            ],
        },
        auth,
    });

    return response;
}

export async function deleteCalendarEvent(calendarId: string, eventId: string) {
    await CalendarApi.events.delete({
        calendarId,
        eventId,
        sendUpdates: 'all',
        auth,
    });
}
