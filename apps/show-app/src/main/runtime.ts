// The show app's core: it follows the episode on the website, runs the cue engine on the prompter's cues,
// sends the engine's commands to the switcher, and keeps track of each element's file. It knows nothing
// about Electron (the window and file pickers come in from main.ts), so it can be tested on its own.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  breakCueId,
  breakGraphic,
  buildShowPlan,
  cameraCues,
  clipKey,
  isBreakCue,
  computeRundown,
  CueEngine,
  cueLabel,
  cuePointLabel,
  DEFAULT_SHOW_SETTINGS,
  defaultMusicPoints,
  matchMedia,
  readRows,
  topCues,
  type Broadcast,
  type CuePoint,
  type MediaProblem,
  type RundownTiming,
  type ShowPlan,
  type ShowSection,
  type SwitcherCommand,
} from '@tstv/shared';
import type { Action, AppState, ElementView, FileProblem, SectionView } from '../shared/api.ts';
import { collectFiles, makePlayable, readable, readFile, thumbnail, THUMBNAIL_VERSION, type FileInfo } from './media.ts';
import { CHECKED_GRAPHIC_TYPES, checkGraphic, convertGraphic } from './graphic-format.ts';
import type { ShowSettings } from '@tstv/shared';
import { cableAddresses, keepNdiOnCable, listSources, loadNdi } from './ndi.ts';
import { Feeds } from './feeds.ts';
import { Playout } from './playout.ts';
import { ProfileSync, type Profile, type ProfileList } from './profiles.ts';
import { DEFAULT_SETTINGS, type Settings, type Store } from './store.ts';
import { askSwitcher, Switcher, type PlaylistClip, type SwitcherMode } from './switcher.ts';
import type { UpdateState } from './updates.ts';
import { WebsiteLink, type CueEvent } from './website.ts';

/** What RiGster asks for until it sees the TC1's cable (RG, Nov 2, 2026). */
export const PLUG_IN = 'Plug in the TC1 Cable to Connect to TC1';

/** Manual Mode's one pretend section, which holds its graphics in the Playlist's order. */
const MANUAL_SECTION = 'manual';

/** The clip TSTV holds during each commercial break, at the start of every block in DDR 2 (probe, Oct 28, 2026). */
export const BREAK_CLIP = { name: 'TSTV Ident 2022 News', durationMs: 4_963 };

export interface RuntimeDeps {
  store: Store;
  /** Asks the producer for graphics files or a folder. */
  pickFiles: () => Promise<string[]>;
  /** Asks the producer for one file. */
  pickFile: () => Promise<string | null>;
  /**
   * Asks the producer what to call a recording and where to save it, starting with a suggested name in
   * the folder used before (RG, Oct 30, 2026: the producer names each recording).
   */
  pickRecording?: (suggested: string) => Promise<string | null>;
  /** Where recordings go until the producer picks a folder (the laptop's Movies or Videos folder). */
  recordingsFolder?: string;
  /** Gets the new version of RiGster (see updates.ts). */
  applyUpdate?: () => void;
  /** The laptop's cable addresses (tests pretend; the app reads them from the network settings). */
  cable?: () => string[];
  /** Google Drive's address, for show profiles (tests use a pretend one). */
  driveApi?: string;
  /**
   * RiGster runs the TC1 from the moment it opens (RG, Nov 2, 2026: no simulator, no Run the real TC1
   * button): it looks for the TC1 at once, and again whenever the connection drops. Only the app sets
   * this; tests (and npm run show-app:simulator, for development) leave it off and use the simulator.
   */
  alwaysLive?: boolean;
}

export class Runtime extends EventEmitter {
  website = new WebsiteLink();
  switcher: Switcher;
  engine: CueEngine | null = null;
  settings: Settings = DEFAULT_SETTINGS;
  private plan: ShowPlan | null = null;
  private timing: RundownTiming | null = null;
  private files: Record<string, FileInfo> = {};
  private permanent: Record<string, FileInfo> = {};
  /** The show's transitions, by which: "tease" (between back-to-back teases) and "lites" (in and out of a LITES). */
  private transitions: Record<string, FileInfo> = {};
  /**
   * Show profiles (RG, Nov 2, 2026): the permanent graphics, green screen and music above are the profile
   * picked by hand (settings.profileShowId), shared through Google Drive. The list comes from the website.
   */
  private profiles: ProfileSync;
  private profileList: ProfileList | null = null;
  /** The RiGster key's episode belongs to a different show than the profile picked: it isn't followed. */
  private profileMismatch = false;
  /**
   * Open On Manual Mode (RG, Nov 2, 2026): RiGster runs the TC1 by hand, with no rundown, prompter or
   * RiGster key, for recordings. Its graphics fire in the order they were imported (dragged into another
   * order if wanted) and stay up until taken off. No show profile: no permanent graphics, music or
   * transitions, and a green screen of its own, which can be one of the shows'.
   */
  private manualSession = false;
  /** Manual Mode's graphics' ids, in the Playlist's order (their files are in this.files). */
  private manualOrder: string[] = [];
  /** The shows whose green screen Manual Mode can use. */
  private greenScreenChoices: { showId: string; name: string }[] = [];
  /** A profile has been picked on the Select A Show Profile page since RiGster opened. */
  private profilePicked = false;
  /**
   * What the profile is doing with Google Drive (uploading, downloading), the last problem, and the files
   * waiting to go up because this laptop can't read them right now (their drive isn't plugged in).
   */
  private profileStatus: { working: string | null; error: string | null; waiting: string[] } = { working: null, error: null, waiting: [] };
  private syncingProfile = false;
  private syncProfileAgain = false;
  private profileTimer: ReturnType<typeof setInterval> | null = null;
  private problems: FileProblem[] = [];
  private lastCue: AppState['lastCue'] = null;
  private log: AppState['log'] = [];
  private clock: AppState['clock'] = { startedAt: null, sectionLabel: null, overUnderSeconds: null };
  private greenScreen: FileInfo | null = null;
  private musicTrack: FileInfo | null = null;
  /**
   * Files with no playable copy yet that the app can't read right now: missing (on a drive that isn't
   * plugged in) or blocked (macOS isn't letting the app read the drive).
   */
  private unreachable = new Map<string, 'missing' | 'blocked'>();
  /** L3, OTSL and OTSR files already checked this time RiGster is open: in the right format, or not convertible. */
  private formatChecked = new Set<string>();
  /** The element whose graphic is being converted right now. */
  private converting: string | null = null;
  private fixing = false;
  private fixAgain = false;
  /** RiGster is closing: the copies and conversions in the background stop, and nothing more is saved. */
  private closed = false;
  /** Files FFmpeg couldn't make a playable copy of, so they aren't tried again and again. */
  private unplayable = new Set<string>();
  private makingPlayable = false;
  private playableAgain = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private cableTimer: ReturnType<typeof setInterval> | null = null;
  private syncingSimulator = false;
  /** Live mode's playout (Phase 5), which sends the graphics and music to the TC1's input 4 over NDI. */
  private playout: Playout | null = null;
  /** Live mode's view of the TC1's camera and program feeds, and the recording. */
  private feeds: Feeds | null = null;
  private liveError: string | null = null;
  /**
   * While live mode is being turned on: what RiGster is waiting for (the cable, the TC1, or its session),
   * as the producer reads it. It keeps trying until it connects or the producer cancels (RG, Nov 1, 2026).
   */
  private liveWaiting: string | null = null;
  /** The laptop's address on the TC1's cable, while connected; when it goes, so has the cable. */
  private liveCable: string | null = null;
  /** Each search for the TC1 has its own number, so cancelling one stops it. */
  private liveSearch = 0;
  /** A new version of RiGster, from main.ts's update checks. */
  private update: UpdateState = null;
  /** The Sound fader, from 0 to 2, which the playout applies in live mode. */
  private fader = 1;

  constructor(private deps: RuntimeDeps) {
    super();
    this.profiles = new ProfileSync(() => ({ siteUrl: this.settings.siteUrl, key: this.settings.key }), deps.store.profileFolder(), deps.driveApi);
    this.switcher = this.newSwitcher(DEFAULT_SETTINGS.simulatorAddress);
    this.website.on('change', () => this.changed());
    this.website.on('rundown', () => {
      this.rebuild();
      this.sendMedia();
    });
    this.website.on('cue', (event: CueEvent) => void this.onCue(event));
    this.website.on('broadcast', (broadcast: Broadcast) => this.onBroadcast(broadcast));
  }

  /**
   * Start live broadcast: automation starts following the prompter, from a clean slate (still in manual
   * mode if the producer chose it), and the clock starts. End live broadcast: it stops (the producer's own
   * buttons keep working).
   */
  private onBroadcast(broadcast: Broadcast): void {
    if (broadcast.live) {
      if (this.plan) {
        const manual = this.engine?.state.manual ?? false;
        const camerasByHand = this.engine?.state.camerasByHand ?? false;
        this.engine = new CueEngine(this.plan);
        this.engine.setManual(manual);
        this.engine.setCamerasByHand(camerasByHand, this.switcher.snapshot.programInput);
      }
      this.clock = { startedAt: broadcast.startedAt ?? Date.now(), sectionLabel: null, overUnderSeconds: null };
      this.note('Live: automation is following the prompter');
    } else {
      this.note('Live broadcast ended: automation stopped');
    }
    this.reportStatus();
    this.changed();
  }

  /** Starts up with what was remembered: the TC1 (or, in tests, the simulator), and the last episode's key. */
  async start(): Promise<void> {
    this.settings = await this.deps.store.settings();
    if (this.deps.alwaysLive) {
      // Not connected until the TC1 is found: nothing is sent anywhere until then.
      this.switcher = this.newSwitcher(this.settings.tc1Address, 5951, 'live');
      void this.lookForTc1();
    }
    // Tests can run a second simulator, with its state stream on another port (TSTV_SIM_STATE_PORT).
    else await this.connectSwitcher(this.settings.simulatorAddress, Number(process.env.TSTV_SIM_STATE_PORT) || undefined);
    await this.loadProfile();
    if (this.settings.key) await this.connect(this.settings.siteUrl, this.settings.key);
    else void this.refreshProfiles();
    // Other laptops' changes to the profile arrive every two minutes.
    this.profileTimer = setInterval(() => void this.refreshProfiles(), 120_000);
    // A drive plugged in later is noticed by itself: its files get their playable copies.
    // So do the profile's files waiting to go to Google Drive.
    // A pulled cable can leave the TC1's connection looking open for minutes, so the cable itself is watched.
    if (this.deps.alwaysLive) {
      this.cableTimer = setInterval(() => {
        if (this.liveCable && !(this.deps.cable ?? cableAddresses)().includes(this.liveCable)) void this.lostTc1();
      }, 2000);
    }
    this.retryTimer = setInterval(() => {
      if (this.unreachable.size > 0) void this.makePlayables();
      if (this.profileStatus.waiting.length > 0) void this.syncProfile();
    }, 10_000);
    this.changed();
  }

