import {
  ChartLineData01Icon,
  DashboardSquare02Icon,
  InvoiceIcon,
  PackageIcon,
  ReceiptDollarIcon,
  Settings02Icon,
  ShoppingBag01Icon,
} from 'hugeicons-react';

/** Icons are React components with Hugeicons' own prop shape; derive it from one. */
export type NavIconComponent = typeof DashboardSquare02Icon;

export interface NavItem {
  key: string;
  labelKey: `nav.${string}`;
  href: string;
  icon: NavIconComponent;
  /** Sub-navigation shown in the context rail when this item is active. */
  sections?: NavSection[];
}

export interface NavSection {
  key: string;
  label: string;
  items: Array<{ key: string; label: string; href: string; badge?: string }>;
}

/**
 * Global navigation config — consumed by IconRail (for the icon list) and
 * ContextRail (for sub-sections of the active item). Config-driven so adding
 * a new module means one entry here, not changes in three components.
 */
export const NAV_ITEMS: NavItem[] = [
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
        label: 'Durum',
        items: [
          { key: 'all', label: 'Hepsi', href: '/orders' },
          { key: 'pending', label: 'Bekleyen', href: '/orders?status=pending' },
          { key: 'shipped', label: 'Kargoda', href: '/orders?status=shipped' },
          { key: 'delivered', label: 'Teslim edildi', href: '/orders?status=delivered' },
          { key: 'returned', label: 'İade', href: '/orders?status=returned' },
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
        label: 'Katalog',
        items: [
          { key: 'active', label: 'Aktif ürünler', href: '/products' },
          { key: 'draft', label: 'Taslaklar', href: '/products?status=draft' },
          { key: 'costs', label: 'Maliyetler', href: '/products/costs' },
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
        label: 'Görünümler',
        items: [
          { key: 'period', label: 'Dönem', href: '/profitability' },
          { key: 'by-product', label: 'Ürün bazında', href: '/profitability/products' },
          { key: 'by-campaign', label: 'Kampanya bazında', href: '/profitability/campaigns' },
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
];
