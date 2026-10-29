// The cue engine (Phase 4): the brief's cue rules as plain logic. It hears what the prompter reports
// (a section starting, a cue crossing the reading line), what the switcher reports (a clip ending) and
// what the producer does (fire the next cue, skip one, take a camera, pause), and answers with the
// switcher commands to send. It has no network code, so every rule has automatic tests.
//
// Every element except music plays from DDR 2 through DSK 2, one at a time: a new cue replaces whatever
// is up. Music plays from the Sound player alongside it.
import { cueLabel, type ElementType, type RundownTiming, type SectionRow } from './rundown.ts';
import { cameraInput, type ShowSettings } from './show.ts';

/**
 * How an element behaves on air (RG, Oct 28–29, 2026):
 * - graphic: L3, OTS, FSG and lower-third permanent graphics stay up until their section ends.
 * - voiceover: VO, TEASE and LITES play while the anchor reads. They come off when the clip or the
 *   section ends, whichever is first, and the section's L3 comes back if the clip ended first.
 * - clip: SOT, PKG and permanent graphics with their own audio play to their end, then back to the anchors.
 * - music: plays from the Sound player.
 */
export type CueBehavior = 'graphic' | 'voiceover' | 'clip' | 'music';

export function cueBehavior(type: ElementType, name: string, permanentWithSound: string[]): CueBehavior {
  switch (type) {
    case 'VO':
    case 'TEASE':
    case 'LITES':
      return 'voiceover';
    case 'SOT':
    case 'PKG':
      return 'clip';
    case 'MUSIC':
      return 'music';
    case 'PERM':
      return permanentWithSound.some((g) => g.toLowerCase() === name.trim().toLowerCase()) ? 'clip' : 'graphic';
    default:
      return 'graphic';
  }
}

export interface ShowElement {
  id: string;
  sectionId: string;
  type: ElementType;
  name: string;
  behavior: CueBehavior;
  /** Its item in DDR 2's playlist, counting from 0; null while its file is missing. Music: null. */
  ddrItem: number | null;
}

export interface ShowSection {
  id: string;
  /** Like "A2". */
  label: string;
  slug: string;
  /** The story type, like "Tease". */
  type: string;
  /** The camera to take when it starts. */
  camera: string;
  input: number;
  elements: ShowElement[];
}

/** A point in the show: a section starting, or a cue crossing the reading line. */
export type CuePoint = { kind: 'section'; sectionId: string } | { kind: 'cue'; elementId: string };

export interface ShowPlan {
  /** The sections that air, in order. */
  sections: ShowSection[];
  /** When the music starts and stops (null: never by itself), and its Sound player track, counting from 0. */
  music: { in: CuePoint | null; out: CuePoint | null; track: number };
}

export type SwitcherCommand =
  | { kind: 'camera'; input: number }
  | { kind: 'cueClip'; item: number }
  | { kind: 'dsk'; on: boolean }
  | { kind: 'music'; play: boolean; track?: number };

/**
 * The default music points (RG, Oct 29, 2026): the music starts when the first Tease section in block A
 * starts, and stops just before the Show Intro. Each show can change both in the show app.
 */
export function defaultMusicPoints(sections: ShowSection[]): { in: CuePoint | null; out: CuePoint | null } {
  const tease = sections.find((s) => s.label.replace(/\d+$/, '') === 'A' && /tease/i.test(s.type));
  const intro = sections.flatMap((s) => s.elements).find((e) => e.type === 'PERM' && /show intro/i.test(e.name));
  return { in: tease ? { kind: 'section', sectionId: tease.id } : null, out: intro ? { kind: 'cue', elementId: intro.id } : null };
}

/** A file name without its folder and extension, lowercase, for finding it in a playlist. */
export function clipKey(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').trim().toLowerCase();
}

/**
 * The show as the engine runs it: the sections that air, in order, each element with how it behaves and
 * where its file sits in DDR 2's playlist. files maps element ids to their file names; ddrPlaylist and
 * soundTracks are the names in DDR 2 and the Sound player, as the switcher reports them.
 */
export function buildShowPlan(
  timing: RundownTiming,
  settings: ShowSettings,
  files: Record<string, string>,
  ddrPlaylist: string[],
  soundTracks: string[],
  music?: { in: CuePoint | null; out: CuePoint | null },
): ShowPlan {
  const playlist = ddrPlaylist.map(clipKey);
  const sections: ShowSection[] = timing.rows
    .filter((c) => c.row.kind === 'section' && !c.row.floated)
    .map((c) => {
      const row = c.row as SectionRow;
      const camera = row.camera || settings.defaultCamera;
      return {
        id: row.id,
        label: c.label,
        slug: row.slug,
        type: row.type,
        camera,
        input: cameraInput(settings, camera),
        elements: row.elements.map((e) => {
          const file = files[e.id];
          const index = file ? playlist.indexOf(clipKey(file)) : -1;
          return { id: e.id, sectionId: row.id, type: e.type, name: e.name, behavior: cueBehavior(e.type, e.name, settings.permanentWithSound), ddrItem: e.type === 'MUSIC' || index < 0 ? null : index };
        }),
      };
    });
  const musicElement = sections.flatMap((s) => s.elements).find((e) => e.type === 'MUSIC');
  const track = musicElement ? soundTracks.map(clipKey).indexOf(clipKey(musicElement.name)) : -1;
  const points = music ?? defaultMusicPoints(sections);
  return { sections, music: { in: points.in, out: points.out, track: track < 0 ? 0 : track } };
}