  private newSwitcher(address: string, statePort?: number, mode: SwitcherMode = 'simulator', playout: Playout | null = null, localAddress?: string): Switcher {
    const switcher = new Switcher(address, statePort, mode, playout, localAddress);
    switcher.transitions = this.transitions;
    let playlist = '';
    switcher.on('change', () => {
      const now = `${switcher.snapshot.playlist.join('\n')}|${switcher.snapshot.soundTracks.join('\n')}`;
      if (now !== playlist) {
        playlist = now;
        this.rebuild();
      }
      this.reportStatus();
      this.changed();
      // The TC1's connection dropped (its cable pulled, or it was turned off): look for it again.
      if (this.deps.alwaysLive && switcher === this.switcher && this.playout && switcher.snapshot.status === 'error') void this.lostTc1();
      // DDR 2 may have been waiting for the clip on air to finish.
      void this.syncSimulator();
    });
    switcher.on('clipEnded', (item: number | null) => {
      if (!this.engine) return;
      const ended = this.view(this.engine.state.onAir);
      void this.run(this.engine.clipEnded(item), ended ? `${ended.label} ended` : 'Clip ended');
    });
    return switcher;
  }

  private note(text: string): void {
    this.log = [{ at: Date.now(), text }, ...this.log].slice(0, 50);
  }

  private async run(commands: SwitcherCommand[], why: string): Promise<void> {
    if (commands.length) this.note(why);
    await this.switcher.run(commands);
    if (commands.length && this.plan?.sections.flatMap((s) => s.elements).find((e) => e.id === this.engine?.state.onAir)?.type !== 'LITES') await this.switcher.leaveStrayLayout();
    this.changed();
  }

  private reportStatus(): void {
    this.website.setAppStatus({ mode: this.switcher.mode, switcherConnected: this.switcher.snapshot.status === 'connected', paused: this.engine?.state.manual ?? false });
  }

  // ---- The show ----

  private fileFor(element: { id: string; type: string; name: string }): FileInfo | undefined {
    return this.files[element.id] ?? (element.type === 'PERM' ? this.permanent[element.name.trim().toLowerCase()] : undefined);
  }

  /**
   * The show's music points. Music in "default" (or "teases") plays it whenever a Tease fires, and then Music
   * out "default" stops it when the teases end (RG, Oct 30, 2026). A Music out point instead keeps the teases
   * before it playing until it.
   */
  private musicPoints(): { in: CuePoint | null; out: CuePoint | null; track: string | null; withTeases: boolean } {
    const showId = this.website.show?.id ?? '';
    const chosen = this.settings.music[showId] ?? { in: 'default', out: 'default' };
    const defaults = this.plan ? defaultMusicPoints(this.plan.sections) : { in: null, out: null };
    const resolve = (value: string, fallback: CuePoint | null): CuePoint | null => {
      if (value === 'none') return null;
      const [kind, id] = value.split(':');
      if (kind === 'section' && id) return { kind: 'section', sectionId: id };
      if (kind === 'cue' && id) return { kind: 'cue', elementId: id };
      return fallback;
    };
    const withTeases = chosen.in === 'default' || chosen.in === 'teases';
    return { in: withTeases ? null : resolve(chosen.in, defaults.in), out: resolve(chosen.out, withTeases ? null : defaults.out), track: this.musicTrack?.path ?? null, withTeases };
  }

  /** Rebuilds the show from the rundown, the files and the switcher's playlists. */
  private rebuild(): void {
    if (this.manualSession) return this.rebuildManual();
    const doc = this.website.doc;
    const show = this.website.show;
    if (!doc || !show) return;
    this.timing = computeRundown(readRows(doc), show.settings.targetSeconds, undefined, show.settings.breakSeconds);
    const files: Record<string, string> = {};
    for (const row of readRows(doc)) if (row.kind === 'section') for (const e of row.elements) {
      const file = this.fileFor(e);
      if (file) files[e.id] = path.basename(file.path);
    }
    // Each commercial break plays the show's break graphic, or else the break clip DDR 2 already has.
    const breakFile = this.breakFile();
    for (const c of this.timing.rows) if (c.breakBefore) files[breakCueId(c.row.id)] = breakFile ? path.basename(breakFile.path) : BREAK_CLIP.name;
    const { playlist, soundTracks } = this.switcher.snapshot;
    const cameras: Record<string, { id: string; camera: string }[]> = {};
    for (const row of readRows(doc)) if (row.kind === 'section') cameras[row.id] = cameraCues(doc, row.id);
    // First without the producer's music choices (they need the sections), then with them.
    this.plan = buildShowPlan(this.timing, show.settings, files, playlist, soundTracks, undefined, cameras);
    this.plan = buildShowPlan(this.timing, show.settings, files, playlist, soundTracks, this.musicPoints(), cameras);
    this.plan.transitions = { tease: Boolean(this.transitions.tease), lites: Boolean(this.transitions.lites) };
    if (this.engine) this.engine.setPlan(this.plan);
    else this.engine = new CueEngine(this.plan);
    this.changed();
    void this.syncSimulator();
  }

  private async onCue(event: CueEvent): Promise<void> {
    if (!this.engine || !this.plan) return;
    // Before Start live broadcast (and after End), prompter cues are ignored: the app does only what the
    // producer does by hand.
    if (!this.website.broadcast().live) return;
    const latencyMs = Date.now() - event.at;
    let label: string;
    let commands: SwitcherCommand[];
    if (event.kind === 'section') {
      const section = this.plan.sections.find((s) => s.id === event.sectionId);
      if (!section) return;
      // The cues at the very top of its script fire with it (RG, Oct 29, 2026).
      const top = this.website.doc ? topCues(this.website.doc, section.id) : [];
      const firing = this.engine.state.manual ? [] : top.map((id) => this.view(id)?.label ?? this.engine?.cameraCue(id)?.camera).filter(Boolean);
      label = `${section.label} started${firing.length ? `, with ${firing.join(' and ')}` : ''}`;
      commands = this.engine.sectionStarted(section.id, top);
      const now = Date.now();
      this.clock.startedAt ??= this.website.broadcast().startedAt ?? now;
      const planned = this.timing?.rows.find((c) => c.row.id === section.id)?.startOffset ?? null;
      this.clock = { startedAt: this.clock.startedAt, sectionLabel: section.label, overUnderSeconds: planned === null ? null : Math.round((now - this.clock.startedAt) / 1000 - planned) };
    } else if (this.engine.cameraCue(event.elementId ?? null)) {
      const cue = this.engine.cameraCue(event.elementId ?? null)!;
      label = `${cue.camera} (${this.plan.sections.find((s) => s.id === cue.sectionId)?.label ?? ''})`;
      commands = this.engine.cueReached(cue.id);
    } else {
      const element = this.view(event.elementId ?? null);
      if (!element) return;
      label = `${element.label} (${element.sectionLabel})`;
      commands = this.engine.cueReached(element.id);
    }
    // Clocks differ a little between computers, so very large or negative numbers aren't shown.
    this.lastCue = { label, latencyMs: latencyMs >= 0 && latencyMs < 10_000 ? latencyMs : null, at: Date.now() };
    await this.run(commands, label);
  }

  // ---- Files ----

  private sendMedia(): void {
    const doc = this.website.doc;
    if (!doc) return;
    const items: Record<string, { file: string; seconds: number | null } | null> = {};
    for (const row of readRows(doc)) if (row.kind === 'section') for (const e of row.elements) {
      if (e.type === 'MUSIC') continue;
      const file = this.fileFor(e);
      items[e.id] = file ? { file: path.basename(file.path), seconds: file.seconds } : null;
    }
    this.website.sendMedia(items);
  }

  private async saveFiles(): Promise<void> {
    await this.writeFiles();
    this.rebuild();
    this.sendMedia();
    void this.makePlayables();
  }

  private async writeFiles(): Promise<void> {
    if (this.closed) return;
    if (this.manualSession) return this.deps.store.saveManualSession({ order: this.manualOrder, files: this.files, greenScreen: this.greenScreen });
    const episode = this.website.episode;
    const profile = this.profileShow()?.id;
    if (episode) await this.deps.store.saveEpisodeFiles(episode.id, this.files);
    if (profile) await this.deps.store.savePermanentFiles(profile, this.permanent);
    if (profile) await this.deps.store.saveMusicTrack(profile, this.musicTrack);
    if (profile) await this.deps.store.saveGreenScreen(profile, this.greenScreen);
    if (profile) await this.deps.store.saveTransitions(profile, this.transitions);
  }

  /**
   * Makes the copies the Program box plays (see makePlayable), one file at a time in the background, so
   * the producer can carry on. Each one shows up as soon as it's ready, and is remembered with its file,
   * so it plays even after the drive the file came from is unplugged. A file whose drive isn't plugged in
   * waits for it (see start).
   */
  private async makePlayables(): Promise<void> {
    // Graphics in the wrong format are converted alongside, in a queue of their own, so a slow conversion
    // never holds up the Program box's copies.
    void this.fixGraphics();
    if (this.makingPlayable) {
      this.playableAgain = true;
      return;
    }
    this.makingPlayable = true;
    const exists = (file: string) => stat(file).then(() => true, () => false);
    try {
      do {
        this.playableAgain = false;
        let made = false;
        for (const info of [...Object.values(this.files), ...Object.values(this.permanent), ...(this.musicTrack ? [this.musicTrack] : []), ...(this.greenScreen ? [this.greenScreen] : []), ...Object.values(this.transitions)]) {
          if (this.closed) return;
          if ((info.playable && (await exists(info.playable))) || this.unplayable.has(info.path)) continue;
          const found = await readable(info.path);
          if (found !== (this.unreachable.get(info.path) ?? 'yes')) {
            if (found === 'yes') this.unreachable.delete(info.path);
            else this.unreachable.set(info.path, found);
            this.changed();
          }
          if (found !== 'yes') continue;
          const copy = await makePlayable(info.path, this.deps.store.playableFolder()).catch(() => null);
          if (copy) {
            info.playable = copy;
            made = true;
          } else {
            this.unplayable.add(info.path);
          }
          this.changed();
        }
        if (made) await this.writeFiles();
      } while (this.playableAgain);
    } finally {
      this.makingPlayable = false;
    }
  }

