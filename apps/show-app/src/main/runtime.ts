// The show app's core: it follows the episode on the website, runs the cue engine on the prompter's cues,
// sends the engine's commands to the switcher, and keeps track of each element's file. It knows nothing
// about Electron (the window and file pickers come in from main.ts), so it can be tested on its own.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildShowPlan,
  clipKey,
  computeRundown,
  CueEngine,
  cueLabel,
  cuePointLabel,
  defaultMusicPoints,
  matchMedia,
  readRows,
  type Broadcast,
  type CuePoint,
  type MediaProblem,
  type RundownTiming,
  type ShowPlan,
  type SwitcherCommand,
} from '@tstv/shared';
import type { Action, AppState, ElementView, FileProblem, SectionView } from '../shared/api.ts';
import { collectFiles, makePlayable, readFile, THUMBNAIL_VERSION, type FileInfo } from './media.ts';
import { DEFAULT_SETTINGS, type Settings, type Store } from './store.ts';
import { Switcher } from './switcher.ts';
import { WebsiteLink, type CueEvent } from './website.ts';

/** The clip TSTV holds during each commercial break, at the start of every block in DDR 2 (probe, Oct 28, 2026). */
export const BREAK_CLIP = { name: 'TSTV Ident 2022 News', durationMs: 4_963 };

