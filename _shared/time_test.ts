import { deepStrictEqual as eq } from 'node:assert/strict';
import {
    formatDay,
    formatNewYork,
    newYorkDate,
    newYorkMidnight,
    newYorkTimestamp,
    newYorkWeekday,
} from './time.ts';

Deno.test('newYorkDate and weekday use New York, not UTC', () => {
    const lateEvening = new Date('2026-11-04T03:30:00Z'); // 10:30 PM EST on the 3rd
    eq(newYorkDate(lateEvening), '2026-11-03');
    eq(newYorkWeekday(lateEvening), 'TUESDAY');
});

Deno.test('formatNewYork labels EST and EDT', () => {
    eq(formatNewYork('2026-11-03T20:30:00Z'), 'November 3, 2026, 3:30 PM EST');
    eq(formatNewYork('2026-07-01T16:00:00Z'), 'July 1, 2026, 12:00 PM EDT');
});

Deno.test('formatDay reads a calendar day', () => {
    eq(formatDay('2026-11-03'), 'November 3, 2026');
    eq(formatDay('2027-01-01'), 'January 1, 2027');
});

Deno.test('newYorkTimestamp gives wall time', () => {
    eq(
        newYorkTimestamp(new Date('2026-03-08T07:30:00Z')),
        '2026-03-08T03:30:00',
    );
    eq(
        newYorkTimestamp(new Date('2026-12-31T23:59:59Z')),
        '2026-12-31T18:59:59',
    );
});

Deno.test('newYorkMidnight across daylight saving changes', () => {
    eq(newYorkMidnight('2026-11-03'), '2026-11-03T05:00:00.000Z');
    eq(newYorkMidnight('2026-07-01'), '2026-07-01T04:00:00.000Z');
    eq(newYorkMidnight('2026-03-08'), '2026-03-08T05:00:00.000Z');
    eq(newYorkMidnight('2026-11-01'), '2026-11-01T04:00:00.000Z');
});
