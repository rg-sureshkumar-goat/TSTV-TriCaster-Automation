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
    expect(lines.map((l) => l.kind)).toEqual(['block', 'section', 'speaker', 'cue', 'text', 'text', 'speaker', 'text', 'break', 'block', 'section', 'crossTalk', 'text', 'end']);
    expect(lines[1]).toMatchObject({ kind: 'section', label: 'A1', slug: 'Cold Open', readers: ['Jordan', 'Riley Park'], camera: 'Camera 2' });
    expect(lines[2]).toMatchObject({ kind: 'speaker', name: 'JORDAN' });
    expect(lines[3]).toMatchObject({ kind: 'cue', sectionId: a1, element: { type: 'L3', name: 'Score' } });
    expect(lines[8]).toMatchObject({ kind: 'break', seconds: 60 });
    expect(lines[10]).toMatchObject({ kind: 'section', sectionId: b1, readers: [], camera: 'Camera 1' });
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
    expect(lines.filter((l) => l.kind === 'camera')).toMatchObject(cameras.map((c) => ({ kind: 'camera', sectionId: id, cueId: c.id, camera: c.camera })));
    expect(lines.map((l) => l.kind)).toEqual(['section', 'camera', 'speaker', 'text', 'camera', 'text', 'end']);
    // The one at the very top fires with the section.
    expect(topCues(doc, id)).toEqual([cameras[0].id]);
  });
});
