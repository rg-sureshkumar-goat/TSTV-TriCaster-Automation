// Each episode's on-air talent: its anchors and correspondents, entered by the producer. They live in the
// episode's shared document, so everyone editing the episode sees changes live. Each person gets a
// color, used to mark their sections in the rundown and (Phase 3) on the prompter.
import * as Y from 'yjs';
import { newId } from './rundown.ts';
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
