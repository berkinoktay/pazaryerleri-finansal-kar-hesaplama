import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearTabBadge,
  resetTabBadgeForTesting,
  setTabBadge,
} from '@/features/live-performance/lib/tab-badge';

const BASE_TITLE = 'PazarSync';

// happy-dom exposes a read/write document.title; restore it around every test so
// one case's label never bleeds into the next. The module-level baseTitle is reset
// too, so a captured base from one test can't leak into another.
beforeEach(() => {
  document.title = BASE_TITLE;
  resetTabBadgeForTesting();
});
afterEach(() => {
  document.title = BASE_TITLE;
  resetTabBadgeForTesting();
});

describe('tab-badge', () => {
  it('prepends the label to the captured base title', () => {
    setTabBadge('🛍️ Yeni sipariş geldi!');
    expect(document.title).toBe(`🛍️ Yeni sipariş geldi! · ${BASE_TITLE}`);
  });

  it('re-prepends onto the same base instead of stacking labels', () => {
    setTabBadge('🛍️ Yeni sipariş geldi!');
    setTabBadge('🛍️ 2 yeni sipariş geldi!');
    expect(document.title).toBe(`🛍️ 2 yeni sipariş geldi! · ${BASE_TITLE}`);
  });

  it('restores the bare base title on clear', () => {
    setTabBadge('🛍️ Yeni sipariş geldi!');
    clearTabBadge();
    expect(document.title).toBe(BASE_TITLE);
  });

  it('is a no-op when clearing with no active badge', () => {
    clearTabBadge();
    expect(document.title).toBe(BASE_TITLE);
  });

  it('captures a fresh base after a clear, so set/clear round-trips cleanly', () => {
    setTabBadge('🛍️ Yeni sipariş geldi!');
    clearTabBadge();
    document.title = 'Canlı Performans · PazarSync';
    setTabBadge('🛍️ 3 yeni sipariş geldi!');
    expect(document.title).toBe('🛍️ 3 yeni sipariş geldi! · Canlı Performans · PazarSync');
    clearTabBadge();
    expect(document.title).toBe('Canlı Performans · PazarSync');
  });
});
