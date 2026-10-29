// Section scripts. Each section's script is a shared document in the episode's room, so several people
// can type in the same script at once without overwriting each other. A script is a list of paragraphs;
// a paragraph holds text and cue chips. A cue chip marks where one of the section's graphics fires, and
// is linked to that graphic (rundown element) by its id. A speaker's part starts with their name in curly
// brackets, like {Jordan}.
//
// The episode room creates a section's script as soon as the section exists; pages never create one
// themselves, so two people opening a new script at the same moment can't end up with two copies.
import * as Y from 'yjs';
import { readRows, rowsOf, type Person } from './rundown.ts';

/** How fast a typical anchor reads (RG, Oct 28, 2026): 143 to 154 words a minute, about 2.38 to 2.57 a second. */
export const READING_SPEED = { minWordsPerMinute: 143, maxWordsPerMinute: 154 } as const;

/** Names used inside a script document (they match the script editor's). */
export const PARAGRAPH_NODE = 'paragraph';
export const CUE_NODE = 'cue';

export interface ScriptInfo {
  /** Everyone who has typed in this script, in the order they first did. */
  editors: Person[];
  updatedBy?: Person;
  updatedAt?: number;
}

/** A piece of a paragraph: text, or a cue chip for one of the section's graphics. */
export type ScriptPiece = { kind: 'text'; text: string } | { kind: 'cue'; elementId: string };

/** Every section's script, by section id. */
export function scriptBodiesOf(doc: Y.Doc): Y.Map<Y.XmlFragment> {
  return doc.getMap<Y.XmlFragment>('scriptBodies');
}

/** Phase 1 kept scripts as plain text. They're copied into script documents once, and kept as a backup. */
function plainScriptsOf(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>('scripts');
}

function scriptInfoOf(doc: Y.Doc): Y.Map<ScriptInfo> {
  return doc.getMap<ScriptInfo>('scriptInfo');
}

/** The section's script, or undefined until the episode room has created it. */
export function scriptBody(doc: Y.Doc, sectionId: string): Y.XmlFragment | undefined {
  return scriptBodiesOf(doc).get(sectionId);
}

/** The script's paragraphs, each as its text and cue chips in order. */
export function readScriptParagraphs(body: Y.XmlFragment): ScriptPiece[][] {
  const paragraphs: ScriptPiece[][] = [];
  const readInline = (node: Y.XmlElement | Y.XmlText | Y.XmlHook, into: ScriptPiece[]) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert: unknown }[]) {
        if (typeof op.insert === 'string') into.push({ kind: 'text', text: op.insert });
      }
    } else if (node instanceof Y.XmlElement && node.nodeName === CUE_NODE) {
      const elementId = node.getAttribute('elementId');
      if (typeof elementId === 'string' && elementId) into.push({ kind: 'cue', elementId });
    }
  };
  for (const child of body.toArray()) {
    const pieces: ScriptPiece[] = [];
    if (child instanceof Y.XmlElement && child.nodeName === PARAGRAPH_NODE) {
      for (const inline of child.toArray()) readInline(inline, pieces);
    } else {
      readInline(child, pieces);
    }
    paragraphs.push(pieces);
  }
  return paragraphs;
}

/** The script's words, one line per paragraph, without its cue chips. */
export function scriptPlainText(body: Y.XmlFragment | undefined): string {
  if (!body) return '';
  return readScriptParagraphs(body)
    .map((pieces) => pieces.map((p) => (p.kind === 'text' ? p.text : '')).join(''))
    .join('\n');
}

export function readScript(doc: Y.Doc, sectionId: string): string {
  return scriptPlainText(scriptBody(doc, sectionId));
}

/** How many cue chips the script has for each graphic, by element id. */
export function scriptCueCounts(body: Y.XmlFragment | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  if (!body) return counts;
  for (const pieces of readScriptParagraphs(body)) {
    for (const p of pieces) if (p.kind === 'cue') counts.set(p.elementId, (counts.get(p.elementId) ?? 0) + 1);
  }
  return counts;
}

