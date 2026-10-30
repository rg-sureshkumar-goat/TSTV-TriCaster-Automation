// The switcher driver: the only code in the show app that talks to a switcher. It speaks the TC1's own
// web control (port 80, /v1/…) and state stream (port 5951), which the simulator copies, so the same code
// runs both. See docs/TC1-FINDINGS.md.
//
// Two modes (docs/ARCHITECTURE.md, 6.3). In simulator mode it refuses to send anything to a switcher that
// doesn't identify itself as the TSTV simulator, so typing the TC1's address by mistake sends nothing. In
// live mode (Phase 5, turned on by the producer) it talks only to a switcher that says it's a TriCaster TC1,
// and the graphics and music come from the laptop's playout over NDI instead of DDR 2 and the Sound player
// (decided Oct 30, 2026): cameras and DSK 2 are TC1 commands; cueing, playing and stopping clips, and the
// music, go to the playout.
import { EventEmitter } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import type { SwitcherCommand } from '@tstv/shared';
import type { Playout } from './playout.ts';

export const SIMULATOR_NAME = 'TSTV Simulator';
export const TC1_NAME = 'TriCaster TC1';
export type SwitcherMode = 'simulator' | 'live';

/** A clip for DDR 2 (the simulator) or the playout (live mode); path only matters to the playout. */
export interface PlaylistClip {
  name: string;
  durationMs: number;
  path?: string;
}

export interface SwitcherSnapshot {
  status: 'off' | 'connecting' | 'connected' | 'error' | 'refused';
  error: string | null;
  address: string;
  programInput: number | null;
  dskOn: boolean;
  ddrItem: number | null;
  ddrPlaying: boolean;
  ddrRemaining: number | null;
  musicPlaying: boolean;
  playlist: string[];
  soundTracks: string[];
}

const attr = (text: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(text)?.[1];
const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A player's clips from the TC1's ddr_playlist, by their names. */
function playlistNames(xml: string, player: string): string[] {
  const block = new RegExp(`<${player}\\b[^>]*>([\\s\\S]*?)</${player}>`).exec(xml)?.[1] ?? '';
  return [...block.matchAll(/<clip\b([^>]*)\/?>/g)].map((m) => {
    const alias = attr(m[1], 'alias');
    const file = attr(m[1], 'filename') ?? '';
    return unescape(alias || file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''));
  });
}

export class Switcher extends EventEmitter {
  private states = new Map<string, string>();
  private socket: net.Socket | null = null;
  private notifications: WebSocket | null = null;
  private closed = false;
  private timecodeTimer: ReturnType<typeof setInterval> | null = null;
  snapshot: SwitcherSnapshot;

  /** The music track's file, which the playout plays in live mode. */
  musicPath: string | null = null;

  /**
   * address is host:port of the web control; the state stream is on statePort (5951 on the TC1). In live
   * mode, playout plays the show's clips and music.
   */
  constructor(
    address: string,
    private statePort = 5951,
    readonly mode: SwitcherMode = 'simulator',
    private playout: Playout | null = null,
  ) {
    super();
    this.snapshot = { status: 'off', error: null, address, programInput: null, dskOn: false, ddrItem: null, ddrPlaying: false, ddrRemaining: null, musicPlaying: false, playlist: [], soundTracks: [] };
    if (playout) {
      // The playout stands in for DDR 2 and the Sound player.
      const follow = () => this.set({ ddrItem: playout.state.item, ddrPlaying: playout.state.playing, ddrRemaining: playout.state.remaining, musicPlaying: playout.state.musicPlaying });
      playout.on('change', follow);
      playout.on('ended', (item: number) => {
        if (this.snapshot.dskOn) this.emit('clipEnded', item);
      });
    }
  }

  private get live(): boolean {
    return this.mode === 'live';
  }

  private get base(): string {
    return `http://${this.snapshot.address}`;
  }

  private set(patch: Partial<SwitcherSnapshot>): void {
    Object.assign(this.snapshot, patch);
    this.emit('change');
  }

  async connect(): Promise<void> {
    this.set({ status: 'connecting', error: null });
    try {
      const version = await (await fetch(`${this.base}/v1/version`, { signal: AbortSignal.timeout(4000) })).text();
      const product = /<product_name>([^<]*)<\/product_name>/.exec(version)?.[1] ?? '';
      // The lock: each mode talks only to its own switcher.
      if (!this.live && product !== SIMULATOR_NAME) {
        this.set({ status: 'refused', error: `That switcher calls itself “${product || 'unknown'}”, not the TSTV simulator, so the app won’t send it anything. To run the real TC1, turn on live mode.` });
        return;
      }
      if (this.live && product !== TC1_NAME) {
        this.set({ status: 'refused', error: `That switcher calls itself “${product || 'unknown'}”, not TSTV’s ${TC1_NAME}, so live mode won’t send it anything.` });
        return;
      }
    } catch (e) {
      this.set({
        status: 'error',
        error: this.live ? `Couldn’t reach the TC1 at ${this.snapshot.address}. Is the laptop on the TC1’s cable?` : `Couldn’t reach the simulator at ${this.snapshot.address}. Is it running? (npm run simulator)`,
      });
      return;
    }
    this.listen();
    if (!this.live) await this.readPlaylists();
    this.set({ status: 'connected', error: null });
  }

