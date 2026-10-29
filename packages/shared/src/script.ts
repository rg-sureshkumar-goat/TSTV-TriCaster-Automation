// Section scripts. Each section's script is shared text in the episode's document, so several people
// can type in the same script at once without overwriting each other. The episode room creates a
// section's script as soon as the section exists; pages never create one themselves, so two people
// opening a new script at the same moment can't end up with two different copies.
import * as Y from 'yjs';
import { readRows, rowsOf, type Person } from './rundown.ts';

/** How fast a typical anchor reads (RG, Oct 28, 2026): 143 to 154 words a minute, about 2.38 to 2.57 a second. */
export const READING_SPEED = { minWordsPerMinute: 143, maxWordsPerMinute: 154 } as const;

export interface ScriptInfo {
  /** Everyone who has typed in this script, in the order they first did. */
  editors: Person[];
  updatedBy?: Person;
  updatedAt?: number;
}

export function scriptsOf(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>('scripts');
}

function scriptInfoOf(doc: Y.Doc): Y.Map<ScriptInfo> {
  return doc.getMap<ScriptInfo>('scriptInfo');
}

/** The section's script, or undefined until the episode room has created it. */
export function scriptText(doc: Y.Doc, sectionId: string): Y.Text | undefined {
  return scriptsOf(doc).get(sectionId);
}

export function readScript(doc: Y.Doc, sectionId: string): string {
  return scriptText(doc, sectionId)?.toString() ?? '';
}

export function readScriptInfo(doc: Y.Doc, sectionId: string): ScriptInfo {
  return scriptInfoOf(doc).get(sectionId) ?? { editors: [] };
}

/** Run by the episode room only: gives every section a script. Returns true if it added any. */
export function ensureScripts(doc: Y.Doc): boolean {
  const scripts = scriptsOf(doc);
  const missing = rowsOf(doc)
    .toArray()
    .filter((m) => m.get('kind') === 'section' && !scripts.has(String(m.get('id'))))
    .map((m) => String(m.get('id')));
  if (missing.length === 0) return false;
  doc.transact(() => {
    for (const id of missing) scripts.set(id, new Y.Text());
  });
  return true;
}

/** Records who edited a script and when. */
export function noteScriptEdit(doc: Y.Doc, sectionId: string, by: Person): void {
  const info = scriptInfoOf(doc);
  const current = info.get(sectionId) ?? { editors: [] };
  const editors = current.editors.some((p) => p.id === by.id) ? current.editors : [...current.editors, by];
  info.set(sectionId, { editors, updatedBy: by, updatedAt: Date.now() });
}

export function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** How long a typical anchor takes to read this many words, as a range in seconds. */
export function readTimeRange(words: number): { fastestSeconds: number; slowestSeconds: number } {
  return {
    fastestSeconds: Math.round((words * 60) / READING_SPEED.maxWordsPerMinute),
    slowestSeconds: Math.round((words * 60) / READING_SPEED.minWordsPerMinute),
  };
}

/** Text of every section's script, for archive search. */
export function allScriptText(doc: Y.Doc, maxChars = 50_000): string {
  let out = '';
  for (const row of readRows(doc)) {
    if (row.kind !== 'section') continue;
    out += ` ${readScript(doc, row.id)}`;
    if (out.length > maxChars) break;
  }
  return out.slice(0, maxChars);
}
