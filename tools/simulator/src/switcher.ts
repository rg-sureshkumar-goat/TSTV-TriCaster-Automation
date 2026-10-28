// The simulated switcher: program and preview, DSKs, M/Es, media players and recording.
// It applies commands, plays clips in real time, and reports every change.
import { EventEmitter } from 'node:events';
import {
  DEFAULT_PLAYLISTS,
  DSK_COUNT,
  GREEN_SCREEN,
  GUESSED_NAMES,
  INPUTS,
  MACROS,
  ME_COUNT,
  PLAYERS,
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
  playlist: ClipSpec[];
  index: number;
  playing: boolean;
  positionMs: number;
}

export interface Me {
  a: string;
  b: string;
  key: string | null;
}

export interface Snapshot {
  program: string;
  preview: string;
  inputs: { id: string; longName: string; shortName: string }[];
  dsks: Record<string, { source: string; onAir: boolean }>;
  mes: Record<string, Me>;
  players: Record<string, Player>;
  recording: { on: boolean; startedAt: string | null; seconds: number };
  streaming: boolean;
  macros: { name: string; folder: string }[];
  tally: TallyColumn[];
}

export interface ChangeEvent {
  /** Shortcut states whose value changed. */
  states: [string, StateValue][];
  /** Dictionary keys whose content changed, as announced on /v1/change_notifications. */
  keys: string[];
}

const SOURCES = [
  ...INPUTS.map((i) => i.id),
  ...PLAYERS.map((p) => p.id),
  ...Array.from({ length: ME_COUNT }, (_, i) => `v${i + 1}`),
  'black',
];

export class Switcher extends EventEmitter {
  program = 'input1';
  preview = 'input2';
  dsks: Record<string, { source: string; onAir: boolean }> = {};
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

  constructor() {
    super();
    this.reset();
  }

  reset(): void {
    this.stopTicker();
    this.playStartedAt.clear();
    this.program = 'input1';
    this.preview = 'input2';
    this.dsks = {};
    for (let n = 1; n <= DSK_COUNT; n++) this.dsks[`main_dsk${n}`] = { source: n === 2 ? 'ddr2' : 'gfx2', onAir: false };
    this.mes = {};
    for (let n = 1; n <= ME_COUNT; n++) this.mes[`v${n}`] = { a: 'input1', b: 'input2', key: null };
    this.mes[GREEN_SCREEN.me] = { a: GREEN_SCREEN.background, b: 'input1', key: GREEN_SCREEN.keyedCamera };
    this.players = {};
    for (const p of PLAYERS) {
      this.players[p.id] = { id: p.id, label: p.label, stills: p.stills, playlist: [...(DEFAULT_PLAYLISTS[p.id] ?? [])], index: 0, playing: false, positionMs: 0 };
    }
    this.recording = { on: false, startedAt: 0 };
    this.streaming = false;
    this.publish();
  }

