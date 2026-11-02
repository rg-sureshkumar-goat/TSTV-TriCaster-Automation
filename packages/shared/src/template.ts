// Rundown templates (RG, Nov 2, 2026): each show can have a template rundown, edited on its own page,
// and every new rundown for the show starts as a copy of it: its blocks, sections, graphics and scripts,
// which columns the rundown shows, in what order, and its starter talent (like Anchor 1), who the producer
// renames to the real people (renameEpisodeTalent). A copy is made once, when the rundown is created, so
// changing the template never changes rundowns already made.
import * as Y from 'yjs';

/**
 * The rundown's columns after the drag handle and the block or section number (which always come first).
 * Slug, Camera and Graphics can't be removed (RG, Nov 2, 2026); the rest can, and all can be reordered.
 */
export const RUNDOWN_COLUMNS = [
  { key: 'slug', label: 'Slug', locked: true },
  { key: 'type', label: 'Story Type', locked: false },
  { key: 'writer', label: 'Writer', locked: false },
  { key: 'talent', label: 'Talent', locked: false },
  { key: 'camera', label: 'Camera', locked: true },
  { key: 'headline', label: 'Headline', locked: false },
  { key: 'graphics', label: 'Graphics', locked: true },
  { key: 'notes', label: 'Notes', locked: false },
  { key: 'assignGraphics', label: 'Assign Graphics', locked: false },
  { key: 'est', label: 'Est.', locked: false },
  { key: 'backTime', label: 'Back-time', locked: false },
  { key: 'lastEdit', label: 'Last edit', locked: false },
] as const;

export type ColumnKey = (typeof RUNDOWN_COLUMNS)[number]['key'];

export const DEFAULT_COLUMNS: ColumnKey[] = RUNDOWN_COLUMNS.map((c) => c.key);
const KNOWN = new Set<string>(DEFAULT_COLUMNS);
const LOCKED = RUNDOWN_COLUMNS.filter((c) => c.locked).map((c) => c.key as ColumnKey);

function layoutOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('layout');
}

/**
 * The columns a rundown shows, in order. Rundowns made before templates (and without one) show them all.
 * Unknown names are dropped, and a locked column that's missing is put back.
 */
export function readColumns(doc: Y.Doc): ColumnKey[] {
  const saved = layoutOf(doc).get('columns');
  if (!Array.isArray(saved)) return DEFAULT_COLUMNS;
  const columns = [...new Set(saved.filter((k): k is ColumnKey => typeof k === 'string' && KNOWN.has(k)))];
  for (const locked of LOCKED) if (!columns.includes(locked)) columns.push(locked);
  return columns;
}

/** Sets which columns the rundown shows, and in what order (locked ones always stay). */
export function setColumns(doc: Y.Doc, columns: string[]): void {
  const valid = [...new Set(columns.filter((k) => KNOWN.has(k)))];
  for (const locked of LOCKED) if (!valid.includes(locked)) valid.push(locked);
  layoutOf(doc).set('columns', valid);
}

/**
 * Turns a copy of a template into a new rundown: anything about the template's own files, broadcast and
 * edit history is cleared. Its blocks, sections, graphics, scripts, columns and starter talent stay.
 */
export function startFromTemplate(doc: Y.Doc): void {
  doc.transact(() => {
    for (const name of ['media', 'broadcast', 'scriptInfo']) {
      const map = doc.getMap(name);
      for (const key of [...map.keys()]) map.delete(key);
    }
  });
}
