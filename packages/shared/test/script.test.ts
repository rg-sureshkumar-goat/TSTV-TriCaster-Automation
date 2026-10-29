import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CROSS_TALK, insertSection, updateRow } from '../src/rundown.ts';
import {
  countWords,
  CUE_NODE,
  cuedElementIds,
  ensureScripts,
  estimatedReadSeconds,
  noteScriptEdit,
  PARAGRAPH_NODE,
  readScript,
  readScriptInfo,
  readScriptParagraphs,
  readTimeRange,
  scriptBody,
  scriptCueCounts,
  scriptWordCounts,
  sectionSecondsFrom,
  speakerTag,
  speakerTags,
  tagReaders,
  upgradeScripts,
} from '../src/script.ts';

const alex = { id: 'u1', name: 'Alex Producer' };
const sam = { id: 'u2', name: 'Sam Writer' };

/**
 * Adds a paragraph the way the script editor does. `[cue:id]` adds a cue chip inside the paragraph, the way
 * scripts kept them before Oct 29, 2026.
 */
function addParagraph(body: Y.XmlFragment, content: string): void {
  const paragraph = new Y.XmlElement(PARAGRAPH_NODE);
  body.push([paragraph]);
  for (const part of content.split(/(\[cue:[^\]]+\])/).filter(Boolean)) {
    const cue = /^\[cue:([^\]]+)\]$/.exec(part);
    if (cue) {
      const chip = new Y.XmlElement(CUE_NODE);
      paragraph.push([chip]);
      chip.setAttribute('elementId', cue[1]);
    } else {
      paragraph.push([new Y.XmlText(part)]);
    }
  }
}

/** Adds a cue chip on a line of its own, the way the script editor does. */
function addCueLine(body: Y.XmlFragment, elementId: string): void {
  const cue = new Y.XmlElement(CUE_NODE);
  body.push([cue]);
  cue.setAttribute('elementId', elementId);
}

/** Replaces a script with these lines. */
function setScript(body: Y.XmlFragment, lines: string[]): void {
  body.delete(0, body.length);
  lines.forEach((line) => addParagraph(body, line));
}

