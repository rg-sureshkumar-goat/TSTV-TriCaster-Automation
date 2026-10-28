// Dates and times shown the way people in Texas read them.

/** "2026-10-30" → "Fri, Oct 30, 2026". */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "19:00" → "7:00 PM". */
export function formatTime(hhmm: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!match) return '';
  const h = Number(match[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${match[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "3 min ago", "yesterday", or a date. */
export function timeAgo(ms: number | undefined): string {
  if (!ms) return '';
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
