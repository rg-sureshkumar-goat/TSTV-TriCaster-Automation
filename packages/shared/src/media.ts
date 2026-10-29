// Graphics and clip files, matched to the rundown's elements by name. TSTV names files
// [Block][Section]_[Type]_[Slug], like B5_VO_Basketball.mov. The real DDR 2 playlist also has OTS_L and
// OTS_R, double underscores, copies ending in "(1)" or "copy", spaces in slugs, and two more types: NAMES
// (a lower third with the anchors' and correspondents' names) and RDR (an OTS graphic) (RG, Oct 29, 2026).
//
// The show app stops and asks the producer whenever it can't decide which element a file belongs to.
import * as Y from 'yjs';
import type { ElementType, Row } from './rundown.ts';

export interface ParsedMediaName {
  /** The section it's for, like "B5". */
  section: string;
  /** The type as written in the name, like "OTS_L" or "NAMES". */
  writtenType: string;
  /** The rundown element types it can be. */
  types: ElementType[];
  slug: string;
  /** The name ends in "(1)", "copy" or similar. */
  copy: boolean;
}

const TYPES: Record<string, ElementType[]> = {
  L3: ['L3'],
  NAMES: ['L3'],
  OTSL: ['OTSL'],
  OTS_L: ['OTSL'],
  OTSR: ['OTSR'],
  OTS_R: ['OTSR'],
  OTS: ['OTSL', 'OTSR'],
  RDR: ['OTSL', 'OTSR'],
  FSG: ['FSG'],
  TEASE: ['TEASE'],
  LITES: ['LITES'],
  VO: ['VO'],
  SOT: ['SOT'],
  PKG: ['PKG'],
};

const NAME = /^([A-Za-z]{1,2})(\d{1,3})_+(OTS_L|OTS_R|OTSL|OTSR|OTS|RDR|NAMES|L3|FSG|TEASE|LITES|VO|SOT|PKG)(?:_+(.*))?$/i;
const COPY = /(\s*\(\d+\)|[\s_-]*copy(\s*\d+)?)$/i;

/** Reads a file name like "B5_VO_Basketball.mov". Returns null for a name that doesn't follow the pattern. */
export function parseMediaName(fileName: string): ParsedMediaName | null {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').trim();
  const m = NAME.exec(base);
  if (!m) return null;
  let slug = (m[4] ?? '').trim();
  const copy = COPY.test(slug);
  slug = slug.replace(COPY, '').trim();
  const written = m[3].toUpperCase();
  return { section: `${m[1].toUpperCase()}${Number(m[2])}`, writtenType: written, types: TYPES[written], slug, copy };
}