export interface RuntimeDeps {
  store: Store;
  /** Asks the producer for graphics files or a folder. */
  pickFiles: () => Promise<string[]>;
  /** Asks the producer for one file. */
  pickFile: () => Promise<string | null>;
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
  /** The Program box's playable copy of each file, by the file's path (null: FFmpeg couldn't make one). */
  private playable: Record<string, string | null> = {};
  private makingPlayable = false;
  private playableAgain = false;
  private syncingSimulator = false;

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
        this.engine = new CueEngine(this.plan);
        this.engine.setManual(manual);
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
    this.changed();
  }

  private newSwitcher(address: string, statePort?: number): Switcher {
    const switcher = new Switcher(address, statePort);
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
    switcher.on('clipEnded', () => {
      if (!this.engine) return;
      const ended = this.view(this.engine.state.onAir);
      void this.run(this.engine.clipEnded(), ended ? `${ended.label} ended` : 'Clip ended');
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
    this.website.setAppStatus({ mode: 'simulator', switcherConnected: this.switcher.snapshot.status === 'connected', paused: this.engine?.state.manual ?? false });
  }

  // ---- The show ----

  private fileFor(element: { id: string; type: string; name: string }): FileInfo | undefined {
    return this.files[element.id] ?? (element.type === 'PERM' ? this.permanent[element.name.trim().toLowerCase()] : undefined);
  }

  private musicPoints(): { in: CuePoint | null; out: CuePoint | null; track: string | null } {
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
    return { in: resolve(chosen.in, defaults.in), out: resolve(chosen.out, defaults.out), track: this.musicTrack?.path ?? null };
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
    const { playlist, soundTracks } = this.switcher.snapshot;
    // First without the producer's music choices (they need the sections), then with them.
    this.plan = buildShowPlan(this.timing, show.settings, files, playlist, soundTracks);
    this.plan = buildShowPlan(this.timing, show.settings, files, playlist, soundTracks, this.musicPoints());
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
      label = `${section.label} started`;
      commands = this.engine.sectionStarted(section.id);
      const now = Date.now();
      this.clock.startedAt ??= this.website.broadcast().startedAt ?? now;
      const planned = this.timing?.rows.find((c) => c.row.id === section.id)?.startOffset ?? null;
      this.clock = { startedAt: this.clock.startedAt, sectionLabel: section.label, overUnderSeconds: planned === null ? null : Math.round((now - this.clock.startedAt) / 1000 - planned) };
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
    const episode = this.website.episode;
    const show = this.website.show;
    if (episode) await this.deps.store.saveEpisodeFiles(episode.id, this.files);
    if (show) await this.deps.store.savePermanentFiles(show.id, this.permanent);
    this.rebuild();
    this.sendMedia();
    void this.makePlayables();
  }

  /**
   * Makes the copies the Program box plays (see makePlayable), one file at a time in the background, so
   * the producer can carry on. Each one shows up as soon as it's ready.
   */
  private async makePlayables(): Promise<void> {
    if (this.makingPlayable) {
      this.playableAgain = true;
      return;
    }
    this.makingPlayable = true;
    try {
      do {
        this.playableAgain = false;
        for (const info of [...Object.values(this.files), ...Object.values(this.permanent)]) {
          if (info.path in this.playable) continue;
          this.playable[info.path] = await makePlayable(info.path, this.deps.store.playableFolder()).catch(() => null);
          this.changed();
        }
      } while (this.playableAgain);
    } finally {
      this.makingPlayable = false;
    }
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
    const files = await collectFiles(paths);
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
    this.note(`Imported ${matches.length - asked.filter((a) => matches.some((m) => m.file === a.path)).length} of ${files.length} file(s)`);
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
    // On the simulator, a still goes in GFX 1 and a clip in DDR 1 (on the real TC1, Phase 5 sends it).
    if (this.greenScreen && this.switcher.snapshot.status === 'connected') {
      const name = path.basename(this.greenScreen.path).replace(/\.[^.]+$/, '');
      const seconds = this.greenScreen.seconds;
      await this.switcher.loadSimulatorPlaylist([{ name, durationMs: seconds ? Math.round(seconds * 1000) : 0 }], seconds ? 'ddr1' : 'gfx1');
    }
    this.note(this.greenScreen ? `Green screen: ${path.basename(this.greenScreen.path)}` : 'Green screen removed');
    this.changed();
  }

  /**
   * The show's music track, dropped on the Music box (RG, Oct 29, 2026), so the right track plays. On the
   * simulator it's put in the Sound player; on the real TC1 it has to be in the Sound player already
   * (sending it there comes with Send to TriCaster in Phase 5).
   */
  private async setMusicTrack(file: string | null): Promise<void> {
    const show = this.website.show;
    if (!show) return;
    this.musicTrack = file ? await readFile(file) : null;
    await this.deps.store.saveMusicTrack(show.id, this.musicTrack);
    if (this.musicTrack && this.switcher.snapshot.status === 'connected') await this.loadSimulatorSound();
    this.note(this.musicTrack ? `Music: ${path.basename(this.musicTrack.path)}` : 'Music track removed');
    this.rebuild();
  }

  private async loadSimulatorSound(): Promise<void> {
    if (!this.musicTrack) return;
    const name = path.basename(this.musicTrack.path).replace(/\.[^.]+$/, '');
    await this.switcher.loadSimulatorPlaylist([{ name, durationMs: Math.round((this.musicTrack.seconds ?? 60) * 1000) }], 'sound');
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
      sectionLabel,
      label: cueLabel(e),
      type: e.type,
      behavior: e.behavior,
      file: file ? path.basename(file.path) : null,
      seconds: file?.seconds ?? null,
      thumbnail: file?.thumbnail ?? null,
      playable: file && this.playable[file.path] ? pathToFileURL(this.playable[file.path]!).href : null,
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
      greenScreen: this.greenScreen ? { file: path.basename(this.greenScreen.path), seconds: this.greenScreen.seconds, thumbnail: this.greenScreen.thumbnail } : null,
      musicTrack: this.musicTrack
        ? {
            file: path.basename(this.musicTrack.path),
            seconds: this.musicTrack.seconds,
            inSoundPlayer: this.switcher.snapshot.soundTracks.some((t) => clipKey(t) === clipKey(this.musicTrack!.path)),
          }
        : null,
      episode: this.website.episode ? { id: this.website.episode.id, title: this.website.episode.title, showName: show?.name ?? '', airDate: this.website.episode.airDate, airTime: this.website.episode.airTime } : null,
      cameras: show
        ? show.settings.cameras.map((name) => {
            const input = show.settings.cameraInputs[name] ?? 1;
            return { name, input, video: this.switcher.cameraVideo(input) };
          })
        : [],
      switcher: { ...this.switcher.snapshot },
      prompter: { connected: p !== null, label: p?.label ?? '', speed: p?.speed ?? 0, paused: p?.paused ?? false },
      automation: {
        manual: engine?.state.manual ?? false,
        sectionId: engine?.state.sectionId ?? null,
        sectionLabel: plan?.sections.find((s) => s.id === engine?.state.sectionId)?.label ?? null,
        onAir: this.view(engine?.state.onAir ?? null) ?? null,
        upNext: engine ? engine.upNext().slice(0, 8).map((e) => this.toView(e, plan?.sections.find((s) => s.id === e.sectionId)?.label ?? '')) : [],
        nextChoice: engine?.state.nextChoice ?? null,
        previous: this.view(engine?.previous()?.id ?? null) ?? null,
      },
      sections,
      problems: this.problems,
      music: {
        in: chosen.in,
        out: chosen.out,
        defaults: { in: plan ? cuePointLabel(plan, defaults.in) : '', out: plan ? cuePointLabel(plan, defaults.out) : '' },
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
    if (this.switcher.snapshot.status === 'connected') await this.loadSimulatorSound().catch(() => undefined);
    this.rebuild();
    void this.refreshThumbnails();
    void this.makePlayables();
  }

  /**
   * Remakes thumbnails from before graphics kept their see-through parts, in the background, so the preview
   * can lay each graphic over its camera. Files no longer on this laptop keep their old thumbnail.
   */
  private async refreshThumbnails(): Promise<void> {
    const episodeId = this.website.episode?.id;
    let changed = false;
    for (const store of [this.files, this.permanent]) {
      for (const [key, info] of Object.entries(store)) {
        if ((info.thumbnailVersion ?? 1) >= THUMBNAIL_VERSION) continue;
        const fresh = await readFile(info.path);
        if (this.website.episode?.id !== episodeId) return;
        if (fresh.thumbnail) {
          store[key] = fresh;
          changed = true;
        }
      }
    }
    if (changed) await this.saveFiles();
  }

  async connectSwitcher(address: string, statePort?: number): Promise<void> {
    this.switcher.close();
    this.switcher = this.newSwitcher(address.trim() || DEFAULT_SETTINGS.simulatorAddress, statePort);
    this.settings = { ...this.settings, simulatorAddress: this.switcher.snapshot.address };
    await this.deps.store.saveSettings(this.settings);
    await this.switcher.connect();
    // A fresh simulator gets the show's music track in its Sound player.
    if (this.switcher.snapshot.status === 'connected') await this.loadSimulatorSound().catch(() => undefined);
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

  /**
   * The show's clips in the order TSTV's TD loads DDR 2: the break clip at the start of every block, then
   * each element's file in rundown order.
   */
  private simulatorClips(): { name: string; durationMs: number }[] | null {
    if (!this.timing) return null;
    const clips: { name: string; durationMs: number }[] = [];
    for (const c of this.timing.rows) {
      if (c.row.kind === 'block') {
        clips.push(BREAK_CLIP);
        continue;
      }
      if (c.row.floated) continue;
      for (const e of c.row.elements) {
        const file = e.type === 'MUSIC' ? undefined : this.fileFor(e);
        // Graphics are about 20-second clips on TSTV's playlist.
        if (file) clips.push({ name: path.basename(file.path).replace(/\.[^.]+$/, ''), durationMs: Math.round((file.seconds ?? 20) * 1000) });
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
    if (!clips || status !== 'connected' || ddrPlaying || dskOn || this.syncingSimulator) return;
    if (clips.length === playlist.length && clips.every((c, i) => clipKey(c.name) === clipKey(playlist[i]))) return;
    this.syncingSimulator = true;
    try {
      await this.switcher.loadSimulatorPlaylist(clips);
      this.engine?.playlistReloaded();
      this.note(`The simulator’s DDR 2 now has the show’s ${clips.length} clips`);
    } catch {
      // The simulator went away; its next change tries again.
    } finally {
      this.syncingSimulator = false;
    }
    this.changed();
  }

  close(): void {
    this.website.close();
    this.switcher.close();
  }
}
