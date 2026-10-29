import { describe, expect, it } from 'vitest';
import { matchMedia, parseMediaName, type MediaSection } from '../src/media.ts';

describe('graphics file names', () => {
  it('reads TSTV’s names, including the spellings on the real DDR 2 playlist', () => {
    expect(parseMediaName('B5_VO_Basketball.mov')).toEqual({ section: 'B5', writtenType: 'VO', types: ['VO'], slug: 'Basketball', copy: false });
    expect(parseMediaName('/Volumes/USB/B17_OTS_R_BEVO LAB.mov')).toMatchObject({ section: 'B17', types: ['OTSR'], slug: 'BEVO LAB' });
    expect(parseMediaName('A12__OTSR_Election.mov')).toMatchObject({ section: 'A12', types: ['OTSR'], slug: 'Election' });
    expect(parseMediaName('A9_NAMES_ANCHORNAMES (1).mov')).toMatchObject({ section: 'A9', types: ['L3'], slug: 'ANCHORNAMES', copy: true });
    expect(parseMediaName('C2_RDR_Budget copy.mov')).toMatchObject({ types: ['OTSL', 'OTSR'], slug: 'Budget', copy: true });
    expect(parseMediaName('a3_sot_coach.mp4')).toMatchObject({ section: 'A3', types: ['SOT'] });
    expect(parseMediaName('Show Intro.mov')).toBeNull();
    expect(parseMediaName('B5-VO-Basketball.mov')).toBeNull();
  });
});

describe('matching files to the rundown', () => {
  const sections: MediaSection[] = [
    { label: 'A1', slug: 'Cold Open', elements: [{ id: 'l3', type: 'L3', name: 'Score' }] },
    {
      label: 'A2',
      slug: 'Basketball Wins',
      elements: [
        { id: 'vo1', type: 'VO', name: 'Highlights' },
        { id: 'vo2', type: 'VO', name: 'Crowd' },
        { id: 'ots', type: 'OTSR', name: '' },
      ],
    },
    { label: 'B1', slug: 'Weather', elements: [{ id: 'fsg', type: 'FSG', name: '' }, { id: 'perm', type: 'PERM', name: 'Station ID' }] },
  ];

  it('matches by section and type, and flags a slug that doesn’t look right', () => {
    const result = matchMedia(['A1_L3_ColdOpen.mov', 'A2_RDR_Basketball.mov', 'B1_FSG_Football.mov'], sections);
    expect(result.problems).toEqual([]);
    expect(result.matches).toEqual([
      { file: 'A1_L3_ColdOpen.mov', elementId: 'l3', section: 'A1', checkSlug: false },
      { file: 'A2_RDR_Basketball.mov', elementId: 'ots', section: 'A2', checkSlug: false },
      { file: 'B1_FSG_Football.mov', elementId: 'fsg', section: 'B1', checkSlug: true },
    ]);
  });

  it('doesn’t doubt a file for a section that has no slug yet', () => {
    const result = matchMedia(['C1_LITES_Opener.mp4'], [{ label: 'C1', slug: '', elements: [{ id: 'lites', type: 'LITES', name: '' }] }]);
    expect(result.matches).toEqual([{ file: 'C1_LITES_Opener.mp4', elementId: 'lites', section: 'C1', checkSlug: false }]);
  });

  it('tells two files of one type apart by the elements’ names, and asks when it can’t', () => {
    const named = matchMedia(['A2_VO_Crowd.mov', 'A2_VO_Highlights.mov'], sections);
    expect(named.matches.map((m) => [m.file, m.elementId])).toEqual([
      ['A2_VO_Crowd.mov', 'vo2'],
      ['A2_VO_Highlights.mov', 'vo1'],
    ]);
    const unclear = matchMedia(['A2_VO_Basketball1.mov', 'A2_VO_Basketball2.mov'], sections);
    expect(unclear.matches).toEqual([]);
    expect(unclear.problems.map((p) => p.reason)).toEqual(['which-element', 'which-element']);
  });

  it('stops for names it can’t place', () => {
    const result = matchMedia(['Station ID.mov', 'C4_VO_Late.mov', 'A1_SOT_Coach.mov', 'A1_L3_Extra.mov'], sections, new Set(['l3']));
    expect(result.matches).toEqual([]);
    expect(result.problems).toEqual([
      { file: 'Station ID.mov', reason: 'pattern' },
      { file: 'C4_VO_Late.mov', reason: 'no-section', section: 'C4' },
      { file: 'A1_SOT_Coach.mov', reason: 'no-element', section: 'A1', type: 'SOT' },
      { file: 'A1_L3_Extra.mov', reason: 'no-element', section: 'A1', type: 'L3' },
    ]);
  });
});
