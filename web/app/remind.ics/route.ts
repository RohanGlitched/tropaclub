import { SITE_URL, buyOpenAt } from '@/lib/site';

export const dynamic = 'force-dynamic';

// "Remind me": a calendar entry for the moment buying opens.
export function GET() {
  const start = new Date(buyOpenAt());
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tropa Club//Buy opens//EN',
    'BEGIN:VEVENT',
    'UID:buy-opens@tropaclub.xyz',
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + 30 * 60_000))}`,
    'SUMMARY:Tropa Club: buying opens',
    `DESCRIPTION:Take your seat. Buy from $5 of a stock token from your own wallet and play gameweek 0 with your club. ${SITE_URL}/clubs\\nStock tokens track the share price. They are not shares. Not available to US persons. Not advice.`,
    `URL:${SITE_URL}/clubs`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Tropa Club buying opens in 10 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="tropa-club-buying-opens.ics"', 'Cache-Control': 'public, max-age=300' } });
}
