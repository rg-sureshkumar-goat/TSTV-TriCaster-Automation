// The simulated switcher, set up like TSTV's TC1: program runs through M/E 1 (cameras on its A row),
// the green screen is M/E 2, and DSK 2 shows DDR 2 with AutoPlay. It applies commands, plays clips in
// real time, and reports every change the way the real TC1 does.
import { EventEmitter } from 'node:events';
import {
  CAMERAS,
  DEFAULT_PLAYLISTS,
  DSK_COUNT,
  DSK_SOURCES,
  GREEN_SCREEN,
  GUESSED_NAMES,
  INPUTS,
  MACROS,
  ME_COUNT,
  PLAYERS,
  PROGRAM_ME,
  SOURCE_INDEX,
  type ClipSpec,
} from './profile.ts';
import { switcherXml, tallyXml, type StateValue, type TallyColumn } from './xml.ts';

export type CommandSource = 'http' | 'tcp' | 'panel' | 'macro';
export type CommandResult = 'ok' | 'unknown' | 'dropped' | 'rejected';

export interface CommandRecord {
  id: number;
  at: string;
  source: CommandSource;
  from?: string;
  name: string;
  value?: string;
  result: CommandResult;
  guessedName: boolean;
  note?: string;
}

export interface Player {
  id: string;
  label: string;
  stills: boolean;
  autoplay: boolean;
  playlist: ClipSpec[];
  index: number;
  playing: boolean;
  positionMs: number;
}

/** An M/E's A and B rows. A layered M/E (the green screen) shows A keyed over B. */
export interface Me {
  a: string;
  b: string;
  layered: boolean;
}

export interface Dsk {
  source: string;
  onAir: boolean;
}

export interface Snapshot {
  program: string;
  preview: string;
  cameras: { id: string; label: string }[];
  dsks: Record<string, Dsk>;
  mes: Record<string, Me>;
  players: Record<string, Player>;
  recording: { on: boolean; startedAt: string | null; seconds: number };
  streaming: boolean;
  macros: { name: string; folder: string }[];
  tally: TallyColumn[];
  programTally: string;
  sourceIndex: Record<string, number>;
}

export interface ChangeEvent {
  /** Shortcut states whose value changed. */
  states: [string, StateValue][];
  /** What the change notifications announce, as the TC1 does: dictionary keys and "state.<name>". */
  keys: string[];
}

const SOURCES = Object.keys(SOURCE_INDEX);
const NAME_BY_INDEX = new Map(Object.entries(SOURCE_INDEX).map(([name, index]) => [index, name]));
const MEDIA_STATE = /^(ddr\d|gfx\d|sound|media)_(play|stop)$/;

/** Row values the TC1 reports in upper case ("INPUT2", "V1"); black is "Black". */
export function rowName(source: string): string {
  return source === 'black' ? 'Black' : source.toUpperCase();
}

export class Switcher extends EventEmitter {
  program = PROGRAM_ME;
  preview = 'black';
  dsks: Record<string, Dsk> = {};
  mes: Record<string, Me> = {};
  players: Record<string, Player> = {};
  recording = { on: false, startedAt: 0 };
  streaming = false;
  dropCommands = false;

  private playStartedAt = new Map<string, { at: number; from: number }>();
  private ticker: NodeJS.Timeout | undefined;
  private lastStates = new Map<string, StateValue>();
  private lastTally = '';
  private lastSwitcher = '';
  private log: CommandRecord[] = [];
  private nextId = 1;
  private playlistsChanged = false;

  constructor() {
    super();
    this.reset();
  }

  reset(): void {
    this.stopTicker();
    this.playStartedAt.clear();
    this.program = PROGRAM_ME;
    this.preview = 'black';
    this.dsks = {};
    for (let n = 1; n <= DSK_COUNT; n++) this.dsks[`main_dsk${n}`] = { source: DSK_SOURCES[`main_dsk${n}`] ?? 'ddr1', onAir: false };
    this.mes = {};
    for (let n = 1; n <= ME_COUNT; n++) this.mes[`v${n}`] = { a: 'input1', b: 'gfx1', layered: false };
    this.mes[GREEN_SCREEN.me] = { a: GREEN_SCREEN.keyedCamera, b: GREEN_SCREEN.background, layered: true };
    this.players = {};
    for (const p of PLAYERS) {
      this.players[p.id] = { ...p, playlist: [...(DEFAULT_PLAYLISTS[p.id] ?? [])], index: 0, playing: false, positionMs: 0 };
    }
    this.recording = { on: false, startedAt: 0 };
    this.streaming = false;
    this.playlistsChanged = true;
    this.publish();
  }

