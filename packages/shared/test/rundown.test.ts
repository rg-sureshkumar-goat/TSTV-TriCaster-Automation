import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addElement,
  blockLetter,
  computeRundown,
  deleteRow,
  formatClock,
  formatDuration,
  formatOverUnder,
  initEpisode,
  insertBlock,
  insertSection,
  moveElement,
  moveRow,
  parseDuration,
  readRows,
  removeElement,
  rowsOf,
  updateElement,
  updateRow,
  type Row,
  type SectionRow,
} from '../src/rundown.ts';
import { DEFAULT_SHOW_SETTINGS, normalizeShowSettings } from '../src/show.ts';

const alex = { id: 'u1', name: 'Alex Producer' };
const sam = { id: 'u2', name: 'Sam Writer' };

const section = (slug: string, estSeconds: number | null, extra: Partial<SectionRow> = {}): SectionRow => ({
  id: slug,
  kind: 'section',
  slug,
  type: '',
  talent: '',
  camera: '',
  greenScreen: '',
  floated: false,
  estSeconds,
  elements: [],
  ...extra,
});
const block = (id: string): Row => ({ id, kind: 'block', title: '' });

describe('numbering', () => {
  it('letters blocks and numbers sections within each block, floated ones included', () => {
    const rows = [block('a'), section('s1', 30), section('s2', 30, { floated: true }), section('s3', 30), block('b'), section('s4', 60)];
    const labels = computeRundown(rows, 1800).rows.map((r) => r.label);
    expect(labels).toEqual(['A', 'A1', 'A2', 'A3', 'B', 'B1']);
  });

  it('treats sections above the first block as block A', () => {
    const labels = computeRundown([section('s1', 10), block('b'), section('s2', 10)], 60).rows.map((r) => r.label);
    expect(labels).toEqual(['A1', 'B', 'B1']);
  });

  it('keeps going past Z', () => {
    expect([0, 1, 25, 26, 27].map(blockLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('timing', () => {
  const rows = [block('a'), section('s1', 60), section('s2', 120, { floated: true }), section('s3', 90), block('b'), section('s4', 300)];

  it('adds up what will air and compares it with the target', () => {
    const t = computeRundown(rows, 600);
    expect(t.totalSeconds).toBe(450);
    expect(t.overUnderSeconds).toBe(-150);
    expect(t.blockSeconds).toEqual({ A: 150, B: 300 });
  });

  it('works out when each section starts and when it must start to end on time', () => {
    const t = computeRundown(rows, 600);
    const byLabel = Object.fromEntries(t.rows.map((r) => [r.label, r]));
    expect(byLabel.A1.startOffset).toBe(0);
    expect(byLabel.A3.startOffset).toBe(60);
    expect(byLabel.B1.startOffset).toBe(150);
    // To end exactly at 10:00, B1 (5:00) must start at 5:00, A3 at 3:30, A1 at 2:30.
    expect(byLabel.B1.backTimeOffset).toBe(300);
    expect(byLabel.B.backTimeOffset).toBe(300);
    expect(byLabel.A3.backTimeOffset).toBe(210);
    expect(byLabel.A1.backTimeOffset).toBe(150);
    expect(byLabel.A2.startOffset).toBeNull();
    expect(byLabel.A2.backTimeOffset).toBeNull();
  });

  it('can take section lengths from elsewhere, for script read time later', () => {
    const t = computeRundown([section('s1', null)], 60, () => 42);
    expect(t.totalSeconds).toBe(42);
  });
});

describe('shared document', () => {
  it('starts a new episode with block A and one empty section, once', () => {
    const doc = new Y.Doc();
    initEpisode(doc, alex);
    initEpisode(doc, alex);
    expect(readRows(doc).map((r) => r.kind)).toEqual(['block', 'section']);
  });

  it('records who created and who last edited a section', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { slug: 'Basketball' });
    updateRow(doc, id, { slug: 'Basketball Wins', estSeconds: 45 }, sam);
    const row = readRows(doc)[0] as SectionRow;
    expect(row.slug).toBe('Basketball Wins');
    expect(row.estSeconds).toBe(45);
    expect(row.createdBy).toEqual(alex);
    expect(row.updatedBy).toEqual(sam);
  });

  it('moves a row and keeps its id and authorship', () => {
    const doc = new Y.Doc();
    insertBlock(doc, alex);
    const first = insertSection(doc, alex, { slug: 'First' });
    insertSection(doc, sam, { slug: 'Second' });
    moveRow(doc, 1, 2);
    const rows = readRows(doc) as SectionRow[];
    expect(rows.map((r) => r.slug ?? '')).toEqual(['', 'Second', 'First']);
    expect(rows[2].id).toBe(first);
    expect(rows[2].createdBy).toEqual(alex);
  });

  it('merges edits made at the same time by two people', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    initEpisode(a, alex);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const id = readRows(a)[1].id;
    // Both edit while "offline", then sync.
    updateRow(a, id, { slug: 'Campus Food' }, alex);
    insertSection(b, sam, { slug: 'Weather' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const slugs = (doc: Y.Doc) => readRows(doc).map((r) => (r.kind === 'section' ? r.slug : '#'));
    expect(slugs(a)).toEqual(['#', 'Campus Food', 'Weather']);
    expect(slugs(b)).toEqual(slugs(a));
  });

  it('deletes a row', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    deleteRow(doc, id);
    expect(readRows(doc)).toEqual([]);
  });
});

describe('elements', () => {
  const sectionWith = () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { slug: 'Basketball', elements: [{ type: 'L3', name: 'Anchors' }] });
    return { doc, id, section: () => readRows(doc)[0] as SectionRow };
  };

  it('a reader can have an L3 and a VO over it, in order', () => {
    const { doc, id, section } = sectionWith();
    addElement(doc, id, 'VO', sam, 'Highlights');
    expect(section().elements.map((e) => `${e.type} ${e.name}`)).toEqual(['L3 Anchors', 'VO Highlights']);
    expect(section().updatedBy).toEqual(sam);
  });

  it('renames, retypes, reorders and removes elements', () => {
    const { doc, id, section } = sectionWith();
    const vo = addElement(doc, id, 'VO', alex)!;
    updateElement(doc, id, vo, { type: 'SOT', name: 'Coach' }, sam);
    moveElement(doc, id, vo, 0, sam);
    expect(section().elements.map((e) => e.type)).toEqual(['SOT', 'L3']);
    removeElement(doc, id, section().elements[1].id, sam);
    expect(section().elements.map((e) => `${e.type} ${e.name}`)).toEqual(['SOT Coach']);
  });

  it('keeps both when two people add elements to the same section at once', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const id = insertSection(a, alex);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addElement(a, id, 'L3', alex);
    addElement(b, id, 'VO', sam);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const types = (doc: Y.Doc) => (readRows(doc)[0] as SectionRow).elements.map((e) => e.type).sort();
    expect(types(a)).toEqual(['L3', 'VO']);
    expect(types(b)).toEqual(['L3', 'VO']);
  });

  it('keeps elements, still editable, when the section moves', () => {
    const doc = new Y.Doc();
    insertSection(doc, alex, { slug: 'First' });
    const id = insertSection(doc, alex, { slug: 'Second', elements: [{ type: 'VO' }] });
    moveRow(doc, 1, 0);
    addElement(doc, id, 'L3', alex);
    expect((readRows(doc)[0] as SectionRow).elements.map((e) => e.type)).toEqual(['VO', 'L3']);
  });

  it('gives rows made before elements existed an empty list', () => {
    const doc = new Y.Doc();
    const old = new Y.Map<unknown>();
    old.set('id', 'old');
    old.set('kind', 'section');
    old.set('slug', 'Old story');
    rowsOf(doc).push([old]);
    expect((readRows(doc)[0] as SectionRow).elements).toEqual([]);
    addElement(doc, 'old', 'FSG', alex);
    expect((readRows(doc)[0] as SectionRow).elements.map((e) => e.type)).toEqual(['FSG']);
  });
});

describe('formatting', () => {
  it('formats and reads durations', () => {
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-30)).toBe('-0:30');
    expect(parseDuration('1:35')).toBe(95);
    expect(parseDuration('95')).toBe(95);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeUndefined();
  });

  it('describes over and under', () => {
    expect(formatOverUnder(130)).toBe('2:10 over');
    expect(formatOverUnder(-65)).toBe('1:05 under');
    expect(formatOverUnder(0)).toBe('on time');
  });

  it('turns an offset into a clock time', () => {
    expect(formatClock('19:00', 750)).toBe('7:12:30 PM');
    expect(formatClock('11:59', 120)).toBe('12:01:00 PM');
    expect(formatClock('', 90)).toBe('+1:30');
  });
});

