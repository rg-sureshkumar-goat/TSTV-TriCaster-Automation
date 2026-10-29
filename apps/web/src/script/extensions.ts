// The script editor's own pieces: cue chips, which are locked lines linked to the section's graphics,
// speaker tags like {JORDAN}, shown in that person's color, and typing in capital letters.
import { Extension, mergeAttributes, Node, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { CUE_NODE, cueLabel, elementKind, SPEAKER_TAG, type Element } from '@tstv/shared';

/** A value the editor reads that can change while it's open, like the episode's graphics. */
export interface Live<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function live<T>(initial: T): Live<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A cue chip: where one of the section's graphics fires. Each sits on a line of its own (RG, Oct 29, 2026).
 * It stores only the graphic's id, so renaming the graphic in the rundown renames the chip, and it can't be
 * typed over, only moved or deleted.
 */
export const Cue = Node.create<{ elements: Live<Map<string, Element>> }>({
  name: CUE_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { elements: live(new Map<string, Element>()) };
  },

  addAttributes() {
    return {
      elementId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-element-id'),
        renderHTML: (attrs) => ({ 'data-element-id': attrs.elementId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-cue]' }, { tag: 'span[data-cue]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-cue': '' }, HTMLAttributes)];
  },

  renderText({ node }) {
    const element = this.options.elements.get().get(node.attrs.elementId as string);
    return `[${element ? cueLabel(element) : 'cue'}]`;
  },

  addNodeView() {
    const elements = this.options.elements;
    return ({ node }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'cue-line';
      dom.contentEditable = 'false';
      const chip = dom.appendChild(document.createElement('span'));
      const draw = () => {
        const element = elements.get().get(current.attrs.elementId as string);
        chip.className = `cue-chip element-chip ${element ? elementKind(element.type) : 'missing'}`;
        chip.textContent = element ? cueLabel(element) : 'Removed graphic';
        chip.title = element ? 'Cue: fires when the prompter reaches it. Drag to move it.' : 'This graphic was removed from the rundown. Delete this cue.';
      };
      draw();
      const unsubscribe = elements.subscribe(draw);
      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          draw();
          return true;
        },
        destroy: unsubscribe,
      };
    };
  },
});

/**
 * Puts a cue chip on a line of its own where the cursor is. A line the cursor is in the middle of is split
 * around it, and the cursor ends up on the line below, ready to keep typing.
 */
export function insertCue(editor: Editor, elementId: string): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const cue = tr.doc.type.schema.nodes[CUE_NODE].create({ elementId });
      if (tr.selection instanceof NodeSelection) {
        // A chip is selected: the new one goes on the line below it.
        const below = tr.selection.to;
        tr.insert(below, cue).setSelection(NodeSelection.create(tr.doc, below));
        return true;
      }
      const { $from } = tr.selection;
      if (!$from.parent.isTextblock) tr.insert($from.pos, cue);
      else if ($from.parentOffset === 0) tr.insert($from.before(), cue);
      else tr.split($from.pos).insert($from.pos + 1, cue);
      return true;
    })
    .scrollIntoView()
    .run();
}

/** Text with every letter in capitals. */
function capitalized(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => nodes.push(node.isText ? node.type.schema.text(node.text!.toUpperCase(), node.marks) : node.copy(capitalized(node.content))));
  return Fragment.fromArray(nodes);
}

/** Puts the line the cursor is on in capitals, for letters typed with an accent key (like é). */
function capitalizeLine(view: EditorView): void {
  if (view.isDestroyed || view.composing) return;
  const { $from } = view.state.selection;
  if (!$from.parent.isTextblock) return;
  const tr = view.state.tr;
  const fixes: [number, number, string][] = [];
  $from.parent.forEach((child, offset) => {
    if (child.isText && child.text !== child.text!.toUpperCase()) fixes.push([$from.start() + offset, $from.start() + offset + child.nodeSize, child.text!.toUpperCase()]);
  });
  for (const [from, to, text] of fixes.reverse()) tr.insertText(text, from, to);
  if (tr.docChanged) view.dispatch(tr);
}

/**
 * Scripts are written in capital letters (RG, Oct 29, 2026), whether or not Caps Lock is on. Typing,
 * pasting, dropping text and spell-check fixes all come out in capitals.
 */
export const Capitals = Extension.create({
  name: 'capitals',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('capitals'),
        props: {
          handleTextInput(view, from, to, text) {
            if (view.composing || text === text.toUpperCase()) return false;
            view.dispatch(view.state.tr.insertText(text.toUpperCase(), from, to));
            return true;
          },
          transformPasted: (slice) => new Slice(capitalized(slice.content), slice.openStart, slice.openEnd),
          handleDOMEvents: {
            // A letter typed with an accent key arrives only once it's finished.
            compositionend: (view) => {
              setTimeout(() => capitalizeLine(view));
              return false;
            },
          },
        },
        // Anything else typed here, like a spell-check fix, is put in capitals as it happens. Other people's
        // changes are left alone: their own editor already did it.
        appendTransaction(transactions, _before, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta(ySyncPluginKey) || tr.getMeta('composition'))) return null;
          // Where the text changed, in the new document.
          let changed: [number, number][] = [];
          for (const tr of transactions) {
            for (const map of tr.mapping.maps) {
              changed = changed.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
              map.forEach((_oldFrom, _oldTo, from, to) => changed.push([from, to]));
            }
          }
          const merged: [number, number][] = [];
          for (const [from, to] of changed.sort((a, b) => a[0] - b[0])) {
            const last = merged[merged.length - 1];
            if (last && from <= last[1]) last[1] = Math.max(last[1], to);
            else merged.push([from, to]);
          }
          const fixes: [number, number, string][] = [];
          for (const [from, to] of merged) {
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (!node.isText) return;
              const start = Math.max(from, pos);
              const end = Math.min(to, pos + node.nodeSize);
              const text = node.text!.slice(start - pos, end - pos);
              if (text !== text.toUpperCase()) fixes.push([start, end, text.toUpperCase()]);
            });
          }
          if (fixes.length === 0) return null;
          const tr = state.tr;
          for (const [from, to, text] of fixes.sort((a, b) => b[0] - a[0])) tr.insertText(text, from, to);
          return tr;
        },
      }),
    ];
  },
});

/** Shows each {NAME} in that speaker's color, and flags names that aren't this episode's talent. */
export const SpeakerTags = Extension.create<{ speakers: Live<Map<string, string | undefined>> }>({
  name: 'speakerTags',

  addOptions() {
    return { speakers: live(new Map<string, string | undefined>()) };
  },

  addProseMirrorPlugins() {
    const speakers = this.options.speakers;
    return [
      new Plugin({
        key: new PluginKey('speakerTags'),
        props: {
          decorations(state) {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(SPEAKER_TAG)) {
                const name = match[1].trim();
                const key = name.toLowerCase();
                const known = speakers.get().has(key);
                const color = speakers.get().get(key);
                const from = pos + (match.index ?? 0);
                found.push(
                  Decoration.inline(from, from + match[0].length, {
                    class: known ? 'speaker-tag' : 'speaker-tag unknown',
                    style: color ? `--speaker: ${color}` : '',
                    title: known ? `${name} reads from here` : `${name} isn’t one of this episode’s anchors or correspondents`,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, found);
          },
        },
      }),
    ];
  },
});