describe('scripts', () => {
  it('gives every section a script, once', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    expect(scriptBody(doc, id)).toBeUndefined();
    expect(ensureScripts(doc)).toBe(true);
    expect(ensureScripts(doc)).toBe(false);
    expect(readScript(doc, id)).toBe('');
  });

  it('copies a Phase 1 plain-text script in, word for word, one paragraph per line', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    doc.getMap<Y.Text>('scripts').set(id, new Y.Text('{Jordan}\nGood evening.\n\nThe Longhorns won tonight.'));
    ensureScripts(doc);
    expect(readScript(doc, id)).toBe('{Jordan}\nGood evening.\n\nThe Longhorns won tonight.');
    expect(scriptBody(doc, id)!.toArray().map((p) => (p as Y.XmlElement).nodeName)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    // The plain text stays as a backup.
    expect(doc.getMap<Y.Text>('scripts').get(id)!.toString()).toContain('Longhorns');
  });

  it('merges two people typing in the same script at once', () => {
    const room = new Y.Doc();
    const id = insertSection(room, alex);
    ensureScripts(room);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room));
    addParagraph(scriptBody(a, id)!, 'Good evening.');
    addParagraph(scriptBody(b, id)!, 'The Longhorns won tonight.');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readScript(a, id)).toBe(readScript(b, id));
    expect(readScript(a, id)).toContain('Good evening.');
    expect(readScript(a, id)).toContain('The Longhorns won tonight.');
  });

  it('reads cue chips in place, each on its own line, leaves them out of the words, and counts them per graphic', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    const body = scriptBody(doc, id)!;
    addCueLine(body, 'l3');
    addParagraph(body, 'GOOD EVENING.');
    addCueLine(body, 'vo');
    addParagraph(body, 'THE LONGHORNS WON.');
    addCueLine(body, 'vo');
    // A new script starts with one empty paragraph.
    expect(readScriptParagraphs(body)).toEqual([
      [],
      [{ kind: 'cue', elementId: 'l3' }],
      [{ kind: 'text', text: 'GOOD EVENING.' }],
      [{ kind: 'cue', elementId: 'vo' }],
      [{ kind: 'text', text: 'THE LONGHORNS WON.' }],
      [{ kind: 'cue', elementId: 'vo' }],
    ]);
    expect(readScript(doc, id)).toBe('\n\nGOOD EVENING.\n\nTHE LONGHORNS WON.\n');
    expect(scriptCueCounts(body)).toEqual(new Map([['l3', 1], ['vo', 2]]));
    expect(cuedElementIds(doc)).toEqual(new Set(['l3', 'vo']));
    expect(scriptWordCounts(doc)[id]).toBe(5);
  });

  it('brings older scripts up to date once: each cue on its own line, and the words in capitals', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    const body = scriptBody(doc, id)!;
    setScript(body, ['{Jordan}', '[cue:l3]Good evening. [cue:vo]The Longhorns won.', '', 'Back to you, Riley.[cue:fsg]']);
    expect(upgradeScripts(doc)).toBe(true);
    expect(readScriptParagraphs(body)).toEqual([
      [{ kind: 'text', text: '{JORDAN}' }],
      [{ kind: 'cue', elementId: 'l3' }],
      [{ kind: 'text', text: 'GOOD EVENING.' }],
      [{ kind: 'cue', elementId: 'vo' }],
      [{ kind: 'text', text: 'THE LONGHORNS WON.' }],
      [],
      [{ kind: 'text', text: 'BACK TO YOU, RILEY.' }],
      [{ kind: 'cue', elementId: 'fsg' }],
      // A line to type on after the last cue.
      [],
    ]);
    expect(body.toArray().map((n) => (n as Y.XmlElement).nodeName)).toEqual(['paragraph', 'cue', 'paragraph', 'cue', 'paragraph', 'paragraph', 'paragraph', 'cue', 'paragraph']);
    expect(scriptWordCounts(doc)[id]).toBe(9);
    // It runs only once.
    expect(upgradeScripts(doc)).toBe(false);
  });

  it('writes the readers’ names into a script with no words yet, and follows the Talent until someone writes', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    tagReaders(doc);
    expect(readScript(doc, id)).toBe('');
    updateRow(doc, id, { talent: ['Jordan', 'Riley Park'] }, alex);
    expect(tagReaders(doc)).toBe(true);
    expect(readScript(doc, id)).toBe('{JORDAN}\n\n{RILEY PARK}\n');
    expect(tagReaders(doc)).toBe(false);
    // Talent changes before anyone writes: the names follow.
    updateRow(doc, id, { talent: ['Riley Park'] }, alex);
    tagReaders(doc);
    expect(readScript(doc, id)).toBe('{RILEY PARK}\n');
    // Unscripted cross talk has no readers.
    updateRow(doc, id, { talent: [CROSS_TALK] }, alex);
    tagReaders(doc);
    expect(readScript(doc, id)).toBe('');
    // Once there are words, a change of Talent leaves the script alone.
    updateRow(doc, id, { talent: ['Jordan', 'Riley Park'] }, alex);
    tagReaders(doc);
    setScript(scriptBody(doc, id)!, ['{JORDAN}', 'GOOD EVENING.', '{RILEY PARK}', 'THANKS.']);
    updateRow(doc, id, { talent: ['Jordan'] }, alex);
    tagReaders(doc);
    expect(readScript(doc, id)).toBe('{JORDAN}\nGOOD EVENING.\n{RILEY PARK}\nTHANKS.');
  });

  it('adds the reader’s name to the top of a written one-reader script with no name in it', () => {
    const doc = new Y.Doc();
    const one = insertSection(doc, alex);
    const tagged = insertSection(doc, alex);
    const two = insertSection(doc, alex);
    ensureScripts(doc);
    setScript(scriptBody(doc, one)!, ['GOOD EVENING.']);
    setScript(scriptBody(doc, tagged)!, ['{JORDAN}', 'HI.']);
    setScript(scriptBody(doc, two)!, ['HELLO.']);
    updateRow(doc, one, { talent: ['Jordan'] }, alex);
    updateRow(doc, tagged, { talent: ['Jordan'] }, alex);
    updateRow(doc, two, { talent: ['Jordan', 'Riley Park'] }, alex);
    tagReaders(doc);
    expect(readScript(doc, one)).toBe('{JORDAN}\nGOOD EVENING.');
    expect(readScript(doc, tagged)).toBe('{JORDAN}\nHI.');
    // With two readers, only the writer knows where each part starts.
    expect(readScript(doc, two)).toBe('HELLO.');
    // A name the writer deletes isn't put back unless the Talent changes.
    setScript(scriptBody(doc, one)!, ['GOOD EVENING.']);
    tagReaders(doc);
    expect(readScript(doc, one)).toBe('GOOD EVENING.');
    expect(speakerTag('Riley Park')).toBe('{RILEY PARK}');
  });

  it('remembers everyone who edited a script and who was last', () => {
    const doc = new Y.Doc();
    noteScriptEdit(doc, 's1', alex);
    noteScriptEdit(doc, 's1', sam);
    noteScriptEdit(doc, 's1', alex);
    const info = readScriptInfo(doc, 's1');
    expect(info.editors).toEqual([alex, sam]);
    expect(info.updatedBy).toEqual(alex);
  });

  it('counts words, but not speaker tags', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords(' Good evening,\n and welcome  to TSTV News. ')).toBe(7);
    expect(countWords('{Jordan}\nGood evening.\n{Riley Park}\nThanks, Jordan.')).toBe(4);
    expect(speakerTags('{Jordan}\nHi.\n{ Riley Park }\nHello.')).toEqual(['Jordan', 'Riley Park']);
  });

  it('times a section from its script unless a length was typed in', () => {
    expect(estimatedReadSeconds(148)).toBe(60);
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    addParagraph(scriptBody(doc, id)!, 'word '.repeat(297));
    const seconds = sectionSecondsFrom(scriptWordCounts(doc));
    expect(seconds({ id, estSeconds: null })).toBe(120);
    expect(seconds({ id, estSeconds: 45 })).toBe(45);
    expect(seconds({ id: 'no-script', estSeconds: null })).toBe(0);
  });

  it('estimates read time at 143 to 154 words a minute', () => {
    expect(readTimeRange(154)).toEqual({ fastestSeconds: 60, slowestSeconds: 65 });
    expect(readTimeRange(143)).toEqual({ fastestSeconds: 56, slowestSeconds: 60 });
    expect(readTimeRange(0)).toEqual({ fastestSeconds: 0, slowestSeconds: 0 });
  });
});
