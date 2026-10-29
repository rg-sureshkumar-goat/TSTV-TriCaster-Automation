// A show's settings. Every show uses the same interface; shows differ only in these.

export interface Talent {
  name: string;
  /** Color for the talent's name on the prompter and in the rundown. */
  color: string;
}

export interface ShowSettings {
  /** Target length of an episode, in seconds (default 30:00). */
  targetSeconds: number;
  /** Reading speed used to time scripts. */
  wordsPerMinute: number;
  /** Camera names producers pick from in the rundown. */
  cameras: string[];
  /** Camera used when a section doesn't name one. */
  defaultCamera: string;
  /** The show's usual on-air talent. */
  talent: Talent[];
  /** Segment types for the rundown's Type column. */
  segmentTypes: string[];
}

export const TALENT_COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];

export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  targetSeconds: 30 * 60,
  wordsPerMinute: 160,
  cameras: ['Camera 1', 'Camera 2', 'Camera 3'],
  defaultCamera: 'Camera 1',
  talent: [],
  // TSTV's section types (RG, Oct 28, 2026). What plays during a section goes in its Elements instead.
  segmentTypes: ['Intro', 'Tease', 'Reader', 'Cross Talk', 'Package', 'SOT'],
};

/** Earlier default lists. Shows still using one unchanged get TSTV's current list instead. */
const EARLIER_DEFAULT_SEGMENT_TYPES = [
  ['Reader', 'VO', 'VO/SOT', 'SOT', 'PKG', 'OTS', 'FSG', 'Weather', 'Tease', 'Lites'],
  ['Intro', 'Tease', 'Reader', 'Cross Talk'],
].map((list) => list.join('|'));

/** Fills in anything missing or malformed, so old or hand-edited settings never break the site. */
export function normalizeShowSettings(input: unknown): ShowSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<ShowSettings>;
  const strings = (v: unknown, fallback: string[]) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : fallback;
  const cameras = strings(s.cameras, DEFAULT_SHOW_SETTINGS.cameras);
  const talent = Array.isArray(s.talent)
    ? s.talent
        .map((t, i) => ({
          name: String((t as Talent)?.name ?? '').trim(),
          color: /^#[0-9a-f]{6}$/i.test(String((t as Talent)?.color)) ? String((t as Talent).color) : TALENT_COLORS[i % TALENT_COLORS.length],
        }))
        .filter((t) => t.name)
        .slice(0, 50)
    : [];
  const target = Number(s.targetSeconds);
  const wpm = Number(s.wordsPerMinute);
  return {
    targetSeconds: Number.isFinite(target) && target > 0 && target <= 6 * 3600 ? Math.round(target) : DEFAULT_SHOW_SETTINGS.targetSeconds,
    wordsPerMinute: Number.isFinite(wpm) && wpm >= 60 && wpm <= 400 ? Math.round(wpm) : DEFAULT_SHOW_SETTINGS.wordsPerMinute,
    cameras,
    defaultCamera: cameras.includes(String(s.defaultCamera)) ? String(s.defaultCamera) : cameras[0] ?? '',
    talent,
    segmentTypes: (() => {
      const types = strings(s.segmentTypes, DEFAULT_SHOW_SETTINGS.segmentTypes);
      return EARLIER_DEFAULT_SEGMENT_TYPES.includes(types.join('|')) ? [...DEFAULT_SHOW_SETTINGS.segmentTypes] : types;
    })(),
  };
}
