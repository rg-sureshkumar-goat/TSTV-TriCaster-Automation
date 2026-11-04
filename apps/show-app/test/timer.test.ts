// The time-left timer turns orange at 15 seconds left and red at 10 (RG, Nov 4, 2026), by what it shows.
import { describe, expect, it } from 'vitest';
import { timerLevel } from '../src/shared/timer.ts';

describe('the time-left timer’s color', () => {
  it('is normal above 15 seconds, or with nothing playing', () => {
    expect(timerLevel(null)).toBe('normal');
    expect(timerLevel(90)).toBe('normal');
    expect(timerLevel(16)).toBe('normal');
    expect(timerLevel(15.6)).toBe('normal');
  });

  it('is orange from 15 seconds', () => {
    expect(timerLevel(15.4)).toBe('warning');
    expect(timerLevel(15)).toBe('warning');
    expect(timerLevel(11)).toBe('warning');
  });

  it('is red from 10 seconds to the end', () => {
    expect(timerLevel(10.4)).toBe('danger');
    expect(timerLevel(10)).toBe('danger');
    expect(timerLevel(0)).toBe('danger');
  });
});
