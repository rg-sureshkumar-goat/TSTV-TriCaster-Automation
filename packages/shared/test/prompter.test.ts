import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addElement, computeRundown, CROSS_TALK, insertBlock, insertSection, readRows, updateRow } from '../src/rundown.ts';
import { CAMERA_CUE_NODE, CUE_NODE, ensureScripts, PARAGRAPH_NODE, scriptBody } from '../src/script.ts';
import { cameraCues, prompterLines, topCues } from '../src/prompter.ts';

const alex = { id: 'u1', name: 'Alex Producer' };

function setLines(body: Y.XmlFragment, lines: string[]): void {
  body.delete(0, body.length);
  for (const line of lines) {
    const cue = /^\[cue:(.+)\]$/.exec(line);
    const camera = /^\[camera:(.+)\]$/.exec(line);
    if (camera) {
      const chip = new Y.XmlElement(CAMERA_CUE_NODE);
      chip.setAttribute('camera', camera[1]);
      body.push([chip]);
    } else if (cue) {
      const chip = new Y.XmlElement(CUE_NODE);
      chip.setAttribute('elementId', cue[1]);
      body.push([chip]);
    } else {
      const paragraph = new Y.XmlElement(PARAGRAPH_NODE);
      if (line) paragraph.insert(0, [new Y.XmlText(line)]);
      body.push([paragraph]);
    }
  }
}

