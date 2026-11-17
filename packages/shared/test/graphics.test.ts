import { describe, expect, it } from 'vitest';
import { graphicsDeleteDate, isAttachable } from '../src/graphics.ts';

describe('an episode’s graphics in Google Drive (RG, Nov 17, 2026)', () => {
  it('are deleted two weeks after the air date, across month and year ends', () => {
    expect(graphicsDeleteDate('2026-11-20')).toBe('2026-12-04');
    expect(graphicsDeleteDate('2026-12-25')).toBe('2027-01-08');
    expect(graphicsDeleteDate('')).toBeNull();
    expect(graphicsDeleteDate(null)).toBeNull();
  });

  it('can be attached to every graphic and clip, but not music or permanent graphics', () => {
    for (const t of ['L3', 'OTSL', 'OTSR', 'FSG', 'TEASE', 'LITES', 'VO', 'SOT', 'PKG']) expect(isAttachable(t)).toBe(true);
    expect(isAttachable('MUSIC')).toBe(false);
    expect(isAttachable('PERM')).toBe(false);
  });
});
