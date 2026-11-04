// The show's keys (RG, Nov 4, 2026): only → takes the next graphic, and Space pauses, in manual mode only.
import { describe, expect, it } from 'vitest';
import { keyAction } from '../src/shared/keys.ts';

describe('the show’s keys', () => {
  it('in automation, → takes the next graphic and Space and the other arrows do nothing', () => {
    expect(keyAction('ArrowRight', false, false)).toEqual({ kind: 'fireNext' });
    for (const key of [' ', 'ArrowLeft', 'ArrowDown']) expect(keyAction(key, false, false)).toBeNull();
    expect(keyAction('p', false, false)).toEqual({ kind: 'setManual', manual: true });
  });

  it('in manual mode, → takes the next graphic, Space pauses, ← goes back and ↓ takes it off', () => {
    expect(keyAction('ArrowRight', true, false)).toEqual({ kind: 'fireNext' });
    expect(keyAction(' ', true, false)).toEqual({ kind: 'pauseGraphic' });
    expect(keyAction('ArrowLeft', true, false)).toEqual({ kind: 'fireBack' });
    expect(keyAction('ArrowDown', true, false)).toEqual({ kind: 'takeOff' });
    expect(keyAction('P', true, false)).toEqual({ kind: 'setManual', manual: false });
  });

  it('in Manual Mode, the keys are manual mode’s, without P', () => {
    expect(keyAction('ArrowRight', true, true)).toEqual({ kind: 'fireNext' });
    expect(keyAction(' ', true, true)).toEqual({ kind: 'pauseGraphic' });
    expect(keyAction('p', true, true)).toBeNull();
  });
});