/** How a point reads in the show app: "A1 starts" or "★ Show Intro (A2)". */
export function cuePointLabel(plan: ShowPlan, point: CuePoint | null): string {
  if (!point) return 'Never by itself';
  if (point.kind === 'section') return `${plan.sections.find((s) => s.id === point.sectionId)?.label ?? 'A removed section'} starts`;
  for (const s of plan.sections) {
    const e = s.elements.find((x) => x.id === point.elementId);
    if (e) return `${cueLabel(e)} (${s.label})`;
  }
  return 'A removed cue';
}

export interface EngineState {
  sectionId: string | null;
  /** The element on DSK 2. */
  onAir: string | null;
  /** The DDR 2 item cued up. */
  cued: number | null;
  /** The section's L3, to bring back when a VO ends before the section does. */
  returnTo: string | null;
  musicPlaying: boolean;
  /** The camera input on air. */
  camera: number | null;
  skipped: string[];
  /** The element the producer picked to fire next. */
  nextChoice: string | null;
  /** The last element fired, by the prompter or the producer. */
  lastFired: string | null;
  paused: boolean;
}

export class CueEngine {
  plan: ShowPlan;
  state: EngineState = { sectionId: null, onAir: null, cued: null, returnTo: null, musicPlaying: false, camera: null, skipped: [], nextChoice: null, lastFired: null, paused: false };
  /** A clip to cue in DDR 2 once the one playing ends (cueing it now would cut that one off). */
  private waitingToCue: number | null = null;

  constructor(plan: ShowPlan) {
    this.plan = plan;
  }

  /** The rundown changed (or files were matched): keep going with the new plan. */
  setPlan(plan: ShowPlan): void {
    this.plan = plan;
  }

  private elements(): ShowElement[] {
    return this.plan.sections.flatMap((s) => s.elements);
  }

  private element(id: string | null): ShowElement | undefined {
    return id ? this.elements().find((e) => e.id === id) : undefined;
  }

  private section(id: string | null): ShowSection | undefined {
    return id ? this.plan.sections.find((s) => s.id === id) : undefined;
  }

  private isPoint(point: CuePoint | null, kind: CuePoint['kind'], id: string): boolean {
    return point !== null && point.kind === kind && (point.kind === 'section' ? point.sectionId : point.elementId) === id;
  }


  /** What fires next, in order: the producer's pick first, then the rest from the prompter's place on. */
  upNext(): ShowElement[] {
    const all = this.elements();
    const sectionStart = this.state.sectionId ? all.findIndex((e) => e.sectionId === this.state.sectionId) : 0;
    const afterLast = this.state.lastFired ? all.findIndex((e) => e.id === this.state.lastFired) + 1 : 0;
    const from = Math.max(afterLast, sectionStart < 0 ? 0 : sectionStart);
    const queue = all.slice(from).filter((e) => !this.state.skipped.includes(e.id) && e.id !== this.state.nextChoice);
    const choice = this.element(this.state.nextChoice);
    return choice ? [choice, ...queue] : queue;
  }

  private musicCommands(play: boolean): SwitcherCommand[] {
    if (play === this.state.musicPlaying) return [];
    this.state.musicPlaying = play;
    return [play ? { kind: 'music', play: true, track: this.plan.music.track } : { kind: 'music', play: false }];
  }

  /** The first clip of a section (or after a given element) that can be cued in DDR 2. */
  private firstClipFrom(sectionId: string, afterId: string | null = null): number | null {
    const elements = this.section(sectionId)?.elements ?? [];
    const start = afterId ? elements.findIndex((e) => e.id === afterId) + 1 : 0;
    const next = elements.slice(start).find((e) => e.behavior !== 'music' && e.ddrItem !== null && !this.state.skipped.includes(e.id));
    return next?.ddrItem ?? null;
  }

  private cueCommands(item: number | null): SwitcherCommand[] {
    if (item === null || item === this.state.cued) return [];
    const playing = this.element(this.state.onAir);
    if (playing && playing.behavior !== 'graphic') {
      // Cueing now would cut off the clip on air; wait for it to end.
      this.waitingToCue = item;
      return [];
    }
    this.state.cued = item;
    return [{ kind: 'cueClip', item }];
  }

