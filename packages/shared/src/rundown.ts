// The rundown: blocks (A, B, C…) and the sections under them (A1, A2, B1…). One episode's rundown is a
// shared Yjs document, so several people can edit it at once without overwriting each other. Every
// section remembers who created it and who last edited it.
import * as Y from 'yjs';

export interface Person {
  id: string;
  name: string;
}

/**
 * Things that play during a section, each fired by its own cue. Graphics and clips play from DDR2 through
 * DSK 2: L3, OTSL, OTSR, FSG and TEASE are graphics; VO, SOT, PKG and LITES are clips (video). MUSIC plays
 * from the TriCaster's Sound player, named by the track (like the intro music under the tease). PERM is one
 * of the show's permanent graphics (Station ID, Show Intro…), named by the element's name.
 */
export const ELEMENT_TYPES = ['L3', 'OTSL', 'OTSR', 'FSG', 'TEASE', 'LITES', 'VO', 'SOT', 'PKG', 'MUSIC', 'PERM'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** One element of a section, for example the VO that plays while the anchor reads. */
export interface Element {
  id: string;
  type: ElementType;
  /** Optional name, like "Highlights", which also helps match the graphics file later. */
  name: string;
}

/** How an element reads in exports and on the script page: "VO Highlights", or just "Station ID" for a permanent graphic. */
export function elementLabel(e: Pick<Element, 'type' | 'name'>): string {
  if (e.type === 'PERM') return e.name || 'Permanent graphic';
  return e.name ? `${e.type} ${e.name}` : e.type;
}

/** Clips are video; the rest are graphics. */
export function isClipType(type: ElementType): boolean {
  return type === 'VO' || type === 'SOT' || type === 'PKG' || type === 'LITES';
}

/** The color an element is shown in: graphics blue, video red, music purple, permanent graphics green. */
export function elementKind(type: ElementType): 'graphic' | 'clip' | 'music' | 'permanent' {
  if (type === 'PERM') return 'permanent';
  if (type === 'MUSIC') return 'music';
  return isClipType(type) ? 'clip' : 'graphic';
}

/** How a cue chip reads in a script: "Take L3 Score", "★ Station ID" or "♪ PrimeTime Main". */
/**
 * The id of the cue for the commercial break just before a row: the prompter fires it when the break's
 * line reaches the reading line, and the show app plays the show's break graphic (RG, Oct 29, 2026).
 */
export function breakCueId(rowId: string): string {
  return `break-${rowId}`;
}

export function isBreakCue(id: string): boolean {
  return id.startsWith('break-');
}

export function cueLabel(e: Pick<Element, 'type' | 'name'>): string {
  if (e.type === 'PERM') return `★ ${e.name || 'Permanent graphic'}`;
  if (e.type === 'MUSIC') return `♪ ${e.name || 'Music'}`;
  return `Take ${e.type}${e.name ? ` ${e.name}` : ''}`;
}

export function isElementType(value: unknown): value is ElementType {
  return typeof value === 'string' && (ELEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * An admin's change to the commercial break just before a row (decided Oct 29, 2026). Without one, a
 * break of the show's length airs before every block except one that opens the show, and none before
 * a section. off removes the break; seconds adds one, with its own length (null: the show's length).
 */
export type BreakSetting = { off: true } | { seconds: number | null };

export interface BlockRow {
  id: string;
  kind: 'block';
  title: string;
  commercialBreak?: BreakSetting;
  createdBy?: Person;
  updatedBy?: Person;
  updatedAt?: number;
}

export interface SectionRow {
  id: string;
  kind: 'section';
  slug: string;
  /** Story type, from the show's editable list (Intro, Tease, Reader, Cross Talk, Q&A, Package, SOT, Permanent Graphic). */
  type: string;
  /** Who writes the section's script, typed in by the producer. */
  writer: string;
  /**
   * Who reads it on air: one or more of the episode's anchors and correspondents. When several people
   * talk, the script marks each person's part with their name in curly brackets, like {Jordan}. Or just
   * CROSS_TALK, for unscripted cross talk.
   */
  talent: string[];
  /** Camera name from the show's camera list; empty means the show's default camera. */
  camera: string;
  /** The on-screen headline for the section. */
  headline: string;
  /** Free-form notes for the section. */
  notes: string;
  /** Who makes the section's graphics, typed in. */
  assignGraphics: string;
  /** Kept in the rundown but skipped on air. */
  floated: boolean;
  /** Estimated length in seconds, typed in by hand. Later phases add script read time and clip lengths. */
  estSeconds: number | null;
  /** What plays during the section, in order (a Reader might have an L3, then a VO over the anchor). */
  elements: Element[];
  commercialBreak?: BreakSetting;
  createdBy?: Person;
  createdAt?: number;
  updatedBy?: Person;
  updatedAt?: number;
}

export type Row = BlockRow | SectionRow;
/** Fields set with updateRow. Elements have their own functions, so concurrent edits never collide. */
export type SectionFields = Omit<SectionRow, 'id' | 'kind' | 'elements' | 'commercialBreak' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>;

export const EMPTY_SECTION: SectionFields = {
  slug: '',
  type: '',
  writer: '',
  talent: [],
  camera: '',
  headline: '',
  notes: '',
  assignGraphics: '',
  floated: false,
  estSeconds: null,
};

/** The shared list of rows in an episode's document. */
export function rowsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>('rows');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function readRow(map: Y.Map<unknown>): Row {
  const data = map.toJSON() as Partial<Row> & { kind?: string };
  const commercialBreak = readBreakSetting(data.commercialBreak);
  if (data.kind === 'block') {
    return {
      id: String(data.id),
      kind: 'block',
      title: String((data as BlockRow).title ?? ''),
      ...(commercialBreak && { commercialBreak }),
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
      updatedAt: data.updatedAt,
    };
  }
  const s = data as Partial<SectionRow>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  // Only known fields, so anything older documents still carry (like a removed column) is ignored.
  return {
    id: String(s.id),
    kind: 'section',
    slug: text(s.slug),
    type: text(s.type),
    writer: text(s.writer),
    talent: readTalent(s.talent),
    camera: text(s.camera),
    headline: text(s.headline),
    notes: text(s.notes),
    assignGraphics: text(s.assignGraphics),
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt,
    floated: Boolean(s.floated),
    estSeconds: typeof s.estSeconds === 'number' ? s.estSeconds : null,
    elements: Array.isArray(s.elements)
      ? s.elements
          .filter((e) => e && isElementType(e.type))
          .map((e) => ({ id: String(e.id), type: e.type, name: String(e.name ?? '') }))
      : [],
    ...(commercialBreak && { commercialBreak }),
  };
}

function readBreakSetting(value: unknown): BreakSetting | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ((value as { off?: unknown }).off === true) return { off: true };
  const seconds = (value as { seconds?: unknown }).seconds;
  if (seconds === null || (typeof seconds === 'number' && seconds >= 0)) return { seconds };
  return undefined;
}

/** A section's talent list. Sections saved before several people could be picked hold one name as text. */
function readTalent(value: unknown): string[] {
  const names = Array.isArray(value) ? value : [value];
  const clean = names.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean);
  return [...new Set(clean)];
}

/**
 * The Talent choice for real cross talk: everyone talks and there's no formal script, so the prompter
 * just says CROSS TALK. It's picked on its own, never alongside named people.
 */
export const CROSS_TALK = 'Everyone (cross talk)';

export function isCrossTalk(talent: string[]): boolean {
  return talent.includes(CROSS_TALK);
}

/** Ticks or unticks one name. Picking cross talk clears the names, and picking a name clears cross talk. */
export function toggleTalent(talent: string[], name: string): string[] {
  if (name === CROSS_TALK) return isCrossTalk(talent) ? [] : [CROSS_TALK];
  const people = talent.filter((n) => n !== CROSS_TALK);
  return people.includes(name) ? people.filter((n) => n !== name) : [...people, name];
}

/** "Jordan", or "Jordan, Riley Park" when several people read a section. */
export function talentLabel(talent: string[]): string {
  return talent.join(', ');
}

export function readRows(doc: Y.Doc): Row[] {
  return rowsOf(doc).toArray().map(readRow);
}

function toMap(row: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    if (key === 'elements' && Array.isArray(value)) {
      // A shared list, so two people adding elements to the same section never overwrite each other.
      const list = new Y.Array<Element>();
      list.push(value as Element[]);
      map.set(key, list);
    } else {
      map.set(key, value);
    }
  }
  return map;
}

function findMap(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return rowsOf(doc)
    .toArray()
    .find((m) => m.get('id') === id);
}

function indexOf(doc: Y.Doc, id: string): number {
  return rowsOf(doc)
    .toArray()
    .findIndex((m) => m.get('id') === id);
}

/** Adds a block at the given position (or the end) and returns its id. */
export function insertBlock(doc: Y.Doc, by: Person, title = '', index?: number): string {
  const id = newId();
  const rows = rowsOf(doc);
  const now = Date.now();
  rows.insert(index ?? rows.length, [toMap({ id, kind: 'block', title, createdBy: by, updatedBy: by, updatedAt: now })]);
  return id;
}

/** Adds a section at the given position (or the end) and returns its id. */
export function insertSection(
  doc: Y.Doc,
  by: Person,
  fields: Partial<SectionFields> & { elements?: { type: ElementType; name?: string }[] } = {},
  index?: number,
): string {
  const id = newId();
  const rows = rowsOf(doc);
  const now = Date.now();
  const elements = (fields.elements ?? []).map((e) => ({ id: newId(), type: e.type, name: e.name ?? '' }));
  rows.insert(index ?? rows.length, [
    toMap({ ...EMPTY_SECTION, ...fields, elements, id, kind: 'section', createdBy: by, createdAt: now, updatedBy: by, updatedAt: now }),
  ]);
  return id;
}

/** Changes some fields of a row and records who changed it. */
export function updateRow(doc: Y.Doc, id: string, patch: Partial<SectionFields> | { title: string }, by: Person): void {
  const map = findMap(doc, id);
  if (!map) return;
  doc.transact(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (map.get(key) !== value) map.set(key, value);
    }
    map.set('updatedBy', by);
    map.set('updatedAt', Date.now());
  });
}

