import { describe, expect, it } from 'vitest';

import {
  getSettingsItemStatus,
  SETTINGS_NAV_SECTIONS,
} from '@/app/[locale]/(dashboard)/settings/settings-nav-config';

describe('settings nav config', () => {
  it('groups settings by the three ownership scopes', () => {
    expect(SETTINGS_NAV_SECTIONS.map((s) => s.key)).toEqual(['account', 'organization', 'store']);
  });

  it('returns the configured status for known hrefs', () => {
    expect(getSettingsItemStatus('/settings/members')).toBe('ready');
    expect(getSettingsItemStatus('/settings/stores/shipping')).toBe('ready');
    expect(getSettingsItemStatus('/settings/profile')).toBe('draft');
    expect(getSettingsItemStatus('/settings/subscription')).toBe('draft');
  });

  it('defaults unknown hrefs to ready (no stray draft marker)', () => {
    expect(getSettingsItemStatus('/settings/does-not-exist')).toBe('ready');
  });
});
