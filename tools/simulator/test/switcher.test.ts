// The simulator should behave like TSTV's real TC1 as recorded by the probe on Oct 28, 2026.
import { afterEach, describe, expect, it } from 'vitest';
import { Switcher, type ChangeEvent } from '../src/switcher.ts';

let sw: Switcher;
afterEach(() => sw?.close());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = (name: string) => sw.shortcutStates().get(name)?.value;

describe('program runs through M/E 1', () => {
  it('starts with M/E 1 on program and Camera 1 on its A row', () => {
    sw = new Switcher();
    expect(state('main_a_row_named_input')).toBe('V1');
    expect(state('main_a_row')).toBe('43');
    expect(state('v1_a_row_named_input')).toBe('INPUT1');
    expect(state('program_tally')).toBe('INPUT1');
  });

  it('switches cameras on M/E 1, by name or by TC1 source number', () => {
    sw = new Switcher();
    sw.command('http', 'v1_a_row', 'INPUT2');
    expect(state('v1_a_row_named_input')).toBe('INPUT2');
    sw.command('http', 'v1_a_row', '2');
    expect(state('v1_a_row_named_input')).toBe('INPUT3');
    expect(state('program_tally')).toBe('INPUT3');
    expect(sw.command('http', 'v1_a_row', 'INPUT99').result).toBe('rejected');
  });

  it('takes the green screen (M/E 2) to air with its camera keyed over GFX 1', () => {
    sw = new Switcher();
    sw.command('http', 'v2_a_row', 'INPUT1');
    sw.command('http', 'main_a_row', 'V2');
    expect(state('main_a_row_named_input')).toBe('V2');
    expect(state('program_tally')).toBe('INPUT1|GFX1');
    const onPgm = sw.tallyColumns().filter((c) => c.onPgm).map((c) => c.name);
    expect(onPgm).toEqual(expect.arrayContaining(['v2', 'input1', 'gfx1']));
  });

  it('swaps program and preview on auto', () => {
    sw = new Switcher();
    sw.command('http', 'main_b_row', 'V2');
    sw.command('http', 'main_auto');
    expect([sw.program, sw.preview]).toEqual(['v2', 'v1']);
  });
});

describe('DSK 2 and DDR 2 with AutoPlay', () => {
  it('plays the cued clip when DSK 2 goes on, and stops and cues the next one when it goes off', () => {
    sw = new Switcher();
    sw.command('http', 'ddr2_select_index', '1');
    sw.command('http', 'main_dsk2_take');
    expect(state('main_dsk2_value')).toBe('1');
    expect(state('ddr2_play')).toBe('true');
    expect(state('program_tally')).toBe('INPUT1|DDR2');
    sw.command('http', 'main_dsk2_take');
    expect(state('main_dsk2_value')).toBe('0');
    expect(state('ddr2_play')).toBe('false');
    expect(state('ddr2_select_clips')).toBe('2|');
  });

  it('takes DSK 2 on when DDR 2 is played', () => {
    sw = new Switcher();
    sw.command('http', 'ddr2_play');
    expect(state('main_dsk2_value')).toBe('1');
  });

  it('keeps DSK 2 on when a clip ends by itself, as the real TC1 does', async () => {
    sw = new Switcher();
    sw.loadPlaylist('ddr2', [
      { name: 'B5_VO_Basketball', durationMs: 250 },
      { name: 'B6_SOT_Coach', durationMs: 1000 },
    ]);
    const ended: string[] = [];
    sw.on('clipEnded', (e: { clip: string }) => ended.push(e.clip));
    sw.command('http', 'main_dsk2_take');
    await wait(500);
    expect(ended).toEqual(['B5_VO_Basketball']);
    expect(state('ddr2_play')).toBe('false');
    expect(state('ddr2_stop')).toBe('true');
    expect(state('main_dsk2_value')).toBe('1');
  });

  it('does not take DSK 2 off when DDR 2 is stopped', () => {
    sw = new Switcher();
    sw.command('http', 'main_dsk2_take');
    sw.command('http', 'ddr2_stop');
    expect(state('main_dsk2_value')).toBe('1');
    expect(state('ddr2_play')).toBe('false');
  });

  it('starts with the commercial-break clip at the top of each block', () => {
    sw = new Switcher();
    const names = sw.players.ddr2.playlist.map((c) => c.name);
    expect(names[0]).toBe('TSTV Ident 2022 News');
    expect(names.filter((n) => n === 'TSTV Ident 2022 News')).toHaveLength(3);
  });
});

describe('other commands', () => {
  it('jumps to a playlist item, counting from 0, using either guessed name', () => {
    sw = new Switcher();
    expect(sw.command('http', 'ddr2_select_index', '3').result).toBe('ok');
    expect(state('ddr2_select_clips')).toBe('3|');
    expect(sw.command('http', 'ddr2_select_clips', '5|').result).toBe('ok');
    expect(state('ddr2_select_clips')).toBe('5|');
    expect(sw.command('http', 'ddr2_select_index', '99').result).toBe('rejected');
  });

  it('marks unknown commands and commands with guessed names', () => {
    sw = new Switcher();
    expect(sw.command('http', 'make_coffee').result).toBe('unknown');
    expect(sw.command('http', 'ddr2_select_index', '0').guessedName).toBe(true);
    expect(sw.command('http', 'main_dsk2_take').guessedName).toBe(false);
  });

  it('ignores outside commands when "Ignore commands" is on, but not panel presses', () => {
    sw = new Switcher();
    sw.dropCommands = true;
    expect(sw.command('http', 'main_dsk2_take').result).toBe('dropped');
    expect(sw.dsks.main_dsk2.onAir).toBe(false);
    sw.command('panel', 'main_dsk2_take');
    expect(sw.dsks.main_dsk2.onAir).toBe(true);
  });

  it('runs a macro by name', () => {
    sw = new Switcher();
    sw.command('http', 'play_macro_byname', 'TSTV Green Screen On');
    expect(sw.program).toBe('v2');
    expect(sw.commandLog().map((c) => c.source)).toEqual(['macro', 'http']);
  });

  it('starts and stops recording', () => {
    sw = new Switcher();
    sw.command('http', 'record_toggle', '1');
    expect(state('record_toggle')).toBe('1');
    sw.command('http', 'record_toggle');
    expect(state('record_toggle')).toBe('0');
  });
});

describe('change announcements', () => {
  it('announces exactly what changed, named the way the TC1 names it', () => {
    sw = new Switcher();
    const events: ChangeEvent[] = [];
    sw.on('change', (e: ChangeEvent) => events.push(e));
    sw.command('http', 'main_dsk2_take');
    expect(events).toHaveLength(1);
    const names = events[0].states.map(([name]) => name);
    expect(names).toEqual(expect.arrayContaining(['main_dsk2_value', 'main_dsk2_take', 'ddr2_play', 'ddr2_stop', 'program_tally']));
    expect(events[0].keys).toEqual(expect.arrayContaining(['tally', 'switcher', 'shortcut_states', 'state.ddr2_play', 'ddr_timecode']));
  });
});
