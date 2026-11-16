import { act, renderHook } from '@testing-library/react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from '@/providers/theme-provider';

import { render, screen } from '../helpers/render';

// What the provider hands to Next for the server HTML: Next's own hook is a no-op
// outside its render pipeline, so the test collects the callbacks instead.
const { insertedHtml } = vi.hoisted(() => {
  const callbacks: Array<() => React.ReactNode> = [];
  return { insertedHtml: callbacks };
});

vi.mock('next/navigation', () => ({
  useServerInsertedHTML: (callback: () => React.ReactNode): void => {
    insertedHtml.push(callback);
  },
}));

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => store.clear(),
  });
  return store;
}

function stubBlockedStorage(): void {
  const blocked = (): never => {
    throw new Error('SecurityError: storage is disabled');
  };
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
}

/** A `prefers-color-scheme: dark` query whose answer the test can flip. */
function stubColorScheme(dark: boolean): { setDark: (next: boolean) => void } {
  let matches = dark;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches(): boolean {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void): void => {
      listeners.delete(listener);
    },
  }));
  return {
    setDark: (next) => {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

function ThemeProbe(): React.ReactElement {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <p>{`theme:${theme ?? 'none'}`}</p>
      <p>{`resolved:${resolvedTheme ?? 'none'}`}</p>
      <button type="button" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        system
      </button>
    </div>
  );
}

function renderProvider(): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

const root = document.documentElement;

function runInitScript(): void {
  // The script is a plain string built from constants (it runs in <head> before React);
  // run it as the browser would.
  new Function(THEME_INIT_SCRIPT)();
}

beforeEach(() => {
  insertedHtml.length = 0;
  root.className = '';
  root.style.colorScheme = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('renders no script element on the client and hands the pre-paint script to the server HTML once', () => {
    stubStorage();
    stubColorScheme(false);

    const { container } = renderProvider();

    // The React that Next bundles warns about every <script> element created on the
    // client ("Encountered a script tag while rendering React component"); the React
    // these tests run does not, so the guard is that the client tree holds none.
    expect(container.querySelector('script')).toBeNull();
    const latest = insertedHtml.at(-1);
    if (latest === undefined) throw new Error('the provider registered no inserted HTML');
    expect(renderToStaticMarkup(<>{latest()}</>)).toBe(`<script>${THEME_INIT_SCRIPT}</script>`);
    // Next calls every callback again on each later flush of the stream.
    expect(latest()).toBeNull();
  });

  it('applies the stored preference after mount', () => {
    stubStorage({ [THEME_STORAGE_KEY]: 'dark' });
    stubColorScheme(false);

    renderProvider();

    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(screen.getByText('resolved:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
  });

  it('stores a new preference and applies it', async () => {
    const store = stubStorage();
    stubColorScheme(false);
    const { user } = renderProvider();
    expect(screen.getByText('theme:system')).toBeInTheDocument();
    expect(root.classList.contains('light')).toBe(true);
    const appendToHead = vi.spyOn(document.head, 'appendChild');

    await user.click(screen.getByRole('button', { name: 'dark' }));

    // The change lands with transitions blocked for a moment.
    expect(
      appendToHead.mock.calls.some(
        ([node]) =>
          node instanceof HTMLStyleElement && node.textContent.includes('transition:none'),
      ),
    ).toBe(true);
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    expect(root.style.colorScheme).toBe('dark');
  });

  it('follows the operating system while the preference is system', () => {
    stubStorage({ [THEME_STORAGE_KEY]: 'system' });
    const scheme = stubColorScheme(false);
    renderProvider();
    expect(screen.getByText('resolved:light')).toBeInTheDocument();

    act(() => scheme.setDark(true));

    expect(screen.getByText('resolved:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('applies a preference written in another tab, and the default for an unknown one', () => {
    const store = stubStorage();
    stubColorScheme(false);
    renderProvider();

    // The other tab writes localStorage, then this tab gets the event.
    store.set(THEME_STORAGE_KEY, 'dark');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }),
      );
    });
    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);

    store.set(THEME_STORAGE_KEY, 'sepia');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'sepia' }),
      );
    });
    expect(screen.getByText('theme:system')).toBeInTheDocument();
    expect(root.classList.contains('light')).toBe(true);
  });

  it('keeps the stored preference when the event did not change localStorage (a sessionStorage clear)', () => {
    stubStorage({ [THEME_STORAGE_KEY]: 'dark' });
    stubColorScheme(false);
    renderProvider();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    });

    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('answers undefined on the server, so the hydration render matches the server HTML', () => {
    stubStorage({ [THEME_STORAGE_KEY]: 'dark' });
    stubColorScheme(true);

    const html = renderToString(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(html).toContain('theme:none');
    expect(html).toContain('resolved:none');
  });

  it('leaves <html> alone when the pre-paint script already applied the theme', () => {
    stubStorage({ [THEME_STORAGE_KEY]: 'dark' });
    stubColorScheme(false);
    runInitScript();
    const appendToHead = vi.spyOn(document.head, 'appendChild');

    renderProvider();

    const transitionBlocks = appendToHead.mock.calls.filter(
      ([node]) => node instanceof HTMLStyleElement && node.textContent.includes('transition:none'),
    );
    expect(root.classList.contains('dark')).toBe(true);
    expect(transitionBlocks).toHaveLength(0);
  });

  it('keeps a choice for the tab when storage is blocked', async () => {
    stubBlockedStorage();
    stubColorScheme(false);
    const { user } = renderProvider();
    expect(screen.getByText('theme:system')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'dark' }));

    expect(screen.getByText('theme:dark')).toBeInTheDocument();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('throws when useTheme is read outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useTheme())).toThrow(
      'useTheme must be used inside ThemeProvider',
    );
  });
});

describe('THEME_INIT_SCRIPT', () => {
  it.each([
    { stored: 'dark', osDark: false, expected: 'dark' },
    { stored: 'light', osDark: true, expected: 'light' },
    { stored: 'system', osDark: true, expected: 'dark' },
    { stored: 'sepia', osDark: false, expected: 'light' },
    { stored: null, osDark: true, expected: 'dark' },
  ])('stored $stored with a dark OS $osDark applies $expected', ({ stored, osDark, expected }) => {
    stubStorage(stored === null ? {} : { [THEME_STORAGE_KEY]: stored });
    stubColorScheme(osDark);
    root.classList.add(expected === 'dark' ? 'light' : 'dark');

    runInitScript();

    expect(root.classList.contains(expected)).toBe(true);
    expect(root.classList.contains(expected === 'dark' ? 'light' : 'dark')).toBe(false);
    expect(root.style.colorScheme).toBe(expected);
  });

  it('falls back to the operating system when storage is blocked', () => {
    stubBlockedStorage();
    stubColorScheme(true);

    runInitScript();

    expect(root.classList.contains('dark')).toBe(true);
  });
});