/** Sets (or, with null, clears) an admin's change to the commercial break before a row. */
export function setCommercialBreak(doc: Y.Doc, id: string, setting: BreakSetting | null, by: Person): void {
  const map = findMap(doc, id);
  if (!map) return;
  doc.transact(() => {
    if (setting) map.set('commercialBreak', setting);
    else map.delete('commercialBreak');
    stamp(map, by);
  });
}

// ---- Elements ----

function elementsOf(map: Y.Map<unknown>): Y.Array<Element> {
  let list = map.get('elements');
  if (!(list instanceof Y.Array)) {
    // Rows made before elements existed get an empty list the first time someone adds one.
    const fresh = new Y.Array<Element>();
    if (Array.isArray(list)) fresh.push(list as Element[]);
    map.set('elements', fresh);
    list = fresh;
  }
  return list as Y.Array<Element>;
}

function stamp(map: Y.Map<unknown>, by: Person): void {
  map.set('updatedBy', by);
  map.set('updatedAt', Date.now());
}

/** Adds an element to the end of a section's list (or at a position) and returns its id. */
export function addElement(doc: Y.Doc, sectionId: string, type: ElementType, by: Person, name = '', index?: number): string | undefined {
  const map = findMap(doc, sectionId);
  if (!map || map.get('kind') !== 'section') return undefined;
  const id = newId();
  doc.transact(() => {
    const list = elementsOf(map);
    list.insert(Math.min(index ?? list.length, list.length), [{ id, type, name }]);
    stamp(map, by);
  });
  return id;
}

