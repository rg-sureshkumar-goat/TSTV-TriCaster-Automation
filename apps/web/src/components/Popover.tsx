// A small box that opens next to a button and floats above everything, so it's never cut off by the
// rundown table's scrolling. Closes on Escape or a click elsewhere. Inside a window, like the script
// window, it floats in that window, and Escape closes just the box.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Popover({ anchor, onClose, align = 'left', children }: { anchor: HTMLElement | null; onClose: () => void; align?: 'left' | 'right'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const width = ref.current?.offsetWidth ?? 240;
      const height = ref.current?.offsetHeight ?? 200;
      const left = Math.max(8, Math.min(align === 'right' ? r.right - width : r.left, window.innerWidth - width - 8));
      const below = r.bottom + 4;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
      setPosition({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Stops a window this box is in from closing too.
      e.preventDefault();
      onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} className="popover" style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}>
      {children}
    </div>,
    anchor?.closest('dialog') ?? document.body,
  );
}
