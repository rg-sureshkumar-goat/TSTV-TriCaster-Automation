// The script editor for one section: shared text in capital letters where everyone's cursor shows, a
// toolbar that drops cue chips for the section's graphics and camera cues, and buttons that start a speaker's part with {NAME}.
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type YProvider from 'y-partyserver/provider';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Dropcursor, Gapcursor, Placeholder } from '@tiptap/extensions';
import { addElement, cueLabel, elementKind, readersOf, speakerTag, type Element, type Person, type SectionRow } from '@tstv/shared';
import { Popover } from '../components/Popover.tsx';
import { GraphicMenu } from '../rundown/GraphicMenu.tsx';
import { CameraCue, Capitals, Cue, insertCameraCue, insertCue, live, SpeakerTags } from './extensions.ts';

interface Props {
  body: Y.XmlFragment;
  provider: YProvider | null;
  doc: Y.Doc;
  section: SectionRow;
  label: string;
  me: Person & { color: string };
  readOnly: boolean;
  /** Every graphic in the episode, by id, so a chip always shows its graphic's current name. */
  elements: Map<string, Element>;
  /** This episode's talent by lowercase name, with their color. */
  speakers: Map<string, string | undefined>;
  /** How many cue chips this script has for each graphic. */
  cueCounts: Map<string, number>;
  permanent: string[];
  /** The show's cameras, for camera cues. */
  cameras: string[];
  onFocusChange: (focused: boolean) => void;
}

export function ScriptWriter({ body, provider, doc, section, label, me, readOnly, elements, speakers, cueCounts, permanent, cameras, onFocusChange }: Props) {
  const elementsLive = useRef(live(elements)).current;
  const speakersLive = useRef(live(speakers)).current;
  const focusRef = useRef(onFocusChange);
  focusRef.current = onFocusChange;

  const editor = useEditor(
    {
      extensions: [
        Document,
        Paragraph,
        Text,
        Placeholder.configure({ placeholder: 'Type the script for this section…' }),
        // Lets the cursor sit between two cue chips, and shows where a dragged chip will land.
        Gapcursor,
        Dropcursor.configure({ color: false, width: 3, class: 'drop-cursor' }),
        Capitals,
        Cue.configure({ elements: elementsLive }),
        CameraCue,
        SpeakerTags.configure({ speakers: speakersLive }),
        Collaboration.configure({ fragment: body }),
        ...(provider ? [CollaborationCaret.configure({ provider, user: { name: me.name, color: me.color } })] : []),
      ],
      editable: !readOnly,
      // Set up after the page draws, so the editor's first sync never updates the page mid-draw.
      immediatelyRender: false,
      editorProps: {
        attributes: { class: 'script-editor', 'aria-label': `Script for ${label}`, role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', autocapitalize: 'characters' },
      },
      onFocus: () => focusRef.current(true),
      onBlur: () => focusRef.current(false),
    },
    [body, provider],
  );

  useEffect(() => editor?.setEditable(!readOnly), [editor, readOnly]);
  useEffect(() => elementsLive.set(elements), [elementsLive, elements]);
  useEffect(() => {
    speakersLive.set(speakers);
    // Redraw the speaker colors.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('speakerTags', 'refresh'));
  }, [speakersLive, speakers, editor]);

  return (
    <>
      {!readOnly && editor && <Toolbar editor={editor} doc={doc} section={section} label={label} me={me} elements={elements} cueCounts={cueCounts} permanent={permanent} cameras={cameras} />}
      <EditorContent editor={editor} className="script-box" />
    </>
  );
}

function Toolbar({ editor, doc, section, label, me, elements, cueCounts, permanent, cameras }: { editor: Editor; doc: Y.Doc; section: SectionRow; label: string; me: Person; elements: Map<string, Element>; cueCounts: Map<string, number>; permanent: string[]; cameras: string[] }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  // A speaker's part starts on its own line with their name in curly brackets.
  const insertSpeaker = (name: string) =>
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'paragraph', content: [{ type: 'text', text: speakerTag(name) }] },
        { type: 'paragraph' },
      ])
      .run();
  const readers = readersOf(section.talent);
  const doubled = section.elements.filter((e) => (cueCounts.get(e.id) ?? 0) > 1);
  const removed = [...cueCounts.keys()].filter((id) => !elements.has(id)).length;
  // Keep the cursor in the script when a toolbar button is clicked.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="script-toolbar" role="toolbar" aria-label={`Cues for ${label}`}>
      <div className="toolbar-row">
        <span className="toolbar-label" title="Put the cursor where a graphic should fire, then click it. It goes on a line of its own.">
          Cues
        </span>
        {section.elements.length === 0 && <span className="muted small">This section has no graphics yet.</span>}
        {section.elements.map((e) => {
          const placed = (cueCounts.get(e.id) ?? 0) > 0;
          return (
            <button
              key={e.id}
              className={`element-chip ${elementKind(e.type)}${placed ? ' placed' : ''}`}
              disabled={placed}
              aria-label={`${placed ? 'In the script' : 'Add cue'}: ${cueLabel(e)}`}
              title={placed ? 'Already in the script. Drag the chip to move it, or delete it and add it again.' : 'Add this cue where the cursor is'}
              onMouseDown={keepFocus}
              onClick={() => insertCue(editor, e.id)}
            >
              {placed ? '✓ ' : '+ '}
              {cueLabel(e)}
            </button>
          );
        })}
        <button className="element-add" onMouseDown={keepFocus} onClick={(ev) => setMenu(menu ? null : ev.currentTarget)} aria-expanded={Boolean(menu)}>
          + New graphic
        </button>
        {menu && (
          <Popover anchor={menu} onClose={() => setMenu(null)}>
            <GraphicMenu
              label={`New graphic for ${label}`}
              permanent={permanent}
              onPick={(type, name) => {
                setMenu(null);
                const id = addElement(doc, section.id, type, me, name);
                if (id) insertCue(editor, id);
              }}
            />
          </Popover>
        )}
      </div>
      {cameras.length > 0 && (
        <div className="toolbar-row">
          <span className="toolbar-label" title="Put the cursor where the camera should change, then click it. The switcher takes that camera when the prompter reaches it.">
            Cameras
          </span>
          {cameras.map((camera) => (
            <button key={camera} className="element-chip camera" aria-label={`Add camera cue: Take ${camera}`} title="Take this camera here, in the middle of the section" onMouseDown={keepFocus} onClick={() => insertCameraCue(editor, camera)}>
              + {camera}
            </button>
          ))}
        </div>
      )}
      {readers.length > 0 && (
        <div className="toolbar-row">
          <span className="toolbar-label" title="Starts a new part, read by this person">
            Speakers
          </span>
          {readers.map((name) => (
            <button key={name} className="speaker-button" aria-label={`Start ${name}’s part`} onMouseDown={keepFocus} onClick={() => insertSpeaker(name)}>
              {speakerTag(name)}
            </button>
          ))}
        </div>
      )}
      {(doubled.length > 0 || removed > 0) && (
        <p className="toolbar-warning" role="status">
          {doubled.length > 0 && `${doubled.map(cueLabel).join(', ')} ${doubled.length === 1 ? 'is' : 'are'} in the script more than once; the prompter fires the first. `}
          {removed > 0 && `${removed === 1 ? 'A cue points' : `${removed} cues point`} to a graphic removed from the rundown. Delete ${removed === 1 ? 'it' : 'them'}.`}
        </p>
      )}
    </div>
  );
}