  /** The state stream (port 5951) and change notifications, which report everything the switcher does. */
  private listen(): void {
    const [host] = this.snapshot.address.split(':');
    const socket = net.connect({ host, port: this.statePort });
    this.socket = socket;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('<register name="NTK_states"/>\n'));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const changed: string[] = [];
      let match: RegExpExecArray | null;
      const pattern = /<shortcut_state\b([^>]*?)\/>/g;
      let last = 0;
      while ((match = pattern.exec(buffer))) {
        const name = attr(match[1], 'name');
        const value = unescape(attr(match[1], 'value') ?? '');
        if (name && this.states.get(name) !== value) {
          this.states.set(name, value);
          changed.push(name);
        }
        last = pattern.lastIndex;
      }
      buffer = buffer.slice(last);
      if (changed.length) this.onStates(changed);
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (!this.closed) this.set({ status: 'error', error: 'Lost the connection to the switcher.' });
    });

    const notifications = new WebSocket(`ws://${this.snapshot.address}/v1/change_notifications`);
    this.notifications = notifications;
    notifications.on('message', (data) => {
      const key = String(data).replace(/\0/g, '');
      if (key === 'ddr_playlist' && !this.live) void this.readPlaylists();
    });
    notifications.on('error', () => undefined);
  }

  private onStates(changed: string[]): void {
    const was = this.snapshot.ddrPlaying;
    const input = /^INPUT(\d+)$/i.exec(this.states.get('v1_a_row_named_input') ?? '');
    const dskOn = this.states.get('main_dsk2_value') === '1' || this.states.get('main_dsk2_take') === 'true';
    // Live mode: the TC1's DDR 2 and Sound player aren't used; the playout reports instead.
    if (this.live) return this.set({ programInput: input ? Number(input[1]) : null, dskOn });
    const ddrPlaying = this.states.get('ddr2_play') === 'true';
    const item = Number.parseInt(this.states.get('ddr2_select_clips') ?? '', 10);
    this.set({
      programInput: input ? Number(input[1]) : null,
      dskOn,
      ddrPlaying,
      ddrItem: Number.isInteger(item) ? item : null,
      musicPlaying: this.states.get('sound_play') === 'true',
    });
    // DDR 2 stopped by itself at the end of a clip, with DSK 2 still on: the clip ended.
    if (was && !ddrPlaying && changed.includes('ddr2_play')) void this.checkClipEnd();
    // While a clip plays, its time left is read twice a second, for the producer's screen. A clip that just
    // started is read at once, so the last clip's time left doesn't show for it.
    if (ddrPlaying && (!was || changed.includes('ddr2_select_clips'))) {
      this.set({ ddrRemaining: null });
      void this.readTimecode();
    }
    if (ddrPlaying && !this.timecodeTimer) this.timecodeTimer = setInterval(() => void this.readTimecode(), 500);
    if (!ddrPlaying && this.timecodeTimer) {
      clearInterval(this.timecodeTimer);
      this.timecodeTimer = null;
    }
  }

  /** Seconds left in DDR 2's clip. */
  private async readTimecode(): Promise<number | null> {
    try {
      const xml = await (await fetch(`${this.base}/v1/dictionary?key=ddr_timecode`)).text();
      const remaining = Number(attr(/<ddr2\b([^>]*)\/?>/.exec(xml)?.[1] ?? '', 'clip_seconds_remaining'));
      const value = Number.isFinite(remaining) ? remaining : null;
      this.set({ ddrRemaining: value });
      return value;
    } catch {
      return null;
    }
  }

  /** Says which DDR 2 item ended, so a clip that was already replaced by another isn't taken for the new one. */
  private async checkClipEnd(): Promise<void> {
    const item = this.snapshot.ddrItem;
    const remaining = await this.readTimecode();
    if (remaining !== null && remaining <= 0.5 && this.snapshot.dskOn && this.snapshot.ddrItem === item) this.emit('clipEnded', item);
  }

  async readPlaylists(): Promise<void> {
    try {
      const xml = await (await fetch(`${this.base}/v1/dictionary?key=ddr_playlist`)).text();
      this.set({ playlist: playlistNames(xml, 'ddr2'), soundTracks: playlistNames(xml, 'sound') });
    } catch {
      // Kept as it was; it's read again when the playlist changes.
    }
  }

  /**
   * Where to watch a camera's video, or null. On the simulator, each camera has a moving test picture.
   * How the real TC1's cameras reach the laptop is still to be found at the station: the probe now lists
   * the TC1's NDI video feeds.
   */
  cameraVideo(input: number): string | null {
    if (this.live) return null;
    return this.snapshot.status === 'connected' && input >= 1 && input <= 3 ? `${this.base}/sim/video/input${input}` : null;
  }

  /** Sends one TC1 command, like v1_a_row=INPUT2. Nothing goes out to anything but the simulator. */
  async send(name: string, value?: string): Promise<boolean> {
    if (this.snapshot.status !== 'connected') return false;
    const query = new URLSearchParams({ name, ...(value === undefined ? {} : { value }) });
    try {
      const response = await fetch(`${this.base}/v1/shortcut?${query}`, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * The cue engine's commands, as TC1 commands. Cameras switch on M/E 1's A row, clips play from DDR 2
   * through DSK 2, and music from the Sound player (docs/TC1-FINDINGS.md). The DDR and Sound player
   * command names get confirmed on the real TC1 in Phase 5.
   */
  /**
   * Sends commands in order. Each batch waits for the one before it, so two cues arriving together (a
   * section start and the cue at its top, say) never mix their commands.
   */
  run(commands: SwitcherCommand[]): Promise<void> {
    const sent = this.sending.then(() => this.sendAll(commands));
    this.sending = sent.catch(() => undefined);
    return sent;
  }

  private sending: Promise<void> = Promise.resolve();

  private async sendAll(commands: SwitcherCommand[]): Promise<void> {
    for (const c of commands) {
      if (this.live && this.playout && c.kind !== 'camera') {
        await this.sendLive(c, this.playout);
        continue;
      }
      if (c.kind === 'camera') await this.send('v1_a_row', `INPUT${c.input}`);
      else if (c.kind === 'cueClip') await this.send('ddr2_select_clips', String(c.item));
      else if (c.kind === 'play') await this.send('ddr2_play');
      else if (c.kind === 'dsk') await this.send('main_dsk2_value', c.on ? '1' : '0');
      else if (c.kind === 'music') {
        if (c.play) {
          await this.send('sound_select_clips', String(c.track ?? 0));
          await this.send('sound_play');
        } else {
          await this.send('sound_stop');
        }
      }
    }
  }

  /**
   * Live mode: DSK 2 (whose source is input 4, the laptop) goes on and off on the TC1, and the playout
   * plays: taking DSK 2 on plays the cued clip, as DDR 2's AutoPlay does, and taking it off stops it.
   */
  private async sendLive(c: SwitcherCommand, playout: Playout): Promise<void> {
    if (c.kind === 'cueClip') playout.select(c.item);
    else if (c.kind === 'play') playout.play();
    else if (c.kind === 'music') playout.music(c.play, this.musicPath ?? undefined);
    else if (c.kind === 'dsk') {
      if (c.on) {
        playout.play();
        await this.send('main_dsk2_value', '1');
      } else {
        await this.send('main_dsk2_value', '0');
        playout.stop();
      }
    }
  }

  /**
   * Loads a player's playlist: on the simulator, DDR 2 gets the show's clips (GFX 1 or DDR 1 the green-
   * screen background, the Sound player the music); in live mode, the playout gets DDR 2's clips and the
   * music, and nothing goes to the TC1.
   */
  async loadPlaylist(clips: PlaylistClip[], player = 'ddr2'): Promise<void> {
    if (this.snapshot.status !== 'connected') throw new Error('Connect to the switcher first.');
    if (this.live) {
      if (player === 'ddr2') {
        this.playout?.setPlaylist(clips.map((c) => ({ name: c.name, path: c.path ?? '', seconds: c.durationMs ? c.durationMs / 1000 : null })));
        this.set({ playlist: clips.map((c) => c.name) });
      } else if (player === 'sound') {
        this.musicPath = clips[0]?.path ?? null;
        this.set({ soundTracks: clips.map((c) => c.name) });
      }
      return;
    }
    await fetch(`${this.base}/sim/api/playlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player, clips: clips.map(({ name, durationMs }) => ({ name, durationMs })) }) });
    await this.readPlaylists();
  }

  close(): void {
    this.closed = true;
    if (this.timecodeTimer) clearInterval(this.timecodeTimer);
    this.socket?.destroy();
    this.notifications?.close();
    this.set({ status: 'off' });
  }
}
