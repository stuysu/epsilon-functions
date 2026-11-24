import { deepStrictEqual as eq, ok } from 'node:assert/strict';
import { buildCalendar, foldLine, icsDate, icsEscape } from './ics.ts';

const bytes = (s: string) => new TextEncoder().encode(s).length;

Deno.test('icsEscape', () => {
    eq(icsEscape('a,b;c\\d\ne\r\nf'), 'a\\,b\\;c\\\\d\\ne\\nf');
    eq(icsEscape('bell\x07 gone'), 'bell gone');
});

Deno.test('icsDate is UTC', () => {
    eq(icsDate('2026-11-03T15:30:00-05:00'), '20261103T203000Z');
    eq(icsDate(new Date('2026-07-01T16:00:00.123Z')), '20260701T160000Z');
});

Deno.test('foldLine keeps lines to 75 bytes without splitting characters', () => {
    eq(foldLine('short'), 'short');
    const line = 'DESCRIPTION:' + 'é😀'.repeat(40);
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    ok(parts.length > 1);
    for (const part of parts) ok(bytes(part) <= 75, part);
    eq(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), line);
    ok(parts.slice(1).every((p) => p.startsWith(' ')));
});

Deno.test('buildCalendar', () => {
    const ics = buildCalendar({
        name: 'Chess, Go & More',
        now: new Date('2026-11-01T00:00:00Z'),
        events: [{
            uid: 'meeting-7@epsilon.stuysu.org',
            start: '2026-11-03T20:30:00Z',
            end: '2026-11-03T21:30:00Z',
            summary: 'Weekly; meeting',
            description: 'Bring boards\nand clocks',
            location: 'Room 301 (floor 3)',
            url: 'https://epsilon.stuysu.org/chess',
        }, {
            uid: 'meeting-8@epsilon.stuysu.org',
            start: '2026-11-10T20:30:00Z',
            end: '2026-11-10T21:30:00Z',
            summary: 'Virtual',
        }],
    });
    ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    ok(ics.endsWith('END:VCALENDAR\r\n'));
    ok(!/[^\r]\n/.test(ics), 'CRLF only');
    ok(ics.includes('X-WR-CALNAME:Chess\\, Go & More\r\n'));
    ok(ics.includes('UID:meeting-7@epsilon.stuysu.org\r\n'));
    ok(ics.includes('DTSTAMP:20261101T000000Z\r\n'));
    ok(ics.includes('DTSTART:20261103T203000Z\r\nDTEND:20261103T213000Z\r\n'));
    ok(ics.includes('SUMMARY:Weekly\\; meeting\r\n'));
    ok(ics.includes('DESCRIPTION:Bring boards\\nand clocks\r\n'));
    ok(ics.includes('LOCATION:Room 301 (floor 3)\r\n'));
    eq(ics.match(/BEGIN:VEVENT/g)?.length, 2);
    eq(ics.match(/LOCATION:/g)?.length, 1);
});
