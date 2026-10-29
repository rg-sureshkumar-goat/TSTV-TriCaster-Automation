import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { insertSection } from '../src/rundown.ts';
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
  speakerTags,
} from '../src/script.ts';

const alex = { id: 'u1', name: 'Alex Producer' };
const sam = { id: 'u2', name: 'Sam Writer' };

/** Adds a paragraph the way the script editor does: text, with cue chips where `[cue:id]` appears. */
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

  it('reads cue chips in place, leaves them out of the words, and counts them per graphic', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    const body = scriptBody(doc, id)!;
    addParagraph(body, '[cue:l3]Good evening. [cue:vo]The Longhorns won.');
    addParagraph(body, '[cue:vo]');
    // A new script starts with one empty paragraph.
    expect(readScriptParagraphs(body)[0]).toEqual([]);
    expect(readScriptParagraphs(body)[1]).toEqual([
      { kind: 'cue', elementId: 'l3' },
      { kind: 'text', text: 'Good evening. ' },
      { kind: 'cue', elementId: 'vo' },
      { kind: 'text', text: 'The Longhorns won.' },
    ]);
    expect(readScript(doc, id)).toBe('\nGood evening. The Longhorns won.\n');
    expect(scriptCueCounts(body)).toEqual(new Map([['l3', 1], ['vo', 2]]));
    expect(cuedElementIds(doc)).toEqual(new Set(['l3', 'vo']));
    expect(scriptWordCounts(doc)[id]).toBe(5);
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