  /** Runs one command from the show app (http, tcp), the simulator page (panel) or a macro. */
  command(source: CommandSource, name: string, value?: string, from?: string): CommandRecord {
    const key = name.trim().toLowerCase();
    let outcome: { result: CommandResult; note?: string };
    if (this.dropCommands && source !== 'panel') outcome = { result: 'dropped', note: 'Ignored on purpose ("Ignore commands" is on)' };
    else outcome = this.apply(key, value);
    const record: CommandRecord = {
      id: this.nextId++,
      at: new Date().toISOString(),
      source,
      from,
      name: key,
      value,
      result: outcome.result,
      guessedName: GUESSED_NAMES.has(key),
      note: outcome.note,
    };
    this.log.push(record);
    if (this.log.length > 1000) this.log.shift();
    this.emit('command', record);
    this.publish();
    return record;
  }

  commandLog(): CommandRecord[] {
    return [...this.log];
  }

  clearLog(): void {
    this.log = [];
  }

  loadPlaylist(playerId: string, clips: ClipSpec[]): void {
    const player = this.players[playerId];
    if (!player) throw new Error(`No player called ${playerId}`);
    this.stopPlayer(player);
    player.playlist = clips.map((c) => ({ name: String(c.name), durationMs: Math.max(0, Number(c.durationMs) || 0) }));
    player.index = 0;
    player.positionMs = 0;
    this.playlistsChanged = true;
    this.publish();
  }

  /** Practice problem: makes the current clip finish right now. */
  endClipNow(playerId: string): void {
    const player = this.players[playerId];
    if (!player?.playing) return;
    this.finishClip(player);
    this.publish();
  }

  private apply(name: string, value?: string): { result: CommandResult; note?: string } {
    let m: RegExpMatchArray | null;

    if (name === 'main_a_row' || name === 'main_b_row') {
      const source = this.resolveSource(value);
      if (!source) return { result: 'rejected', note: `Unknown source "${value}"` };
      if (name === 'main_a_row') this.program = source;
      else this.preview = source;
      return { result: 'ok' };
    }
    if (['main_take', 'main_auto', 'main_background_take', 'main_background_auto'].includes(name)) {
      [this.program, this.preview] = [this.preview, this.program];
      return { result: 'ok', note: name.endsWith('auto') ? 'Transition shown as a cut in the simulator' : undefined };
    }
    if ((m = name.match(/^v(\d)_(a_row|b_row|take|auto)$/))) {
      const me = this.mes[`v${m[1]}`];
      if (!me) return { result: 'rejected', note: `No M/E ${m[1]}` };
      if (m[2] === 'take' || m[2] === 'auto') {
        [me.a, me.b] = [me.b, me.a];
        return { result: 'ok' };
      }
      const source = this.resolveSource(value);
      if (!source) return { result: 'rejected', note: `Unknown source "${value}"` };
      if (m[2] === 'a_row') me.a = source;
      else me.b = source;
      return { result: 'ok' };
    }
    if ((m = name.match(/^main_dsk(\d)(?:_(select|take|auto|value))?$/))) {
      const id = `main_dsk${m[1]}`;
      const dsk = this.dsks[id];
      if (!dsk) return { result: 'rejected', note: `No DSK ${m[1]}` };
      const action = m[2] ?? 'select';
      if (action === 'select') {
        const source = this.resolveSource(value);
        if (!source) return { result: 'rejected', note: `Unknown source "${value}"` };
        dsk.source = source;
        return { result: 'ok' };
      }
      const on = action === 'value' ? value === '1' || value?.toLowerCase() === 'true' : !dsk.onAir;
      this.setDsk(id, on);
      return { result: 'ok', note: action === 'auto' ? 'Transition shown as a cut in the simulator' : undefined };
    }
    if ((m = name.match(/^(ddr\d|gfx\d|sound)_(play|stop|play_toggle|back|forward|select_index|select_clips|autoplay_mode_toggle|single_mode_toggle)$/))) {
      const player = this.players[m[1]];
      if (!player) return { result: 'rejected', note: `No player ${m[1]}` };
      return this.applyPlayer(player, m[2], value);
    }
    if (name === 'record_toggle' || name === 'record_start' || name === 'record_stop') {
      const on = name === 'record_start' ? true : name === 'record_stop' ? false : value === undefined ? !this.recording.on : value === '1';
      if (on !== this.recording.on) this.recording = { on, startedAt: on ? Date.now() : 0 };
      return { result: 'ok' };
    }
    if (name === 'streaming_toggle') {
      this.streaming = value === undefined ? !this.streaming : value === '1';
      return { result: 'ok', note: 'Streaming is out of scope for TSTV' };
    }
    if (name === 'play_macro_byname') {
      const macro = MACROS.find((mc) => mc.name.toLowerCase() === (value ?? '').toLowerCase());
      if (!macro) return { result: 'rejected', note: `No macro named "${value}"` };
      for (const step of macro.commands) this.command('macro', step.name, step.value, macro.name);
      return { result: 'ok', note: `Ran ${macro.commands.length} step(s)` };
    }
    return { result: 'unknown', note: 'The simulator does not know this command' };
  }

