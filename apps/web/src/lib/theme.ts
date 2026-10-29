// Light or dark mode for the whole website (RG, Oct 29, 2026). Until someone flips the switch, the
// website follows the computer's own setting. The choice is remembered in this browser only.
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'tstv-theme';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Puts the remembered choice on the page. Runs before the page first draws, so it never flashes. */
export function applyStoredTheme(): void {
  const theme = stored();
  if (theme) document.documentElement.dataset.theme = theme;
}

/** The mode the website is showing, and a switch for it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? systemTheme());
  useEffect(() => {
    // Follow the computer's setting while nobody has picked one here.
    const media = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => !stored() && setTheme(systemTheme());
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);
  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing: the choice lasts until the page closes.
    }
    setTheme(next);
  };
  return [theme, choose];
}
