import { describe, expect, it } from 'vitest';
import { computeRundown, type Row } from '@tstv/shared';
import { toCsv } from '../src/rundown/export.ts';

const sam = { id: 'u2', name: 'Sam Writer' };
const rows: Row[] = [
  { id: 'a', kind: 'block', title: 'Top stories' },
  { id: 's1', kind: 'section', slug: 'Basketball, "big" win', type: 'Reader', writer: 'Sam', talent: 'Jordan', camera: '', floated: false, estSeconds: 90, elements: [{ id: 'e1', type: 'L3', name: 'Score' }, { id: 'e2', type: 'VO', name: '' }], createdBy: sam, updatedBy: sam },
  { id: 's2', kind: 'section', slug: 'Weather', type: 'Cross Talk', writer: '', talent: 'Riley', camera: 'Camera 3', floated: true, estSeconds: 60, elements: [] },
];

describe('CSV export', () => {
  const csv = toCsv(computeRundown(rows, 1800), { showName: 'News', episodeTitle: 'Ep', airDate: '', airTime: '19:00', defaultCamera: 'Camera 1' });
  const lines = csv.trim().split('\r\n');

  it('has a header and one line per row', () => {
    expect(lines[0]).toBe('#,Slug,Type,Writer,Talent,Camera,Graphics,Floated,Est.,Back-time,Added by,Last edited by');
    expect(lines).toHaveLength(4);
  });

  it('quotes commas and quotes, lists elements in order, fills in the default camera, and names the writer', () => {
    expect(lines[2]).toBe('A1,"Basketball, ""big"" win",Reader,Sam,Jordan,Camera 1,"L3 Score, VO",,1:30,7:28:30 PM,Sam Writer,Sam Writer');
  });

  it('marks floated sections and gives them no back-time', () => {
    expect(lines[3]).toBe('A2,Weather,Cross Talk,,Riley,Camera 3,,Floated,1:00,,,');
  });

  it('shows block lines with their total', () => {
    expect(lines[1]).toBe('A,BLOCK A: Top stories,,,,,,,1:30,7:28:30 PM,,');
  });
});