  /** A section's start crossed the reading line. */
  sectionStarted(sectionId: string): SwitcherCommand[] {
    const section = this.section(sectionId);
    if (!section) return [];
    // Paused: the TD runs the switcher by hand. The engine just follows the prompter's place.
    if (this.state.paused) {
      this.state.sectionId = sectionId;
      return [];
    }
    const commands: SwitcherCommand[] = [];
    if (this.isPoint(this.plan.music.out, 'section', sectionId)) commands.push(...this.musicCommands(false));
    // The section that just ended takes its graphic or voiceover off. A SOT or package plays to its end.
    const onAir = this.element(this.state.onAir);
    if (onAir && onAir.behavior !== 'clip' && onAir.sectionId !== sectionId) {
      commands.push({ kind: 'dsk', on: false });
      this.state.onAir = null;
      // DSK 2 off also stops DDR 2 and moves it to its next item.
      this.state.cued = null;
    }
    this.state.returnTo = null;
    this.state.sectionId = sectionId;
    if (this.state.camera !== section.input) {
      commands.push({ kind: 'camera', input: section.input });
      this.state.camera = section.input;
    }
    commands.push(...this.cueCommands(this.firstClipFrom(sectionId)));
    if (this.isPoint(this.plan.music.in, 'section', sectionId)) commands.push(...this.musicCommands(true));
    return commands;
  }

  /** A cue chip crossed the reading line (or the producer fired it). */
  cueReached(elementId: string): SwitcherCommand[] {
    const element = this.element(elementId);
    if (!element || this.state.skipped.includes(elementId)) return [];
    if (this.state.nextChoice === elementId) this.state.nextChoice = null;
    this.state.lastFired = elementId;
    // Paused: the cue is passed without firing, and isn't fired later either.
    if (this.state.paused) return [];
    // Fired ahead of the prompter: the engine follows along.
    if (element.sectionId !== this.state.sectionId) this.state.sectionId = element.sectionId;
    const commands: SwitcherCommand[] = [];
    // The music stops just before its out cue fires (RG: right before the Show Intro begins).
    if (this.isPoint(this.plan.music.out, 'cue', elementId)) commands.push(...this.musicCommands(false));
    if (element.behavior === 'music') {
      commands.push(...this.musicCommands(true));
    } else if (element.ddrItem !== null) {
      const onAir = this.element(this.state.onAir);
      // A VO over the section's L3: bring the L3 back if the VO ends first.
      this.state.returnTo = onAir && onAir.behavior === 'graphic' && onAir.sectionId === element.sectionId && element.behavior === 'voiceover' ? onAir.id : null;
      if (onAir) commands.push({ kind: 'dsk', on: false });
      this.state.onAir = null;
      if (this.state.cued !== element.ddrItem || onAir) commands.push({ kind: 'cueClip', item: element.ddrItem });
      this.state.cued = element.ddrItem;
      this.waitingToCue = null;
      commands.push({ kind: 'dsk', on: true });
      this.state.onAir = element.id;
    }
    if (this.isPoint(this.plan.music.in, 'cue', elementId)) commands.push(...this.musicCommands(true));
    return commands;
  }

  /** The clip on DDR 2 played to its end. */
  clipEnded(): SwitcherCommand[] {
    const ended = this.element(this.state.onAir);
    if (this.state.paused || !ended || ended.behavior === 'graphic') return [];
    const commands: SwitcherCommand[] = [{ kind: 'dsk', on: false }];
    this.state.onAir = null;
    this.state.cued = null;
    const returning = this.element(this.state.returnTo);
    this.state.returnTo = null;
    if (ended.behavior === 'voiceover' && returning && returning.sectionId === this.state.sectionId && returning.ddrItem !== null) {
      // The VO ended before the section did: the section's L3 comes back.
      commands.push({ kind: 'cueClip', item: returning.ddrItem }, { kind: 'dsk', on: true });
      this.state.cued = returning.ddrItem;
      this.state.onAir = returning.id;
    } else {
      const waiting = this.waitingToCue ?? (this.state.sectionId ? this.firstClipFrom(this.state.sectionId, ended.sectionId === this.state.sectionId ? ended.id : null) : null);
      this.waitingToCue = null;
      commands.push(...this.cueCommands(waiting));
    }
    return commands;
  }

  /** The producer fires the next cue by hand (the spacebar). */
  fireNext(): SwitcherCommand[] {
    const next = this.upNext()[0];
    return next ? this.cueReached(next.id) : [];
  }

  skip(elementId: string, skipped = true): void {
    const rest = this.state.skipped.filter((id) => id !== elementId);
    this.state.skipped = skipped ? [...rest, elementId] : rest;
    if (skipped && this.state.nextChoice === elementId) this.state.nextChoice = null;
  }

  /** The producer picks which element fires next (null goes back to rundown order). */
  chooseNext(elementId: string | null): void {
    this.state.nextChoice = elementId;
  }

  /** The producer takes a camera by hand. */
  takeCamera(input: number): SwitcherCommand[] {
    if (this.state.paused) return [];
    this.state.camera = input;
    return [{ kind: 'camera', input }];
  }

  /**
   * Pause Automation: nothing goes to the switcher, and the TD runs it by hand. Resume picks up from the
   * prompter's place without firing the cues passed while paused; dskOn says whether DSK 2 is on now.
   */
  setPaused(paused: boolean, now?: { dskOn: boolean; camera: number | null }): void {
    this.state.paused = paused;
    if (!paused && now) {
      if (!now.dskOn) this.state.onAir = null;
      this.state.camera = now.camera;
      this.state.cued = null;
      this.state.returnTo = null;
    }
  }
}
