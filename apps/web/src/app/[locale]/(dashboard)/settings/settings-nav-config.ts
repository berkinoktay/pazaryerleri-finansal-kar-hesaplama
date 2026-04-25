/**
 * Settings nav — secondary sidebar inside /settings/* routes.
 *
 * Settings lives at the bottom dock of the main shell (a single leaf
 * link to /settings); the actual sub-page navigation happens inside
 * Settings via this config + the (settings)/layout.tsx 200px aside.
 * Keeps the main nav uncluttered and matches the Linear / Tiyasis
 * convention for admin-flavored sub-routes.
 */

export type SettingsItemLabelKey =
  | 'settings.nav.profile'
  | 'settings.nav.team'
  | 'settings.nav.billing'
  | 'settings.nav.stores'
  | 'settings.nav.notifications';

export type SettingsSectionLabelKey =
  | 'settings.nav.sections.account'
  | 'settings.nav.sections.connections';

export interface SettingsNavItem {
  key: string;
  labelKey: SettingsItemLabelKey;
  href: string;
}

export interface SettingsNavSection {
  key: string;
  labelKey: SettingsSectionLabelKey;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    key: 'account',
    labelKey: 'settings.nav.sections.account',
    items: [
      { key: 'profile', labelKey: 'settings.nav.profile', href: '/settings/profile' },
      { key: 'team', labelKey: 'settings.nav.team', href: '/settings/team' },
      { key: 'billing', labelKey: 'settings.nav.billing', href: '/settings/billing' },
    ],
  },
  {
    key: 'connections',
    labelKey: 'settings.nav.sections.connections',
    items: [
      { key: 'stores', labelKey: 'settings.nav.stores', href: '/settings/stores' },
      {
        key: 'notifications',
        labelKey: 'settings.nav.notifications',
        href: '/settings/notifications',
      },
    ],
  },
] as const satisfies readonly SettingsNavSection[];