  /**
   * DSK on or off, with the AutoPlay link seen on the real TC1: when the DSK's source has AutoPlay on,
   * taking the DSK on starts it playing, and taking it off stops it and moves to the next clip.
   */
  private setDsk(id: string, on: boolean): void {
    const dsk = this.dsks[id];
    if (dsk.onAir === on) return;
    dsk.onAir = on;
    const player = this.players[dsk.source];
    if (!player?.autoplay) return;
    if (on) {
      this.startPlayer(player);
    } else {
      this.stopPlayer(player);
      if (player.index < player.playlist.length - 1) {
        player.index++;
        player.positionMs = 0;
      }
    }
  }

  private applyPlayer(player: Player, action: string, value?: string): { result: CommandResult; note?: string } {
    const count = player.playlist.length;
    switch (action) {
      case 'play':
      case 'play_toggle': {
        if (action === 'play_toggle' && player.playing) {
          this.stopPlayer(player);
          return { result: 'ok' };
        }
        if (count === 0) return { result: 'rejected', note: 'Playlist is empty' };
        this.startPlayer(player);
        // AutoPlay also works the other way: playing the clip takes its DSK on air.
        if (player.autoplay) {
          for (const dsk of Object.values(this.dsks)) if (dsk.source === player.id) dsk.onAir = true;
        }
        return { result: 'ok' };
      }
      case 'stop':
        this.stopPlayer(player);
        return { result: 'ok' };
      case 'back':
      case 'forward': {
        if (count === 0) return { result: 'rejected', note: 'Playlist is empty' };
        const wasPlaying = player.playing;
        this.stopPlayer(player);
        player.index = action === 'back' ? Math.max(0, player.index - 1) : Math.min(count - 1, player.index + 1);
        player.positionMs = 0;
        if (wasPlaying) this.startPlayer(player);
        return { result: 'ok' };
      }
      case 'select_index':
      case 'select_clips': {
        const index = Number.parseInt(String(value ?? '').split('|')[0], 10);
        if (!Number.isInteger(index) || index < 0 || index >= count) return { result: 'rejected', note: `No item ${value} (playlist has ${count}, counting from 0)` };
        this.stopPlayer(player);
        player.index = index;
        player.positionMs = 0;
        return { result: 'ok', note: 'Counts from 0 (a guess until the TC1 confirms)' };
      }
      case 'autoplay_mode_toggle':
        player.autoplay = value === undefined ? !player.autoplay : value === '1' || value === 'true';
        return { result: 'ok' };
      default:
        return { result: 'ok', note: 'Single mode is always on in the simulator' };
    }
  }

