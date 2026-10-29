import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { ensureScripts, insertSection, readScriptParagraphs, scriptBody } from '@tstv/shared';
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

  it('stores cue chips the way the rundown, the room and (later) the prompter read them', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('test');
    prosemirrorJSONToYXmlFragment(
      schema,
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'cue', attrs: { elementId: 'e1' } }, { type: 'text', text: 'Good evening.' }] }],
      },
      fragment,
    );
    expect(readScriptParagraphs(fragment)).toEqual([[{ kind: 'cue', elementId: 'e1' }, { kind: 'text', text: 'Good evening.' }]]);
  });
});
