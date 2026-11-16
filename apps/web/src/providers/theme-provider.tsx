'use client';

import { useServerInsertedHTML } from 'next/navigation';
import * as React from 'react';

/**
 * The app's light / dark theme. The preference ('light', 'dark' or 'system') is kept
 * in localStorage and applied as a `light` / `dark` class plus `color-scheme` on
 * `<html>`, which is what the `dark:` variant and the dark tokens read.
 *
 * The pre-paint script that applies the stored preference before hydration goes
 * through `useServerInsertedHTML`: Next writes it into the server HTML (`<head>`) and
 * it never becomes part of the React tree. next-themes rendered it as a `<script>`
 * element inside its provider, and React 19 warns about every `<script>` it creates
 * on the client ("Encountered a script tag while rendering React component").
 *
 * `theme` and `resolvedTheme` are `undefined` on the server and in the hydration
 * render, and the stored values right after it, so reading them never makes the
 * hydration render differ from the server HTML.
 */

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const RESOLVED_THEMES = ['light', 'dark'] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

/** The localStorage key. Kept from next-themes, so preferences stored before survive. */
export const THEME_STORAGE_KEY = 'pazarsync.theme';
const DEFAULT_PREFERENCE: ThemePreference = 'system';
const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';
const NO_TRANSITIONS_CSS = '*,*::before,*::after{transition:none!important}';
/** Long enough for the browser to paint the theme change before transitions return. */
const TRANSITIONS_RESTORE_DELAY_MS = 1;

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

/**
 * Runs in `<head>` before the first paint and does what `applyTheme` does for the
 * stored preference. Built only from the constants above (JSON-encoded), never from
 * request or user data. Any failure (storage blocked, no matchMedia) leaves the
 * server markup as it is.
 */
export const THEME_INIT_SCRIPT = [
  '(function(){try{',
  `var d=document.documentElement,p=${JSON.stringify(DEFAULT_PREFERENCE)},s=null;`,
  `try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}`,
  `if(${JSON.stringify(THEME_PREFERENCES)}.indexOf(s)>=0)p=s;`,
  `var r=p===${JSON.stringify(DEFAULT_PREFERENCE)}?(matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)}).matches?"dark":"light"):p;`,
  `d.classList.remove.apply(d.classList,${JSON.stringify(RESOLVED_THEMES)});`,
  'd.classList.add(r);d.style.colorScheme=r',
  '}catch(e){}})()',
].join('');

function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove(...RESOLVED_THEMES);
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/** True when `<html>` already shows the theme: after the pre-paint script, on hydration. */
function isThemeApplied(theme: ResolvedTheme): boolean {
  const root = document.documentElement;
  return (
    root.style.colorScheme === theme &&
    RESOLVED_THEMES.every(
      (candidate) => root.classList.contains(candidate) === (candidate === theme),
    )
  );
}

/** Applies a theme change at once, without every transitioned color animating to it. */
function applyThemeWithoutTransitions(theme: ResolvedTheme): void {
  if (isThemeApplied(theme)) return;
  const style = document.createElement('style');
  style.appendChild(document.createTextNode(NO_TRANSITIONS_CSS));
  document.head.appendChild(style);
  applyTheme(theme);
  // Reading a computed value flushes styles, so the change lands while transitions are off.
  window.getComputedStyle(document.body).getPropertyValue('color');
  window.setTimeout(() => style.remove(), TRANSITIONS_RESTORE_DELAY_MS);
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    // Storage is blocked (private mode, disabled cookies): the default applies.
    return DEFAULT_PREFERENCE;
  }
}

interface PreferenceStore {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => ThemePreference;
  readonly set: (preference: ThemePreference) => void;
}

/**
 * The stored preference as an external store: read once from localStorage, changed
 * by `set` and by a write in another tab (the `storage` event, after which it reads
 * localStorage again: a sessionStorage event under the same key changes nothing).
 */
function createPreferenceStore(): PreferenceStore {
  let current: ThemePreference | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const onStorage = (event: StorageEvent): void => {
    // A null key is `clear()` in the other document.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = readStoredPreference();
    if (next === current) return;
    current = next;
    notify();
  };

  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      if (listeners.size === 1) window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot: () => {
      current ??= readStoredPreference();
      return current;
    },
    set: (preference) => {
      current = preference;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
      } catch {
        // Storage is blocked: the choice still applies in this tab until it reloads.
      }
      notify();
    },
  };
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = matchMedia(DARK_SCHEME_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSystemTheme(): ResolvedTheme {
  return matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function getServerSnapshot(): undefined {
  return undefined;
}

export interface ThemeContextValue {
  /** The seller's preference; `undefined` on the server and in the hydration render. */
  readonly theme: ThemePreference | undefined;
  /** The theme in effect ('system' resolved); `undefined` on the server and in the hydration render. */
  readonly resolvedTheme: ResolvedTheme | undefined;
  readonly setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [store] = React.useState(createPreferenceStore);
  const theme = React.useSyncExternalStore<ThemePreference | undefined>(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot,
  );
  const systemTheme = React.useSyncExternalStore<ResolvedTheme | undefined>(
    subscribeToSystemTheme,
    getSystemTheme,
    getServerSnapshot,
  );
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  // Next calls every inserted-HTML callback on each flush of the stream; the script
  // goes out with the first one only. A provider instance rendered again on the server
  // would send it once more, later in the stream: harmless, it applies the same theme.
  const scriptInserted = React.useRef(false);
  useServerInsertedHTML(() => {
    if (scriptInserted.current) return null;
    scriptInserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
  });

  React.useEffect(() => {
    if (resolvedTheme === undefined) return;
    applyThemeWithoutTransitions(resolvedTheme);
  }, [resolvedTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme: store.set }),
    [theme, resolvedTheme, store],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
