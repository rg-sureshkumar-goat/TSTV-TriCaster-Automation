// What the simulated TC1 looks like. Matches TSTV's real TC1 as recorded by the probe on Oct 28, 2026
// (tools/probe/results, kept off GitHub): source numbering, names, how program runs through M/E 1,
// DSK 2 showing DDR 2 with AutoPlay, and the green screen on M/E 2. See docs/TC1-FINDINGS.md.

export interface ClipSpec {
  name: string;
  durationMs: number;
}

export interface MacroSpec {
  name: string;
  folder: 'system' | 'session';
  commands: { name: string; value?: string }[];
}

export const PRODUCT = {
  name: 'TSTV Simulator',
  model: 'TC1',
  version: '7-7 (simulated)',
  build: '210722',
  machine: 'TSTV-SIM',
  session: 'Practice',
} as const;

/** The TC1's own source numbers (its tally index), as reported by the real switcher. */
export const SOURCE_INDEX: Record<string, number> = {
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`input${i + 1}`, i])),
  ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`bfr${i + 1}`, 16 + i])),
  ddr1: 39,
  ddr2: 40,
  gfx1: 41,
  gfx2: 42,
  v1: 43,
  v2: 44,
  v3: 45,
  v4: 46,
  black: -1,
};

/** Inputs keep the TC1's own names. Which input is which camera is TSTV's setup, below. */
export const INPUTS = Array.from({ length: 16 }, (_, i) => ({
  id: `input${i + 1}`,
  longName: `INPUT ${i + 1}`,
  shortName: String(i + 1),
}));

/** TSTV's studio cameras. Cameras 1 and 2 have prompter monitors; camera 3 is the wide shot. */
export const CAMERAS = [
  { id: 'input1', label: 'Camera 1 (prompter)' },
  { id: 'input2', label: 'Camera 2 (prompter)' },
  { id: 'input3', label: 'Camera 3 (wide)' },
] as const;

/** DDR 1 and DDR 2 are named "A" and "B" on TSTV's TC1. DDR 2 has AutoPlay on and plays one clip at a time. */
export const PLAYERS = [
  { id: 'ddr1', label: 'A', stills: false, autoplay: false },
  { id: 'ddr2', label: 'B', stills: false, autoplay: true },
  { id: 'gfx1', label: 'GFX 1', stills: true, autoplay: false },
  { id: 'gfx2', label: 'GFX 2', stills: true, autoplay: false },
  // The Sound player holds the show's music, with AutoPlay off (probe, Oct 28, 2026).
  { id: 'sound', label: 'SOUND', stills: false, autoplay: false },
] as const;

export const ME_COUNT = 4;
export const DSK_COUNT = 4;

/** Program runs through M/E 1: the main program row shows M/E 1, and cameras are switched on M/E 1's A row. */
export const PROGRAM_ME = 'v1';

/** The green screen is M/E 2: a camera on its A row keyed over GFX 1 on its B row. All three cameras face it. */
export const GREEN_SCREEN = { me: 'v2', background: 'gfx1', keyedCamera: 'input2' } as const;

/** Main DSK sources as found on the TC1: DSK 2 shows DDR 2, DSK 3 is the bug in buffer 11. */
export const DSK_SOURCES: Record<string, string> = { main_dsk1: 'ddr1', main_dsk2: 'ddr2', main_dsk3: 'bfr11', main_dsk4: 'ddr1' };

/** The clip held during commercial breaks, at the start of every block in DDR 2. */
export const BREAK_CLIP: ClipSpec = { name: 'TSTV Ident 2022 News', durationMs: 4_963 };

/** A short practice show laid out the way TSTV's DDR 2 playlists are. */
export const DEFAULT_PLAYLISTS: Record<string, ClipSpec[]> = {
  ddr1: [],
  ddr2: [
    BREAK_CLIP,
    { name: 'A1_L3_Anchors', durationMs: 20_000 },
    { name: 'A2_VO_Basketball', durationMs: 25_000 },
    { name: 'A3_SOT_Coach', durationMs: 18_400 },
    BREAK_CLIP,
    { name: 'B1_OTSL_Election', durationMs: 20_000 },
    { name: 'B2_FSG_Weather', durationMs: 25_000 },
    { name: 'B3_PKG_CampusFood', durationMs: 90_000 },
    BREAK_CLIP,
    { name: 'C1_TEASE_Sports', durationMs: 20_000 },
  ],
  gfx1: [
    { name: 'PrimeTime Main BG', durationMs: 0 },
    { name: 'Weather Map BG', durationMs: 0 },
  ],
  gfx2: [],
  sound: [
    { name: 'PrimeTime Main', durationMs: 56_000 },
    { name: 'PrimeTime Transition Music', durationMs: 21_000 },
  ],
};

export const MACROS: MacroSpec[] = [
  { name: 'TSTV Green Screen On', folder: 'session', commands: [{ name: 'main_a_row', value: 'V2' }] },
  { name: 'TSTV Green Screen Off', folder: 'session', commands: [{ name: 'main_a_row', value: 'V1' }] },
];

/**
 * Command names the simulator accepts that are not yet confirmed on the real TC1. Bitfocus Companion's
 * names and the TC1's own state names are more trustworthy. Every command gets confirmed in live mode
 * in Phase 5; the simulator page marks these so nobody mistakes a guess for the real TC1's behavior.
 */
export const GUESSED_NAMES = new Set([
  'record_start',
  'record_stop',
  ...['ddr1', 'ddr2', 'gfx1', 'gfx2'].flatMap((p) => [`${p}_select_index`, `${p}_select_clips`]),
  'sound_select_index',
  ...Array.from({ length: DSK_COUNT }, (_, i) => `main_dsk${i + 1}_select`),
]);