/** Renames an element or changes its type. */
export function updateElement(doc: Y.Doc, sectionId: string, elementId: string, patch: Partial<Pick<Element, 'type' | 'name'>>, by: Person): void {
  const map = findMap(doc, sectionId);
  if (!map) return;
  doc.transact(() => {
    const list = elementsOf(map);
    const i = list.toArray().findIndex((e) => e.id === elementId);
    if (i < 0) return;
    const next = { ...list.get(i), ...patch };
    list.delete(i, 1);
    list.insert(i, [next]);
    stamp(map, by);
  });
}

export function removeElement(doc: Y.Doc, sectionId: string, elementId: string, by: Person): void {
  const map = findMap(doc, sectionId);
  if (!map) return;
  doc.transact(() => {
    const list = elementsOf(map);
    const i = list.toArray().findIndex((e) => e.id === elementId);
    if (i >= 0) list.delete(i, 1);
    stamp(map, by);
  });
}

/** Moves an element earlier or later in its section (the order elements are expected to fire). */
export function moveElement(doc: Y.Doc, sectionId: string, elementId: string, to: number, by: Person): void {
  const map = findMap(doc, sectionId);
  if (!map) return;
  doc.transact(() => {
    const list = elementsOf(map);
    const from = list.toArray().findIndex((e) => e.id === elementId);
    if (from < 0 || to < 0 || to >= list.length || from === to) return;
    const element = list.get(from);
    list.delete(from, 1);
    list.insert(to, [element]);
    stamp(map, by);
  });
}