  private startPlayer(player: Player): void {
    const clip = player.playlist[player.index];
    if (!clip || player.stills || clip.durationMs === 0) return;
    if (player.positionMs >= clip.durationMs) player.positionMs = 0;
    player.playing = true;
    this.playStartedAt.set(player.id, { at: Date.now(), from: player.positionMs });
    this.startTicker();
  }

  private stopPlayer(player: Player): void {
    this.updatePosition(player);
    player.playing = false;
    this.playStartedAt.delete(player.id);
  }

  /** A clip that reaches its end stops on its last frame. Its DSK stays on air, as on the real TC1. */
  private finishClip(player: Player): void {
    const clip = player.playlist[player.index];
    player.playing = false;
    player.positionMs = clip?.durationMs ?? 0;
    this.playStartedAt.delete(player.id);
    this.emit('clipEnded', { player: player.id, clip: clip?.name });
  }

  private updatePosition(player: Player): void {
    const started = this.playStartedAt.get(player.id);
    if (started) player.positionMs = started.from + (Date.now() - started.at);
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 100);
  }

  private stopTicker(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private tick(): void {
    let anyPlaying = false;
    let ended = false;
    for (const player of Object.values(this.players)) {
      if (!player.playing) continue;
      this.updatePosition(player);
      const clip = player.playlist[player.index];
      if (!clip || player.positionMs >= clip.durationMs) {
        this.finishClip(player);
        ended = true;
      } else {
        anyPlaying = true;
      }
    }
    if (!anyPlaying) this.stopTicker();
    if (ended) this.publish();
    this.emit('tick');
  }

  /** Accepts a source by name ("input2", "INPUT2", "V1", "ddr2"), by TC1 number ("1", "43"), or by camera label. */
  resolveSource(value?: string): string | undefined {
    if (value === undefined) return undefined;
    const v = value.trim().toLowerCase().replace(/\s+/g, '');
    if (SOURCES.includes(v)) return v;
    if (/^-?\d+$/.test(v)) return NAME_BY_INDEX.get(Number(v));
    return CAMERAS.find((c) => c.label.toLowerCase().replace(/\s+/g, '') === v)?.id;
  }

  /** The sources you can actually see on an output: an M/E's camera (and background, for the green screen), plus on-air DSKs. */
  private visibleLeaves(source: string, withDsks: boolean): string[] {
    const me = this.mes[source];
    const leaves = me ? (me.layered ? [me.a, me.b] : [me.a]) : [source];
    if (withDsks) for (const dsk of Object.values(this.dsks)) if (dsk.onAir) leaves.push(dsk.source);
    return [...new Set(leaves)];
  }

  tallyColumns(): TallyColumn[] {
    const pgm = new Set([this.program, ...this.visibleLeaves(this.program, true)]);
    const pvw = new Set([this.preview, ...this.visibleLeaves(this.preview, false)]);
    return SOURCES.map((name) => ({ index: SOURCE_INDEX[name], name, onPgm: pgm.has(name), onPrev: pvw.has(name) }));
  }

  /** What's on air, the way the TC1's program_tally state reports it, e.g. "INPUT2|BFR11". */
  programTally(): string {
    return this.visibleLeaves(this.program, true)
      .filter((s) => s !== 'black')
      .map(rowName)
      .join('|');
  }

  /** State names, values and types as the real TC1 reports them on port 5951 and in shortcut_states. */
  shortcutStates(): Map<string, StateValue> {
    const s = new Map<string, StateValue>();
    const text = (value: string): StateValue => ({ value, type: '' });
    const str = (value: string): StateValue => ({ value, type: 'string' });
    const int = (value: number): StateValue => ({ value: String(value), type: 'int' });
    const bool = (value: boolean): StateValue => ({ value: value ? 'true' : 'false', type: 'bool' });
    const double = (value: boolean): StateValue => ({ value: value ? '1' : '0', type: 'double' });
    for (const input of INPUTS) {
      s.set(`${input.id}_long_name`, str(input.longName));
      s.set(`${input.id}_short_name`, str(input.shortName));
    }
    for (const row of ['a', 'b'] as const) {
      const source = row === 'a' ? this.program : this.preview;
      s.set(`main_${row}_row`, int(SOURCE_INDEX[source]));
      s.set(`main_${row}_row_named_input`, text(rowName(source)));
    }
    for (const [id, me] of Object.entries(this.mes)) {
      s.set(`${id}_long_name`, str(`M/E ${id.slice(1)}`));
      for (const row of ['a', 'b'] as const) {
        s.set(`${id}_${row}_row`, int(SOURCE_INDEX[me[row]]));
        s.set(`${id}_${row}_row_named_input`, text(rowName(me[row])));
      }
    }
    for (const [id, dsk] of Object.entries(this.dsks)) {
      s.set(`${id}_select`, int(SOURCE_INDEX[dsk.source]));
      s.set(`${id}_select_named_input`, text(dsk.source));
      s.set(`${id}_value`, double(dsk.onAir));
      s.set(`${id}_take`, bool(dsk.onAir));
    }
    for (const p of Object.values(this.players)) {
      s.set(`${p.id}_long_name`, str(p.label));
      s.set(`${p.id}_short_name`, str(p.label));
      s.set(`${p.id}_play`, bool(p.playing));
      s.set(`${p.id}_stop`, bool(!p.playing));
      s.set(`${p.id}_select_clips`, text(`${p.index}|`));
      s.set(`${p.id}_autoplay_mode_toggle`, bool(p.autoplay));
      s.set(`${p.id}_single_mode_toggle`, bool(true));
    }
    const anyPlaying = Object.values(this.players).some((p) => p.playing);
    s.set('media_play', bool(anyPlaying));
    s.set('media_stop', bool(!anyPlaying));
    s.set('record_toggle', int(this.recording.on ? 1 : 0));
    s.set('streaming_toggle', int(this.streaming ? 1 : 0));
    s.set('program_tally', text(this.programTally()));
    return s;
  }

  /** Works out what changed since last time and tells listeners, naming changes the way the TC1 does. */
  publish(): void {
    const states = this.shortcutStates();
    const changed: [string, StateValue][] = [];
    for (const [name, state] of states) {
      const prev = this.lastStates.get(name);
      if (!prev || prev.value !== state.value) changed.push([name, state]);
    }
    this.lastStates = states;
    const keys: string[] = [];
    const tally = tallyXml(this.tallyColumns());
    if (tally !== this.lastTally) keys.push('tally');
    this.lastTally = tally;
    const switcher = switcherXml(this.program, this.preview, this.dsks);
    if (switcher !== this.lastSwitcher) keys.push('switcher');
    this.lastSwitcher = switcher;
    if (changed.length > 0) keys.push('shortcut_states');
    const names = changed.map(([name]) => name);
    const media = names.filter((n) => MEDIA_STATE.test(n));
    keys.push(...media.map((n) => `state.${n}`));
    if (media.length > 0) keys.push('ddr_timecode');
    if (this.playlistsChanged || names.some((n) => n.endsWith('_select_clips'))) keys.push('ddr_playlist');
    if (names.includes('record_toggle')) keys.push('record_configuration');
    this.playlistsChanged = false;
    if (keys.length > 0) this.emit('change', { states: changed, keys } satisfies ChangeEvent);
  }

  snapshot(): Snapshot {
    for (const player of Object.values(this.players)) if (player.playing) this.updatePosition(player);
    return {
      program: this.program,
      preview: this.preview,
      cameras: CAMERAS.map((c) => ({ ...c })),
      dsks: structuredClone(this.dsks),
      mes: structuredClone(this.mes),
      players: structuredClone(this.players),
      recording: {
        on: this.recording.on,
        startedAt: this.recording.on ? new Date(this.recording.startedAt).toISOString() : null,
        seconds: this.recording.on ? Math.floor((Date.now() - this.recording.startedAt) / 1000) : 0,
      },
      streaming: this.streaming,
      macros: MACROS.map((m) => ({ name: m.name, folder: m.folder })),
      tally: this.tallyColumns(),
      programTally: this.programTally(),
      sourceIndex: { ...SOURCE_INDEX },
    };
  }

  close(): void {
    this.stopTicker();
    this.removeAllListeners();
  }
}
