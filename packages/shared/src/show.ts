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
  /** Story types for the rundown's Story Type column. */
  segmentTypes: string[];
  /**
   * Graphics used in every episode (Station ID, Show Intro…). They must be loaded on the TriCaster before
   * every show, and the rundown's Graphics column picks them as PERM elements.
   */
  permanentGraphics: string[];
  /**
   * The permanent graphics that are clips with their own audio, like the Show Intro and Station ID (RG,
   * Oct 29, 2026). They play to their end like a SOT. The rest, like Social Media L3, are lower thirds.
   */
  permanentWithSound: string[];
  /** Length of each commercial break between blocks, in seconds. 0 leaves breaks out of the show's timing. */
  breakSeconds: number;
  /** Which TriCaster input each camera is, by camera name (Camera 1 → 1). Set once per show. */
  cameraInputs: Record<string, number>;
}

export const TALENT_COLORS = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];

export const DEFAULT_SHOW_SETTINGS: ShowSettings = {
  targetSeconds: 30 * 60,
  wordsPerMinute: 160,
  cameras: ['Camera 1', 'Camera 2', 'Camera 3'],
  defaultCamera: 'Camera 1',
  talent: [],
  // TSTV's section types (RG, Oct 28, 2026). What plays during a section goes in its Elements instead.
  segmentTypes: ['Intro', 'Tease', 'Reader', 'Cross Talk', 'Q&A', 'Package', 'SOT', 'Permanent Graphic'],
  // TSTV's permanent graphics (RG, Oct 29, 2026). Each show can edit its own list.
  permanentGraphics: ['Station ID', 'Show Intro', 'Commercial Break', 'Social Media L3', 'Website L3', 'Station Outro'],
  permanentWithSound: ['Station ID', 'Show Intro', 'Commercial Break', 'Station Outro'],
  breakSeconds: 0,
  // TSTV's TC1: cameras are inputs 1–3 (probe, Oct 28, 2026).
  cameraInputs: { 'Camera 1': 1, 'Camera 2': 2, 'Camera 3': 3 },
};

/** A camera's TriCaster input, from the show's settings (input 1 for a camera that isn't listed). */
export function cameraInput(settings: ShowSettings, camera: string): number {
  return settings.cameraInputs[camera] ?? 1;
}

/** The permanent graphic that plays during commercial breaks: the first whose name mentions a break. */
export function breakGraphic(settings: ShowSettings): string | undefined {
  return settings.permanentGraphics.find((g) => /break/i.test(g));
}

/** Earlier default lists. Shows still using one unchanged get TSTV's current list instead. */
const EARLIER_DEFAULT_SEGMENT_TYPES = [
  ['Reader', 'VO', 'VO/SOT', 'SOT', 'PKG', 'OTS', 'FSG', 'Weather', 'Tease', 'Lites'],
  ['Intro', 'Tease', 'Reader', 'Cross Talk'],
  ['Intro', 'Tease', 'Reader', 'Cross Talk', 'Package', 'SOT'],
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
  const breakSeconds = Number(s.breakSeconds);
  const permanentGraphics = strings(s.permanentGraphics, DEFAULT_SHOW_SETTINGS.permanentGraphics);
  const cameraInputs: Record<string, number> = {};
  cameras.forEach((camera, i) => {
    const input = Number((s.cameraInputs as Record<string, unknown> | undefined)?.[camera]);
    // Unset: the number in the camera's name (Camera 2 → 2), else its place in the list.
    const named = /(\d+)\s*$/.exec(camera);
    cameraInputs[camera] = Number.isInteger(input) && input >= 1 && input <= 16 ? input : named ? Math.min(16, Math.max(1, Number(named[1]))) : Math.min(16, i + 1);
  });
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
    permanentGraphics,
    // Shows saved before this setting: everything but the lower thirds has its own audio.
    permanentWithSound: Array.isArray(s.permanentWithSound)
      ? strings(s.permanentWithSound, []).filter((g) => permanentGraphics.includes(g))
      : permanentGraphics.filter((g) => !/\bL3\b|lower third/i.test(g)),
    cameraInputs,
    breakSeconds: Number.isFinite(breakSeconds) && breakSeconds >= 0 && breakSeconds <= 3600 ? Math.round(breakSeconds) : DEFAULT_SHOW_SETTINGS.breakSeconds,
  };
}