/** Letters and digits only, lowercase, for comparing slugs loosely. */
function simple(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when a file's slug plausibly belongs to a section or element named this. With no slug or name to
 * compare (a section without a slug yet), there's nothing to doubt.
 */
export function slugMatches(fileSlug: string, ...names: string[]): boolean {
  const a = simple(fileSlug);
  const known = names.map(simple).filter(Boolean);
  if (!a || known.length === 0) return true;
  return known.some((b) => a.includes(b) || b.includes(a));
}

export interface MediaSection {
  label: string;
  slug: string;
  elements: { id: string; type: ElementType; name: string }[];
}

export interface MediaMatch {
  file: string;
  elementId: string;
  section: string;
  /** The file's slug doesn't look like the section's slug or the element's name: the producer should check. */
  checkSlug: boolean;
}

export type MediaProblem =
  | { file: string; reason: 'pattern' }
  | { file: string; reason: 'no-section'; section: string }
  | { file: string; reason: 'no-element'; section: string; type: string }
  | { file: string; reason: 'which-element'; section: string; candidates: string[] };

export interface MediaMatchResult {
  matches: MediaMatch[];
  /** Files the producer has to place by hand, and why. */
  problems: MediaProblem[];
}

/** Elements that play from DDR 2 and get their file from the graphics team (not permanent graphics or music). */
const FILE_TYPES = new Set<ElementType>(['L3', 'OTSL', 'OTSR', 'FSG', 'TEASE', 'LITES', 'VO', 'SOT', 'PKG']);

/**
 * Matches files to elements by section number and type, then checks the slug. Two files of one type for
 * a section are told apart by the elements' names; when that doesn't settle it, the producer decides.
 * Elements that already have a file (taken) aren't matched again.
 */
export function matchMedia(files: string[], sections: MediaSection[], taken: Set<string> = new Set()): MediaMatchResult {
  const matches: MediaMatch[] = [];
  const problems: MediaProblem[] = [];
  const byLabel = new Map(sections.map((s) => [s.label.toUpperCase(), s]));
  // Group the files by section and the set of types they can be.
  const groups = new Map<string, { section: MediaSection; types: ElementType[]; files: { file: string; parsed: ParsedMediaName }[] }>();
  for (const file of files) {
    const parsed = parseMediaName(file);
    if (!parsed) {
      problems.push({ file, reason: 'pattern' });
      continue;
    }
    const section = byLabel.get(parsed.section);
    if (!section) {
      problems.push({ file, reason: 'no-section', section: parsed.section });
      continue;
    }
    const key = `${section.label}|${parsed.types.join(',')}`;
    const group = groups.get(key) ?? { section, types: parsed.types, files: [] };
    group.files.push({ file, parsed });
    groups.set(key, group);
  }
  const used = new Set(taken);
  for (const { section, types, files: group } of groups.values()) {
    const candidates = section.elements.filter((e) => FILE_TYPES.has(e.type) && types.includes(e.type) && !used.has(e.id));
    if (candidates.length === 0) {
      for (const f of group) problems.push({ file: f.file, reason: 'no-element', section: section.label, type: f.parsed.writtenType });
      continue;
    }
    const place = (f: (typeof group)[number], elementId: string) => {
      const element = section.elements.find((e) => e.id === elementId)!;
      used.add(elementId);
      matches.push({ file: f.file, elementId, section: section.label, checkSlug: !slugMatches(f.parsed.slug, section.slug, element.name) });
    };
    if (group.length === 1 && candidates.length === 1) {
      place(group[0], candidates[0].id);
      continue;
    }
    // Several files or several elements: pair them up by the elements' names, when each is clear.
    const left = [...candidates];
    for (const f of group) {
      const named = left.filter((e) => e.name && slugMatches(f.parsed.slug, e.name));
      if (named.length === 1) {
        place(f, named[0].id);
        left.splice(left.indexOf(named[0]), 1);
      } else {
        problems.push({ file: f.file, reason: 'which-element', section: section.label, candidates: left.map((e) => e.id) });
      }
    }
  }
  return { matches, problems };
}

/** What the show app reports for an element: its file, and the clip's length in seconds when it has one. */
export interface MediaStatus {
  file: string;
  seconds: number | null;
}

/** Each element's file, by element id, as the show app reported it. Only the episode room writes it. */
export function mediaOf(doc: Y.Doc): Y.Map<MediaStatus> {
  return doc.getMap<MediaStatus>('media');
}

export function readMedia(doc: Y.Doc): Record<string, MediaStatus> {
  return Object.fromEntries(mediaOf(doc).entries());
}

/** Run by the episode room for the show app: sets (or, with null, clears) elements' files. */
export function setMedia(doc: Y.Doc, items: Record<string, unknown>): void {
  const media = mediaOf(doc);
  doc.transact(() => {
    for (const [id, value] of Object.entries(items).slice(0, 500)) {
      if (!/^[\w-]{1,64}$/.test(id)) continue;
      const v = value as Partial<MediaStatus> | null;
      if (!v) {
        media.delete(id);
        continue;
      }
      if (typeof v.file !== 'string' || !v.file) continue;
      const seconds = typeof v.seconds === 'number' && Number.isFinite(v.seconds) && v.seconds >= 0 ? Math.round(v.seconds * 10) / 10 : null;
      const next = { file: v.file.slice(0, 200), seconds };
      const current = media.get(id);
      if (current?.file !== next.file || current?.seconds !== next.seconds) media.set(id, next);
    }
  });
}

/** How long each section's SOTs and packages run, from the clip lengths the show app measured. */
export function clipSecondsBySection(rows: Row[], media: Record<string, MediaStatus>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.kind !== 'section') continue;
    const seconds = row.elements.filter((e) => e.type === 'SOT' || e.type === 'PKG').reduce((sum, e) => sum + (media[e.id]?.seconds ?? 0), 0);
    if (seconds > 0) out[row.id] = Math.round(seconds);
  }
  return out;
}
