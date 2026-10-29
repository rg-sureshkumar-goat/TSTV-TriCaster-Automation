import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { insertSection } from '../src/rundown.ts';
import { countWords, ensureScripts, noteScriptEdit, readScript, readScriptInfo, readTimeRange, scriptText } from '../src/script.ts';

const alex = { id: 'u1', name: 'Alex Producer' };
const sam = { id: 'u2', name: 'Sam Writer' };

describe('scripts', () => {
  it('gives every section a script, once', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    expect(scriptText(doc, id)).toBeUndefined();
    expect(ensureScripts(doc)).toBe(true);
    expect(ensureScripts(doc)).toBe(false);
    expect(readScript(doc, id)).toBe('');
  });

  it('merges two people typing in the same script at once', () => {
    const room = new Y.Doc();
    const id = insertSection(room, alex);
    ensureScripts(room);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room));
    scriptText(a, id)!.insert(0, 'Good evening. ');
    scriptText(b, id)!.insert(0, 'The Longhorns won tonight.');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readScript(a, id)).toBe(readScript(b, id));
    expect(readScript(a, id)).toContain('Good evening. ');
    expect(readScript(a, id)).toContain('The Longhorns won tonight.');
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

  it('counts words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords(' Good evening,\n and welcome  to TSTV News. ')).toBe(7);
  });

  it('estimates read time at 143 to 154 words a minute', () => {
    expect(readTimeRange(154)).toEqual({ fastestSeconds: 60, slowestSeconds: 65 });
    expect(readTimeRange(143)).toEqual({ fastestSeconds: 56, slowestSeconds: 60 });
    expect(readTimeRange(0)).toEqual({ fastestSeconds: 0, slowestSeconds: 0 });
  });
});
