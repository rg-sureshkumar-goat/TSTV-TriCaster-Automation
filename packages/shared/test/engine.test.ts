import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, breakCueId, computeRundown, insertBlock, insertSection, readRows } from '../src/rundown.ts';
import { DEFAULT_SHOW_SETTINGS, normalizeShowSettings } from '../src/show.ts';
import { buildShowPlan, cueBehavior, CueEngine, defaultMusicPoints, type ShowPlan, type ShowSection } from '../src/engine.ts';

const alex = { id: 'u1', name: 'Alex Producer' };

/**
 * A small show: A1 tease with music, A2 Show Intro, A3 reader with an L3 and a VO, A4 SOT, the commercial
 * break, then B1 on camera 3 with an FSG.
 */
function show(): { plan: ShowPlan; ids: Record<string, string> } {
  const doc = new Y.Doc();
  insertBlock(doc, alex);
  const a1 = insertSection(doc, alex, { slug: 'Tease', type: 'Tease' });
  const a2 = insertSection(doc, alex, { slug: 'Open', type: 'Permanent Graphic' });
  const a3 = insertSection(doc, alex, { slug: 'Basketball', type: 'Reader' });
  const a4 = insertSection(doc, alex, { slug: 'Coach', type: 'SOT' });
  insertSection(doc, alex, { slug: 'Floated', floated: true });
  const blockB = insertBlock(doc, alex);
  const b1 = insertSection(doc, alex, { slug: 'Weather', camera: 'Camera 3' });
  const ids = {
    breakB: breakCueId(blockB),
    a1,
    a2,
    a3,
    a4,
    b1,
    tease: addElement(doc, a1, 'TEASE', alex)!,
    music: addElement(doc, a1, 'MUSIC', alex, 'PrimeTime Main')!,
    intro: addElement(doc, a2, 'PERM', alex, 'Show Intro')!,
    l3: addElement(doc, a3, 'L3', alex, 'Score')!,
    vo: addElement(doc, a3, 'VO', alex, 'Highlights')!,
    sot: addElement(doc, a4, 'SOT', alex)!,
    fsg: addElement(doc, b1, 'FSG', alex)!,
  };
  const files = { [ids.breakB]: 'TSTV Ident 2022 News.m4v', [ids.tease]: 'A1_TEASE_Sports.mov', [ids.intro]: 'Show Intro.mov', [ids.l3]: 'A3_L3_Score.mov', [ids.vo]: 'A3_VO_Highlights.mp4', [ids.sot]: 'A4_SOT_Coach.mov', [ids.fsg]: 'B1_FSG_Weather.mov' };
  const playlist = ['TSTV Ident 2022 News', 'A1_TEASE_Sports', 'Show Intro', 'A3_L3_Score', 'A3_VO_Highlights', 'A4_SOT_Coach', 'TSTV Ident 2022 News', 'B1_FSG_Weather'];
  const timing = computeRundown(readRows(doc), 1800);
  return { plan: buildShowPlan(timing, DEFAULT_SHOW_SETTINGS, files, playlist, ['PrimeTime Transition Music', 'PrimeTime Main']), ids };
}

describe('cue behavior', () => {
  it('follows the brief’s rules for every element type', () => {
    const settings = normalizeShowSettings(undefined);
    expect(cueBehavior('L3', '', settings.permanentWithSound)).toBe('graphic');
    expect(cueBehavior('OTSR', '', settings.permanentWithSound)).toBe('graphic');
    expect(cueBehavior('FSG', '', settings.permanentWithSound)).toBe('graphic');
    expect(cueBehavior('VO', '', settings.permanentWithSound)).toBe('voiceover');
    expect(cueBehavior('TEASE', '', settings.permanentWithSound)).toBe('voiceover');
    expect(cueBehavior('LITES', '', settings.permanentWithSound)).toBe('voiceover');
    expect(cueBehavior('SOT', '', settings.permanentWithSound)).toBe('clip');
    expect(cueBehavior('PKG', '', settings.permanentWithSound)).toBe('clip');
    expect(cueBehavior('MUSIC', '', settings.permanentWithSound)).toBe('music');
    expect(cueBehavior('PERM', 'Show Intro', settings.permanentWithSound)).toBe('clip');
    expect(cueBehavior('PERM', 'Social Media L3', settings.permanentWithSound)).toBe('graphic');
  });
});

