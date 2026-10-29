// A small router: the address bar picks the page, and links change it without reloading.
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Goes to another page. keepScroll stays put on the page, for a window that opens over it, like a script. */
export function navigate(to: string, { replace = false, keepScroll = false } = {}): void {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!keepScroll) window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

export function Link({ to, keepScroll, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; keepScroll?: boolean }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, { keepScroll });
  };
  return <a href={to} onClick={handle} {...rest} />;
}
