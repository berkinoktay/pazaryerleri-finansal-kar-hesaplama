import { describe, expect, it } from 'vitest';

import { HELP_MENU_ITEMS, NAV_GROUPS } from '@/components/layout/nav-config';

const allItems = NAV_GROUPS.flatMap((group) => group.items);
const keys = allItems.map((item) => item.key);

describe('nav-config', () => {
  it('groups the primary nav into Özet / Operasyon / Finans & Araçlar', () => {
    expect(NAV_GROUPS.map((group) => group.key)).toEqual(['overview', 'operations', 'finance']);
  });

  it('keeps every primary destination, drops Notifications + Settings from the rail', () => {
    expect(keys).toContain('dashboard');
    expect(keys).toContain('live-performance');
    expect(keys).toContain('orders');
    expect(keys).toContain('products');
    expect(keys).toContain('costs');
    expect(keys).toContain('profitability');
    expect(keys).toContain('reconciliation');
    expect(keys).toContain('tools');
    expect(keys).toContain('expenses');
    // Notifications now lives behind the footer bell + /notifications page.
    expect(keys).not.toContain('notifications');
    // Settings lives in the user menu, not the primary rail.
    expect(keys).not.toContain('settings');
  });

  it('only Tools keeps sidebar sub-nav — filter views moved to in-page tabs', () => {
    const withSections = allItems.filter((item) => 'sections' in item && item.sections);
    expect(withSections.map((item) => item.key)).toEqual(['tools']);
  });

  it('carries the expected inline badges', () => {
    const live = allItems.find((item) => item.key === 'live-performance');
    expect(live?.badge).toEqual({ variant: 'new', label: 'Yeni' });

    const profitability = allItems.find((item) => item.key === 'profitability');
    expect(profitability?.badge).toEqual({ variant: 'beta', label: 'Beta' });

    const dashboard = allItems.find((item) => item.key === 'dashboard');
    expect(dashboard?.badge).toBeUndefined();
  });

  it('uses activeMatch so default-sub-route items stay highlighted across their section', () => {
    const profitability = allItems.find((item) => item.key === 'profitability');
    expect(profitability?.activeMatch).toBe('/profitability');

    const tools = allItems.find((item) => item.key === 'tools');
    expect(tools?.activeMatch).toBe('/tools');
  });

  it('groups whats-new + support into the footer Help menu', () => {
    expect(HELP_MENU_ITEMS.map((item) => item.key)).toEqual(['whats-new', 'support']);
  });
});
