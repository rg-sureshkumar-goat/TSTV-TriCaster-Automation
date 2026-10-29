// The show app's core: it follows the episode on the website, runs the cue engine on the prompter's cues,
// sends the engine's commands to the switcher, and keeps track of each element's file. It knows nothing
// about Electron (the window and file pickers come in from main.ts), so it can be tested on its own.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  buildShowPlan,
  computeRundown,
  CueEngine,
  cueLabel,
  cuePointLabel,
  defaultMusicPoints,
  matchMedia,
  readRows,
  type CuePoint,
  type MediaProblem,
  type RundownTiming,
  type ShowPlan,
  type SwitcherCommand,
} from '@tstv/shared';
import type { Action, AppState, ElementView, FileProblem, SectionView } from '../shared/api.ts';
import { collectFiles, readFile, type FileInfo } from './media.ts';
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

  constructor(private deps: RuntimeDeps) {
    super();
    this.switcher = this.newSwitcher(DEFAULT_SETTINGS.simulatorAddress);
    this.website.on('change', () => this.changed());
    this.website.on('rundown', () => {
      this.rebuild();
      this.sendMedia();
    });
    this.website.on('cue', (event: CueEvent) => void this.onCue(event));
  }

  /** Starts up with what was remembered: the simulator, and the last episode's key. */
  async start(): Promise<void> {
    this.settings = await this.deps.store.settings();
    await this.connectSwitcher(this.settings.simulatorAddress);
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
    this.website.setAppStatus({ mode: 'simulator', switcherConnected: this.switcher.snapshot.status === 'connected', paused: this.engine?.state.paused ?? false });
  }

  // ---- The show ----

  private fileFor(element: { id: string; type: string; name: string }): FileInfo | undefined {
    return this.files[element.id] ?? (element.type === 'PERM' ? this.permanent[element.name.trim().toLowerCase()] : undefined);
  }

  private musicPoints(): { in: CuePoint | null; out: CuePoint | null } {
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
    return { in: resolve(chosen.in, defaults.in), out: resolve(chosen.out, defaults.out) };
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
  }

  private async onCue(event: CueEvent): Promise<void> {
    if (!this.engine || !this.plan) return;
    const latencyMs = Date.now() - event.at;
    let label: string;
    let commands: SwitcherCommand[];
    if (event.kind === 'section') {
      const section = this.plan.sections.find((s) => s.id === event.sectionId);
      if (!section) return;
      label = `${section.label} started`;
      commands = this.engine.sectionStarted(section.id);
      const now = Date.now();
      this.clock.startedAt ??= now;
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
    await this.run(commands, this.engine.state.paused ? `${label} (paused: not fired)` : label);
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
    const open = this.views().filter((e) => e.type !== 'MUSIC' && !e.file);
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

  private async assign(file: string, elementId: string): Promise<void> {
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
    return {
      website: { status: this.website.status, error: this.website.error, siteUrl: this.settings.siteUrl, key: this.settings.key },
      episode: this.website.episode ? { id: this.website.episode.id, title: this.website.episode.title, showName: show?.name ?? '', airDate: this.website.episode.airDate, airTime: this.website.episode.airTime } : null,
      cameras: show ? show.settings.cameras.map((name) => ({ name, input: show.settings.cameraInputs[name] ?? 1 })) : [],
      switcher: { ...this.switcher.snapshot },
      prompter: { connected: p !== null, label: p?.label ?? '', speed: p?.speed ?? 0, paused: p?.paused ?? false },
      automation: {
        paused: engine?.state.paused ?? false,
        sectionId: engine?.state.sectionId ?? null,
        sectionLabel: plan?.sections.find((s) => s.id === engine?.state.sectionId)?.label ?? null,
        onAir: this.view(engine?.state.onAir ?? null) ?? null,
        upNext: engine ? engine.upNext().slice(0, 8).map((e) => this.toView(e, plan?.sections.find((s) => s.id === e.sectionId)?.label ?? '')) : [],
        nextChoice: engine?.state.nextChoice ?? null,
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
    if (this.website.show) this.permanent = await this.deps.store.permanentFiles(this.website.show.id);
    this.reportStatus();
    this.rebuild();
  }

  async connectSwitcher(address: string, statePort?: number): Promise<void> {
    this.switcher.close();
    this.switcher = this.newSwitcher(address.trim() || DEFAULT_SETTINGS.simulatorAddress, statePort);
    this.settings = { ...this.settings, simulatorAddress: this.switcher.snapshot.address };
    await this.deps.store.saveSettings(this.settings);
    await this.switcher.connect();
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
      case 'skip':
        engine?.skip(action.elementId, action.skipped);
        return this.changed();
      case 'chooseNext':
        engine?.chooseNext(action.elementId);
        return this.changed();
      case 'takeCamera':
        if (!engine) return this.switcher.run([{ kind: 'camera', input: action.input }]);
        return this.run(engine.takeCamera(action.input), `Camera ${action.input} taken by hand`);
      case 'pause':
        engine?.setPaused(action.paused, { dskOn: this.switcher.snapshot.dskOn, camera: this.switcher.snapshot.programInput });
        this.switcher.paused = action.paused;
        this.note(action.paused ? 'Automation paused: the TD runs the switcher' : 'Automation resumed from the prompter’s place');
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
      case 'loadSimulator':
        return this.loadSimulator();
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
   * Fills the simulator's DDR 2 the way TSTV's TD does: the break clip at the start of every block, then
   * each element's file in rundown order. (On the real TC1, Send to TriCaster does this in Phase 5.)
   */
  private async loadSimulator(): Promise<void> {
    if (!this.timing) return;
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
    await this.switcher.loadSimulatorPlaylist(clips);
    this.note(`Loaded ${clips.length} clips into the simulator’s DDR 2`);
    this.changed();
  }

  close(): void {
    this.website.close();
    this.switcher.close();
  }
}
