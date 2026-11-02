import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, insertBlock, insertSection, readRows } from '../src/rundown.ts';
import { DEFAULT_COLUMNS, readColumns, setColumns, startFromTemplate } from '../src/template.ts';
import { addEpisodeTalent, readEpisodeTalent } from '../src/talent.ts';

const alex = { id: 'u1', name: 'Alex Producer' };

describe('rundown templates', () => {
  it('shows every column until a template chooses, and always keeps Slug, Camera and Graphics', () => {
    const doc = new Y.Doc();
    expect(readColumns(doc)).toEqual(DEFAULT_COLUMNS);
    setColumns(doc, ['notes', 'slug', 'est']);
    expect(readColumns(doc)).toEqual(['notes', 'slug', 'est', 'camera', 'graphics']);
    setColumns(doc, ['graphics', 'nonsense', 'camera', 'slug']);
    expect(readColumns(doc)).toEqual(['graphics', 'camera', 'slug']);
  });

  it('copies the blocks, sections, graphics and columns into a new rundown, but not the talent', () => {
    const template = new Y.Doc();
    insertBlock(template, alex, 'Top stories');
    const open = insertSection(template, alex, { slug: 'Show Open', talent: ['Jordan'] });
    addElement(template, open, 'PERM', alex, 'Show Intro');
    addEpisodeTalent(template, 'Jordan', 'anchor');
    setColumns(template, ['slug', 'camera', 'graphics', 'notes']);

    const episode = new Y.Doc();
    Y.applyUpdate(episode, Y.encodeStateAsUpdate(template));
    startFromTemplate(episode);
    const rows = readRows(episode);
    expect(rows.map((r) => (r.kind === 'block' ? r.title : r.slug))).toEqual(['Top stories', 'Show Open']);
    expect(rows[1].kind === 'section' && rows[1].elements.map((e) => e.name)).toEqual(['Show Intro']);
    expect(rows[1].kind === 'section' && rows[1].talent).toEqual([]);
    expect(readEpisodeTalent(episode)).toEqual([]);
    expect(readColumns(episode)).toEqual(['slug', 'camera', 'graphics', 'notes']);

    // Changing the template afterward leaves the rundown as it was.
    setColumns(template, ['slug', 'camera', 'graphics']);
    insertSection(template, alex, { slug: 'Later' });
    expect(readColumns(episode)).toEqual(['slug', 'camera', 'graphics', 'notes']);
    expect(readRows(episode)).toHaveLength(2);
  });
});
