import {
  ChartLineData01Icon,
  DashboardSquare02Icon,
  InvoiceIcon,
  PackageIcon,
  ReceiptDollarIcon,
  Settings02Icon,
  ShoppingBag01Icon,
} from 'hugeicons-react';

export const NAV_ITEMS = [
  {
    key: 'dashboard',
    labelKey: 'nav.dashboard',
    href: '/dashboard',
    icon: DashboardSquare02Icon,
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
            key: 'costs',
            labelKey: 'navSections.products.catalog.costs',
            href: '/products/costs',
          },
        ],
      },
    ],
  },
  {
    key: 'profitability',
    labelKey: 'nav.profitability',
    href: '/profitability',
    icon: ChartLineData01Icon,
    sections: [
      {
        key: 'views',
        labelKey: 'navSections.profitability.views.title',
        items: [
          {
            key: 'period',
            labelKey: 'navSections.profitability.views.period',
            href: '/profitability',
          },
          {
            key: 'by-product',
            labelKey: 'navSections.profitability.views.byProduct',
            href: '/profitability/products',
          },
          {
            key: 'by-campaign',
            labelKey: 'navSections.profitability.views.byCampaign',
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
  },
  {
    key: 'expenses',
    labelKey: 'nav.expenses',
    href: '/expenses',
    icon: ReceiptDollarIcon,
  },
  {
    key: 'settings',
    labelKey: 'nav.settings',
    href: '/settings',
    icon: Settings02Icon,
  },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavIconComponent = NavItem['icon'];