describe('the show plan', () => {
  it('lists the sections that air, finds each file in DDR 2, and sets the default music points', () => {
    const { plan, ids } = show();
    expect(plan.sections.map((s) => s.label)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1']);
    expect(plan.sections[4]).toMatchObject({ camera: 'Camera 3', input: 3 });
    const vo = plan.sections[2].elements.find((e) => e.id === ids.vo)!;
    expect(vo).toMatchObject({ behavior: 'voiceover', ddrItem: 4 });
    // By default the teases start the music, and it stops when they end (RG, Oct 30, 2026).
    expect(plan.music).toEqual({ in: null, out: null, track: 1, withTeases: true });
    // The points the producer can pick instead: A1 starting, and just before the Show Intro.
    expect(defaultMusicPoints(plan.sections)).toEqual({ in: { kind: 'section', sectionId: ids.a1 }, out: { kind: 'cue', elementId: ids.intro } });
    expect(defaultMusicPoints([] as ShowSection[])).toEqual({ in: null, out: null });
  });

  it('plays the track the producer chose, found in the Sound player by its file name', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { type: 'Tease' });
    addElement(doc, id, 'MUSIC', alex, 'PrimeTime Main');
    const timing = computeRundown(readRows(doc), 1800);
    const tracks = ['PrimeTime Main', 'PrimeTime Transition Music', 'News Open 2026'];
    const chosen = buildShowPlan(timing, DEFAULT_SHOW_SETTINGS, {}, [], tracks, { in: null, out: null, track: '/Volumes/USB/News Open 2026.wav' });
    expect(chosen.music.track).toBe(2);
    // Without a choice, the MUSIC element's name picks the track.
    expect(buildShowPlan(timing, DEFAULT_SHOW_SETTINGS, {}, [], tracks).music.track).toBe(0);
  });
});

