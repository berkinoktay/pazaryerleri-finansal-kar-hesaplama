import {
  Activity03Icon,
  Calculator01Icon,
  ChartLineData01Icon,
  DashboardSquare02Icon,
  InvoiceIcon,
  Megaphone01Icon,
  Notification03Icon,
  PackageIcon,
  ReceiptDollarIcon,
  ShoppingBag01Icon,
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
 * Visual divider in the nav scroll body — renders as a horizontal
 * dashed separator.  Used to delimit primary nav from a section like
 * "Yenilikler" that lives below the main scroll.
 */
export interface NavDivider {
  type: 'divider';
  key: string;
}

/**
 * Shape of a section block inside the ContextRail middle slot.
 * `meta` is an alternative render hint — when set, the rail picks
 * a custom React component instead of rendering a SubNavList.
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
  /** When true, IconRail skips this item (visible to ContextRail only). */
  hideFromIconRail?: boolean;
  /** Optional inline badge — Yeni / Beta / count indicator. */
  badge?: NavItemBadge;
}

export type NavItem =
  | (NavItemBase & { sections: readonly NavSection[]; meta?: never })
  | (NavItemBase & { sections?: never; meta: 'dashboard' })
  | (NavItemBase & { sections?: never; meta?: never });

/** All renderable nav entries — items plus dividers. */
export type NavEntry = NavItem | NavDivider;

export function isNavDivider(entry: NavEntry): entry is NavDivider {
  return 'type' in entry && entry.type === 'divider';
}

