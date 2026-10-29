import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, computeRundown, insertBlock, insertSection, readRows } from '../src/rundown.ts';
import { DEFAULT_SHOW_SETTINGS, normalizeShowSettings } from '../src/show.ts';
import { buildShowPlan, cueBehavior, CueEngine, defaultMusicPoints, type ShowPlan, type ShowSection } from '../src/engine.ts';

const alex = { id: 'u1', name: 'Alex Producer' };

/** A small show: A1 tease with music, A2 Show Intro, A3 reader with an L3 and a VO, A4 SOT, B1 on camera 3 with an FSG. */
function show(): { plan: ShowPlan; ids: Record<string, string> } {
  const doc = new Y.Doc();
  insertBlock(doc, alex);
  const a1 = insertSection(doc, alex, { slug: 'Tease', type: 'Tease' });
  const a2 = insertSection(doc, alex, { slug: 'Open', type: 'Permanent Graphic' });
  const a3 = insertSection(doc, alex, { slug: 'Basketball', type: 'Reader' });
  const a4 = insertSection(doc, alex, { slug: 'Coach', type: 'SOT' });
  insertSection(doc, alex, { slug: 'Floated', floated: true });
  insertBlock(doc, alex);
  const b1 = insertSection(doc, alex, { slug: 'Weather', camera: 'Camera 3' });
  const ids = {
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
  const files = { [ids.tease]: 'A1_TEASE_Sports.mov', [ids.intro]: 'Show Intro.mov', [ids.l3]: 'A3_L3_Score.mov', [ids.vo]: 'A3_VO_Highlights.mp4', [ids.sot]: 'A4_SOT_Coach.mov', [ids.fsg]: 'B1_FSG_Weather.mov' };
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
    expect(plan.music).toEqual({ in: { kind: 'section', sectionId: ids.a1 }, out: { kind: 'cue', elementId: ids.intro }, track: 1 });
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
  it('takes the section’s camera, cues its first clip, and starts the music with the tease', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    expect(engine.sectionStarted(ids.a1)).toEqual([
      { kind: 'camera', input: 1 },
      { kind: 'cueClip', item: 1 },
      { kind: 'music', play: true, track: 1 },
    ]);
    // The tease plays while the anchor reads.
    expect(engine.cueReached(ids.tease)).toEqual([{ kind: 'dsk', on: true }]);
    // Firing the MUSIC cue too doesn't restart the track.
    expect(engine.cueReached(ids.music)).toEqual([]);
  });

  it('stops the music just before the Show Intro fires, and plays the intro to its end', () => {
    const { plan, ids } = show();
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
    expect(engine.cueReached(ids.vo)).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 4 },
      { kind: 'dsk', on: true },
    ]);
    expect(engine.clipEnded()).toEqual([
      { kind: 'dsk', on: false },
      { kind: 'cueClip', item: 3 },
      { kind: 'dsk', on: true },
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
    expect(engine.clipEnded()).toEqual([{ kind: 'dsk', on: false }]);
    expect(engine.sectionStarted(ids.b1)).toEqual([
      { kind: 'camera', input: 3 },
      { kind: 'cueClip', item: 7 },
    ]);
  });

  it('lets the producer fire the next cue, skip one, or pick a different one', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    expect(engine.upNext().map((e) => e.id)).toEqual([ids.l3, ids.vo, ids.sot, ids.fsg]);
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

  it('sends nothing while paused, and doesn’t fire the cues passed while paused', () => {
    const { plan, ids } = show();
    const engine = new CueEngine(plan);
    engine.sectionStarted(ids.a3);
    engine.setPaused(true);
    expect(engine.cueReached(ids.l3)).toEqual([]);
    expect(engine.sectionStarted(ids.a4)).toEqual([]);
    expect(engine.takeCamera(2)).toEqual([]);
    engine.setPaused(false, { dskOn: false, camera: 2 });
    expect(engine.upNext()[0].id).toBe(ids.sot);
    expect(engine.cueReached(ids.sot)).toEqual([
      { kind: 'cueClip', item: 5 },
      { kind: 'dsk', on: true },
    ]);
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
