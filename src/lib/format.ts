// Dates as the trainee reads them: en-SG, 24-hour, in the phone's time zone.

const DAY = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-SG', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "22:10". */
export function formatTimeOfDay(d: Date): string {
  return TIME.format(d);
}

/** "9 Nov, 22:10". Built from two parts so a newer ICU can't change the joiner (say to "at"). */
export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${DAY.format(d)}, ${formatTimeOfDay(d)}`;
}