export const NAV_ITEMS = [
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
  {
    key: 'orders',
    labelKey: 'nav.orders',
    href: '/orders',
    icon: ShoppingBag01Icon,
    sections: [
      {
        key: 'status',
        labelKey: 'navSections.orders.status.title',
        items: [
          { key: 'all', labelKey: 'navSections.orders.status.all', href: '/orders' },
          {
            key: 'pending',
            labelKey: 'navSections.orders.status.pending',
            href: '/orders?status=pending',
          },
          {
            key: 'shipped',
            labelKey: 'navSections.orders.status.shipped',
            href: '/orders?status=shipped',
          },
          {
            key: 'delivered',
            labelKey: 'navSections.orders.status.delivered',
            href: '/orders?status=delivered',
          },
          {
            key: 'returned',
            labelKey: 'navSections.orders.status.returned',
            href: '/orders?status=returned',
            tone: 'warning',
          },
        ],
      },
    ],
  },
  {
    key: 'products',
    labelKey: 'nav.products',
    href: '/products',
    icon: PackageIcon,
    sections: [
      {
        key: 'catalog',
        labelKey: 'navSections.products.catalog.title',
        items: [
          { key: 'active', labelKey: 'navSections.products.catalog.active', href: '/products' },
          {
            key: 'draft',
            labelKey: 'navSections.products.catalog.draft',
            href: '/products?status=draft',
          },
          {
            key: 'no-cost',
            labelKey: 'navSections.products.catalog.noCost',
            href: '/products?filter=no-cost',
            tone: 'warning',
          },
          {
            key: 'no-desi',
            labelKey: 'navSections.products.catalog.noDesi',
            href: '/products?filter=no-desi',
            tone: 'warning',
          },
          {
            key: 'low-stock',
            labelKey: 'navSections.products.catalog.lowStock',
            href: '/products?filter=low-stock',
          },
        ],
      },
      {
        key: 'meta',
        labelKey: 'navSections.products.meta.title',
        items: [
          { key: 'costs', labelKey: 'navSections.products.meta.costs', href: '/products/costs' },
        ],
      },
    ],
  },
  {
    key: 'profitability',
    labelKey: 'nav.profitability',
    href: '/profitability/orders',
    icon: ChartLineData01Icon,
    badge: { variant: 'beta', label: 'Beta' },
    sections: [
      {
        key: 'reports',
        labelKey: 'navSections.profitability.reports.title',
        items: [
          {
            key: 'order',
            labelKey: 'navSections.profitability.reports.order',
            href: '/profitability/orders',
          },
          {
            key: 'product',
            labelKey: 'navSections.profitability.reports.product',
            href: '/profitability/products',
          },
          {
            key: 'category',
            labelKey: 'navSections.profitability.reports.category',
            href: '/profitability/categories',
          },
          {
            key: 'return',
            labelKey: 'navSections.profitability.reports.return',
            href: '/profitability/returns',
          },
          {
            key: 'campaign',
            labelKey: 'navSections.profitability.reports.campaign',
            href: '/profitability/campaigns',
          },
        ],
      },
    ],
  },
  {
    key: 'reconciliation',
    labelKey: 'nav.reconciliation',
    href: '/reconciliation',
    icon: InvoiceIcon,
    sections: [
      {
        key: 'status',
        labelKey: 'navSections.reconciliation.status.title',
        items: [
          {
            key: 'matched',
            labelKey: 'navSections.reconciliation.status.matched',
            href: '/reconciliation?status=matched',
          },
          {
            key: 'pending',
            labelKey: 'navSections.reconciliation.status.pending',
            href: '/reconciliation?status=pending',
          },
          {
            key: 'mismatch',
            labelKey: 'navSections.reconciliation.status.mismatch',
            href: '/reconciliation?status=mismatch',
            tone: 'warning',
          },
        ],
      },
    ],
  },
  {
    key: 'tools',
    labelKey: 'nav.tools',
    href: '/tools/commission-calculator',
    icon: Calculator01Icon,
    sections: [
      {
        key: 'tools',
        labelKey: 'navSections.tools.tools.title',
        items: [
          {
            key: 'commission-calculator',
            labelKey: 'navSections.tools.tools.commissionCalculator',
            href: '/tools/commission-calculator',
          },
          {
            key: 'category-commissions',
            labelKey: 'navSections.tools.tools.categoryCommissions',
            href: '/tools/category-commissions',
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
    sections: [
      {
        key: 'category',
        labelKey: 'navSections.expenses.category.title',
        items: [
          { key: 'all', labelKey: 'navSections.expenses.category.all', href: '/expenses' },
          {
            key: 'product',
            labelKey: 'navSections.expenses.category.product',
            href: '/expenses?category=product',
          },
          {
            key: 'ad',
            labelKey: 'navSections.expenses.category.ad',
            href: '/expenses?category=ad',
          },
          {
            key: 'packaging',
            labelKey: 'navSections.expenses.category.packaging',
            href: '/expenses?category=packaging',
          },
          {
            key: 'other',
            labelKey: 'navSections.expenses.category.other',
            href: '/expenses?category=other',
          },
        ],
      },
    ],
  },
  {
    key: 'notifications',
    labelKey: 'nav.notifications',
    href: '/notifications',
    icon: Notification03Icon,
    hideFromIconRail: true,
    sections: [
      {
        key: 'filter',
        labelKey: 'navSections.notifications.filter.title',
        items: [
          { key: 'all', labelKey: 'navSections.notifications.filter.all', href: '/notifications' },
          {
            key: 'unread',
            labelKey: 'navSections.notifications.filter.unread',
            href: '/notifications?filter=unread',
          },
          {
            key: 'sync',
            labelKey: 'navSections.notifications.filter.sync',
            href: '/notifications?filter=sync',
          },
          {
            key: 'orders',
            labelKey: 'navSections.notifications.filter.orders',
            href: '/notifications?filter=orders',
          },
          {
            key: 'warning',
            labelKey: 'navSections.notifications.filter.warning',
            href: '/notifications?filter=warning',
            tone: 'warning',
          },
        ],
      },
    ],
  },
] as const satisfies readonly NavItem[];

/**
 * Renderable nav surface — primary items from NAV_ITEMS plus the
 * trailing "Yenilikler" leaf preceded by a dashed section divider.
 * Sidebar renderer consumes this; tests that exercise just primary
 * nav still import NAV_ITEMS directly.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  ...NAV_ITEMS,
  { type: 'divider', key: 'before-whats-new' },
  {
    key: 'whats-new',
    labelKey: 'nav.whatsNew',
    href: '/whats-new',
    icon: Megaphone01Icon,
  },
];

export type NavIconComponent = NavItem['icon'];
