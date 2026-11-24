// Dates and times as people in New York see them, whatever the server's zone.
const ZONE = 'America/New_York';

const parts = (value: Date, options: Intl.DateTimeFormatOptions) =>
    Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: ZONE, ...options })
            .formatToParts(value)
            .map((part) => [part.type, part.value]),
    );

/* YYYY-MM-DD */
export const newYorkDate = (value: Date) => {
    const p = parts(value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return `${p.year}-${p.month}-${p.day}`;
};

/* MONDAY, TUESDAY, ... */
export const newYorkWeekday = (value: Date) =>
    parts(value, { weekday: 'long' }).weekday.toUpperCase();

/* "November 3, 2026, 3:30 PM EST" (EDT in summer) */
export const formatNewYork = (value: string | Date) => {
    const p = parts(new Date(value), {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });
    return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
};

/* "November 3, 2026" for a YYYY-MM-DD day */
export const formatDay = (day: string) =>
    new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(new Date(`${day}T12:00:00Z`));

/* local New York wall time, YYYY-MM-DDTHH:mm:ss (for timestamp columns
   without a zone) */
export const newYorkTimestamp = (value: Date) => {
    const p = parts(value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

/* midnight in New York on a YYYY-MM-DD day, as an ISO instant */
export const newYorkMidnight = (day: string) => {
    // New York is 4 or 5 hours behind UTC, and clocks never change at midnight
    for (const hours of [4, 5]) {
        const candidate = new Date(`${day}T0${hours}:00:00Z`);
        if (newYorkTimestamp(candidate) === `${day}T00:00:00`) {
            return candidate.toISOString();
        }
    }
    return new Date(`${day}T05:00:00Z`).toISOString();
};