/** Every graphic that has a cue chip in any script of the episode. */
export function cuedElementIds(doc: Y.Doc): Set<string> {
  const ids = new Set<string>();
  scriptBodiesOf(doc).forEach((body) => scriptCueCounts(body).forEach((_, id) => ids.add(id)));
  return ids;
}

export function readScriptInfo(doc: Y.Doc, sectionId: string): ScriptInfo {
  return scriptInfoOf(doc).get(sectionId) ?? { editors: [] };
}

/** Copies plain text into an empty script, one paragraph per line. An empty script gets one empty paragraph. */
function fillFromText(body: Y.XmlFragment, text: string): void {
  const paragraphs = text.split(/\r?\n/).map((line) => {
    const paragraph = new Y.XmlElement(PARAGRAPH_NODE);
    if (line) paragraph.insert(0, [new Y.XmlText(line)]);
    return paragraph;
  });
  body.insert(0, paragraphs);
}

/**
 * Run by the episode room only: gives every section a script. A section that already has a Phase 1
 * plain-text script gets that text, word for word. Returns true if it added any.
 */
export function ensureScripts(doc: Y.Doc): boolean {
  const bodies = scriptBodiesOf(doc);
  const missing = rowsOf(doc)
    .toArray()
    .filter((m) => m.get('kind') === 'section' && !bodies.has(String(m.get('id'))))
    .map((m) => String(m.get('id')));
  if (missing.length === 0) return false;
  doc.transact(() => {
    for (const id of missing) {
      const body = new Y.XmlFragment();
      bodies.set(id, body);
      // Starting with a paragraph means editors that open the new script at the same time don't each add one.
      fillFromText(body, plainScriptsOf(doc).get(id)?.toString() ?? '');
    }
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

/** A speaker's name in curly brackets, like {Jordan}, which marks where their part starts. */
export const SPEAKER_TAG = /\{([^{}\n]{1,60})\}/g;

/** The names in a script's speaker tags, in order. */
export function speakerTags(text: string): string[] {
  return [...text.matchAll(SPEAKER_TAG)].map((m) => m[1].trim());
}

/** Words read aloud: speaker tags like {Jordan} aren't. */
export function countWords(text: string): number {
  const spoken = text.replace(SPEAKER_TAG, ' ').trim();
  return spoken === '' ? 0 : spoken.split(/\s+/).length;
}

/** How long a typical anchor takes to read this many words, as a range in seconds. */
export function readTimeRange(words: number): { fastestSeconds: number; slowestSeconds: number } {
  return {
    fastestSeconds: Math.round((words * 60) / READING_SPEED.maxWordsPerMinute),
    slowestSeconds: Math.round((words * 60) / READING_SPEED.minWordsPerMinute),
  };
}

/**
 * One number for timing the rundown: the read time at the middle of the 143–154 range (148.5 words a minute).
 */
export function estimatedReadSeconds(words: number): number {
  const mid = (READING_SPEED.minWordsPerMinute + READING_SPEED.maxWordsPerMinute) / 2;
  return Math.round((words * 60) / mid);
}

/** Word count of every section's script, by section id. */
export function scriptWordCounts(doc: Y.Doc): Record<string, number> {
  const counts: Record<string, number> = {};
  scriptBodiesOf(doc).forEach((body, id) => (counts[id] = countWords(scriptPlainText(body))));
  return counts;
}

/**
 * A section's estimated length: a length typed in by hand wins; otherwise the script's read time.
 * (Phase 4 adds SOT and package clip lengths.)
 */
export function sectionSecondsFrom(words: Record<string, number>) {
  return (row: { id: string; estSeconds: number | null }) => row.estSeconds ?? estimatedReadSeconds(words[row.id] ?? 0);
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
