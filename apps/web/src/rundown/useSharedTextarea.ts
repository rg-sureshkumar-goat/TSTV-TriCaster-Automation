// Connects a plain text box to a shared script. Your typing goes to everyone; their typing appears in
// your box without moving your cursor, and nobody's words are overwritten.
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

const LOCAL = Symbol('this text box');

export function useSharedTextarea(text: Y.Text | undefined, onLocalEdit: () => void) {
  // The box is tracked as state, so it connects whenever it appears, even if the script arrived first.
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState('');
  const editRef = useRef(onLocalEdit);
  editRef.current = onLocalEdit;

  useEffect(() => {
    if (!text || !box) return;
    let last = text.toString();
    box.value = last;
    setValue(last);

    // Turn what changed in the box into the smallest edit to the shared text.
    const onInput = () => {
      const next = box.value;
      let start = 0;
      while (start < last.length && start < next.length && last[start] === next[start]) start++;
      let endLast = last.length;
      let endNext = next.length;
      while (endLast > start && endNext > start && last[endLast - 1] === next[endNext - 1]) {
        endLast--;
        endNext--;
      }
      text.doc?.transact(() => {
        if (endLast > start) text.delete(start, endLast - start);
        if (endNext > start) text.insert(start, next.slice(start, endNext));
      }, LOCAL);
      last = next;
      setValue(next);
      editRef.current();
    };

    // Someone else typed: update the box and shift your cursor past their changes.
    const onRemote = (event: Y.YTextEvent) => {
      if (event.transaction.origin === LOCAL) return;
      let selStart = box.selectionStart;
      let selEnd = box.selectionEnd;
      let index = 0;
      for (const op of event.delta) {
        if (op.retain) {
          index += op.retain;
        } else if (typeof op.insert === 'string') {
          const n = op.insert.length;
          if (index < selStart) selStart += n;
          if (index < selEnd) selEnd += n;
          index += n;
        } else if (op.delete) {
          const n = op.delete;
          if (index < selStart) selStart -= Math.min(n, selStart - index);
          if (index < selEnd) selEnd -= Math.min(n, selEnd - index);
        }
      }
      last = text.toString();
      box.value = last;
      setValue(last);
      if (document.activeElement === box) box.setSelectionRange(selStart, selEnd);
    };

    box.addEventListener('input', onInput);
    text.observe(onRemote);
    return () => {
      box.removeEventListener('input', onInput);
      text.unobserve(onRemote);
    };
  }, [text, box]);

  return { ref: setBox, value };
}
