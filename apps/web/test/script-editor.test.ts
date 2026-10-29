import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { ensureScripts, insertSection, readScriptParagraphs, scriptBody, upgradeScripts } from '@tstv/shared';
import { Cue } from '../src/script/extensions.ts';

const schema = getSchema([Document, Paragraph, Text, Cue]);
const alex = { id: 'u1', name: 'Alex Producer' };

describe('script editor documents', () => {
  it('opens a Phase 1 plain-text script in the editor, word for word', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    doc.getMap<Y.Text>('scripts').set(id, new Y.Text('{Jordan}\nGood evening.\n\nThe Longhorns won.'));
    ensureScripts(doc);
    const root = yXmlFragmentToProseMirrorRootNode(scriptBody(doc, id)!, schema);
    expect(root.childCount).toBe(4);
    expect(root.child(0).textContent).toBe('{Jordan}');
    expect(root.child(1).textContent).toBe('Good evening.');
    expect(root.child(2).textContent).toBe('');
    expect(root.child(3).textContent).toBe('The Longhorns won.');
  });

  it('opens a new script as one empty paragraph', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    const root = yXmlFragmentToProseMirrorRootNode(scriptBody(doc, id)!, schema);
    expect(root.childCount).toBe(1);
    expect(root.child(0).type.name).toBe('paragraph');
  });

  it('stores cue chips, each on its own line, the way the rundown, the room and (later) the prompter read them', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('test');
    prosemirrorJSONToYXmlFragment(
      schema,
      {
        type: 'doc',
        content: [
          { type: 'cue', attrs: { elementId: 'e1' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'GOOD EVENING.' }] },
        ],
      },
      fragment,
    );
    expect(readScriptParagraphs(fragment)).toEqual([[{ kind: 'cue', elementId: 'e1' }], [{ kind: 'text', text: 'GOOD EVENING.' }]]);
  });

  it('opens a script brought up to date by the room, with cues on their own lines', () => {
    const doc = new Y.Doc();
    const id = insertSection(doc, alex);
    ensureScripts(doc);
    const body = scriptBody(doc, id)!;
    // A line with a cue chip in the middle, the way scripts kept them before Oct 29, 2026.
    const old = new Y.XmlElement('paragraph');
    body.push([old]);
    const cue = new Y.XmlElement('cue');
    old.push([new Y.XmlText('Good evening. '), cue, new Y.XmlText('The Longhorns won.')]);
    cue.setAttribute('elementId', 'e1');
    upgradeScripts(doc);
    const root = yXmlFragmentToProseMirrorRootNode(body, schema);
    expect(() => root.check()).not.toThrow();
    expect(root.content.content.map((n) => (n.type.name === 'cue' ? `[${n.attrs.elementId}]` : n.textContent))).toEqual(['', 'GOOD EVENING.', '[e1]', 'THE LONGHORNS WON.']);
  });
});
