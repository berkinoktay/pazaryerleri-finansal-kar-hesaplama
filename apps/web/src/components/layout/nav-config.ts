import {
  Activity03Icon,
  Calculator01Icon,
  ChartLineData01Icon,
  DashboardSquare02Icon,
  HelpCircleIcon,
  InvoiceIcon,
  Megaphone01Icon,
  PackageIcon,
  ReceiptDollarIcon,
  ReturnRequestIcon,
  ShoppingBag01Icon,
  Tag01Icon,
} from 'hugeicons-react';

import type { SubNavItem } from '@/components/patterns/sub-nav-list';

/**
 * Inline badge for a nav item — Yeni / Beta / count indicator.
 * Renders as a small pill next to the label in the nav.  Variants
 * map to existing semantic tokens (success / warning / muted) — no
 * new color tokens are introduced.
 */
export interface NavItemBadge {
  variant: 'new' | 'beta' | 'count';
  label: string;
}

/**
 * A section block inside a primary nav item's collapsible body (NavGroup).
 * Only DESTINATION groups carry sections — i.e. domains whose children are
 * genuinely distinct pages, not filtered views of one list. Filter-style
 * views (Orders → Pending, Products → No cost, …) live as in-page tabs on
 * the page itself, NOT here. See docs/plans/2026-05-29-app-shell-modernization-design.md.
 */
export interface NavSection {
  key: string;
  labelKey: SubNavItem['labelKey'];
  items: readonly SubNavItem[];
}

export interface NavItemBase {
  key: string;
  labelKey: SubNavItem['labelKey'];
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Route prefix that marks this item active. Defaults to `href`. Use when an
   * item links to a default sub-route but should stay highlighted across its
   * whole section — e.g. Profitability links to `/profitability/orders` but is
   * active for any `/profitability/*`, so `activeMatch: '/profitability'`.
   */
  activeMatch?: string;
  /** Optional inline badge — Yeni / Beta / count indicator. */
  badge?: NavItemBadge;
}

export type NavItem =
  | (NavItemBase & { sections: readonly NavSection[]; meta?: never })
  | (NavItemBase & { sections?: never; meta: 'dashboard' })
  | (NavItemBase & { sections?: never; meta?: never });

/**
 * A labelled section of the sidebar (shadcn SidebarGroup + SidebarGroupLabel).
 * Groups give the nav a scannable information architecture instead of one
 * flat list. Order here is render order top-to-bottom.
 */
export interface NavGroupConfig {
  key: string;
  /** Section label shown above the group. */
  labelKey: SubNavItem['labelKey'];
  items: readonly NavItem[];
}

/**
 * Primary sidebar navigation, grouped.
 *
 * Sub-navigation principle (see design spec): the sidebar holds DESTINATIONS
 * (distinct pages); same-entity VIEWS/FILTERS live in-page (FilterTabs). After
 * this epic the only domain that still carries sidebar sub-nav is
 * `Tools & Pricing` (its tools are genuinely distinct pages). Campaigns will
 * join the same `Finans & Araçlar` group as a destination-with-sub-nav once
 * its pages exist — the structure is ready.
 */
export const NAV_GROUPS: readonly NavGroupConfig[] = [
  {
    key: 'overview',
    labelKey: 'nav.groups.overview',
    items: [
      {
        key: 'dashboard',
        labelKey: 'nav.dashboard',
        href: '/dashboard',
        icon: DashboardSquare02Icon,
        meta: 'dashboard',
      },
      {
        key: 'live-performance',
        labelKey: 'nav.livePerformance',
        href: '/live-performance',
        icon: Activity03Icon,
        badge: { variant: 'new', label: 'Yeni' },
      },
    ],
  },
  {
    key: 'operations',
    labelKey: 'nav.groups.operations',
    items: [
      {
        key: 'orders',
        labelKey: 'nav.orders',
        href: '/orders',
        icon: ShoppingBag01Icon,
      },
      {
        key: 'returns',
        labelKey: 'nav.returns',
        href: '/returns',
        icon: ReturnRequestIcon,
      },
      {
        key: 'products',
        labelKey: 'nav.products',
        href: '/products',
        icon: PackageIcon,
      },
      {
        key: 'costs',
        labelKey: 'nav.costs',
        href: '/costs',
        icon: Tag01Icon,
      },
    ],
  },
  {
    key: 'finance',
    labelKey: 'nav.groups.financeTools',
    items: [
      {
        key: 'profitability',
        labelKey: 'nav.profitability',
        href: '/profitability/orders',
        // Report types (orders/products/categories/returns/campaigns) become
        // in-page tabs (separate page work). The sidebar row stays active for
        // any /profitability/* route while linking to the default report.
        activeMatch: '/profitability',
        icon: ChartLineData01Icon,
        badge: { variant: 'beta', label: 'Beta' },
      },
      {
        key: 'reconciliation',
        labelKey: 'nav.reconciliation',
        href: '/reconciliation',
        icon: InvoiceIcon,
      },
      {
        key: 'tools',
        labelKey: 'nav.tools',
        // No overviewHref this epic: clicking the parent navigates to the first
        // tool and expands the sub-list (NavGroup's navigate-on-click). Active
        // across all /tools/* via activeMatch.
        href: '/tools/commission-rates',
        activeMatch: '/tools',
        icon: Calculator01Icon,
        sections: [
          {
            key: 'tools',
            labelKey: 'navSections.tools.tools.title',
            items: [
              {
                key: 'commission-rates',
                labelKey: 'navSections.tools.tools.commissionRates',
                href: '/tools/commission-rates',
              },
              {
                key: 'commission-calculator',
                labelKey: 'navSections.tools.tools.commissionCalculator',
                href: '/tools/commission-calculator',
              },
              {
                key: 'plus-commission-rates',
                labelKey: 'navSections.tools.tools.plusCommissionRates',
                href: '/tools/plus-commission-rates',
              },
              {
                key: 'product-pricing',
                labelKey: 'navSections.tools.tools.productPricing',
                href: '/tools/product-pricing',
              },
            ],
          },
        ],
      },
      {
        key: 'expenses',
        labelKey: 'nav.expenses',
        href: '/expenses',
        icon: ReceiptDollarIcon,
      },
    ],
  },
] as const satisfies readonly NavGroupConfig[];

/**
 * Help menu entries (sidebar footer "Yardım & Destek" dropdown). Replaces the
 * former AUX_NAV_ITEMS shelf links — consolidating low-frequency, easy-to-miss
 * destinations under one clearly-labelled menu, leaving the bell as the only
 * other footer utility. Scales: Dokümanlar / Klavye kısayolları can join once
 * a docs URL + a shortcuts dialog exist (tracked; omitted now to avoid dead
 * entries).
 */
export interface HelpMenuItem {
  key: string;
  labelKey: SubNavItem['labelKey'];
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shows a small "new" dot on the trigger + item when truthy. */
  hasNewDot?: boolean;
}

export const HELP_MENU_ITEMS = [
  {
    key: 'whats-new',
    labelKey: 'nav.whatsNew',
    href: '/whats-new',
    icon: Megaphone01Icon,
    hasNewDot: true,
  },
  {
    key: 'support',
    labelKey: 'nav.support',
    href: '/support',
    icon: HelpCircleIcon,
  },
] as const satisfies readonly HelpMenuItem[];

export type NavIconComponent = NavItem['icon'];