describe('show settings', () => {
  it('uses TSTV\'s section types, and moves shows off earlier default lists', () => {
    const tstv = ['Intro', 'Tease', 'Reader', 'Cross Talk', 'Package', 'SOT'];
    expect(DEFAULT_SHOW_SETTINGS.segmentTypes).toEqual(tstv);
    expect(normalizeShowSettings({ segmentTypes: ['Reader', 'VO', 'VO/SOT', 'SOT', 'PKG', 'OTS', 'FSG', 'Weather', 'Tease', 'Lites'] }).segmentTypes).toEqual(tstv);
    expect(normalizeShowSettings({ segmentTypes: ['Intro', 'Tease', 'Reader', 'Cross Talk'] }).segmentTypes).toEqual(tstv);
    // A list someone chose on purpose is kept.
    expect(normalizeShowSettings({ segmentTypes: ['Reader', 'Weather'] }).segmentTypes).toEqual(['Reader', 'Weather']);
  });

  it('fills in defaults and fixes bad values', () => {
    expect(normalizeShowSettings(undefined)).toEqual(DEFAULT_SHOW_SETTINGS);
    const s = normalizeShowSettings({ targetSeconds: -5, wordsPerMinute: 'fast', cameras: ['Anchor Camera', ' '], defaultCamera: 'Nope', talent: [{ name: 'Jordan' }] });
    expect(s.targetSeconds).toBe(1800);
    expect(s.wordsPerMinute).toBe(160);
    expect(s.cameras).toEqual(['Anchor Camera']);
    expect(s.defaultCamera).toBe('Anchor Camera');
    expect(s.talent[0]).toMatchObject({ name: 'Jordan' });
    expect(s.talent[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