  /**
   * Checks each L3, OTSL and OTSR graphic's format, and plays a copy in the right one when it's wrong (RG,
   * Nov 10, 2026: 1080p, 29.97, ProRes 4444 with alpha, QuickTime). One at a time, in the background.
   */
  private async fixGraphics(): Promise<void> {
    if (this.fixing) {
      this.fixAgain = true;
      return;
    }
    this.fixing = true;
    try {
      do {
        this.fixAgain = false;
        // A converted graphic gets its Program box copy made from the right format.
        if (await this.fixGraphicsOnce()) void this.makePlayables();
      } while (this.fixAgain);
    } finally {
      this.fixing = false;
    }
  }

  private async fixGraphicsOnce(): Promise<boolean> {
    let fixed = false;
    for (const [id, info] of Object.entries(this.files)) {
      if (this.closed) return false;
      const type = this.element(id)?.type;
      if (!type || !CHECKED_GRAPHIC_TYPES.has(type) || info.original || this.formatChecked.has(info.path)) continue;
      if ((await readable(info.path)) !== 'yes') continue;
      const name = path.basename(info.path);
      this.converting = id;
      this.changed();
      try {
        const converted = await this.convertGraphic(info.path);
        // Unless it was replaced or taken off its cue while it was being converted.
        if (converted && this.files[id] === info) {
          this.files[id] = converted;
          this.note(`${name} converted to 1080p ProRes 4444: ${converted.fixes!.join('; ')}`);
          fixed = true;
        }
      } catch {
        this.formatChecked.add(info.path);
        this.note(`${name} is in the wrong format and couldn’t be converted; it plays as it is`);
      } finally {
        this.converting = null;
      }
      this.changed();
    }
    if (fixed) {
      await this.writeFiles();
      this.rebuild();
      this.sendMedia();
    }
    return fixed;
  }

  /** A graphic's copy in the right format, read and ready to go on its cue; null when it's right already. */
  private async convertGraphic(file: string): Promise<FileInfo | null> {
    try {
      const problems = await checkGraphic(file);
      if (!problems.length) return null;
      const copy = await convertGraphic(file, this.deps.store.convertedFolder(), problems);
      return { ...(await readFile(copy)), original: file, fixes: problems.map((p) => p.text) };
    } finally {
      this.formatChecked.add(file);
    }
  }

  /** Where the files that aren't on this laptop are: the drives' names (like “RG'S DRIVE”), or their folders. */
  private unreachablePlaces(): string[] {
    return this.placesOf([...this.unreachable.keys()]);
  }

  /** Where files are, as the producer knows it: “RG'S DRIVE”, drive E:, or a folder. */
  private placesOf(files: string[]): string[] {
    const places = files.map((file) => {
      const mac = /^\/Volumes\/([^/]+)\//.exec(file);
      const windows = /^([A-Za-z]):[\\/]/.exec(file);
      return mac ? `“${mac[1]}”` : windows ? `drive ${windows[1].toUpperCase()}:` : path.dirname(file);
    });
    return [...new Set(places)];
  }

  private problemText(p: MediaProblem): string {
    switch (p.reason) {
      case 'pattern':
        return 'Its name doesn’t follow Section_Type_Slug (like B5_VO_Basketball).';
      case 'no-section':
        return `There’s no section ${p.section} in the rundown.`;
      case 'no-element':
        return `${p.section} has no ${p.type} element without a file. Add one in the rundown, or put this file on another element.`;
      case 'which-element':
        return `${p.section} has more than one element it could be.`;
    }
  }

  private async addFiles(paths: string[]): Promise<void> {
    if (this.manualSession) return this.addManualFiles(paths);
    if (!this.plan) return;
    const all = await collectFiles(paths);
    // Files already on a cue (imported again from the same drive, say) are read again and keep their cues.
    const onCues = new Map<string, () => Promise<void>>();
    for (const [id, info] of Object.entries(this.files)) {
      onCues.set(info.path, async () => void (this.files[id] = await readFile(info.path)));
      // A converted graphic's original, imported again: checked again, as it may have been re-exported. Its
      // copy is made again only if it changed, so the cue goes straight back to the copy.
      const original = info.original;
      if (original) onCues.set(original, async () => void (this.files[id] = (await this.convertGraphic(original).catch(() => null)) ?? (await readFile(original))));
    }
    for (const [name, info] of Object.entries(this.permanent)) onCues.set(info.path, async () => void (this.permanent[name] = await readFile(info.path)));
    for (const file of all.filter((f) => onCues.has(f))) {
      this.formatChecked.delete(file);
      await onCues.get(file)!();
      this.unreachable.delete(file);
      this.unplayable.delete(file);
    }
    const files = all.filter((f) => !onCues.has(f));
    const sections = this.plan.sections.map((s) => ({ label: s.label, slug: s.slug, elements: s.elements.map((e) => ({ id: e.id, type: e.type, name: e.name })) }));
    const taken = new Set(Object.keys(this.files));
    const { matches, problems } = matchMedia(files, sections, taken);
    // Elements this import fills aren't offered for the files it couldn't place.
    const placed = new Set(matches.filter((m) => !m.checkSlug).map((m) => m.elementId));
    const open = this.views().filter((e) => e.type !== 'MUSIC' && !e.file && !placed.has(e.id));
    // The likely cues first, then every other one, so there's always somewhere to put a file: one that
    // already has a file says so, and placing it there replaces that file (RG, Nov 2, 2026: Put it there
    // did nothing when every cue already had a file, as the list was empty).
    const choices = (ids?: string[]) => {
      const first = ids ? this.views().filter((e) => ids.includes(e.id)) : open;
      const rest = this.views().filter((e) => e.type !== 'MUSIC' && !first.includes(e));
      return [...first, ...rest].map((e) => ({ id: e.id, label: `${e.sectionLabel} · ${e.label}${e.file ? ` (replaces ${e.file})` : ''}` }));
    };
    const asked: FileProblem[] = problems.map((p) => ({ path: p.file, name: path.basename(p.file), reason: this.problemText(p), candidates: choices(p.reason === 'which-element' ? p.candidates : undefined) }));
    for (const m of matches) {
      if (m.checkSlug) {
        const section = this.plan.sections.find((s) => s.label === m.section);
        // The slug doesn't look like the section's: ask, with the likely element first.
        asked.push({ path: m.file, name: path.basename(m.file), reason: `Its name doesn’t look like ${m.section} (“${section?.slug ?? ''}”). Check it’s the right file.`, candidates: choices([m.elementId, ...open.map((e) => e.id).filter((id) => id !== m.elementId)]) });
        continue;
      }
      this.files[m.elementId] = await readFile(m.file);
    }
    const known = new Set(asked.map((p) => p.path));
    this.problems = [...this.problems.filter((p) => !known.has(p.path)), ...asked];
    this.note(`Imported ${matches.length - asked.filter((a) => matches.some((m) => m.file === a.path)).length + all.length - files.length} of ${all.length} file(s)`);
    await this.saveFiles();
  }

  private element(id: string) {
    return this.plan?.sections.flatMap((s) => s.elements).find((e) => e.id === id);
  }

  /** The show's permanent graphic called this, as written in the show's settings. */
  private permanentName(name: string): string | undefined {
    return this.profileShow()?.settings.permanentGraphics.find((g) => g.toLowerCase() === name.trim().toLowerCase());
  }

  /**
   * Files dropped on the permanent graphics box: each goes to the permanent graphic its name contains
   * ("PrimeTime Show Intro.mov" → Show Intro). The rest are asked about.
   */
  private async addPermanent(paths: string[]): Promise<void> {
    const show = this.profileShow();
    if (!show) return;
    const simple = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const asked: FileProblem[] = [];
    let placed = 0;
    for (const file of await collectFiles(paths)) {
      const base = simple(path.basename(file).replace(/\.[^.]+$/, ''));
      const found = show.settings.permanentGraphics.filter((g) => simple(g) && (base.includes(simple(g)) || simple(g).includes(base)));
      if (found.length === 1) {
        this.permanent[found[0].toLowerCase()] = await readFile(file);
        placed++;
      } else {
        asked.push({
          path: file,
          name: path.basename(file),
          reason: found.length ? 'Its name could be more than one permanent graphic.' : 'Its name doesn’t match any of the show’s permanent graphics.',
          candidates: (found.length ? found : show.settings.permanentGraphics).map((g) => ({ id: `perm:${g}`, label: `★ ${g}` })),
        });
      }
    }
    const known = new Set(asked.map((p) => p.path));
    this.problems = [...this.problems.filter((p) => !known.has(p.path)), ...asked];
    this.note(`Added ${placed} permanent graphic file(s)`);
    await this.saveFiles();
    void this.syncProfile();
  }

