import { describe, expect, it } from 'vitest';

import { HELP_MENU_ITEMS, NAV_GROUPS } from '@/components/layout/nav-config';

const allItems = NAV_GROUPS.flatMap((group) => group.items);
const keys = allItems.map((item) => item.key);

describe('nav-config', () => {
  it('groups the primary nav: Özet · Kampanyalar · Operasyon · Finans · Araçlar', () => {
    expect(NAV_GROUPS.map((group) => group.key)).toEqual([
      'overview',
      'campaigns',
      'operations',
      'finance',
      'tools',
    ]);
  });

  it('keeps every primary destination, drops Notifications + Settings from the rail', () => {
    expect(keys).toContain('dashboard');
    expect(keys).toContain('live-performance');
    expect(keys).toContain('orders');
    expect(keys).toContain('products');
    expect(keys).toContain('costs');
    expect(keys).toContain('profitability');
    expect(keys).toContain('reconciliation');
    // Tools is now its own group; its destinations are the individual tools.
    expect(NAV_GROUPS.map((group) => group.key)).toContain('tools');
    expect(keys).toContain('commission-rates');
    expect(keys).toContain('expenses');
    // Notifications now lives behind the footer bell + /notifications page.
    expect(keys).not.toContain('notifications');
    // Settings lives in the user menu, not the primary rail.
    expect(keys).not.toContain('settings');
  });

  it('has no sidebar sub-nav — every destination is flat (filter views are in-page tabs)', () => {
    const withSections = allItems.filter((item) => 'sections' in item && item.sections);
    expect(withSections).toEqual([]);
  });

  it('carries the expected inline badges', () => {
    const live = allItems.find((item) => item.key === 'live-performance');
    expect(live?.badge).toEqual({ variant: 'new', label: 'Yeni' });

    const profitability = allItems.find((item) => item.key === 'profitability');
    expect(profitability?.badge).toEqual({ variant: 'beta', label: 'Beta' });

    const dashboard = allItems.find((item) => item.key === 'dashboard');
    expect(dashboard?.badge).toBeUndefined();
  });

  it('uses activeMatch so a default-sub-route item stays highlighted across its section', () => {
    const profitability = allItems.find((item) => item.key === 'profitability');
    expect(profitability?.activeMatch).toBe('/profitability');
  });

  it('groups whats-new + support into the footer Help menu', () => {
    expect(HELP_MENU_ITEMS.map((item) => item.key)).toEqual(['whats-new', 'support']);
  });
});
