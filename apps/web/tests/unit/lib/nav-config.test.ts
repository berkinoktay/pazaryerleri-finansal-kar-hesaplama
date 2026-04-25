import { describe, expect, it } from 'vitest';

import { NAV_ITEMS, isNavDivider } from '@/components/layout/nav-config';

describe('nav-config', () => {
  it('mevcut tüm primary nav itemlarını içerir', () => {
    const keys = NAV_ITEMS.flatMap((item) => ('key' in item ? [item.key] : []));
    expect(keys).toContain('dashboard');
    expect(keys).toContain('orders');
    expect(keys).toContain('products');
    expect(keys).toContain('profitability');
    expect(keys).toContain('reconciliation');
    expect(keys).toContain('expenses');
    expect(keys).toContain('settings');
  });

  it('badge alanı opsiyoneldir — eski itemlarda undefined', () => {
    const dashboard = NAV_ITEMS.find((item) => 'key' in item && item.key === 'dashboard');
    expect(dashboard).toBeDefined();
    if (dashboard && 'badge' in dashboard) {
      expect(dashboard.badge).toBeUndefined();
    }
  });

  it('isNavDivider type guard correctly distinguishes dividers', () => {
    // Existing items are NOT dividers
    for (const item of NAV_ITEMS) {
      expect(isNavDivider(item)).toBe(false);
    }
  });
});
