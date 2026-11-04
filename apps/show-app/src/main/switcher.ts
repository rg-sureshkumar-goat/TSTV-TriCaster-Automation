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
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import type { SwitcherCommand } from '@tstv/shared';
import type { FileInfo } from './media.ts';
import type { Playout } from './playout.ts';

export const SIMULATOR_NAME = 'TSTV Simulator';
export const TC1_NAME = 'TriCaster TC1';
export type SwitcherMode = 'simulator' | 'live';

/**
 * Asks the switcher's web control for a page, sent from localAddress when given: on a Mac, the self-
 * assigned range (169.254.x.x) is attached to Wi-Fi too, and the Mac can send the TC1's traffic there
 * instead of the cable (seen at the studio Oct 30, 2026), unless it goes from the cable's own address.
 */
export async function askSwitcher(address: string, page: string, timeoutMs: number, localAddress?: string): Promise<{ ok: boolean; text: string }> {
  if (!localAddress) {
    const response = await fetch(`http://${address}${page}`, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, text: await response.text() };
  }
  const [host, port] = address.split(':');
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port: port ? Number(port) : 80, path: page, localAddress, timeout: timeoutMs }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (text += chunk));
      response.on('end', () => resolve({ ok: (response.statusCode ?? 500) < 400, text }));
    });
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', reject);
  });
}

/** A clip for DDR 2 (the simulator) or the playout (live mode); path only matters to the playout. */
export interface PlaylistClip {
  name: string;
  durationMs: number;
  path?: string;
  /** The app's small playable copy, which the playout plays if the original can't be read. */
  fallback?: string;
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
  /** The producer paused the graphic on air where it is (RG, Nov 4, 2026). */
  ddrPaused: boolean;
  musicPlaying: boolean;
  /** DSK 2's source as the TC1 names it, like "input4" or "ddr2" (live mode checks it's input 4). */
  dskSource: string | null;
  /** The LITES layout is on program (M/E 4), with this camera in its left box (RG, Nov 2, 2026). */
  layoutOn: boolean;
  layoutCamera: number | null;
  /** A transition wipe playing (RG, Nov 2, 2026): which, and when it started, for the Program box. */
  transition: { which: string; startedAt: number; seconds: number } | null;
  playlist: string[];
  soundTracks: string[];
}

