import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearTabBadge, setTabBadgeCount } from '@/features/live-performance/lib/tab-badge';

const BASE_TITLE = 'PazarSync';

// happy-dom exposes a read/write document.title; restore it around every test so
// one case's prefix never bleeds into the next.
beforeEach(() => {
  document.title = BASE_TITLE;
});
afterEach(() => {
  document.title = BASE_TITLE;
});

describe('tab-badge', () => {
  it('prefixes the title with the unread count', () => {
    setTabBadgeCount(3);
    expect(document.title).toBe(`(3) ${BASE_TITLE}`);
  });

  it('replaces an existing prefix instead of stacking it', () => {
    setTabBadgeCount(3);
    setTabBadgeCount(5);
    expect(document.title).toBe(`(5) ${BASE_TITLE}`);
  });

  it('clears the prefix back to the bare title', () => {
    setTabBadgeCount(4);
    clearTabBadge();
    expect(document.title).toBe(BASE_TITLE);
  });

  it('treats a count of zero as a clear (no "(0) " prefix)', () => {
    setTabBadgeCount(2);
    setTabBadgeCount(0);
    expect(document.title).toBe(BASE_TITLE);
  });

  it('is a no-op when clearing a title that has no prefix', () => {
    clearTabBadge();
    expect(document.title).toBe(BASE_TITLE);
  });
});