  private async setGreenScreen(file: string | null, fromProfile = false): Promise<void> {
    const show = this.profileShow();
    if (!show && !this.manualSession) return;
    if (!fromProfile) {
      if (!file && this.greenScreen?.driveFileId && show) await this.removeFromProfile('greenScreen');
      this.greenScreen = file ? await readFile(file) : null;
    }
    // Manual Mode's green screen is its own, not any show's.
    if (show) await this.deps.store.saveGreenScreen(show.id, this.greenScreen);
    else await this.writeFiles();
    if (!fromProfile && show) void this.syncProfile();
    // On the simulator, a still goes in GFX 1 and a clip in DDR 1. In live mode the playout sends it to the
    // TC1 as the RIGSTER (Green Screen) source (RG, Oct 30 and Nov 1, 2026).
    this.playout?.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    void this.makePlayables();
    if (this.greenScreen && this.switcher.snapshot.status === 'connected' && this.switcher.mode === 'simulator') {
      const name = path.basename(this.greenScreen.path).replace(/\.[^.]+$/, '');
      const seconds = this.greenScreen.seconds;
      await this.switcher.loadPlaylist([{ name, durationMs: seconds ? Math.round(seconds * 1000) : 0 }], seconds ? 'ddr1' : 'gfx1');
      // The LITES layout's background is the same green screen (RG, Nov 2, 2026).
      this.switcher.greenScreenSource = seconds ? 'DDR1' : 'GFX1';
    }
    this.note(this.greenScreen ? `Green screen: ${path.basename(this.greenScreen.path)}` : 'Green screen removed');
    this.changed();
  }

  /**
   * A transition for the show (RG, Nov 2, 2026): "tease" plays between back-to-back teases, "lites" going
   * into and coming out of a LITES. Saved in the show profile, like the permanent graphics.
   */
  private async setTransition(which: 'tease' | 'lites', file: string | null): Promise<void> {
    if (!this.profileShow()) return;
    if (!file && this.transitions[which]?.driveFileId) await this.removeFromProfile(`transition:${which}`);
    if (file) this.transitions[which] = await readFile(file);
    else delete this.transitions[which];
    this.note(file ? `${which === 'tease' ? 'Tease' : 'LITES'} transition: ${path.basename(file)}` : `${which === 'tease' ? 'Tease' : 'LITES'} transition removed`);
    await this.saveFiles();
    this.useTransitions();
    void this.makePlayables();
    void this.syncProfile();
  }

  /** Tells the switcher and the cue engine which transitions the show has. */
  private useTransitions(): void {
    this.switcher.transitions = this.transitions;
    this.rebuild();
  }

  /**
   * The show's music track, dropped on the Music box (RG, Oct 29, 2026), so the right track plays. On the
   * simulator it's put in the Sound player; in live mode the playout plays it from the laptop (Oct 30, 2026).
   */
  private async setMusicTrack(file: string | null, fromProfile = false): Promise<void> {
    const show = this.profileShow();
    if (!show) return;
    if (!fromProfile) {
      if (!file && this.musicTrack?.driveFileId) await this.removeFromProfile('music');
      this.musicTrack = file ? await readFile(file) : null;
    }
    await this.deps.store.saveMusicTrack(show.id, this.musicTrack);
    if (!fromProfile) void this.syncProfile();
    if (this.musicTrack && this.switcher.snapshot.status === 'connected') await this.loadSound();
    this.note(this.musicTrack ? `Music: ${path.basename(this.musicTrack.path)}` : 'Music track removed');
    void this.makePlayables();
    this.rebuild();
  }

  /** The music track, in the simulator's Sound player or, in live mode, the playout. */
  private async loadSound(): Promise<void> {
    if (!this.musicTrack) return;
    const name = path.basename(this.musicTrack.path).replace(/\.[^.]+$/, '');
    await this.switcher.loadPlaylist([{ name, durationMs: Math.round((this.musicTrack.seconds ?? 60) * 1000), path: this.musicTrack.path }], 'sound');
  }

  private async assign(file: string, elementId: string): Promise<void> {
    if (elementId.startsWith('perm:')) {
      const name = this.permanentName(elementId.slice(5));
      if (!name) return;
      this.permanent[name.toLowerCase()] = await readFile(file);
      this.problems = this.problems.filter((p) => p.path !== file);
      await this.saveFiles();
      return void this.syncProfile();
    }
    const element = this.element(elementId);
    if (!element) {
      // Said where the producer sees it, instead of nothing happening.
      this.problems = this.problems.map((p) => (p.path === file ? { ...p, reason: 'That cue isn’t in the rundown any more. Pick another one.' } : p));
      return this.changed();
    }
    const info = await readFile(file);
    // A permanent graphic's file is remembered for the whole show, so every episode has it.
    if (element.type === 'PERM') this.permanent[element.name.trim().toLowerCase()] = info;
    else this.files[elementId] = info;
    this.problems = this.problems.filter((p) => p.path !== file);
    await this.saveFiles();
    if (element.type === 'PERM') void this.syncProfile();
  }

  // ---- Show profiles (RG, Nov 2, 2026) ----

  /**
   * The show profile picked: from the website's list, or the key's show while the list hasn't come yet
   * (and while none is picked).
   */
  private profileShow(): { id: string; name: string; settings: ShowSettings } | null {
    if (this.manualSession) return null;
    const id = this.settings.profileShowId || this.website.show?.id;
    if (!id) return null;
    const listed = this.profileList?.profiles.find((p) => p.id === id);
    if (listed) return listed;
    return this.website.show?.id === id ? this.website.show : null;
  }

  /** Loads the picked profile's files as this laptop has them, then checks Google Drive for changes. */
  private async loadProfile(): Promise<void> {
    const id = this.settings.profileShowId;
    this.permanent = id ? await this.deps.store.permanentFiles(id) : {};
    this.greenScreen = id ? await this.deps.store.greenScreen(id) : null;
    this.musicTrack = id ? await this.deps.store.musicTrack(id) : null;
    this.transitions = id ? await this.deps.store.transitions(id) : {};
    this.switcher.transitions = this.transitions;
    this.playout?.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    if (this.musicTrack && this.switcher.snapshot.status === 'connected') await this.loadSound().catch(() => undefined);
    this.rebuild();
    this.changed();
    void this.makePlayables();
  }

  /** The producer picks a show profile. With a RiGster key for another show's episode, it isn't followed. */
  private async setProfile(showId: string): Promise<void> {
    const first = !this.profilePicked;
    this.profilePicked = true;
    if (this.manualSession) return this.leaveManual(showId);
    if (showId === this.settings.profileShowId) {
      if (first) void this.syncProfile();
      return this.changed();
    }
    this.settings = { ...this.settings, profileShowId: showId };
    await this.deps.store.saveSettings(this.settings);
    this.note(`Show profile: ${this.profileShow()?.name ?? 'none'}`);
    this.profileStatus = { working: null, error: null, waiting: [] };
    await this.loadProfile();
    // Connect (or reconnect) with the saved key, which checks the key's show against the profile.
    if (this.settings.key) await this.connect(this.settings.siteUrl, this.settings.key);
    else void this.syncProfile();
  }

  // ---- Manual Mode (RG, Nov 2, 2026) ----

  /**
   * Open On Manual Mode: RiGster stops following any episode and runs the TC1 by hand, with the graphics
   * imported for Manual Mode, kept from last time.
   */
  private async openManual(): Promise<void> {
    this.profilePicked = true;
    this.manualSession = true;
    this.profileMismatch = false;
    this.website.close();
    this.website.episode = null;
    this.website.show = null;
    this.engine = null;
    this.plan = null;
    this.timing = null;
    this.problems = [];
    this.clock = { startedAt: null, sectionLabel: null, overUnderSeconds: null };
    const saved = await this.deps.store.manualSession();
    this.files = saved.files;
    this.manualOrder = saved.order.filter((id) => saved.files[id]);
    // No permanent graphics, music or transitions in Manual Mode.
    this.permanent = {};
    this.musicTrack = null;
    this.transitions = {};
    this.switcher.transitions = this.transitions;
    this.greenScreen = saved.greenScreen;
    this.note('Manual Mode: the producer runs the TC1 by hand');
    this.rebuild();
    await this.setGreenScreen(null, true);
    this.reportStatus();
    void this.findGreenScreens();
    void this.makePlayables();
  }

  /** Leaves Manual Mode for a show profile (and, with reconnect, the saved RiGster key's episode). */
  private async leaveManual(showId: string, reconnect = true): Promise<void> {
    this.manualSession = false;
    this.files = {};
    this.manualOrder = [];
    this.problems = [];
    this.engine = null;
    this.plan = null;
    if (showId !== this.settings.profileShowId) {
      this.settings = { ...this.settings, profileShowId: showId };
      await this.deps.store.saveSettings(this.settings);
    }
    this.note(`Show profile: ${this.profileShow()?.name ?? 'none'}`);
    this.profileStatus = { working: null, error: null, waiting: [] };
    await this.loadProfile();
    if (reconnect && this.settings.key) await this.connect(this.settings.siteUrl, this.settings.key);
    else void this.syncProfile();
  }

  /** Manual Mode's plan: one section with its graphics, in the Playlist's order, each staying up until taken off. */
  private rebuildManual(): void {
    const settings = DEFAULT_SHOW_SETTINGS;
    const playlist = this.switcher.snapshot.playlist.map(clipKey);
    const section: ShowSection = {
      id: MANUAL_SECTION,
      label: 'Manual',
      slug: '',
      type: '',
      camera: settings.defaultCamera,
      input: settings.cameraInputs[settings.defaultCamera] ?? 1,
      elements: this.manualOrder
        .filter((id) => this.files[id])
        .map((id) => {
          const file = path.basename(this.files[id].path);
          const item = playlist.indexOf(clipKey(file));
          return { id, sectionId: MANUAL_SECTION, type: 'FSG', name: file.replace(/\.[^.]+$/, ''), behavior: 'graphic', ddrItem: item < 0 ? null : item };
        }),
      cameraCues: [],
    };
    this.timing = null;
    this.plan = { sections: [section], music: { in: null, out: null, track: 0, withTeases: false }, transitions: { tease: false, lites: false } };
    if (this.engine) this.engine.setPlan(this.plan);
    else {
      this.engine = new CueEngine(this.plan);
      this.engine.setManual(true);
      this.engine.setCamerasByHand(true, this.switcher.snapshot.programInput);
    }
    this.changed();
    void this.syncSimulator();
  }

  /** Imported in Manual Mode: added to the end of the Playlist, in the order they came. */
  private async addManualFiles(paths: string[]): Promise<void> {
    const known = new Set(this.manualOrder.map((id) => this.files[id]?.path));
    let added = 0;
    for (const file of await collectFiles(paths)) {
      if (known.has(file)) continue;
      const id = `manual-${randomUUID()}`;
      this.files[id] = await readFile(file);
      this.manualOrder.push(id);
      known.add(file);
      added++;
    }
    this.note(`Imported ${added} graphic(s)`);
    await this.saveFiles();
  }