/** Program runs through M/E 1; the LITES layout is M/E 4 (TSTV's session, and RG, Nov 2, 2026). */
const PROGRAM_ME = 'v1';
/** What's up next, for the TC1's Preview box (RG, Nov 4, 2026). */
const UP_NEXT_ME = 'v3';
const LAYOUT_ME = 'v4';

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
  /** The show's transitions (RG, Nov 2, 2026), by which: "tease" and "lites". */
  transitions: Record<string, FileInfo> = {};
  /** On the simulator, where the green screen is: GFX 1 for a still, DDR 1 for a clip. */
  greenScreenSource = 'GFX1';

  /**
   * address is host:port of the web control; the state stream is on statePort (5951 on the TC1). In live
   * mode, playout plays the show's clips and music, and everything goes to the TC1 from localAddress, the
   * cable's own address (see askSwitcher).
   */
  constructor(
    address: string,
    private statePort = 5951,
    readonly mode: SwitcherMode = 'simulator',
    private playout: Playout | null = null,
    private localAddress?: string,
  ) {
    super();
    this.snapshot = { status: 'off', error: null, address, programInput: null, dskOn: false, ddrItem: null, ddrPlaying: false, ddrRemaining: null, ddrPaused: false, musicPlaying: false, dskSource: null, layoutOn: false, layoutCamera: null, transition: null, playlist: [], soundTracks: [] };
    if (playout) {
      // The playout stands in for DDR 2 and the Sound player.
      const follow = () => this.set({ ddrItem: playout.state.item, ddrPlaying: playout.state.playing, ddrRemaining: playout.state.remaining, ddrPaused: playout.state.paused, musicPlaying: playout.state.musicPlaying });
      playout.on('change', follow);
      playout.on('ended', (item: number) => {
        if (this.snapshot.dskOn || this.snapshot.layoutOn) this.emit('clipEnded', item);
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
      const version = (await askSwitcher(this.snapshot.address, '/v1/version', 4000, this.localAddress)).text;
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
    const socket = net.connect({ host, port: this.statePort, localAddress: this.localAddress });
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

    const notifications = new WebSocket(`ws://${this.snapshot.address}/v1/change_notifications`, { localAddress: this.localAddress });
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
    // The LITES layout: program shows M/E 4 ("V4"), with a camera on its A layer.
    const layoutOn = (this.states.get('main_a_row_named_input') ?? '').toUpperCase() === LAYOUT_ME.toUpperCase();
    const layoutInput = /^INPUT(\d+)$/i.exec(this.states.get(`${LAYOUT_ME}_a_row_named_input`) ?? '');
    const layout = { layoutOn, layoutCamera: layoutInput ? Number(layoutInput[1]) : null };
    // Live mode: the TC1's DDR 2 and Sound player aren't used; the playout reports instead.
    if (this.live) return this.set({ programInput: input ? Number(input[1]) : null, dskOn, ...layout, dskSource: this.states.get('main_dsk2_select_named_input')?.toLowerCase() ?? null });
    const ddrPlaying = this.states.get('ddr2_play') === 'true';
    const item = Number.parseInt(this.states.get('ddr2_select_clips') ?? '', 10);
    this.set({
      programInput: input ? Number(input[1]) : null,
      dskOn,
      ...layout,
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
      const xml = (await askSwitcher(this.snapshot.address, '/v1/dictionary?key=ddr_timecode', 2000, this.localAddress)).text;
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
    if (remaining !== null && remaining <= 0.5 && (this.snapshot.dskOn || this.snapshot.layoutOn) && this.snapshot.ddrItem === item) this.emit('clipEnded', item);
  }

  async readPlaylists(): Promise<void> {
    try {
      const xml = (await askSwitcher(this.snapshot.address, '/v1/dictionary?key=ddr_playlist', 3000, this.localAddress)).text;
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
      return (await askSwitcher(this.snapshot.address, `/v1/shortcut?${query}`, 2000, this.localAddress)).ok;
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

  private upNextShown: string | null = null;

  /**
   * Shows what's up next in the TC1's Preview box, live mode only (RG, Nov 4, 2026): the graphic goes to the
   * playout's Up Next source (input 7, keyed on M/E 3 in the RiGster session), the section's camera to
   * M/E 3's A row, and M/E 3 to the Preview row. Nothing is sent until it changes.
   */
  showUpNext(file: { path: string; fallback?: string } | null, camera: number | null): void {
    if (!this.live || !this.playout || this.snapshot.status !== 'connected') return;
    const shown = JSON.stringify([file?.path ?? null, camera]);
    if (shown === this.upNextShown) return;
    this.upNextShown = shown;
    this.playout.upNext(file?.path ?? null, file?.fallback);
    if (camera === null) return;
    this.sending = this.sending
      .then(async () => {
        await this.send(`${UP_NEXT_ME}_a_row_named_input`, `INPUT${camera}`);
        await this.send('main_b_row_named_input', UP_NEXT_ME.toUpperCase());
      })
      .catch(() => undefined);
  }

  /** Pauses the clip on air where it is, or starts it again. On the simulator, DDR 2 keeps its place when stopped. */
  async pauseClip(paused: boolean): Promise<void> {
    if (this.live && this.playout) return this.playout.pause(paused);
    await this.send(paused ? 'ddr2_stop' : 'ddr2_play');
    this.set({ ddrPaused: paused });
  }

  private async sendAll(commands: SwitcherCommand[]): Promise<void> {
    for (const c of commands) {
      // Anything else done to the clip on air ends the pause; the playout sees to that itself.
      if (!this.live && this.snapshot.ddrPaused && c.kind !== 'camera' && c.kind !== 'music') this.set({ ddrPaused: false });
      if (c.kind === 'transition') {
        await this.transition(c.which, c.then);
        continue;
      }
      if (this.live && this.playout && c.kind !== 'camera') {
        await this.sendLive(c, this.playout);
        continue;
      }
      // The TC1 takes a camera by its name on …_row_named_input; …_row wants its own number and ignores a
      // name (confirmed on the TC1 at the studio, Oct 30, 2026).
      if (c.kind === 'camera') await this.send('v1_a_row_named_input', `INPUT${c.input}`);
      else if (c.kind === 'cueClip') await this.send('ddr2_select_clips', String(c.item));
      else if (c.kind === 'play') await this.send('ddr2_play');
      else if (c.kind === 'dsk') await this.send('main_dsk2_value', c.on ? '1' : '0');
      else if (c.kind === 'layout') await this.layout(c.on, c.camera, 'DDR2', this.greenScreenSource, () => this.send('ddr2_stop'));
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
    else if (c.kind === 'layout') await this.layout(c.on, c.camera, 'INPUT4', 'INPUT5', async () => playout.stop());
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
   * A transition wipe (RG, Nov 2, 2026): the show's transition plays over everything, and at its middle,
   * when it covers the picture, the switch underneath happens (then). In live mode it's the playout's
   * Transition source on input 6, shown by DSK 4; on the simulator, RiGster's Program box draws it. With
   * no transition file, the switch just happens.
   */
  private async transition(which: string, then: SwitcherCommand[]): Promise<void> {
    const file = this.transitions[which];
    if (!file) return this.sendAll(then);
    const seconds = file.seconds && file.seconds > 0 ? file.seconds : 1;
    this.set({ transition: { which, startedAt: Date.now(), seconds } });
    if (this.live && this.playout) {
      this.playout.transition(file.path, file.playable);
      await this.send('main_dsk4_value', '1');
    }
    await new Promise((r) => setTimeout(r, (seconds * 1000) / 2));
    await this.sendAll(then);
    setTimeout(() => {
      if (this.live) void this.send('main_dsk4_value', '0');
      if (this.snapshot.transition?.which === which) this.set({ transition: null });
    }, (seconds * 1000) / 2);
  }

  /**
   * The LITES layout on M/E 4 (RG, Nov 2, 2026), as the TSTV session already had it (probe, Oct 29, 2026):
   * the camera on its A layer (left box), the clip on B (right box), the background on C. On: the layers
   * are set, then program shows M/E 4. Off: program goes back to M/E 1, with the camera, and the clip stops.
   * In live mode the clip is the laptop's graphics (input 4) and the background its green screen (input 5).
   */
  private async layout(on: boolean, camera: number | undefined, clip: string, background: string, stop: () => Promise<unknown>): Promise<void> {
    if (!on) {
      await this.send('main_a_row_named_input', PROGRAM_ME.toUpperCase());
      await stop();
      return;
    }
    await this.send(`${LAYOUT_ME}_a_row_named_input`, `INPUT${camera ?? 1}`);
    await this.send(`${LAYOUT_ME}_b_row_named_input`, clip);
    await this.send(`${LAYOUT_ME}_c_row_named_input`, background);
    await this.send('main_a_row_named_input', LAYOUT_ME.toUpperCase());
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
        this.playout?.setPlaylist(clips.map((c) => ({ name: c.name, path: c.path ?? '', fallback: c.fallback, seconds: c.durationMs ? c.durationMs / 1000 : null })));
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