  /** Runs one command from the show app (http, tcp), the simulator page (panel) or a macro. */
  command(source: CommandSource, name: string, value?: string, from?: string): CommandRecord {
    const key = name.trim().toLowerCase();
    let result: CommandResult = 'ok';
    let note: string | undefined;
    if (this.dropCommands && source !== 'panel') {
      result = 'dropped';
      note = 'Ignored on purpose ("Ignore commands" is on)';
    } else {
      const outcome = this.apply(key, value);
      result = outcome.result;
      note = outcome.note;
    }
    const record: CommandRecord = {
      id: this.nextId++,
      at: new Date().toISOString(),
      source,
      from,
      name: key,
      value,
      result,
      guessedName: GUESSED_NAMES.has(key),
      note,
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
    if ((m = name.match(/^v(\d)_(a_row|b_row|take|auto|key)$/))) {
      const me = this.mes[`v${m[1]}`];
      if (!me) return { result: 'rejected', note: `No M/E ${m[1]}` };
      if (m[2] === 'take' || m[2] === 'auto') {
        [me.a, me.b] = [me.b, me.a];
        return { result: 'ok' };
      }
      const source = this.resolveSource(value);
      if (!source) return { result: 'rejected', note: `Unknown source "${value}"` };
      if (m[2] === 'a_row') me.a = source;
      else if (m[2] === 'b_row') me.b = source;
      else me.key = source;
      return { result: 'ok' };
    }
    if ((m = name.match(/^main_dsk(\d)(?:_(select|take|auto|value))?$/))) {
      const dsk = this.dsks[`main_dsk${m[1]}`];
      if (!dsk) return { result: 'rejected', note: `No DSK ${m[1]}` };
      const action = m[2] ?? 'select';
      if (action === 'select') {
        const source = this.resolveSource(value);
        if (!source) return { result: 'rejected', note: `Unknown source "${value}"` };
        dsk.source = source;
      } else if (action === 'value') {
        dsk.onAir = value === '1' || value?.toLowerCase() === 'true';
      } else {
        dsk.onAir = !dsk.onAir;
      }
      return { result: 'ok', note: action === 'auto' ? 'Transition shown as a cut in the simulator' : undefined };
    }
    if ((m = name.match(/^(ddr\d|gfx\d)_(play|stop|play_toggle|back|forward|select_index|autoplay_mode_toggle)$/))) {
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

  private applyPlayer(player: Player, action: string, value?: string): { result: CommandResult; note?: string } {
    const count = player.playlist.length;
    switch (action) {
      case 'play':
        if (count === 0) return { result: 'rejected', note: 'Playlist is empty' };
        this.startPlayer(player);
        return { result: 'ok' };
      case 'stop':
        this.stopPlayer(player);
        return { result: 'ok' };
      case 'play_toggle':
        if (player.playing) this.stopPlayer(player);
        else if (count > 0) this.startPlayer(player);
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
      case 'select_index': {
        const index = Number(value);
        if (!Number.isInteger(index) || index < 0 || index >= count) return { result: 'rejected', note: `No item ${value} (playlist has ${count}, counting from 0)` };
        this.stopPlayer(player);
        player.index = index;
        player.positionMs = 0;
        return { result: 'ok', note: 'Counts from 0 (a guess until the TC1 confirms)' };
      }
      default:
        return { result: 'ok', note: 'Autoplay is not simulated' };
    }
  }

  private startPlayer(player: Player): void {
    const clip = player.playlist[player.index];
    if (!clip) return;
    if (player.stills || clip.durationMs === 0) {
      player.playing = false;
      return;
    }
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

  private resolveSource(value?: string): string | undefined {
    if (value === undefined) return undefined;
    const v = value.trim().toLowerCase();
    if (SOURCES.includes(v)) return v;
    const byName = INPUTS.find((i) => i.longName.toLowerCase() === v || i.shortName.toLowerCase() === v);
    if (byName) return byName.id;
    if (/^\d+$/.test(v) && INPUTS[Number(v) - 1]) return INPUTS[Number(v) - 1].id;
    return undefined;
  }

  /** Sources visible on an output, including what an M/E or an on-air DSK adds. */
  private visible(source: string, withDsks: boolean): Set<string> {
    const seen = new Set<string>([source]);
    const me = this.mes[source];
    if (me) {
      seen.add(me.a);
      if (me.key) seen.add(me.key);
    }
    if (withDsks) for (const dsk of Object.values(this.dsks)) if (dsk.onAir) seen.add(dsk.source);
    return seen;
  }

  tallyColumns(): TallyColumn[] {
    const pgm = this.visible(this.program, true);
    const pvw = this.visible(this.preview, false);
    return SOURCES.filter((s) => s !== 'black').map((name, index) => ({ index, name, onPgm: pgm.has(name), onPrev: pvw.has(name) }));
  }

  shortcutStates(): Map<string, StateValue> {
    const s = new Map<string, StateValue>();
    const str = (value: string): StateValue => ({ value, type: 'string' });
    const int = (value: number): StateValue => ({ value: String(value), type: 'int' });
    const bool = (value: boolean): StateValue => ({ value: value ? '1' : '0', type: 'bool' });
    for (const input of INPUTS) {
      s.set(`${input.id}_long_name`, str(input.longName));
      s.set(`${input.id}_short_name`, str(input.shortName));
    }
    s.set('main_a_row', str(this.program));
    s.set('main_b_row', str(this.preview));
    for (const [id, me] of Object.entries(this.mes)) {
      s.set(`${id}_a_row`, str(me.a));
      s.set(`${id}_b_row`, str(me.b));
      s.set(`${id}_key`, str(me.key ?? ''));
    }
    for (const [id, dsk] of Object.entries(this.dsks)) {
      s.set(`${id}_select`, str(dsk.source));
      s.set(`${id}_value`, bool(dsk.onAir));
    }
    for (const player of Object.values(this.players)) {
      s.set(`${player.id}_play`, bool(player.playing));
      s.set(`${player.id}_clip_index`, int(player.index));
      s.set(`${player.id}_clip_name`, str(player.playlist[player.index]?.name ?? ''));
      s.set(`${player.id}_clip_count`, int(player.playlist.length));
    }
    s.set('record_toggle', bool(this.recording.on));
    s.set('streaming_toggle', bool(this.streaming));
    return s;
  }

  /** Works out what changed since last time and tells listeners. */
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
    const switcher = switcherXml(this.program, this.preview);
    if (switcher !== this.lastSwitcher) keys.push('switcher');
    this.lastSwitcher = switcher;
    if (changed.length > 0) keys.push('shortcut_states');
    if (changed.length > 0 || keys.length > 0) this.emit('change', { states: changed, keys } satisfies ChangeEvent);
  }

  snapshot(): Snapshot {
    for (const player of Object.values(this.players)) if (player.playing) this.updatePosition(player);
    return {
      program: this.program,
      preview: this.preview,
      inputs: INPUTS.map((i) => ({ ...i })),
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
    };
  }

  close(): void {
    this.stopTicker();
    this.removeAllListeners();
  }
}
