// The show's keys (RG, Nov 4, 2026): → takes the next graphic, in automation and manual mode. In manual mode
// only, Space pauses the graphic on air where it is (and starts it again), ← goes back one, and ↓ takes it
// off. P switches between manual mode and automation, except in Manual Mode, which has no automation.
import type { Action } from './api.ts';

export function keyAction(key: string, manual: boolean, manualSession: boolean): Action | null {
  if (key === 'ArrowRight') return { kind: 'fireNext' };
  if ((key === 'p' || key === 'P') && !manualSession) return { kind: 'setManual', manual: !manual };
  // The others work only in manual mode, so a stray press can't upset the automation.
  if (!manual) return null;
  if (key === ' ') return { kind: 'pauseGraphic' };
  if (key === 'ArrowLeft') return { kind: 'fireBack' };
  if (key === 'ArrowDown') return { kind: 'takeOff' };
  return null;
}
