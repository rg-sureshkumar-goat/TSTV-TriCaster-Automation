// The time-left timer's color (RG, Nov 4, 2026), by the seconds it shows: orange from 15 seconds left, and
// red from 10.
export type TimerLevel = 'normal' | 'warning' | 'danger';

export function timerLevel(seconds: number | null): TimerLevel {
  if (seconds === null) return 'normal';
  const shown = Math.round(seconds);
  return shown <= 10 ? 'danger' : shown <= 15 ? 'warning' : 'normal';
}
