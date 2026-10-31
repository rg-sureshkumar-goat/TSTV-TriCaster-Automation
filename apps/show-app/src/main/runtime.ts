// The show app's core: it follows the episode on the website, runs the cue engine on the prompter's cues,
// sends the engine's commands to the switcher, and keeps track of each element's file. It knows nothing
// about Electron (the window and file pickers come in from main.ts), so it can be tested on its own.
import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  defaultMusicPoints,
  matchMedia,
  readRows,
  topCues,
  type Broadcast,
  type CuePoint,
  type MediaProblem,
  type RundownTiming,
  type ShowPlan,
  type SwitcherCommand,
} from '@tstv/shared';
import type { Action, AppState, ElementView, FileProblem, SectionView } from '../shared/api.ts';
import { collectFiles, makePlayable, readable, readFile, thumbnail, THUMBNAIL_VERSION, type FileInfo } from './media.ts';
import { cableAddresses, keepNdiOnCable, listSources, loadNdi } from './ndi.ts';
import { Feeds } from './feeds.ts';
import { Playout } from './playout.ts';
import { DEFAULT_SETTINGS, type Settings, type Store } from './store.ts';
import { askSwitcher, Switcher, type PlaylistClip, type SwitcherMode } from './switcher.ts';
import type { UpdateState } from './updates.ts';
import { WebsiteLink, type CueEvent } from './website.ts';

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
  /** Files FFmpeg couldn't make a playable copy of, so they aren't tried again and again. */
  private unplayable = new Set<string>();
  private makingPlayable = false;
  private playableAgain = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private syncingSimulator = false;
  /** Live mode's playout (Phase 5), which sends the graphics and music to the TC1's input 4 over NDI. */
  private playout: Playout | null = null;
  /** Live mode's view of the TC1's camera and program feeds, and the recording. */
  private feeds: Feeds | null = null;
  private liveError: string | null = null;
  /** A new version of RiGster, from main.ts's update checks. */
  private update: UpdateState = null;
  /** The Sound fader, from 0 to 2, which the playout applies in live mode. */
  private fader = 1;

  constructor(private deps: RuntimeDeps) {
    super();
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

  /** Starts up with what was remembered: the simulator, and the last episode's key. */
  async start(): Promise<void> {
    this.settings = await this.deps.store.settings();
    // Tests can run a second simulator, with its state stream on another port (TSTV_SIM_STATE_PORT).
    await this.connectSwitcher(this.settings.simulatorAddress, Number(process.env.TSTV_SIM_STATE_PORT) || undefined);
    if (this.settings.key) await this.connect(this.settings.siteUrl, this.settings.key);
    // A drive plugged in later is noticed by itself: its files get their playable copies.
    this.retryTimer = setInterval(() => this.unreachable.size > 0 && void this.makePlayables(), 10_000);
    this.changed();
  }

  private newSwitcher(address: string, statePort?: number, mode: SwitcherMode = 'simulator', playout: Playout | null = null, localAddress?: string): Switcher {
    const switcher = new Switcher(address, statePort, mode, playout, localAddress);
    let playlist = '';
    switcher.on('change', () => {
      const now = `${switcher.snapshot.playlist.join('\n')}|${switcher.snapshot.soundTracks.join('\n')}`;
      if (now !== playlist) {
        playlist = now;
        this.rebuild();
      }
      this.reportStatus();
      this.changed();
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
    const episode = this.website.episode;
    const show = this.website.show;
    if (episode) await this.deps.store.saveEpisodeFiles(episode.id, this.files);
    if (show) await this.deps.store.savePermanentFiles(show.id, this.permanent);
    if (show && this.musicTrack) await this.deps.store.saveMusicTrack(show.id, this.musicTrack);
    if (show && this.greenScreen) await this.deps.store.saveGreenScreen(show.id, this.greenScreen);
  }

  /**
   * Makes the copies the Program box plays (see makePlayable), one file at a time in the background, so
   * the producer can carry on. Each one shows up as soon as it's ready, and is remembered with its file,
   * so it plays even after the drive the file came from is unplugged. A file whose drive isn't plugged in
   * waits for it (see start).
   */
  private async makePlayables(): Promise<void> {
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
        for (const info of [...Object.values(this.files), ...Object.values(this.permanent), ...(this.musicTrack ? [this.musicTrack] : []), ...(this.greenScreen ? [this.greenScreen] : [])]) {
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

  /** Where the files that aren't on this laptop are: the drives' names (like “RG'S DRIVE”), or their folders. */
  private unreachablePlaces(): string[] {
    const places = [...this.unreachable.keys()].map((file) => {
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
    if (!this.plan) return;
    const all = await collectFiles(paths);
    // Files already on a cue (imported again from the same drive, say) are read again and keep their cues.
    const onCues = new Map<string, () => Promise<void>>();
    for (const [id, info] of Object.entries(this.files)) onCues.set(info.path, async () => void (this.files[id] = await readFile(info.path)));
    for (const [name, info] of Object.entries(this.permanent)) onCues.set(info.path, async () => void (this.permanent[name] = await readFile(info.path)));
    for (const file of all.filter((f) => onCues.has(f))) {
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
    const choices = (ids?: string[]) => (ids ? this.views().filter((e) => ids.includes(e.id)) : open).map((e) => ({ id: e.id, label: `${e.sectionLabel} · ${e.label}` }));
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
    return this.website.show?.settings.permanentGraphics.find((g) => g.toLowerCase() === name.trim().toLowerCase());
  }

  /**
   * Files dropped on the permanent graphics box: each goes to the permanent graphic its name contains
   * ("PrimeTime Show Intro.mov" → Show Intro). The rest are asked about.
   */
  private async addPermanent(paths: string[]): Promise<void> {
    const show = this.website.show;
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
  }

  private async setGreenScreen(file: string | null): Promise<void> {
    const show = this.website.show;
    if (!show) return;
    this.greenScreen = file ? await readFile(file) : null;
    await this.deps.store.saveGreenScreen(show.id, this.greenScreen);
    // On the simulator, a still goes in GFX 1 and a clip in DDR 1. In live mode the playout sends it to the
    // TC1 as the "TSTV Show App Background" source (RG, Oct 30, 2026).
    this.playout?.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    void this.makePlayables();
    if (this.greenScreen && this.switcher.snapshot.status === 'connected' && this.switcher.mode === 'simulator') {
      const name = path.basename(this.greenScreen.path).replace(/\.[^.]+$/, '');
      const seconds = this.greenScreen.seconds;
      await this.switcher.loadPlaylist([{ name, durationMs: seconds ? Math.round(seconds * 1000) : 0 }], seconds ? 'ddr1' : 'gfx1');
    }
    this.note(this.greenScreen ? `Green screen: ${path.basename(this.greenScreen.path)}` : 'Green screen removed');
    this.changed();
  }

  /**
   * The show's music track, dropped on the Music box (RG, Oct 29, 2026), so the right track plays. On the
   * simulator it's put in the Sound player; in live mode the playout plays it from the laptop (Oct 30, 2026).
   */
  private async setMusicTrack(file: string | null): Promise<void> {
    const show = this.website.show;
    if (!show) return;
    this.musicTrack = file ? await readFile(file) : null;
    await this.deps.store.saveMusicTrack(show.id, this.musicTrack);
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
      return this.saveFiles();
    }
    const element = this.element(elementId);
    if (!element) return;
    const info = await readFile(file);
    // A permanent graphic's file is remembered for the whole show, so every episode has it.
    if (element.type === 'PERM') this.permanent[element.name.trim().toLowerCase()] = info;
    else this.files[elementId] = info;
    this.problems = this.problems.filter((p) => p.path !== file);
    await this.saveFiles();
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
      label: cueLabel(e),
      type: e.type,
      behavior: e.behavior,
      file: file ? path.basename(file.path) : null,
      seconds: file?.seconds ?? null,
      thumbnail: file?.thumbnail ?? null,
      playable: file?.playable ? pathToFileURL(file.playable).href : null,
      fileFound: !file || !this.unreachable.has(file.path),
      ddrItem: e.ddrItem,
      skipped: this.engine?.state.skipped.includes(e.id) ?? false,
    };
  }

  state(): AppState {
    const plan = this.plan;
    const engine = this.engine;
    const show = this.website.show;
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
        show?.settings.permanentGraphics.map((name) => {
          const file = this.permanent[name.toLowerCase()];
          return { name, withSound: show.settings.permanentWithSound.includes(name), file: file ? path.basename(file.path) : null, seconds: file?.seconds ?? null, thumbnail: file?.thumbnail ?? null };
        }) ?? [],
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
      cameras: show
        ? show.settings.cameras.map((name) => {
            const input = show.settings.cameraInputs[name] ?? 1;
            return { name, input, video: this.switcher.mode === 'live' ? (this.feeds?.url(String(input)) ?? null) : this.switcher.cameraVideo(input) };
          })
        : [],
      switcher: { ...this.switcher.snapshot },
      mode: this.switcher.mode,
      programVideo: this.switcher.mode === 'live' ? (this.feeds?.url('program') ?? null) : null,
      recording: this.feeds ? { ...this.feeds.recording, error: this.feeds.recording.error ?? this.feeds.error } : null,
      liveError: this.liveError,
      update: this.update ? { ...this.update, platform: process.platform === 'win32' ? 'windows' : 'mac' } : null,
      playout: this.playout ? { connections: this.playout.state.connections, error: this.playout.state.error } : null,
      prompter: { connected: p !== null, label: p?.label ?? '', speed: p?.speed ?? 0, paused: p?.paused ?? false },
      automation: {
        manual: engine?.state.manual ?? false,
        camerasByHand: engine?.state.camerasByHand ?? false,
        sectionId: engine?.state.sectionId ?? null,
        sectionLabel: plan?.sections.find((s) => s.id === engine?.state.sectionId)?.label ?? null,
        onAir: this.view(engine?.state.onAir ?? null) ?? null,
        upNext: engine ? engine.upNext().slice(0, 8).map((e) => this.toView(e, plan?.sections.find((s) => s.id === e.sectionId)?.label ?? '')) : [],
        nextChoice: engine?.state.nextChoice ?? null,
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
    if (this.website.episode) this.files = await this.deps.store.episodeFiles(this.website.episode.id);
    if (this.website.show) {
      this.permanent = await this.deps.store.permanentFiles(this.website.show.id);
      this.greenScreen = await this.deps.store.greenScreen(this.website.show.id);
      this.musicTrack = await this.deps.store.musicTrack(this.website.show.id);
    }
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
    if (on === (this.switcher.mode === 'live')) return;
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
    const cable = cableAddresses();
    if (!cable.length) {
      this.liveError = 'The laptop isn’t on the TC1’s cable. Plug it in, wait a minute, and try again.';
      return this.changed();
    }
    keepNdiOnCable(this.deps.store.ndiFolder(), cable);
    let found: { address: string; localAddress: string } | null;
    try {
      found = await this.findTc1(cable);
    } catch (e) {
      this.liveError = e instanceof Error ? e.message : String(e);
      return this.changed();
    }
    if (!found) {
      this.liveError = 'Couldn’t find the TC1 on the cable. Check it’s on, wait a minute after plugging in, and try again.';
      return this.changed();
    }
    const { address, localAddress } = found;
    const playout = new Playout('TSTV Show App');
    playout.on('level', (db: number) => this.emit('level', db));
    playout.fader(this.fader);
    playout.background(this.greenScreen?.path ?? null, this.greenScreen?.playable);
    const live = this.newSwitcher(address, 5951, 'live', playout, localAddress);
    await live.connect();
    if (live.snapshot.status !== 'connected') {
      this.liveError = live.snapshot.error;
      live.close();
      await playout.close();
      return this.changed();
    }
    this.switcher.close();
    this.switcher = live;
    this.playout = playout;
    this.feeds = new Feeds();
    this.feeds.on('change', () => this.changed());
    this.settings = { ...this.settings, tc1Address: address };
    await this.deps.store.saveSettings(this.settings);
    this.engine?.playlistReloaded();
    await this.loadSound().catch(() => undefined);
    this.note(`Live mode: running the TC1 at ${address}`);
    this.reportStatus();
    this.rebuild();
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
    const name = `${words(this.website.show?.name ?? 'Show')}_${words(episode?.title ?? 'Episode')}_${date}`;
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
        return this.connect(action.siteUrl, action.key);
      case 'disconnect':
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
      case 'fireBack': {
        if (!engine) return;
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
        engine?.setManual(action.manual, { dskOn: this.switcher.snapshot.dskOn, camera: this.switcher.snapshot.programInput });
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
      case 'clearPermanent':
        delete this.permanent[action.name.toLowerCase()];
        return this.saveFiles();
      case 'setGreenScreen':
        return this.setGreenScreen(action.path);
      case 'chooseGreenScreen': {
        const file = await this.deps.pickFile();
        if (file) await this.setGreenScreen(file);
        return;
      }
      case 'clearGreenScreen':
        return this.setGreenScreen(null);
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
    if (!this.timing) return null;
    const clips: PlaylistClip[] = [];
    const clip = (file: FileInfo) => ({ name: path.basename(file.path).replace(/\.[^.]+$/, ''), durationMs: Math.round((file.seconds ?? 20) * 1000), path: file.path, fallback: file.playable });
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

  close(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.website.close();
    this.switcher.close();
    void this.playout?.close();
    this.feeds?.stopRecording();
    void this.feeds?.close();
  }
}
