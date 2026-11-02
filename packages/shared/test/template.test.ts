import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, insertBlock, insertSection, readRows, type SectionRow } from '../src/rundown.ts';
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

  it('copies the blocks, sections, graphics, columns and talent into a new rundown', () => {
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
    // Its talent comes too, to be renamed to the real people.
    expect(rows[1].kind === 'section' && rows[1].talent).toEqual(['Jordan']);
    expect(readEpisodeTalent(episode).map((t) => t.name)).toEqual(['Jordan']);
    expect(readColumns(episode)).toEqual(['slug', 'camera', 'graphics', 'notes']);

    // Changing the template afterward leaves the rundown as it was.
    setColumns(template, ['slug', 'camera', 'graphics']);
    insertSection(template, alex, { slug: 'Later' });
    expect(readColumns(episode)).toEqual(['slug', 'camera', 'graphics', 'notes']);
    expect(readRows(episode)).toHaveLength(2);
  });
});

describe('starter talent', () => {
  it('renames a template’s starter talent everywhere: the list, the sections and the scripts’ speaker tags', async () => {
    const { ensureScripts, scriptBody, readScript, tagReaders } = await import('../src/script.ts');
    const { renameEpisodeTalent } = await import('../src/talent.ts');
    const doc = new Y.Doc();
    insertBlock(doc, alex);
    const a1 = insertSection(doc, alex, { slug: 'Open', talent: ['Anchor 1', 'Anchor 2'] });
    const anchor1 = addEpisodeTalent(doc, 'Anchor 1', 'anchor')!;
    addEpisodeTalent(doc, 'Anchor 2', 'anchor');
    ensureScripts(doc);
    tagReaders(doc);
    // The starter script: Anchor 1's part has words.
    const first = scriptBody(doc, a1)!.get(1) as Y.XmlElement;
    first.insert(0, [new Y.XmlText('GOOD EVENING.')]);
    expect(readScript(doc, a1)).toBe('{ANCHOR 1}\nGOOD EVENING.\n{ANCHOR 2}\n');

    expect(renameEpisodeTalent(doc, anchor1, 'Jordan Lee')).toBe(true);
    expect(readEpisodeTalent(doc).map((t) => t.name)).toEqual(['Jordan Lee', 'Anchor 2']);
    expect((readRows(doc)[1] as SectionRow).talent).toEqual(['Jordan Lee', 'Anchor 2']);
    expect(readScript(doc, a1)).toBe('{JORDAN LEE}\nGOOD EVENING.\n{ANCHOR 2}\n');
    // The room's reader tags agree, so it leaves the script alone.
    expect(tagReaders(doc)).toBe(false);
    // A name already taken isn't allowed.
    expect(renameEpisodeTalent(doc, anchor1, 'anchor 2')).toBe(false);
  });

  it('copies the template’s starter talent into a new rundown', () => {
    const template = new Y.Doc();
    insertSection(template, alex, { slug: 'Open', talent: ['Anchor 1'] });
    addEpisodeTalent(template, 'Anchor 1', 'anchor');
    const episode = new Y.Doc();
    Y.applyUpdate(episode, Y.encodeStateAsUpdate(template));
    startFromTemplate(episode);
    expect(readEpisodeTalent(episode).map((t) => t.name)).toEqual(['Anchor 1']);
    expect((readRows(episode)[0] as SectionRow).talent).toEqual(['Anchor 1']);
  });
});
