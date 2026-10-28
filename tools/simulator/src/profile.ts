// What the simulated TC1 looks like: its inputs, players, macros and starting playlists.
// Names come from Bitfocus Companion and node-tricaster where known. Names marked as guesses
// get replaced with the real TC1's names once the probe results are in.

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
  version: '7-7 (simulated)',
  build: '210722',
  machine: 'TSTV-SIM',
  session: 'Practice',
} as const;

/** Camera and other inputs. Which real input each camera uses is still an open question in the brief. */
export const INPUTS = [
  { id: 'input1', longName: 'Camera 1', shortName: 'CAM 1' },
  { id: 'input2', longName: 'Camera 2', shortName: 'CAM 2' },
  { id: 'input3', longName: 'Camera 3', shortName: 'CAM 3' },
  { id: 'input4', longName: 'Input 4', shortName: 'IN 4' },
  { id: 'input5', longName: 'Input 5', shortName: 'IN 5' },
  { id: 'input6', longName: 'Input 6', shortName: 'IN 6' },
  { id: 'input7', longName: 'Input 7', shortName: 'IN 7' },
  { id: 'input8', longName: 'Input 8', shortName: 'IN 8' },
] as const;

export const PLAYERS = [
  { id: 'ddr1', label: 'DDR 1', stills: false },
  { id: 'ddr2', label: 'DDR 2', stills: false },
  { id: 'gfx1', label: 'GFX 1', stills: true },
  { id: 'gfx2', label: 'GFX 2', stills: true },
] as const;

export const ME_COUNT = 4;
export const DSK_COUNT = 4;

export const DEFAULT_PLAYLISTS: Record<string, ClipSpec[]> = {
  ddr1: [{ name: 'GS_City_Loop', durationMs: 30_000 }],
  ddr2: [
    { name: 'A1_L3_Anchors', durationMs: 8_000 },
    { name: 'A2_VO_Basketball', durationMs: 25_000 },
    { name: 'A3_SOT_Coach', durationMs: 18_000 },
    { name: 'B1_OTSL_Election', durationMs: 10_000 },
    { name: 'B2_FSG_Weather', durationMs: 10_000 },
    { name: 'B3_PKG_CampusFood', durationMs: 90_000 },
  ],
  gfx1: [
    { name: 'GS_Studio_Default', durationMs: 0 },
    { name: 'GS_Weather_Map', durationMs: 0 },
  ],
  gfx2: [],
};

/** The green-screen M/E: GFX 1 background with a keyed camera on top. */
export const GREEN_SCREEN = { me: 'v2', background: 'gfx1', keyedCamera: 'input3' } as const;

export const MACROS: MacroSpec[] = [
  { name: 'Restart DDR2 Playlist', folder: 'system', commands: [{ name: 'ddr2_stop' }, { name: 'ddr2_select_index', value: '0' }] },
  { name: 'TSTV Green Screen On', folder: 'session', commands: [{ name: 'main_a_row', value: 'v2' }] },
  { name: 'TSTV Green Screen Off', folder: 'session', commands: [{ name: 'main_a_row', value: 'input1' }] },
];

/**
 * Command and state names the simulator uses without confirmation from Bitfocus code. The simulator
 * page marks commands that use them, so nobody mistakes a guess for the real TC1's behavior.
 */
export const GUESSED_NAMES = new Set([
  'main_take',
  'main_auto',
  'record_start',
  'record_stop',
  ...['ddr1', 'ddr2', 'gfx1', 'gfx2'].flatMap((p) => [`${p}_select_index`, `${p}_clip_index`, `${p}_clip_name`, `${p}_clip_count`]),
  ...Array.from({ length: DSK_COUNT }, (_, i) => `main_dsk${i + 1}_select`),
  ...Array.from({ length: ME_COUNT }, (_, i) => `v${i + 1}_key`),
]);