  /** Drags a Manual Mode graphic to just before another (or to the end, with null). */
  private async moveManual(id: string, before: string | null): Promise<void> {
    if (!this.manualOrder.includes(id) || id === before) return;
    const order = this.manualOrder.filter((x) => x !== id);
    const at = before ? order.indexOf(before) : -1;
    order.splice(at < 0 ? order.length : at, 0, id);
    this.manualOrder = order;
    await this.saveFiles();
  }

  /** The shows with a green screen, for Manual Mode's Green screen menu. */
  private async findGreenScreens(): Promise<void> {
    const choices: { showId: string; name: string }[] = [];
    for (const p of this.profileList?.profiles ?? []) {
      if (p.files.greenScreen || (await this.deps.store.greenScreen(p.id))) choices.push({ showId: p.id, name: p.name });
    }
    this.greenScreenChoices = choices;
    this.changed();
  }

  /** Manual Mode uses a show's green screen: this laptop's copy, or downloaded from Google Drive. */
  private async useShowGreenScreen(showId: string): Promise<void> {
    let file = await this.deps.store.greenScreen(showId);
    if (file && !(await stat(file.path).catch(() => null))) file = null;
    const online = this.profileList?.profiles.find((p) => p.id === showId)?.files.greenScreen;
    if (online && (!file || file.driveFileId !== online.driveFileId)) {
      try {
        this.profileStatus = { ...this.profileStatus, working: `Downloading ${online.fileName}…` };
        this.changed();
        file = { ...(await readFile(await this.profiles.download(showId, online))), driveFileId: online.driveFileId };
      } catch (e) {
        if (!file) this.profileStatus = { ...this.profileStatus, error: e instanceof Error ? e.message : String(e) };
      } finally {
        this.profileStatus = { ...this.profileStatus, working: null };
      }
    }
    if (!file) return this.changed();
    this.greenScreen = file;
    await this.setGreenScreen(null, true);
  }

  /** Gets the profiles from the website again, and brings this laptop's copy of the picked one up to date. */
  private async refreshProfiles(): Promise<void> {
    try {
      this.profileList = await this.profiles.list();
      if (this.manualSession) await this.findGreenScreens();
    } catch (e) {
      // Offline: the laptop's copy of the profile still works.
      this.profileStatus = { ...this.profileStatus, error: e instanceof Error ? e.message : String(e) };
      return this.changed();
    }
    this.changed();
    await this.syncProfile();
  }

  /** This laptop's file for a profile slot ("greenScreen", "music" or "permanent:<name>"). */
  private slotFile(slot: string): FileInfo | null {
    if (slot === 'greenScreen') return this.greenScreen;
    if (slot === 'music') return this.musicTrack;
    if (slot.startsWith('transition:')) return this.transitions[slot.slice('transition:'.length)] ?? null;
    return this.permanent[slot.slice('permanent:'.length).toLowerCase()] ?? null;
  }

  private async setSlotFile(slot: string, file: FileInfo | null): Promise<void> {
    if (slot === 'greenScreen') {
      this.greenScreen = file;
      return this.setGreenScreen(null, true);
    }
    if (slot === 'music') {
      this.musicTrack = file;
      return this.setMusicTrack(null, true);
    }
    if (slot.startsWith('transition:')) {
      const which = slot.slice('transition:'.length);
      if (file) this.transitions[which] = file;
      else delete this.transitions[which];
      await this.saveFiles();
      return this.useTransitions();
    }
    const key = slot.slice('permanent:'.length).toLowerCase();
    if (file) this.permanent[key] = file;
    else delete this.permanent[key];
    await this.saveFiles();
  }

  /**
   * Brings this laptop's copy of the picked profile and the one in Google Drive together, slot by slot:
   * a file added or changed here goes up; one added or changed on another laptop comes down; one removed
   * elsewhere goes here too. After the Drive moves to another account, laptops send it the files they have.
   */
  private async syncProfile(): Promise<void> {
    if (this.manualSession) return;
    // Without a RiGster key the shows are listed, but their files stay where they are until one is pasted.
    if (!this.settings.key) {
      if (this.profileList?.profiles.some((p) => p.id === this.settings.profileShowId)) {
        this.profileStatus = { ...this.profileStatus, error: 'Paste a RiGster key to get this show’s files from Google Drive.' };
        this.changed();
      }
      return;
    }
    if (this.syncingProfile) {
      this.syncProfileAgain = true;
      return;
    }
    this.syncingProfile = true;
    try {
      do {
        this.syncProfileAgain = false;
        await this.syncProfileOnce();
      } while (this.syncProfileAgain);
    } finally {
      this.syncingProfile = false;
      this.profileStatus = { ...this.profileStatus, working: null };
      this.changed();
    }
  }

