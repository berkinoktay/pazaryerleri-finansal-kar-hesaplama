import { describe, expect, it } from 'vitest';

import {
  AUX_NAV_ITEMS,
  NAV_ENTRIES,
  NAV_ITEMS,
  isNavDivider,
} from '@/components/layout/nav-config';

describe('nav-config', () => {
  it('mevcut tüm primary nav itemlarını içerir', () => {
    const keys = NAV_ITEMS.flatMap((item) => ('key' in item ? [item.key] : []));
    expect(keys).toContain('dashboard');
    expect(keys).toContain('live-performance');
    expect(keys).toContain('orders');
    expect(keys).toContain('products');
    expect(keys).toContain('profitability');
    expect(keys).toContain('reconciliation');
    expect(keys).toContain('expenses');
    expect(keys).toContain('tools');
    expect(keys).toContain('notifications');
    // Settings moved to BottomDock — no longer a primary item.
    expect(keys).not.toContain('settings');
  });

  it('badge alanı opsiyoneldir — eski itemlarda undefined, yeni eklenenler badge taşıyabilir', () => {
    const dashboard = NAV_ITEMS.find((item) => 'key' in item && item.key === 'dashboard');
    expect(dashboard).toBeDefined();
    if (dashboard && 'badge' in dashboard) {
      expect(dashboard.badge).toBeUndefined();
    }

    const livePerformance = NAV_ITEMS.find(
      (item) => 'key' in item && item.key === 'live-performance',
    );
    expect(livePerformance).toBeDefined();
    if (livePerformance && 'badge' in livePerformance) {
      expect(livePerformance.badge).toEqual({ variant: 'new', label: 'Yeni' });
    }
  });

  it('isNavDivider type guard primary itemlar için false döner', () => {
    for (const item of NAV_ITEMS) {
      expect(isNavDivider(item)).toBe(false);
    }
  });

  it('NAV_ENTRIES no longer carries whats-new — it moved to AUX_NAV_ITEMS', () => {
    const keys = NAV_ENTRIES.flatMap((entry) => ('key' in entry ? [entry.key] : []));
    expect(keys).not.toContain('whats-new');
  });

  it('AUX_NAV_ITEMS groups whats-new and support together for the footer shelf', () => {
    const keys = AUX_NAV_ITEMS.map((item) => item.key);
    expect(keys).toEqual(['whats-new', 'support']);
  });
});