export function deleteRow(doc: Y.Doc, id: string): void {
  const i = indexOf(doc, id);
  if (i >= 0) rowsOf(doc).delete(i, 1);
}

/**
 * Moves a row. Yjs lists can't move items, so the row is copied to its new place and the old one
 * removed, in one step that everyone sees at once. Its id and authorship stay the same.
 */
export function moveRow(doc: Y.Doc, from: number, to: number): void {
  const rows = rowsOf(doc);
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
  doc.transact(() => {
    const data = rows.get(from).toJSON() as Record<string, unknown>;
    rows.delete(from, 1);
    rows.insert(to, [toMap(data)]);
  });
}

/** A new episode starts with block A and one empty section. Does nothing if rows already exist. */
export function initEpisode(doc: Y.Doc, by: Person): void {
  if (rowsOf(doc).length > 0) return;
  doc.transact(() => {
    insertBlock(doc, by);
    insertSection(doc, by);
  });
}

// ---- Numbering and timing ----

export interface ComputedRow {
  row: Row;
  /** "A" for a block, "A1" for a section. */
  label: string;
  blockLetter: string;
  /** This section's estimated length (0 for blocks). */
  seconds: number;
  /** Seconds from the start of the show when this row starts, if everything runs to time. Null when floated. */
  startOffset: number | null;
  /** Seconds from the start of the show when this row must start to finish exactly on time. Null when floated. */
  backTimeOffset: number | null;
  /** The commercial break that airs just before this row, if there is one. */
  breakBefore?: CommercialBreak;
}

/** A commercial break: added automatically between blocks, or by an admin anywhere. */
export interface CommercialBreak {
  seconds: number;
  startOffset: number;
  backTimeOffset: number;
  /** True for the break added automatically before a block; false for one an admin added. */
  automatic: boolean;
  /** True when an admin typed in its length, instead of using the show's break length. */
  customLength: boolean;
}

export interface RundownTiming {
  rows: ComputedRow[];
  /** Total estimated length of everything that will air, commercial breaks included (floated sections don't count). */
  totalSeconds: number;
  /** How many commercial breaks there are. */
  breakCount: number;
  /** How many of them use the show's break length (rather than one an admin typed in). */
  defaultBreakCount: number;
  targetSeconds: number;
  /** Positive = over the target, negative = under. */
  overUnderSeconds: number;
  /** Estimated length of each block, by letter. */
  blockSeconds: Record<string, number>;
}

/** A, B, … Z, then AA, AB… (shows rarely have more than a handful of blocks). */
export function blockLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Numbers every row and works out timing. Sections are numbered within their block (A1, A2, B1…),
 * floated ones included, so floating a section doesn't renumber the graphics named after it.
 * Sections above the first block belong to block A. A commercial break of breakSeconds airs before every
 * block except one that opens the show, unless an admin removed it; admins can also add breaks before
 * any row and give a break its own length (see BreakSetting).
 */
