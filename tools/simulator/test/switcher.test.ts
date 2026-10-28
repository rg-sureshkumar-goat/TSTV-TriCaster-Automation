import { afterEach, describe, expect, it } from 'vitest';
import { Switcher, type ChangeEvent } from '../src/switcher.ts';

let sw: Switcher;
afterEach(() => sw?.close());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('simulated switcher', () => {
  it('takes sources to program and preview by id, name or input number', () => {
    sw = new Switcher();
    sw.command('http', 'main_a_row', 'input3');
    expect(sw.program).toBe('input3');
    sw.command('http', 'main_b_row', 'Camera 1');
    expect(sw.preview).toBe('input1');
    sw.command('http', 'main_a_row', '2');
    expect(sw.program).toBe('input2');
    expect(sw.command('http', 'main_a_row', 'input99').result).toBe('rejected');
  });

  it('swaps program and preview on take', () => {
    sw = new Switcher();
    sw.command('http', 'main_background_take');
    expect([sw.program, sw.preview]).toEqual(['input2', 'input1']);
  });

  it('puts DSK 2 on air and shows its source in the program tally', () => {
    sw = new Switcher();
    sw.command('http', 'main_dsk2_take');
    expect(sw.dsks.main_dsk2.onAir).toBe(true);
    expect(sw.tallyColumns().find((c) => c.name === 'ddr2')?.onPgm).toBe(true);
    sw.command('http', 'main_dsk2_value', '0');
    expect(sw.dsks.main_dsk2.onAir).toBe(false);
    expect(sw.tallyColumns().find((c) => c.name === 'ddr2')?.onPgm).toBe(false);
  });

  it('shows the green-screen camera and background on program when M/E 2 is taken', () => {
    sw = new Switcher();
    sw.command('http', 'main_a_row', 'v2');
    const onPgm = sw.tallyColumns().filter((c) => c.onPgm).map((c) => c.name);
    expect(onPgm).toEqual(expect.arrayContaining(['v2', 'gfx1', 'input3']));
  });

  it('plays a DDR2 clip in real time and reports when it ends', async () => {
    sw = new Switcher();
    sw.loadPlaylist('ddr2', [
      { name: 'B5_VO_Basketball', durationMs: 250 },
      { name: 'B6_SOT_Coach', durationMs: 1000 },
    ]);
    const ended: string[] = [];
    sw.on('clipEnded', (e: { clip: string }) => ended.push(e.clip));
    sw.command('http', 'ddr2_play');
    expect(sw.shortcutStates().get('ddr2_play')?.value).toBe('1');
    await wait(500);
    expect(ended).toEqual(['B5_VO_Basketball']);
    expect(sw.shortcutStates().get('ddr2_play')?.value).toBe('0');
  });

  it('jumps to a playlist item, counting from 0', () => {
    sw = new Switcher();
    expect(sw.command('http', 'ddr2_select_index', '3').result).toBe('ok');
    expect(sw.shortcutStates().get('ddr2_clip_name')?.value).toBe('B1_OTSL_Election');
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
    expect(sw.recording.on).toBe(true);
    sw.command('http', 'record_toggle');
    expect(sw.recording.on).toBe(false);
  });

  it('announces exactly what changed', () => {
    sw = new Switcher();
    const events: ChangeEvent[] = [];
    sw.on('change', (e: ChangeEvent) => events.push(e));
    sw.command('http', 'main_dsk2_take');
    expect(events).toHaveLength(1);
    expect(events[0].states).toEqual([['main_dsk2_value', { value: '1', type: 'bool' }]]);
    expect(events[0].keys).toEqual(['tally', 'shortcut_states']);
  });
});
