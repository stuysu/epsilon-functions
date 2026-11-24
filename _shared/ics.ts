// iCalendar (RFC 5545) feeds. Times are UTC, so no VTIMEZONE is needed.

export type IcsEvent = {
    uid: string;
    start: string | Date;
    end: string | Date;
    summary: string;
    description?: string | null;
    location?: string | null;
    url?: string | null;
    updated?: string | Date | null;
};

const encoder = new TextEncoder();

/* TEXT values: backslash, semicolon, comma and newlines are escaped */
export const icsEscape = (text: string) =>
    text
        // deno-lint-ignore no-control-regex
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');

/* 20261103T203000Z */
export const icsDate = (value: string | Date) =>
    new Date(value).toISOString().replace(/[-:]/g, '').replace(
        /\.\d{3}/,
        '',
    );

/* lines longer than 75 bytes continue on the next line after a space,
   without splitting a character */
export const foldLine = (line: string) => {
    if (encoder.encode(line).length <= 75) return line;
    const out: string[] = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
        const size = encoder.encode(ch).length;
        const limit = out.length ? 74 : 75; // continuation lines start with a space
        if (bytes + size > limit) {
            out.push(current);
            current = '';
            bytes = 0;
        }
        current += ch;
        bytes += size;
    }
    out.push(current);
    return out.join('\r\n ');
};

export const buildCalendar = (
    { name, description, events, now = new Date() }: {
        name: string;
        description?: string;
        events: IcsEvent[];
        now?: Date;
    },
): string => {
    const stamp = icsDate(now);
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Epsilon//Club meetings//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${icsEscape(name)}`,
        ...(description ? [`X-WR-CALDESC:${icsEscape(description)}`] : []),
        'X-WR-TIMEZONE:America/New_York',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
    ];
    for (const event of events) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${icsEscape(event.uid)}`,
            `DTSTAMP:${stamp}`,
            `DTSTART:${icsDate(event.start)}`,
            `DTEND:${icsDate(event.end)}`,
            `SUMMARY:${icsEscape(event.summary)}`,
        );
        if (event.description) {
            lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
        }
        if (event.location) {
            lines.push(`LOCATION:${icsEscape(event.location)}`);
        }
        if (event.url) lines.push(`URL:${event.url.replace(/[\r\n]/g, '')}`);
        if (event.updated) {
            lines.push(`LAST-MODIFIED:${icsDate(event.updated)}`);
        }
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
};
