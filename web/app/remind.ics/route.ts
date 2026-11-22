import { REGION_LINE, SITE_URL, buyOpenAt } from '@/lib/site';

export const dynamic = 'force-dynamic';

// "Add to calendar": a calendar entry for the moment buying opens.
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
    `DESCRIPTION:Buying opens on Tropa Club. Buy $5 or more of a stock token through Tropa Club from your own wallet and it counts as played in gameweek 0 (the practice week) for your club. ${SITE_URL}/clubs\\nStock tokens track the share price. They are not shares. ${REGION_LINE} Not advice.`,
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
