// Each episode's on-air talent: its anchors and correspondents, entered by the producer. They live in the
// episode's shared document, so everyone editing the episode sees changes live. Each person gets a
// color, used to mark their sections in the rundown and (Phase 3) on the prompter.
import * as Y from 'yjs';
import { newId, rowsOf } from './rundown.ts';
import { TALENT_COLORS, type Talent } from './show.ts';

export type TalentRole = 'anchor' | 'correspondent';

export interface EpisodeTalent {
  id: string;
  name: string;
  role: TalentRole;
}

function talentOf(doc: Y.Doc): Y.Array<EpisodeTalent> {
  return doc.getArray<EpisodeTalent>('talent');
}

export function readEpisodeTalent(doc: Y.Doc): EpisodeTalent[] {
  return talentOf(doc)
    .toArray()
    .filter((t) => t && typeof t.name === 'string' && (t.role === 'anchor' || t.role === 'correspondent'));
}

export function addEpisodeTalent(doc: Y.Doc, name: string, role: TalentRole): string | undefined {
  const clean = name.trim().slice(0, 80);
  if (!clean) return undefined;
  if (readEpisodeTalent(doc).some((t) => t.role === role && t.name.toLowerCase() === clean.toLowerCase())) return undefined;
  const id = newId();
  talentOf(doc).push([{ id, name: clean, role }]);
  return id;
}

export function removeEpisodeTalent(doc: Y.Doc, id: string): void {
  const list = talentOf(doc);
  const i = list.toArray().findIndex((t) => t.id === id);
  if (i >= 0) list.delete(i, 1);
}

/**
 * Renames one of the episode's talent everywhere (RG, Nov 2, 2026: a template's starter talent, like
 * "Anchor 1", becomes the real person): in the talent list, in each section's Talent box, and in the
 * scripts' speaker tags ({ANCHOR 1} becomes {JORDAN}). Returns false if the name is empty or taken.
 */
export function renameEpisodeTalent(doc: Y.Doc, id: string, name: string): boolean {
  const clean = name.trim().slice(0, 80);
  const list = talentOf(doc);
  const i = list.toArray().findIndex((t) => t.id === id);
  if (i < 0 || !clean) return false;
  const person = list.get(i);
  if (person.name === clean) return true;
  if (readEpisodeTalent(doc).some((t) => t.id !== id && t.role === person.role && t.name.toLowerCase() === clean.toLowerCase())) return false;
  const old = person.name.toLowerCase();
  const tag = (n: string) => `{${n.toUpperCase()}}`;
  const oldTag = new RegExp(`\\{\\s*${person.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'gi');
  doc.transact(() => {
    list.delete(i, 1);
    list.insert(i, [{ ...person, name: clean }]);
    for (const row of rowsOf(doc).toArray()) {
      const names = row.get('talent');
      if (row.get('kind') === 'section' && Array.isArray(names) && names.some((n) => String(n).toLowerCase() === old)) {
        row.set('talent', names.map((n) => (String(n).toLowerCase() === old ? clean : n)));
      }
    }
    // The scripts' speaker tags, in place, from the end of each piece of text so earlier places stay put.
    doc.getMap<Y.XmlFragment>('scriptBodies').forEach((body) => {
      const texts: Y.XmlText[] = [];
      const walk = (node: Y.XmlFragment | Y.XmlElement) =>
        node.toArray().forEach((child) => (child instanceof Y.XmlText ? texts.push(child) : child instanceof Y.XmlElement ? walk(child) : undefined));
      walk(body);
      for (const text of texts) {
        const plain = (text.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : ' ')).join('');
        const found = [...plain.matchAll(oldTag)].reverse();
        for (const match of found) {
          text.delete(match.index!, match[0].length);
          text.insert(match.index!, tag(clean));
        }
      }
    });
    // What the room last wrote as each section's readers, so it doesn't rewrite the scripts.
    const readers = doc.getMap<string>('scriptReaders');
    for (const [section, tags] of [...readers.entries()]) if (tags.match(oldTag)) readers.set(section, tags.replace(oldTag, tag(clean)));
  });
  return true;
}

/**
 * Everyone with a color: this episode's anchors and correspondents first (colored in order), then the
 * show's usual talent. Used to color a section by the name typed in its Talent box.
 */
export function talentColors(episode: EpisodeTalent[], show: Talent[]): Talent[] {
  const ordered = [...episode.filter((t) => t.role === 'anchor'), ...episode.filter((t) => t.role === 'correspondent')];
  return [...ordered.map((t, i) => ({ name: t.name, color: TALENT_COLORS[i % TALENT_COLORS.length] })), ...show];
}

export function colorForTalent(name: string, colors: Talent[]): string | undefined {
  const key = name.trim().toLowerCase();
  return key ? colors.find((t) => t.name.toLowerCase() === key)?.color : undefined;
}
