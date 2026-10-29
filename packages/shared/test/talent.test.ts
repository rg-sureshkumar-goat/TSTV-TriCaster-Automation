import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addEpisodeTalent, colorForTalent, readEpisodeTalent, removeEpisodeTalent, talentColors } from '../src/talent.ts';
import { TALENT_COLORS } from '../src/show.ts';

describe('episode talent', () => {
  it('lists anchors and correspondents, without duplicates', () => {
    const doc = new Y.Doc();
    addEpisodeTalent(doc, ' Jordan Lee ', 'anchor');
    addEpisodeTalent(doc, 'jordan lee', 'anchor');
    addEpisodeTalent(doc, 'Riley Park', 'correspondent');
    addEpisodeTalent(doc, '  ', 'anchor');
    expect(readEpisodeTalent(doc).map((t) => `${t.role}:${t.name}`)).toEqual(['anchor:Jordan Lee', 'correspondent:Riley Park']);
    removeEpisodeTalent(doc, readEpisodeTalent(doc)[0].id);
    expect(readEpisodeTalent(doc).map((t) => t.name)).toEqual(['Riley Park']);
  });

  it('keeps both when two people add talent at once', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addEpisodeTalent(a, 'Jordan Lee', 'anchor');
    addEpisodeTalent(b, 'Sam Ortiz', 'anchor');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readEpisodeTalent(a).map((t) => t.name).sort()).toEqual(['Jordan Lee', 'Sam Ortiz']);
  });

  it('colors anchors first, then correspondents, then the show’s usual talent', () => {
    const doc = new Y.Doc();
    addEpisodeTalent(doc, 'Riley Park', 'correspondent');
    addEpisodeTalent(doc, 'Jordan Lee', 'anchor');
    const colors = talentColors(readEpisodeTalent(doc), [{ name: 'Casey', color: '#000000' }]);
    expect(colorForTalent('jordan lee', colors)).toBe(TALENT_COLORS[0]);
    expect(colorForTalent('Riley Park', colors)).toBe(TALENT_COLORS[1]);
    expect(colorForTalent('Casey', colors)).toBe('#000000');
    expect(colorForTalent('Nobody', colors)).toBeUndefined();
  });
});
