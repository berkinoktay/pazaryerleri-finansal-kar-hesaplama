import { describe, expect, it } from 'vitest';

import { filterNavGroupsByPlatform, NAV_GROUPS } from '@/components/layout/nav-config';

describe('nav config', () => {
  it('exposes the expected top-level groups in order (campaigns high, right below overview)', () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual([
      'overview',
      'campaigns',
      'operations',
      'finance',
      'tools',
    ]);
  });

  it('restricts the campaigns group to Trendyol and leaves others unrestricted', () => {
    const campaigns = NAV_GROUPS.find((g) => g.key === 'campaigns');
    expect(campaigns?.platforms).toEqual(['TRENDYOL']);
    const restricted = NAV_GROUPS.filter((g) => g.platforms !== undefined);
    expect(restricted.map((g) => g.key)).toEqual(['campaigns']);
  });
});

describe('filterNavGroupsByPlatform', () => {
  it('shows platform-restricted groups when the active platform matches', () => {
    const visible = filterNavGroupsByPlatform(NAV_GROUPS, 'TRENDYOL');
    expect(visible.some((g) => g.key === 'campaigns')).toBe(true);
  });

  it('hides platform-restricted groups when the active platform does not match', () => {
    const visible = filterNavGroupsByPlatform(NAV_GROUPS, 'HEPSIBURADA');
    expect(visible.some((g) => g.key === 'campaigns')).toBe(false);
  });

  it('hides platform-restricted groups when there is no active store (null)', () => {
    const visible = filterNavGroupsByPlatform(NAV_GROUPS, null);
    expect(visible.some((g) => g.key === 'campaigns')).toBe(false);
  });

  it('always keeps groups without a platforms restriction, for every platform', () => {
    for (const platform of ['TRENDYOL', 'HEPSIBURADA', null] as const) {
      const visible = filterNavGroupsByPlatform(NAV_GROUPS, platform);
      const keys = visible.map((g) => g.key);
      expect(keys).toContain('overview');
      expect(keys).toContain('operations');
      expect(keys).toContain('finance');
      expect(keys).toContain('tools');
    }
  });
});
