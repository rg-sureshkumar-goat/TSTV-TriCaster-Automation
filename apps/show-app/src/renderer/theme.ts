// Light or dark mode for the app (RG, Oct 29, 2026). It's dark, like the control room, until someone flips
// the switch at the top left. The choice is remembered on this laptop.
import { useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'tstv-show-app-theme';

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Puts the remembered choice on the page. Runs before the page first draws, so it never flashes. */
export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = stored();
}

/** The mode the app is showing, and a switch for it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage refused: the choice lasts until the app closes.
    }
    setTheme(next);
  };
  return [theme, choose];
}