describe('the cue engine', () => {
  it('fires the cues at the top of a section as it starts, so back-to-back teases don’t cut to the camera', () => {
    const doc = new Y.Doc();
    insertBlock(doc, alex);
    const t1 = insertSection(doc, alex, { type: 'Tease' });
    const t2 = insertSection(doc, alex, { type: 'Tease' });
    const tease1 = addElement(doc, t1, 'TEASE', alex)!;
    const tease2 = addElement(doc, t2, 'TEASE', alex)!;
    const timing = computeRundown(readRows(doc), 1800);
    const plan = buildShowPlan(timing, DEFAULT_SHOW_SETTINGS, { [tease1]: 'A1_TEASE_One.mov', [tease2]: 'A2_TEASE_Two.mov' }, ['TSTV Ident 2022 News', 'A1_TEASE_One', 'A2_TEASE_Two'], [], { in: null, out: null });
    const engine = new CueEngine(plan);
    expect(engine.sectionStarted(t1, [tease1])).toEqual([
      { kind: 'camera', input: 1 },
      { kind: 'cueClip', item: 1 },
      { kind: 'dsk', on: true },
    ]);
    // The next tease replaces this one straight away, as its section starts: DSK 2 stays on, so the
    // camera doesn't flash between them.
    expect(engine.sectionStarted(t2, [tease2])).toEqual([
      { kind: 'cueClip', item: 2 },
      { kind: 'play' },
    ]);
    // When the prompter reaches the cue itself, it's already up.
    expect(engine.cueReached(tease2)).toEqual([]);
    // The first tease running out just as the second cut in doesn't take the second one off.
    expect(engine.clipEnded(1)).toEqual([]);
    expect(engine.state.onAir).toBe(tease2);
    expect(engine.clipEnded(2)).toEqual([{ kind: 'dsk', on: false }]);
  });

  it('takes the section’s camera, cues its first clip, and starts the music with the tease', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    expect(engine.sectionStarted(ids.a1)).toEqual([
      { kind: 'camera', input: 1 },
      { kind: 'cueClip', item: 1 },
    ]);
    // The tease plays while the anchor reads, with the music.
    expect(engine.cueReached(ids.tease)).toEqual([
      { kind: 'dsk', on: true },
      { kind: 'music', play: true, track: 1 },
    ]);
    // Firing the MUSIC cue too doesn't restart the track.
    expect(engine.cueReached(ids.music)).toEqual([]);
  });

  it('plays the music with a tease later in the show, through back-to-back teases, until the teases end', () => {
    const { plan, ids } = show();
    const tease = (id: string, ddrItem: number) => ({ id, sectionId: ids.b1, type: 'TEASE' as const, name: '', behavior: 'voiceover' as const, ddrItem });
    plan.sections[4].elements.unshift(tease('later1', 1), tease('later2', 4));
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.b1);
    expect(engine.cueReached('later1')).toContainEqual({ kind: 'music', play: true, track: 1 });
    // The next tease cuts straight in, and the music carries on.
    expect(engine.cueReached('later2')).toEqual([{ kind: 'cueClip', item: 4 }, { kind: 'play' }]);
    // The first tease running out changes nothing; the last one ending stops the music.
    expect(engine.clipEnded(1)).toEqual([]);
    expect(engine.clipEnded(4)).toContainEqual({ kind: 'music', play: false });
    expect(engine.state.musicPlaying).toBe(false);
    // Taken off by hand, or by the section ending, it stops too.
    engine.cueReached('later1');
    expect(engine.takeOff()).toEqual([{ kind: 'dsk', on: false }, { kind: 'music', play: false }]);
    // With Music in set to one point instead, a tease plays no music.
    plan.music.withTeases = false;
    expect(engine.cueReached('later2')).not.toContainEqual(expect.objectContaining({ kind: 'music' }));
  });

  it('by default, stops the tease’s music when the tease ends', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a1);
    engine.cueReached(ids.tease);
    expect(engine.state.musicPlaying).toBe(true);
    expect(engine.clipEnded()).toContainEqual({ kind: 'music', play: false });
  });

  it('with Music out set to the Show Intro, keeps the tease’s music until just before it, and plays the intro to its end', () => {
    const { plan, ids } = show();
    plan.music.out = { kind: 'cue', elementId: ids.intro };
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a1);
    engine.cueReached(ids.tease);
    // A new section: the tease (a voiceover) comes off, and the intro is cued.
    expect(engine.sectionStarted(ids.a2)).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 2 },
    ]);
    expect(engine.cueReached(ids.intro)).toEqual([
      { kind: 'music', play: false },
      { kind: 'dsk', on: true },
    ]);
    // The intro has its own audio, so the next section starting doesn't cut it off…
    expect(engine.sectionStarted(ids.a3)).toEqual([]);
    // …and the next clip waits until it ends.
    expect(engine.clipEnded()).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 3 },
    ]);
  });

  it('brings the L3 back when a VO ends before its section does', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    expect(engine.cueReached(ids.l3)).toEqual([{ kind: 'dsk', on: true }]);
    // Straight from the L3 to the VO, and back: DSK 2 stays on.
    expect(engine.cueReached(ids.vo)).toEqual([
      { kind: 'cueClip', item: 4 },
      { kind: 'play' },
    ]);
    expect(engine.clipEnded()).toEqual([
      { kind: 'cueClip', item: 3 },
      { kind: 'play' },
    ]);
    expect(engine.state.onAir).toBe(ids.l3);
    // The section ends: the L3 comes off, and the SOT is cued.
    expect(engine.sectionStarted(ids.a4)).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 5 },
    ]);
  });

  it('takes a VO off when its section ends first', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    engine.cueReached(ids.vo);
    expect(engine.sectionStarted(ids.a4)).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 5 },
    ]);
    expect(engine.clipEnded()).toEqual([]);
  });

  it('plays a SOT to its end, then goes back to the anchors and cues what’s next', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a4);
    expect(engine.cueReached(ids.sot)).toEqual([{ kind: 'dsk', on: true }]);
    // Back to the anchors, and the commercial break's graphic is cued.
    expect(engine.clipEnded()).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 0 },
    ]);
    expect(engine.sectionStarted(ids.b1)).toEqual([
      { kind: 'camera', input: 3 },
      { kind: 'cueClip', item: 7 },
    ]);
  });

  it('holds the show’s break graphic through the commercial break, until the next section starts', () => {
    const { plan, ids } = show();
    // The break is the last cue of the section before it.
    expect(plan.sections[3].elements.at(-1)).toMatchObject({ id: ids.breakB, sectionId: ids.a4, type: 'PERM', name: 'Commercial Break', behavior: 'graphic', ddrItem: 0 });
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a4);
    engine.cueReached(ids.sot);
    engine.clipEnded();
    expect(engine.cueReached(ids.breakB)).toEqual([{ kind: 'dsk', on: true }]);
    // Its clip ends, and it stays up (RG, Oct 29, 2026).
    expect(engine.clipEnded()).toEqual([]);
    expect(engine.state.onAir).toBe(ids.breakB);
    // B1 starts: the break comes off onto B1's camera, and B1's FSG is cued.
    expect(engine.sectionStarted(ids.b1)).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'camera', input: 3 },
      { kind: 'cueClip', item: 7 },
    ]);
  });

  it('lets the producer fire the next cue, skip one, or pick a different one', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    expect(engine.upNext().map((e) => e.id)).toEqual([ids.l3, ids.vo, ids.sot, ids.breakB, ids.fsg]);
    engine.skip(ids.l3);
    expect(engine.fireNext()).toEqual([
      { kind: 'cueClip', item: 4 },
      { kind: 'dsk', on: true },
    ]);
    expect(engine.state.onAir).toBe(ids.vo);
    // A skipped cue doesn't fire when the prompter reaches it.
    expect(engine.cueReached(ids.l3)).toEqual([]);
    engine.chooseNext(ids.fsg);
    expect(engine.upNext()[0].id).toBe(ids.fsg);
    engine.fireNext();
    expect(engine.state.onAir).toBe(ids.fsg);
    expect(engine.state.sectionId).toBe(ids.b1);
  });

  it('in manual mode, ignores the prompter; Continue picks up from its place without firing what it passed', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    engine.setManual(true);
    expect(engine.cueReached(ids.l3)).toEqual([]);
    expect(engine.sectionStarted(ids.a4)).toEqual([]);
    // The producer's place, not the prompter's: the L3 is still next.
    expect(engine.upNext()[0].id).toBe(ids.l3);
    // Cameras change only when the producer clicks one.
    expect(engine.takeCamera(2)).toEqual([{ kind: 'camera', input: 2 }]);
    engine.setManual(false, { dskOn: false, camera: 2 });
    expect(engine.state.sectionId).toBe(ids.a4);
    expect(engine.upNext()[0].id).toBe(ids.sot);
    expect(engine.cueReached(ids.sot)).toEqual([
      { kind: 'cueClip', item: 5 },
      { kind: 'dsk', on: true },
    ]);
  });

  it('in manual mode, the producer fires the next graphic, goes back one, and takes it off', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.setManual(true);
    engine.sectionStarted(ids.a3);
    // The prompter doesn't move the producer's place: the show's first cue is next, with nothing before it.
    expect(engine.upNext()[0].id).toBe(ids.tease);
    expect(engine.fireBack()).toEqual([]);
    engine.chooseNext(ids.l3);
    expect(engine.fireNext()).toEqual([
      { kind: 'cueClip', item: 3 },
      { kind: 'dsk', on: true },
    ]);
    expect(engine.fireNext()).toEqual([
      { kind: 'cueClip', item: 4 },
      { kind: 'play' },
    ]);
    expect(engine.state.onAir).toBe(ids.vo);
    // Back: the L3 goes up again, and the VO is next again.
    expect(engine.fireBack()).toEqual([
      { kind: 'cueClip', item: 3 },
      { kind: 'play' },
    ]);
    expect(engine.state.onAir).toBe(ids.l3);
    expect(engine.upNext()[0].id).toBe(ids.vo);
    // Back again goes past the start of the section, to A2's Show Intro.
    expect(engine.previous()?.id).toBe(ids.intro);
    // Down arrow: the graphic comes off.
    expect(engine.takeOff()).toEqual([{ kind: 'dsk', on: false }]);
    expect(engine.state.onAir).toBeNull();
    expect(engine.takeOff()).toEqual([]);
  });

  it('leaves the cameras to the producer, while the graphics still follow the prompter', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    engine.setCamerasByHand(true, 2);
    // A4 starts: no camera, but its SOT is cued as usual.
    expect(engine.sectionStarted(ids.a4)).toEqual([{ kind: 'cueClip', item: 5 }]);
    expect(engine.cueReached(ids.sot)).toEqual([{ kind: 'dsk', on: true }]);
    expect(engine.takeCamera(3)).toEqual([{ kind: 'camera', input: 3 }]);
    // Given back, with camera 2 on air: the next section takes its camera again (its FSG waits for the SOT).
    engine.setCamerasByHand(false, 2);
    expect(engine.sectionStarted(ids.b1)).toEqual([{ kind: 'camera', input: 3 }]);
  });

  it('takes another camera at a camera cue in the middle of a section, unless the producer has the cameras', () => {
    const { plan, ids } = show();
    const cue = (id: string, sectionId: string, input: number) => ({ id, sectionId, camera: `Camera ${input}`, input });
    plan.sections[2].cameraCues = [cue('camera-mid', ids.a3, 2), cue('camera-back', ids.a3, 1)];
    plan.sections[4].cameraCues = [cue('camera-top', ids.b1, 2)];
    const engine = new CueEngine(plan);
    expect(engine.sectionStarted(ids.a3)).toContainEqual({ kind: 'camera', input: 1 });
    expect(engine.cueReached('camera-mid')).toEqual([{ kind: 'camera', input: 2 }]);
    expect(engine.cueReached('camera-mid')).toEqual([]);
    expect(engine.cueReached('camera-back')).toEqual([{ kind: 'camera', input: 1 }]);
    // The producer has the cameras: camera cues take nothing.
    engine.setCamerasByHand(true, 1);
    expect(engine.cueReached('camera-mid')).toEqual([]);
    engine.setCamerasByHand(false, 1);
    engine.setManual(true);
    expect(engine.cueReached('camera-mid')).toEqual([]);
    engine.setManual(false, { dskOn: false, camera: 1 });
    // A camera cue at the very top of B1 takes its camera instead of B1's (camera 3), once.
    expect(engine.sectionStarted(ids.b1, ['camera-top']).filter((c) => c.kind === 'camera')).toEqual([{ kind: 'camera', input: 2 }]);
    expect(engine.cueReached('camera-top')).toEqual([]);
  });

  it('plays a clip the producer fired in manual mode to its end', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.setManual(true);
    engine.chooseNext(ids.sot);
    engine.fireNext();
    // It comes off, and the commercial break after it is cued.
    expect(engine.clipEnded()).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 0 },
    ]);
  });

  it('doesn’t restart a graphic the producer already put up when the prompter reaches its cue', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    engine.setManual(true);
    engine.chooseNext(ids.l3);
    engine.fireNext();
    engine.setManual(false, { dskOn: true, camera: 1 });
    expect(engine.cueReached(ids.l3)).toEqual([]);
    expect(engine.state.onAir).toBe(ids.l3);
  });

  it('leaves out cues whose file is missing, and the producer’s camera wins', () => {
    const { plan, ids } = show();
    plan.sections[2].elements.find((e) => e.id === ids.l3)!.ddrItem = null;
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    expect(engine.cueReached(ids.l3)).toEqual([]);
    expect(engine.takeCamera(2)).toEqual([{ kind: 'camera', input: 2 }]);
    expect(engine.sectionStarted(ids.a4)).toEqual([
      { kind: 'camera', input: 1 },
      { kind: 'cueClip', item: 5 },
    ]);
  });
});