export function computeRundown(
  rows: Row[],
  targetSeconds: number,
  sectionSeconds: (row: SectionRow) => number = (r) => r.estSeconds ?? 0,
  breakSeconds = 0,
): RundownTiming {
  const computed: ComputedRow[] = [];
  const blockSeconds: Record<string, number> = {};
  let blockIndex = rows[0]?.kind === 'block' ? -1 : 0;
  let sectionInBlock = 0;
  let elapsed = 0;
  let breakCount = 0;
  let defaultBreakCount = 0;
  // The break before a row, if one airs there.
  const breakFor = (row: Row): CommercialBreak | undefined => {
    if (computed.length === 0) return undefined;
    const automatic = row.kind === 'block';
    const setting = row.commercialBreak;
    if (setting ? 'off' in setting : !automatic) return undefined;
    const customLength = Boolean(setting && 'seconds' in setting && setting.seconds !== null);
    const seconds = customLength ? (setting as { seconds: number }).seconds : breakSeconds;
    breakCount++;
    if (!customLength) defaultBreakCount++;
    const commercialBreak = { seconds, startOffset: elapsed, backTimeOffset: 0, automatic, customLength };
    elapsed += seconds;
    return commercialBreak;
  };

  for (const row of rows) {
    const breakBefore = breakFor(row);
    if (row.kind === 'block') {
      blockIndex++;
      sectionInBlock = 0;
      const letter = blockLetter(blockIndex);
      blockSeconds[letter] ??= 0;
      computed.push({ row, label: letter, blockLetter: letter, seconds: 0, startOffset: elapsed, backTimeOffset: null, ...(breakBefore && { breakBefore }) });
      continue;
    }
    sectionInBlock++;
    const letter = blockLetter(Math.max(0, blockIndex));
    const seconds = Math.max(0, sectionSeconds(row));
    const airs = !row.floated;
    computed.push({ row, label: `${letter}${sectionInBlock}`, blockLetter: letter, seconds, startOffset: airs ? elapsed : null, backTimeOffset: null, ...(breakBefore && { breakBefore }) });
    if (airs) {
      elapsed += seconds;
      blockSeconds[letter] = (blockSeconds[letter] ?? 0) + seconds;
    }
  }

  // Back-times: work backwards from the target end.
  let remaining = 0;
  for (let i = computed.length - 1; i >= 0; i--) {
    const c = computed[i];
    const floated = c.row.kind === 'section' && c.row.floated;
    if (!floated) {
      remaining += c.seconds;
      c.backTimeOffset = targetSeconds - remaining;
    }
    if (c.breakBefore) {
      remaining += c.breakBefore.seconds;
      c.breakBefore.backTimeOffset = targetSeconds - remaining;
    }
  }

  return { rows: computed, totalSeconds: elapsed, breakCount, defaultBreakCount, targetSeconds, overUnderSeconds: elapsed - targetSeconds, blockSeconds };
}

// ---- Formatting ----

/** 95 → "1:35", 3725 → "1:02:05", -30 → "-0:30". */
export function formatDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.round(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${sec}` : `${sign}${m}:${sec}`;
}

/** "1:35" → 95, "95" → 95, "1:02:05" → 3725, "" → null. Returns undefined when it can't be read. */
export function parseDuration(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return undefined;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** "+2:10 over", "1:05 under", "on time". */
export function formatOverUnder(seconds: number): string {
  if (Math.round(seconds) === 0) return 'on time';
  return seconds > 0 ? `${formatDuration(seconds)} over` : `${formatDuration(-seconds)} under`;
}

/** Clock time for an offset into a show that starts at "HH:MM" (24-hour), e.g. "7:12:30 PM". */
export function formatClock(startTime: string, offsetSeconds: number): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return `+${formatDuration(offsetSeconds)}`;
  const total = Math.round(Number(match[1]) * 3600 + Number(match[2]) * 60 + offsetSeconds);
  const day = ((total % 86400) + 86400) % 86400;
  const h24 = Math.floor(day / 3600);
  const m = String(Math.floor((day % 3600) / 60)).padStart(2, '0');
  const s = String(day % 60).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m}:${s} ${h24 < 12 ? 'AM' : 'PM'}`;
}
