import {
  Building06Icon,
  CreditCardIcon,
  DeliveryTruck01Icon,
  Notification03Icon,
  PercentIcon,
  PreferenceHorizontalIcon,
  SecurityLockIcon,
  Store01Icon,
  UserIcon,
  UserMultipleIcon,
} from 'hugeicons-react';

/**
 * Settings nav — secondary sidebar inside /settings/* routes.
 *
 * Grouped by OWNERSHIP SCOPE, not by theme: "Hesabım" (things about the
 * signed-in user), "Organizasyon" (the tenant / company / team), "Mağaza"
 * (each connected marketplace store). This mirrors the data model
 * (Kullanıcı → Organizasyon → Mağaza) so a user can answer "does this
 * setting affect me, my company, or one store?" at a glance.
 *
 * `status` marks whether a page's primary action is wired to the backend
 * yet. `draft` pages render fully (we ship to production only once
 * everything is done) but carry a developer-only marker — see
 * `components/patterns/feature-status-marker.tsx` — so we can see what is
 * still unfinished. Flip a page to `ready` here the moment its backend lands.
 *
 * Store-scoped pages (Bağlantılar / Kargo / Komisyon) operate on the active
 * store from the dashboard rail's global switcher — settings carries no
 * store picker of its own.
 */

export type SettingsItemStatus = 'ready' | 'draft';

export type SettingsItemLabelKey =
  | 'settings.nav.profile'
  | 'settings.nav.security'
  | 'settings.nav.notifications'
  | 'settings.nav.preferences'
  | 'settings.nav.general'
  | 'settings.nav.members'
  | 'settings.nav.subscription'
  | 'settings.nav.connections'
  | 'settings.nav.shipping'
  | 'settings.nav.commission';

export type SettingsSectionLabelKey =
  | 'settings.nav.sections.account'
  | 'settings.nav.sections.organization'
  | 'settings.nav.sections.store';

export interface SettingsNavItem {
  key: string;
  labelKey: SettingsItemLabelKey;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  status: SettingsItemStatus;
}

export interface SettingsNavSection {
  key: 'account' | 'organization' | 'store';
  labelKey: SettingsSectionLabelKey;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS = [
  {
    key: 'account',
    labelKey: 'settings.nav.sections.account',
    items: [
      {
        key: 'profile',
        labelKey: 'settings.nav.profile',
        href: '/settings/profile',
        icon: UserIcon,
        status: 'draft',
      },
      {
        key: 'security',
        labelKey: 'settings.nav.security',
        href: '/settings/security',
        icon: SecurityLockIcon,
        status: 'draft',
      },
      {
        key: 'notifications',
        labelKey: 'settings.nav.notifications',
        href: '/settings/notifications',
        icon: Notification03Icon,
        status: 'draft',
      },
      {
        key: 'preferences',
        labelKey: 'settings.nav.preferences',
        href: '/settings/preferences',
        icon: PreferenceHorizontalIcon,
        status: 'draft',
      },
    ],
  },
  {
    key: 'organization',
    labelKey: 'settings.nav.sections.organization',
    items: [
      {
        key: 'general',
        labelKey: 'settings.nav.general',
        href: '/settings/organization',
        icon: Building06Icon,
        status: 'draft',
      },
      {
        key: 'members',
        labelKey: 'settings.nav.members',
        href: '/settings/members',
        icon: UserMultipleIcon,
        status: 'ready',
      },
      {
        key: 'subscription',
        labelKey: 'settings.nav.subscription',
        href: '/settings/subscription',
        icon: CreditCardIcon,
        status: 'draft',
      },
    ],
  },
  {
    key: 'store',
    labelKey: 'settings.nav.sections.store',
    items: [
      {
        key: 'connections',
        labelKey: 'settings.nav.connections',
        href: '/settings/stores',
        icon: Store01Icon,
        status: 'draft',
      },
      {
        key: 'shipping',
        labelKey: 'settings.nav.shipping',
        href: '/settings/stores/shipping',
        icon: DeliveryTruck01Icon,
        status: 'ready',
      },
      {
        key: 'commission',
        labelKey: 'settings.nav.commission',
        href: '/settings/stores/commission',
        icon: PercentIcon,
        status: 'draft',
      },
    ],
  },
] as const satisfies readonly SettingsNavSection[];

/**
 * Flat href → status lookup so a page can mark its own header with the
 * same draft marker the nav shows, without re-declaring the status.
 * Store sub-pages carry a `?store` param at runtime, so we match by the
 * pathname prefix the item's href represents.
 */
const STATUS_BY_HREF: ReadonlyMap<string, SettingsItemStatus> = new Map(
  SETTINGS_NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => [item.href, item.status] as const),
  ),
);

export function getSettingsItemStatus(href: string): SettingsItemStatus {
  return STATUS_BY_HREF.get(href) ?? 'ready';
}
