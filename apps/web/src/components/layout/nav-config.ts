import {
  Activity03Icon,
  Calculator01Icon,
  ChartLineData01Icon,
  Coupon01Icon,
  DashboardSquare02Icon,
  DiscountIcon,
  FlashIcon,
  HelpCircleIcon,
  InvoiceIcon,
  LabelIcon,
  Megaphone01Icon,
  PackageIcon,
  PercentIcon,
  PercentSquareIcon,
  PlusSignSquareIcon,
  ReceiptDollarIcon,
  ReturnRequestIcon,
  SaleTag01Icon,
  ShoppingBag01Icon,
  Tag01Icon,
} from 'hugeicons-react';

import type { Platform } from '@pazarsync/db/enums';

import { TrendyolPlusLogo } from '@/components/patterns/trendyol-plus-logo';
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
  /**
   * Optional brand mark rendered in the trailing slot (where the badge sits),
   * instead of a text badge — e.g. the Trendyol Plus wordmark on the Plus
   * commission tariffs item. Hidden when the sidebar collapses to icon-only.
   */
  trailingMark?: React.ComponentType<{ className?: string }>;
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
  /**
   * When set, this group is only shown if the active store's platform is in
   * the list. Undefined = always shown (platform-agnostic). Used for
   * marketplace-specific groups like Campaigns (Trendyol-only). Filtering
   * happens in the app shell via `filterNavGroupsByPlatform`.
   */
  readonly platforms?: readonly Platform[];
}

/**
 * Primary sidebar navigation, grouped.
 *
 * Sub-navigation principle (see design spec): the sidebar holds DESTINATIONS
 * (distinct pages); same-entity VIEWS/FILTERS live in-page (FilterTabs). The
 * tools (Araçlar) are flat destinations in their own top-level group. The
 * Campaigns (Kampanyalar) group is marketplace-specific — it carries
 * `platforms: ['TRENDYOL']` so it only renders when the active store is a
 * Trendyol store (filtered in the app shell via `filterNavGroupsByPlatform`).
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
    // High-traffic for Trendyol sellers, so it sits right below the overview
    // group rather than at the bottom. Trendyol-specific: the whole group is
    // hidden when the active store is not a Trendyol store (see
    // `filterNavGroupsByPlatform`).
    key: 'campaigns',
    labelKey: 'nav.groups.campaigns',
    platforms: ['TRENDYOL'],
    items: [
      {
        key: 'campaign-product-commission',
        labelKey: 'nav.productCommissionTariffs',
        href: '/campaigns/product-commission-tariffs',
        icon: PercentSquareIcon,
      },
      {
        key: 'campaign-plus-commission',
        labelKey: 'nav.plusCommissionTariffs',
        href: '/campaigns/plus-commission-tariffs',
        icon: PlusSignSquareIcon,
        trailingMark: TrendyolPlusLogo,
      },
      {
        key: 'campaign-product-labels',
        labelKey: 'nav.productLabels',
        href: '/campaigns/product-labels',
        icon: LabelIcon,
      },
      {
        key: 'campaign-flash-products',
        labelKey: 'nav.flashProducts',
        href: '/campaigns/flash-products',
        icon: FlashIcon,
      },
      {
        key: 'campaign-discounts',
        labelKey: 'nav.discounts',
        href: '/campaigns/discounts',
        icon: DiscountIcon,
      },
      {
        key: 'campaign-coupons',
        labelKey: 'nav.coupons',
        href: '/campaigns/coupons',
        icon: Coupon01Icon,
      },
      {
        key: 'campaign-cart-campaigns',
        labelKey: 'nav.cartCampaigns',
        href: '/campaigns/cart-campaigns',
        icon: Megaphone01Icon,
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
    labelKey: 'nav.groups.finance',
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
        key: 'expenses',
        labelKey: 'nav.expenses',
        href: '/expenses',
        icon: ReceiptDollarIcon,
      },
    ],
  },
  {
    key: 'tools',
    labelKey: 'nav.groups.tools',
    items: [
      {
        key: 'commission-rates',
        labelKey: 'navSections.tools.tools.commissionRates',
        href: '/tools/commission-rates',
        icon: PercentIcon,
      },
      {
        key: 'commission-calculator',
        labelKey: 'navSections.tools.tools.commissionCalculator',
        href: '/tools/commission-calculator',
        icon: Calculator01Icon,
      },
      {
        key: 'product-pricing',
        labelKey: 'navSections.tools.tools.productPricing',
        href: '/tools/product-pricing',
        icon: SaleTag01Icon,
      },
    ],
  },
] as const satisfies readonly NavGroupConfig[];

/**
 * Filter nav groups by the active store's platform. A group with no
 * `platforms` restriction is always visible; a restricted group is shown only
 * when `platform` is non-null and listed. With no active store (`null`),
 * platform-restricted groups are hidden.
 */
export function filterNavGroupsByPlatform(
  groups: readonly NavGroupConfig[],
  platform: Platform | null,
): readonly NavGroupConfig[] {
  return groups.filter((group) => {
    if (group.platforms === undefined) return true;
    return platform !== null && group.platforms.includes(platform);
  });
}

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