describe('prompter', () => {
  it('lays out each section that airs, with who reads it, the camera, cues and speakers', () => {
    const doc = new Y.Doc();
    insertBlock(doc, alex, 'Top stories');
    const a1 = insertSection(doc, alex, { slug: 'Cold Open', talent: ['Jordan', 'Riley Park'], camera: 'Camera 2' });
    const a2 = insertSection(doc, alex, { slug: 'Floated story', floated: true });
    insertBlock(doc, alex);
    const b1 = insertSection(doc, alex, { slug: 'Weather', talent: [CROSS_TALK] });
    ensureScripts(doc);
    const l3 = addElement(doc, a1, 'L3', alex, 'Score')!;
    setLines(scriptBody(doc, a1)!, ['{JORDAN}', `[cue:${l3}]`, 'GOOD EVENING.', '', '{RILEY PARK}', 'THANKS.', '[cue:removed]']);
    setLines(scriptBody(doc, a2)!, ['NOT TONIGHT.']);
    const timing = computeRundown(readRows(doc), 1800, undefined, 60);
    const lines = prompterLines(doc, timing, 'Camera 1');
    expect(lines.map((l) => l.kind)).toEqual(['block', 'section', 'speaker', 'text', 'speaker', 'text', 'text', 'break', 'block', 'section', 'crossTalk', 'text', 'end']);
    expect(lines[1]).toMatchObject({ kind: 'section', label: 'A1', slug: 'Cold Open', readers: ['Jordan', 'Riley Park'], camera: 'Camera 2' });
    expect(lines[2]).toMatchObject({ kind: 'speaker', name: 'JORDAN', cues: [{ kind: 'cue', sectionId: a1, element: { type: 'L3', name: 'Score' } }] });
    expect(lines[7]).toMatchObject({ kind: 'break', seconds: 60 });
    expect(lines[9]).toMatchObject({ kind: 'section', sectionId: b1, readers: [], camera: 'Camera 1' });
    // The floated section is skipped.
    expect(lines.some((l) => 'sectionId' in l && l.sectionId === a2)).toBe(false);
  });

  it('finds the cues at the top of a section, before any words to read', () => {
    const doc = new Y.Doc();
    const tease = insertSection(doc, alex, { type: 'Tease', talent: ['Jordan'] });
    const reader = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    setLines(scriptBody(doc, tease)!, ['{JORDAN}', '', '[cue:music]', '[cue:tease]', 'TONIGHT ON PRIMETIME.', '[cue:later]']);
    setLines(scriptBody(doc, reader)!, ['GOOD EVENING.', '[cue:l3]']);
    expect(topCues(doc, tease)).toEqual(['music', 'tease']);
    expect(topCues(doc, reader)).toEqual([]);
  });

  it('keeps each line’s key while the script is edited above it', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    const body = scriptBody(doc, id)!;
    setLines(body, ['FIRST.', 'SECOND.']);
    const timing = () => computeRundown(readRows(doc), 600);
    const keyOf = (text: string) => prompterLines(doc, timing(), 'Camera 1').find((l) => l.kind === 'text' && l.text === text)?.key;
    const before = keyOf('SECOND.');
    const added = new Y.XmlElement(PARAGRAPH_NODE);
    added.insert(0, [new Y.XmlText('NEW LINE.')]);
    body.insert(0, [added]);
    updateRow(doc, id, { slug: 'Renamed' }, alex);
    expect(keyOf('SECOND.')).toBe(before);
  });

  it('shows camera cues as markers that fire like a graphic’s, each with its own id', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    setLines(scriptBody(doc, id)!, ['[camera:Camera 3]', '{JORDAN}', 'GOOD EVENING.', '[camera:Camera 2]', 'OVER HERE.']);
    const cameras = cameraCues(doc, id);
    expect(cameras.map((c) => c.camera)).toEqual(['Camera 3', 'Camera 2']);
    expect(new Set(cameras.map((c) => c.id)).size).toBe(2);
    const lines = prompterLines(doc, computeRundown(readRows(doc), 600), 'Camera 1');
    const [top, later] = cameras.map((c) => ({ kind: 'camera', sectionId: id, cueId: c.id, camera: c.camera }));
    expect(lines.filter((l) => l.kind === 'camera')).toMatchObject([later]);
    expect(lines.map((l) => l.kind)).toEqual(['section', 'speaker', 'text', 'camera', 'text', 'text', 'end']);
    expect(lines[1]).toMatchObject({ kind: 'speaker', name: 'JORDAN', cues: [top] });
    // The one at the very top fires with the section.
    expect(topCues(doc, id)).toEqual([cameras[0].id]);
  });

  it('puts the cues at the top of each reader’s part on the line with their name, and leaves the others', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { talent: ['Jordan', 'Riley'] });
    ensureScripts(doc);
    const fsg = addElement(doc, id, 'FSG', alex, 'Map')!;
    const l3 = addElement(doc, id, 'L3', alex, 'Name')!;
    const mid = addElement(doc, id, 'FSG', alex, 'Later')!;
    setLines(scriptBody(doc, id)!, ['[cue:' + fsg + ']', '{JORDAN}', '', '[camera:Camera 2]', '[cue:' + l3 + ']', 'GOOD EVENING.', '[cue:' + mid + ']', 'MORE.', '[camera:Camera 3]', '{RILEY}', '[camera:Camera 1]', 'THANKS.']);
    const lines = prompterLines(doc, computeRundown(readRows(doc), 600), 'Camera 1');
    const cueNames = (l: (typeof lines)[number]) => (l.kind === 'speaker' ? l.cues.map((c) => (c.kind === 'cue' ? c.element.name : c.camera)) : []);
    expect(lines.map((l) => l.kind)).toEqual(['section', 'speaker', 'text', 'cue', 'text', 'camera', 'speaker', 'text', 'text', 'end']);
    expect(cueNames(lines[1])).toEqual(['Map', 'Camera 2', 'Name']);
    // A cue above a later reader's name belongs to the words before it, so it stays on its own line.
    expect(lines[5]).toMatchObject({ kind: 'camera', camera: 'Camera 3' });
    expect(cueNames(lines[6])).toEqual(['Camera 1']);
  });

  it('takes out completely empty lines, keeps indents, and ends each section with one blank line', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    setLines(scriptBody(doc, id)!, ['', '{JORDAN}', '', 'GOOD EVENING.', '', '\tINDENTED.', '', '\t', '   ', 'MORE.', '', '\t', '', '  ', '']);
    const lines = prompterLines(doc, computeRundown(readRows(doc), 600), 'Camera 1');
    // Among the words, lines with just an indent or spaces stay. After them, there's just the one blank line.
    expect(lines.flatMap((l) => (l.kind === 'text' ? [l.text] : []))).toEqual(['GOOD EVENING.', '\tINDENTED.', '\t', '   ', 'MORE.', '']);
  });

  it('gives a section with no script, or no blank line, its one blank line too', () => {
    const doc = new Y.Doc();
    const empty = insertSection(doc, alex, { talent: ['Jordan'] });
    const full = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    setLines(scriptBody(doc, empty)!, ['', '', '']);
    setLines(scriptBody(doc, full)!, ['GOOD EVENING.']);
    const lines = prompterLines(doc, computeRundown(readRows(doc), 600), 'Camera 1');
    expect(lines.map((l) => (l.kind === 'text' ? l.text : l.kind))).toEqual(['section', '', 'section', 'GOOD EVENING.', '', 'end']);
  });

  it('leaves cues on their own lines when the script has no reader’s name', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex, { talent: ['Jordan'] });
    ensureScripts(doc);
    setLines(scriptBody(doc, id)!, ['[camera:Camera 2]', 'GOOD EVENING.']);
    const lines = prompterLines(doc, computeRundown(readRows(doc), 600), 'Camera 1');
    expect(lines.map((l) => l.kind)).toEqual(['section', 'camera', 'text', 'text', 'end']);
  });
});
