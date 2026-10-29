// The script editor's own pieces: cue chips, which are locked items linked to the section's graphics,
// and speaker tags like {Jordan}, shown in that person's color.
import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
 * A cue chip: where one of the section's graphics fires. It stores only the graphic's id, so renaming
 * the graphic in the rundown renames the chip, and it can't be typed over, only moved or deleted.
 */
export const Cue = Node.create<{ elements: Live<Map<string, Element>> }>({
  name: CUE_NODE,
  group: 'inline',
  inline: true,
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
    return [{ tag: 'span[data-cue]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-cue': '' }, HTMLAttributes)];
  },

  renderText({ node }) {
    const element = this.options.elements.get().get(node.attrs.elementId as string);
    return `[${element ? cueLabel(element) : 'cue'}]`;
  },

  addNodeView() {
    const elements = this.options.elements;
    return ({ node }) => {
      let current = node;
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      const draw = () => {
        const element = elements.get().get(current.attrs.elementId as string);
        dom.className = `cue-chip element-chip ${element ? elementKind(element.type) : 'missing'}`;
        dom.textContent = element ? cueLabel(element) : 'Removed graphic';
        dom.title = element ? 'Cue: fires when the prompter reaches it. Drag to move it.' : 'This graphic was removed from the rundown. Delete this cue.';
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

/** Shows each {Name} in that speaker's color, and flags names that aren't this episode's talent. */
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
