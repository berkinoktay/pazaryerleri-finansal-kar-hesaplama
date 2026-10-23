'use client';

import * as React from 'react';

/**
 * `value` once it has stopped changing for `delayMs` — the settled value of a typed input. Every
 * change restarts the wait, so a burst of keystrokes surfaces only its last value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      clearTimeout(handle);
    };
  }, [value, delayMs]);

  return debounced;
}
