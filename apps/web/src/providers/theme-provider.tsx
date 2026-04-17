'use client';

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'pazarsync.theme';
const DEFAULT_THEME: Theme = 'light';
const FALLBACK_RESOLVED: ResolvedTheme = 'light';

export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveSystem(): ResolvedTheme {
  if (typeof window === 'undefined') return FALLBACK_RESOLVED;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? resolveSystem() : theme;
}

function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

// Inline FOUC-prevention script. Content is a compile-time constant (no user
// input reaches this string), so `dangerouslySetInnerHTML` is safe here — the
// standard Next.js pattern for setting the theme class before hydration.
const FOUC_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'${DEFAULT_THEME}';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.classList.toggle('dark',r==='dark');document.documentElement.style.colorScheme=r;}catch(e){}})();`;

export function ThemeScript(): React.ReactElement {
  return <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />;
}

/**
 * External store holding the current theme. We drive `useSyncExternalStore`
 * with it so React stays in sync with localStorage + system-preference
 * changes without the useEffect/setState anti-pattern React 19 now flags.
 */
const themeStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    themeStore.listeners.add(listener);
    const media =
      typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    media?.addEventListener('change', listener);
    return () => {
      themeStore.listeners.delete(listener);
      media?.removeEventListener('change', listener);
    };
  },
  getSnapshot(): Theme {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? DEFAULT_THEME;
  },
  getServerSnapshot(): Theme {
    return DEFAULT_THEME;
  },
  setTheme(next: Theme): void {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(resolveTheme(next));
    themeStore.listeners.forEach((listener) => listener());
  },
};

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );
  const resolvedTheme = typeof window === 'undefined' ? FALLBACK_RESOLVED : resolveTheme(theme);

  const setTheme = useCallback((next: Theme) => {
    themeStore.setTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