  private async syncProfileOnce(): Promise<void> {
    const showId = this.settings.profileShowId;
    const profile: Profile | undefined = this.profileList?.profiles.find((p) => p.id === showId);
    if (!profile || !this.profileList) return;
    const online = this.profileList.drive.connected;
    const working = (text: string) => {
      this.profileStatus = { ...this.profileStatus, working: text };
      this.changed();
    };
    const percent = (done: number, total: number) => (total ? ` ${Math.floor((done / total) * 100)}%` : '');
    const slots = ['greenScreen', 'music', 'transition:tease', 'transition:lites', ...profile.settings.permanentGraphics.map((g) => `permanent:${g}`)];
    let problem: string | null = null;
    let changedHere = false;
    // Files to send up that this laptop can't read now: they go as soon as their drive is plugged in.
    const waiting: string[] = [];
    for (const slot of slots) {
      if (this.settings.profileShowId !== showId) return;
      const here = this.slotFile(slot);
      const there = profile.files[slot];
      const label = slot === 'greenScreen' ? 'the green screen' : slot === 'music' ? 'the music' : slot.slice('permanent:'.length);
      try {
        // Added or changed on this laptop, or the Drive moved to another account: send it up.
        const sendUp = here && (!here.driveFileId || (there && !there.current && there.driveFileId === here.driveFileId) || (!there && !here.driveFileId));
        if (sendUp && here) {
          if (!online) {
            problem = 'No Google Drive is connected yet, so the profile’s changes stay on this laptop. An admin connects one on the website’s Usage page.';
            continue;
          }
          if ((await readable(here.path)) !== 'yes') {
            waiting.push(here.path);
            continue;
          }
          working(`Uploading ${label}…`);
          const sent = await this.profiles.upload(showId, slot, here.path, (done, total) => working(`Uploading ${label}…${percent(done, total)}`));
          profile.files[slot] = sent;
          if (this.settings.profileShowId === showId && this.slotFile(slot) === here) await this.setSlotFile(slot, { ...here, driveFileId: sent.driveFileId });
          continue;
        }
        if (there?.current && here?.driveFileId === there.driveFileId && (await readable(here.path)) === 'yes') continue;
        if (there?.current) {
          // Added or changed on another laptop: download it.
          working(`Downloading ${label}…`);
          const file = await this.profiles.download(showId, there, (done, total) => working(`Downloading ${label}…${percent(done, total)}`));
          const info = { ...(await readFile(file)), driveFileId: there.driveFileId };
          if (this.settings.profileShowId === showId) await this.setSlotFile(slot, info);
          changedHere = true;
          continue;
        }
        // Removed on another laptop.
        if (!there && here?.driveFileId) {
          await this.setSlotFile(slot, null);
          changedHere = true;
        }
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
    }
    this.profileStatus = { working: null, error: problem, waiting };
    if (changedHere) {
      this.note(`Show profile updated from Google Drive`);
      this.rebuild();
      void this.makePlayables();
      if (this.musicTrack && this.switcher.snapshot.status === 'connected') await this.loadSound().catch(() => undefined);
    }
  }

  /** Takes a file out of the picked profile in Google Drive too. */
  private async removeFromProfile(slot: string): Promise<void> {
    const showId = this.settings.profileShowId;
    if (!showId) return;
    try {
      await this.profiles.remove(showId, slot);
      const profile = this.profileList?.profiles.find((p) => p.id === showId);
      if (profile) delete profile.files[slot];
    } catch (e) {
      this.profileStatus = { ...this.profileStatus, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---- What the window shows ----

  private views(): ElementView[] {
    return this.plan?.sections.flatMap((s) => s.elements.map((e) => this.toView(e, s.label))) ?? [];
  }

  private view(id: string | null): ElementView | undefined {
    return id ? this.views().find((e) => e.id === id) : undefined;
  }

  private toView(e: ShowPlan['sections'][number]['elements'][number], sectionLabel: string): ElementView {
    const file = this.fileFor(e);
    return {
      id: e.id,
      sectionId: e.sectionId,
      // A commercial break's cue sits at the end of the section before it, but reads as the break.
      sectionLabel: isBreakCue(e.id) ? 'Break' : sectionLabel,
      // Manual Mode's graphics go by their file names.
      label: e.sectionId === MANUAL_SECTION ? e.name : cueLabel(e),
      type: e.type,
      behavior: e.behavior,
      file: file ? path.basename(file.path) : null,
      seconds: file?.seconds ?? null,
      thumbnail: file?.thumbnail ?? null,
      playable: file?.playable ? pathToFileURL(file.playable).href : null,
      fileFound: !file || !this.unreachable.has(file.path),
      converting: this.converting === e.id,
      fixes: file?.fixes ?? null,
      ddrItem: e.ddrItem,
      skipped: this.engine?.state.skipped.includes(e.id) ?? false,
    };
  }

  state(): AppState {
    const plan = this.plan;
    const engine = this.engine;
    const show = this.website.show;
    const profileShow = this.profileShow();
    const sections: SectionView[] = plan?.sections.map((s) => ({ id: s.id, label: s.label, slug: s.slug, camera: s.camera, elements: s.elements.map((e) => this.toView(e, s.label)) })) ?? [];
    const chosen = this.settings.music[show?.id ?? ''] ?? { in: 'default', out: 'default' };
    const defaults = plan ? defaultMusicPoints(plan.sections) : { in: null, out: null };
    const points = plan
      ? [
          ...plan.sections.map((s) => ({ id: `section:${s.id}`, label: `${s.label} starts` })),
          ...plan.sections.flatMap((s) => s.elements.map((e) => ({ id: `cue:${e.id}`, label: `${cueLabel(e)} (${s.label})` }))),
        ]
      : [];
    const p = this.website.prompter;
    const broadcast = this.website.broadcast();
    return {
      website: { status: this.website.status, error: this.website.error, siteUrl: this.settings.siteUrl, key: this.settings.key },
      live: { on: broadcast.live, startedAt: broadcast.live ? broadcast.startedAt : null },
      permanent:
        profileShow?.settings.permanentGraphics.map((name) => {
          const file = this.permanent[name.toLowerCase()];
          return { name, withSound: profileShow.settings.permanentWithSound.includes(name), file: file ? path.basename(file.path) : null, seconds: file?.seconds ?? null, thumbnail: file?.thumbnail ?? null };
        }) ?? [],
      profiles: (this.profileList?.profiles ?? []).map((p) => ({ id: p.id, name: p.name, logo: p.logo ?? null })),
      profile: profileShow ? { id: profileShow.id, name: profileShow.name } : null,
      profilePicked: this.profilePicked,
      manualSession: this.manualSession,
      greenScreenChoices: this.greenScreenChoices,
      profileMismatch: this.profileMismatch,
      profileSync: {
        working: this.profileStatus.working,
        error: this.profileStatus.error,
        waiting: this.profileStatus.waiting.length,
        waitingOn: this.placesOf(this.profileStatus.waiting),
        drive: this.profileList ? this.profileList.drive.email : null,
        checked: this.profileList !== null,
      },
      transitions: (['tease', 'lites'] as const).map((which) => {
        const file = this.transitions[which];
        return { which, file: file ? path.basename(file.path) : null, seconds: file?.seconds ?? null, thumbnail: file?.thumbnail ?? null, playable: file?.playable ? pathToFileURL(file.playable).href : null };
      }),
      greenScreen: this.greenScreen
        ? {
            file: path.basename(this.greenScreen.path),
            seconds: this.greenScreen.seconds,
            thumbnail: this.greenScreen.thumbnail,
            playable: this.greenScreen.playable ? pathToFileURL(this.greenScreen.playable).href : null,
          }
        : null,
      musicTrack: this.musicTrack
        ? {
            file: path.basename(this.musicTrack.path),
            seconds: this.musicTrack.seconds,
            inSoundPlayer: this.switcher.snapshot.soundTracks.some((t) => clipKey(t) === clipKey(this.musicTrack!.path)),
            playable: this.musicTrack.playable ? pathToFileURL(this.musicTrack.playable).href : null,
          }
        : null,
      episode: this.website.episode ? { id: this.website.episode.id, title: this.website.episode.title, showName: show?.name ?? '', airDate: this.website.episode.airDate, airTime: this.website.episode.airTime } : null,
      // The episode's show, or the profile's when no episode is followed.
      // Manual Mode: TSTV's three cameras.
      cameras: (show ?? profileShow ?? (this.manualSession ? { settings: DEFAULT_SHOW_SETTINGS } : null))
        ? (show ?? profileShow ?? { settings: DEFAULT_SHOW_SETTINGS }).settings.cameras.map((name) => {
            const input = (show ?? profileShow ?? { settings: DEFAULT_SHOW_SETTINGS }).settings.cameraInputs[name] ?? 1;
            return { name, input, video: this.switcher.mode === 'live' ? (this.feeds?.url(String(input)) ?? null) : this.switcher.cameraVideo(input) };
          })
        : [],
      switcher: { ...this.switcher.snapshot },
      mode: this.switcher.mode,
      alwaysLive: this.deps.alwaysLive ?? false,
      programVideo: this.switcher.mode === 'live' ? (this.feeds?.url('program') ?? null) : null,
      recording: this.feeds ? { ...this.feeds.recording, error: this.feeds.recording.error ?? this.feeds.error } : null,
      liveError: this.liveError,
      liveWaiting: this.liveWaiting,
      update: this.update ? { ...this.update, platform: process.platform === 'win32' ? 'windows' : 'mac' } : null,
      playout: this.playout ? { connections: this.playout.state.connections, error: this.playout.state.error } : null,
      prompter: { connected: p !== null, label: p?.label ?? '', speed: p?.speed ?? 0 },
      automation: {
        manual: engine?.state.manual ?? false,
        camerasByHand: engine?.state.camerasByHand ?? false,
        sectionId: engine?.state.sectionId ?? null,
        sectionLabel: plan?.sections.find((s) => s.id === engine?.state.sectionId)?.label ?? null,
        onAir: this.view(engine?.state.onAir ?? null) ?? null,
        // Every graphic still to come, so the Playlist scrolls through the whole show (RG, Nov 2, 2026).
        upNext: engine ? engine.upNext().map((e) => this.toView(e, plan?.sections.find((s) => s.id === e.sectionId)?.label ?? '')) : [],
        nextChoice: engine?.state.nextChoice ?? null,
        played: engine?.state.played ?? [],
        previous: this.view(engine?.previous()?.id ?? null) ?? null,
      },
      sections,
      problems: this.problems,
      unreachable: { count: this.views().filter((e) => !e.fileFound).length, places: this.unreachablePlaces(), blocked: [...this.unreachable.values()].includes('blocked') },
      music: {
        in: chosen.in,
        out: chosen.out,
        defaults: { in: 'Whenever a Tease fires', out: chosen.in === 'default' || chosen.in === 'teases' ? 'Whenever a Tease ends' : plan ? cuePointLabel(plan, defaults.out) : '' },
        points,
      },
      clock: this.clock,
      lastCue: this.lastCue,
      log: this.log,
    };
  }

  private changed(): void {
    this.emit('state', this.state());
    this.sendUpNext();
  }

  /** The TC1's Preview box shows what the Up next box shows: the next graphic over its section's camera. */
  private sendUpNext(): void {
    const next = this.engine?.upNext()[0];
    const file = next && next.behavior !== 'music' ? this.fileFor(next) : undefined;
    const camera = this.plan?.sections.find((s) => s.id === next?.sectionId)?.input ?? this.switcher.snapshot.programInput;
    this.switcher.showUpNext(file ? { path: file.path, fallback: file.playable } : null, camera);
  }

  // ---- The producer's actions ----

  async connect(siteUrl: string, key: string): Promise<void> {
    this.settings = { ...this.settings, siteUrl: siteUrl.trim() || DEFAULT_SETTINGS.siteUrl, key: key.trim() };
    await this.deps.store.saveSettings(this.settings);
    this.engine = null;
    this.plan = null;
    this.problems = [];
    this.clock = { startedAt: null, sectionLabel: null, overUnderSeconds: null };
    await this.website.connect(this.settings.siteUrl, this.settings.key);
    const show = this.website.show;
    if (show && !this.settings.profileShowId) {
      // No profile picked yet on this laptop: the key's show's.
      this.settings = { ...this.settings, profileShowId: show.id };
      await this.deps.store.saveSettings(this.settings);
      await this.loadProfile();
    }
    this.profileMismatch = Boolean(show && show.id !== this.settings.profileShowId);
    void this.refreshProfiles();
    if (this.profileMismatch) {
      // The key's episode belongs to another show: RiGster doesn't follow it, so it can't run with the
      // wrong show's graphics (RG, Nov 2, 2026).
      this.website.close();
      this.website.episode = null;
      this.website.show = null;
      this.engine = null;
      this.plan = null;
      this.note('This show profile doesn’t match the RiGster key');
      return this.changed();
    }
    if (this.website.episode) this.files = await this.deps.store.episodeFiles(this.website.episode.id);
    const broadcast = this.website.broadcast();
    if (broadcast.live) this.clock = { startedAt: broadcast.startedAt, sectionLabel: null, overUnderSeconds: null };
    this.reportStatus();
    if (this.switcher.snapshot.status === 'connected') await this.loadSound().catch(() => undefined);
    this.rebuild();
    void this.refreshThumbnails();
    void this.makePlayables();
  }

  /**
   * Remakes thumbnails from before graphics kept their see-through parts, in the background, so the preview
   * can lay each graphic over its camera, and makes the ones that are missing (JPEG stills had none until
   * Oct 30, 2026). Files no longer on this laptop keep their old thumbnail, or get one from their playable copy.
   */
  private async refreshThumbnails(): Promise<void> {
    const episodeId = this.website.episode?.id;
    let changed = false;
    const greenScreen: Record<string, FileInfo> = this.greenScreen ? { greenScreen: this.greenScreen } : {};
    for (const store of [this.files, this.permanent, greenScreen]) {
      for (const [key, info] of Object.entries(store)) {
        if ((info.thumbnailVersion ?? 1) >= THUMBNAIL_VERSION && info.thumbnail) continue;
        const fresh = await readFile(info.path);
        if (this.website.episode?.id !== episodeId) return;
        fresh.thumbnail ??= info.playable ? await thumbnail(info.playable, info.seconds) : null;
        if (fresh.thumbnail) {
          store[key] = { ...info, thumbnail: fresh.thumbnail, thumbnailVersion: THUMBNAIL_VERSION };
          changed = true;
        }
      }
    }
    if (greenScreen.greenScreen) this.greenScreen = greenScreen.greenScreen;
    if (changed) await this.saveFiles();
  }

  async connectSwitcher(address: string, statePort?: number): Promise<void> {
    // In live mode the simulator's address doesn't apply.
    if (this.switcher.mode === 'live') return;
    this.switcher.close();
    this.switcher = this.newSwitcher(address.trim() || DEFAULT_SETTINGS.simulatorAddress, statePort);
    this.settings = { ...this.settings, simulatorAddress: this.switcher.snapshot.address };
    await this.deps.store.saveSettings(this.settings);
    await this.switcher.connect();
    // A fresh simulator gets the show's music track in its Sound player.
    if (this.switcher.snapshot.status === 'connected') await this.loadSound().catch(() => undefined);
    this.changed();
  }

  /**
   * Live mode (Phase 5): the app runs TSTV's real TC1. The three locks (docs/ARCHITECTURE.md, 6.3): the app
   * always starts on the simulator and never remembers live mode; the producer turns it on, with a
   * confirmation on the screen; and the driver talks only to a TriCaster TC1. The laptop has to be on the
   * TC1's cable, where NDI is kept; the playout then sends the graphics and music to input 4.
   */
  private async setLiveMode(on: boolean, simulatorStatePort?: number): Promise<void> {
    // RiGster always runs the TC1 (RG, Nov 2, 2026): there's no going back to the simulator.
    if (this.deps.alwaysLive && !on) return;
    if (!on && this.liveWaiting !== null) {
      // Cancelled while still looking for the TC1.
      this.liveSearch++;
      this.liveWaiting = null;
      this.note('Stopped looking for the TC1');
      return this.changed();
    }
    if (on === (this.switcher.mode === 'live') || (on && this.liveWaiting !== null)) return;
    this.liveError = null;
    if (!on) {
      this.switcher.close();
      this.feeds?.stopRecording();
      await Promise.all([this.playout?.close(), this.feeds?.close()]);
      this.playout = null;
      this.feeds = null;
      this.switcher = this.newSwitcher(this.settings.simulatorAddress, simulatorStatePort ?? (Number(process.env.TSTV_SIM_STATE_PORT) || undefined));
      await this.switcher.connect();
      this.engine?.playlistReloaded();
      this.note('Back on the simulator');
      if (this.switcher.snapshot.status === 'connected') await this.loadSound().catch(() => undefined);
      this.rebuild();
      return;
    }
    void this.lookForTc1();
  }

  /** The TC1's connection dropped: RiGster stops sending, says so, and connects again as soon as it can. */
  private async lostTc1(): Promise<void> {
    if (!this.playout) return;
    const [lost, playout, feeds] = [this.switcher, this.playout, this.feeds];
    this.switcher = this.newSwitcher(this.settings.tc1Address, 5951, 'live');
    this.playout = null;
    this.feeds = null;
    this.liveCable = null;
    lost.close();
    feeds?.stopRecording();
    await Promise.all([playout.close(), feeds?.close()]);
    this.note('Lost the connection to the TC1: connecting again');
    this.reportStatus();
    this.rebuild();
    void this.lookForTc1();
  }

  /**
   * Turning on live mode: waits for the cable, then for the TC1 and its session, saying which it's waiting
   * for, and connects as soon as everything's there (RG, Nov 1, 2026: turn on the TC1, plug in the cable,
   * and RiGster takes it from there). Only a switcher that isn't a TC1 stops it.
   */
  private async lookForTc1(): Promise<void> {
    const search = ++this.liveSearch;
    const started = Date.now();
    const searching = () => search === this.liveSearch;
    const waitFor = (message: string) => {
      if (this.liveWaiting !== message) {
        this.liveWaiting = message;
        this.changed();
      }
    };
    waitFor('Looking for the TC1…');
    let ndiReady = false;
    while (searching()) {
      const cable = (this.deps.cable ?? cableAddresses)();
      if (!cable.length) {
        waitFor(
          Date.now() - started < 90_000
            ? `${PLUG_IN}. The laptop takes up to a minute to see it after it’s plugged in.`
            : 'Still no cable. Check the cable is plugged into the laptop’s adapter and into the TC1.',
        );
      } else {
        // NDI reads which connections it may use once, as it starts, so it's only set up once there's a cable.
        if (!ndiReady) keepNdiOnCable(this.deps.store.ndiFolder(), cable);
        ndiReady = true;
        let found: { address: string; localAddress: string } | null = null;
        try {
          found = await this.findTc1(cable);
        } catch (e) {
          waitFor(`Looking for the TC1… (${e instanceof Error ? e.message : String(e)})`);
        }
        if (!searching()) return;
        if (found && (await this.goLive(found))) return;
        if (!searching()) return;
        if (!found) {
          const tc1 = this.settings.tc1Address;
          waitFor(
            tc1 && (await answersPing(tc1, cable))
              ? 'The TC1 is on, but its session isn’t open yet. Open the show’s session on the TC1 (or turn on its Auto-Launch Session), and RiGster connects as soon as it’s open.'
              : 'The cable’s in, but the TC1 isn’t answering. Check it’s turned on; RiGster connects as soon as it is.',
          );
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** Connects live mode to the TC1 that was found. False (and keeps looking) if it couldn't connect yet. */
  private async goLive({ address, localAddress }: { address: string; localAddress: string }): Promise<boolean> {
    const playout = new Playout();
    playout.on('level', (db: number) => this.emit('level', db));
    playout.fader(this.fader);
    playout.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    const live = this.newSwitcher(address, 5951, 'live', playout, localAddress);
    await live.connect();
    if (live.snapshot.status !== 'connected' || !this.liveWaiting) {
      live.close();
      await playout.close();
      // Not a TC1 (the identity lock): that's not something waiting fixes, unless RiGster always runs the
      // TC1, when it says so and keeps looking.
      if (live.snapshot.status === 'refused' && this.deps.alwaysLive) {
        this.liveWaiting = live.snapshot.error;
        this.changed();
        return false;
      }
      if (live.snapshot.status === 'refused') {
        this.liveSearch++;
        this.liveWaiting = null;
        this.liveError = live.snapshot.error;
        this.changed();
        return true;
      }
      return false;
    }
    this.liveWaiting = null;
    this.switcher.close();
    this.switcher = live;
    this.playout = playout;
    // The show profile may have finished loading while this connected, with the cable already in when
    // RiGster opened (RG, Nov 4, 2026): the playout and switcher get its green screen and transitions now.
    playout.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    live.transitions = this.transitions;
    this.liveCable = localAddress;
    this.feeds = new Feeds();
    this.feeds.on('change', () => this.changed());
    this.settings = { ...this.settings, tc1Address: address };
    await this.deps.store.saveSettings(this.settings);
    this.engine?.playlistReloaded();
    await this.loadSound().catch(() => undefined);
    this.note(`Live mode: running the TC1 at ${address}`);
    this.reportStatus();
    this.rebuild();
    return true;
  }

  /**
   * Record (live mode): saves the TC1's program feed, picture and sound, on the laptop (RG, Oct 30, 2026),
   * under the name and in the folder the producer picks. Show_Episode_Date.mp4 is suggested, in the
   * folder used last time.
   */
  private async record(on: boolean): Promise<void> {
    if (!this.feeds) return;
    if (!on) {
      this.feeds.stopRecording();
      this.note('Recording stopped');
      return this.changed();
    }
    const episode = this.website.episode;
    const words = (text: string) => text.replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/ /g, '-') || 'Show';
    const date = episode?.airDate || new Date().toISOString().slice(0, 10);
    const name = this.manualSession ? `Recording_${date}` : `${words(this.website.show?.name ?? 'Show')}_${words(episode?.title ?? 'Episode')}_${date}`;
    // The suggestion is never an earlier recording's name.
    const folder = this.settings.recordFolder || this.deps.recordingsFolder || '';
    let suggested = path.join(folder, `${name}.mp4`);
    for (let n = 2; await stat(suggested).then(() => true, () => false); n++) suggested = path.join(folder, `${name}_${n}.mp4`);
    const picked = await this.deps.pickRecording?.(suggested);
    if (!picked) return;
    // It's always an MP4, whatever the name typed ends with.
    const file = path.extname(picked).toLowerCase() === '.mp4' ? picked : `${picked}.mp4`;
    this.settings = { ...this.settings, recordFolder: path.dirname(file) };
    await this.deps.store.saveSettings(this.settings);
    this.feeds.record(file);
    this.note(`Recording to ${file}`);
    this.changed();
  }

  /**
   * The TC1 on the cable, and which of the laptop's cable addresses reaches it: at its last address, or
   * found by the NDI feeds it announces there. Asked from each cable address, never across Wi-Fi.
   */
  private async findTc1(cable: string[]): Promise<{ address: string; localAddress: string } | null> {
    const reach = async (host: string) => {
      for (const localAddress of cable) {
        try {
          if ((await askSwitcher(host, '/v1/version', 1500, localAddress)).text.includes('<product_name>')) return { address: host, localAddress };
        } catch {
          // Not from this one.
        }
      }
      return null;
    };
    if (this.settings.tc1Address) {
      const remembered = await reach(this.settings.tc1Address);
      if (remembered) return remembered;
    }
    const ndi = loadNdi();
    const finder = ndi.findCreate({ show_local_sources: false, p_groups: null, p_extra_ips: null });
    try {
      for (let i = 0; i < 20; i++) {
        const tc1 = listSources(ndi, finder).find((s) => /^TC1-/i.test(s.p_ndi_name));
        if (tc1) return await reach(tc1.p_url_address.split(':')[0]);
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    } finally {
      ndi.findDestroy(finder);
    }
  }

  /** A new version of RiGster is out, downloading or ready (or null). */
  setUpdate(update: UpdateState): void {
    this.update = update;
    this.changed();
  }

  async act(action: Action): Promise<void> {
    const engine = this.engine;
    switch (action.kind) {
      case 'connect':
        // A key pasted in Manual Mode follows its episode, with the profile picked last.
        if (this.manualSession) await this.leaveManual(this.settings.profileShowId, false);
        return this.connect(action.siteUrl, action.key);
      case 'disconnect':
        this.profileMismatch = false;
        this.website.close();
        this.engine = null;
        this.plan = null;
        this.settings = { ...this.settings, key: '' };
        await this.deps.store.saveSettings(this.settings);
        return this.changed();
      case 'connectSwitcher':
        return this.connectSwitcher(action.address);
      case 'setLiveMode':
        return this.setLiveMode(action.on);
      case 'record':
        return this.record(action.on);
      case 'getUpdate':
        return this.deps.applyUpdate?.();
      case 'setFader':
        this.fader = Math.max(0, Math.min(2, action.level));
        this.playout?.fader(this.fader);
        return;
      case 'fireNext': {
        if (!engine) return;
        const next = engine.upNext()[0];
        const label = next ? this.view(next.id) : undefined;
        return this.run(engine.fireNext(), label ? `${label.label} (${label.sectionLabel}) fired by hand` : 'Nothing left to fire');
      }
      case 'fireNow': {
        const up = engine?.state.manual ? this.view(action.elementId) : undefined;
        // A graphic with no clip in DDR 2 has nothing to play yet.
        if (!engine || !up || up.ddrItem === null) return;
        engine.chooseNext(action.elementId);
        return this.run(engine.fireNext(), `${up.label} (${up.sectionLabel}) fired by double click`);
      }
      case 'pauseGraphic': {
        // Manual mode only, and only a clip: a still has nowhere to pause.
        const up = engine?.state.manual ? this.view(engine.state.onAir) : undefined;
        if (!up?.seconds) return;
        const paused = !this.switcher.snapshot.ddrPaused;
        await this.switcher.pauseClip(paused);
        this.note(`${up.label} ${paused ? 'paused' : 'playing again'}`);
        return this.changed();
      }
      case 'fireBack': {
        if (!engine) return;
        // The first graphic has nothing to go back to: it goes back to its beginning, and keeps playing, or
        // stays paused until Space (RG, Nov 4, 2026).
        const first = !engine.previous() && engine.state.manual ? this.view(engine.state.onAir) : undefined;
        if (first?.seconds) {
          const paused = this.switcher.snapshot.ddrPaused;
          await this.run(engine.restartOnAir(), `${first.label} back to its beginning`);
          if (paused) await this.switcher.pauseClip(true);
          return this.changed();
        }
        const back = this.view(engine.previous()?.id ?? null);
        return this.run(engine.fireBack(), back ? `Back to ${back.label} (${back.sectionLabel}) by hand` : 'Nothing to go back to');
      }
      case 'takeOff':
        if (!engine) return;
        return this.run(engine.takeOff(), 'Graphic taken off by hand');
      case 'skip':
        engine?.skip(action.elementId, action.skipped);
        return this.changed();
      case 'chooseNext':
        engine?.chooseNext(action.elementId);
        return this.changed();
      case 'takeCamera':
        if (!engine) return this.switcher.run([{ kind: 'camera', input: action.input }]);
        return this.run(engine.takeCamera(action.input), `Camera ${action.input} taken by hand`);
      case 'setCamerasByHand':
        engine?.setCamerasByHand(action.byHand, this.switcher.snapshot.programInput);
        this.note(action.byHand ? 'Cameras by hand: the producer switches them' : 'Cameras follow the prompter again from the next section');
        return this.changed();
      case 'setManual':
        // Manual Mode has no automation to go back to.
        if (this.manualSession) return;
        // Back to automation, a graphic the producer paused carries on.
        if (!action.manual && this.switcher.snapshot.ddrPaused) await this.switcher.pauseClip(false);
        engine?.setManual(action.manual, { dskOn: this.switcher.snapshot.dskOn, camera: this.switcher.snapshot.programInput, layoutOn: this.switcher.snapshot.layoutOn });
        this.note(action.manual ? 'Manual mode: the producer fires the graphics' : 'Automation continued from the prompter’s place');
        this.reportStatus();
        return this.changed();
      case 'importFiles':
        return this.addFiles(await this.deps.pickFiles());
      case 'addFiles':
        return this.addFiles(action.paths);
      case 'chooseFile': {
        const file = await this.deps.pickFile();
        if (file) await this.assign(file, action.elementId);
        return;
      }
      case 'assign':
        return this.assign(action.path, action.elementId);
      case 'clearFile': {
        // In Manual Mode, a graphic's file going means the graphic goes from the Playlist.
        if (this.manualSession) this.manualOrder = this.manualOrder.filter((id) => id !== action.elementId);
        const element = this.element(action.elementId);
        if (element?.type === 'PERM') delete this.permanent[element.name.trim().toLowerCase()];
        delete this.files[action.elementId];
        return this.saveFiles();
      }
      case 'dismissProblem':
        this.problems = this.problems.filter((p) => p.path !== action.path);
        return this.changed();
      case 'addPermanent':
        return this.addPermanent(action.paths);
      case 'choosePermanent': {
        const file = await this.deps.pickFile();
        if (file) await this.assign(file, `perm:${action.name}`);
        return;
      }
      case 'clearPermanent': {
        const name = this.permanentName(action.name) ?? action.name;
        if (this.permanent[name.toLowerCase()]?.driveFileId) await this.removeFromProfile(`permanent:${name}`);
        delete this.permanent[name.toLowerCase()];
        return this.saveFiles();
      }
      case 'setProfile':
        return this.setProfile(action.showId);
      case 'openManual':
        return this.openManual();
      case 'moveManual':
        return this.moveManual(action.elementId, action.before);
      case 'clearManual':
        this.files = {};
        this.manualOrder = [];
        this.problems = [];
        this.note('Manual Mode’s graphics cleared');
        return this.saveFiles();
      case 'useShowGreenScreen':
        return this.useShowGreenScreen(action.showId);
      case 'setGreenScreen':
        return this.setGreenScreen(action.path);
      case 'chooseGreenScreen': {
        const file = await this.deps.pickFile();
        if (file) await this.setGreenScreen(file);
        return;
      }
      case 'clearGreenScreen':
        return this.setGreenScreen(null);
      case 'setTransition':
        return this.setTransition(action.which, action.path);
      case 'chooseTransition': {
        const file = await this.deps.pickFile();
        if (file) await this.setTransition(action.which, file);
        return;
      }
      case 'clearTransition':
        return this.setTransition(action.which, null);
      case 'setMusicTrack':
        return this.setMusicTrack(action.path);
      case 'chooseMusicTrack': {
        const file = await this.deps.pickFile();
        if (file) await this.setMusicTrack(file);
        return;
      }
      case 'clearMusicTrack':
        return this.setMusicTrack(null);
      case 'setMusic': {
        const showId = this.website.show?.id;
        if (!showId) return;
        this.settings = { ...this.settings, music: { ...this.settings.music, [showId]: { in: action.in, out: action.out } } };
        await this.deps.store.saveSettings(this.settings);
        return this.rebuild();
      }
    }
  }

  /** The file of the show's break graphic (like Commercial Break), if it has one. */
  private breakFile(): FileInfo | undefined {
    const name = this.website.show ? breakGraphic(this.website.show.settings) : undefined;
    return name ? this.permanent[name.toLowerCase()] : undefined;
  }

  /**
   * The show's clips in the order TSTV's TD loads DDR 2: the break clip at the start of every block (the
   * show's break graphic, when it has a file), then each element's file in rundown order.
   */
  private simulatorClips(): PlaylistClip[] | null {
    const clip = (file: FileInfo) => ({ name: path.basename(file.path).replace(/\.[^.]+$/, ''), durationMs: Math.round((file.seconds ?? 20) * 1000), path: file.path, fallback: file.playable });
    // Manual Mode: just its graphics, in the Playlist's order.
    if (this.manualSession) return this.manualOrder.flatMap((id) => (this.files[id] ? [clip(this.files[id])] : []));
    if (!this.timing) return null;
    const clips: PlaylistClip[] = [];
    const breakFile = this.breakFile();
    for (const c of this.timing.rows) {
      if (c.row.kind === 'block') {
        clips.push(breakFile ? clip(breakFile) : BREAK_CLIP);
        continue;
      }
      if (c.row.floated) continue;
      for (const e of c.row.elements) {
        const file = e.type === 'MUSIC' ? undefined : this.fileFor(e);
        // Graphics are about 20-second clips on TSTV's playlist.
        if (file) clips.push(clip(file));
      }
    }
    return clips;
  }

  /**
   * On the simulator, DDR 2 keeps itself loaded with the show's clips (RG, Oct 29, 2026), so every graphic
   * with a file plays without anyone pressing Load. It waits while DDR 2 plays or DSK 2 is on, so nothing
   * on air is cut off, and tries again on the switcher's next change. (On the real TC1, Send to TriCaster
   * does this in Phase 5, when the producer chooses.)
   */
  private async syncSimulator(): Promise<void> {
    const clips = this.simulatorClips();
    const { status, playlist, ddrPlaying, dskOn } = this.switcher.snapshot;
    // On the simulator, DDR 2 isn't reloaded while it's on air. In live mode the playout is the app's own,
    // so the TC1's DSK 2 doesn't hold it up (at the studio it was on from before, Oct 30, 2026).
    const busy = this.switcher.mode === 'live' ? ddrPlaying : ddrPlaying || dskOn;
    if (!clips || status !== 'connected' || busy || this.syncingSimulator) return;
    if (clips.length === playlist.length && clips.every((c, i) => clipKey(c.name) === clipKey(playlist[i]))) return;
    this.syncingSimulator = true;
    try {
      await this.switcher.loadPlaylist(clips);
      this.engine?.playlistReloaded();
      this.note(this.switcher.mode === 'live' ? `The playout now has the show’s ${clips.length} clips` : `The simulator’s DDR 2 now has the show’s ${clips.length} clips`);
    } catch {
      // The simulator went away; its next change tries again.
    } finally {
      this.syncingSimulator = false;
    }
    this.changed();
  }

  /** Resolves once a recording under way is finished and safely in its file. */
  async close(): Promise<void> {
    this.closed = true;
    // The copy or conversion under way finishes first (a few seconds at most), so nothing is half-written.
    const end = Date.now() + 5000;
    while ((this.makingPlayable || this.fixing) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    this.liveSearch++;
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.cableTimer) clearInterval(this.cableTimer);
    if (this.profileTimer) clearInterval(this.profileTimer);
    this.website.close();
    this.switcher.close();
    void this.playout?.close();
    await this.feeds?.close();
  }
}

/**
 * Whether host answers a ping from one of the cable's addresses: the TC1 answers even before its session
 * is open, when its remote control doesn't yet. Uses the computer's own ping (Mac and Windows).
 */
export async function answersPing(host: string, cable: string[]): Promise<boolean> {
  for (const from of cable) {
    const args = process.platform === 'win32' ? ['-n', '1', '-w', '1500', '-S', from, host] : ['-c', '1', '-t', '2', '-S', from, host];
    const output = await promisify(execFile)('ping', args, { timeout: 4000 }).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? '',
    );
    // A reply has a TTL; Windows also prints "Destination host unreachable" with a successful exit.
    if (/ttl=/i.test(output)) return true;
  }
  return false;
}
