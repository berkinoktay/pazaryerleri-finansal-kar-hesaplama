import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Closed set of translation keys under `dashboard.quickAccess.*`.
 * next-intl validates message keys against the message catalogue at
 * compile time, so `key` must be a literal union, not `string`.
 */
export type QuickAccessKey = 'pendingOrders' | 'noCostProducts' | 'returnReviews';

export interface QuickAccessItem {
  /** Localization key suffix under `dashboard.quickAccess.*`. */
  key: QuickAccessKey;
  /** Internal nav link target (locale prefix added by `Link`). */
  href: string;
  /** Numeric badge — typically a "needs action" count from upstream. */
  count: number;
  /** Visual emphasis. `warning` paints the count in the warning tone. */
  tone: 'warning' | 'neutral';
}

export interface QuickAccessPanelProps {
  items: QuickAccessItem[];
}

/**
 * Top-of-Dashboard "Hizli Erisim" warning row. Three actionable cards
 * surfacing counts that need user attention (pending orders, products
 * missing cost data, return reviews). Replaces the old DashboardContextMiddle
 * which used to live in the 3-rail's ContextRail middle slot.
 */
export function QuickAccessPanel({ items }: QuickAccessPanelProps): React.ReactElement {
  const t = useTranslations('dashboard.quickAccess');

  return (
    <div className="gap-xs grid grid-cols-1 md:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={cn(
            'border-border bg-card hover:bg-muted duration-fast p-md gap-3xs flex flex-col rounded-md border transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          )}
        >
          <span className="text-muted-foreground text-2xs tracking-wide uppercase">
            {t(`${item.key}.label`)}
          </span>
          <span className="gap-xs flex items-baseline">
            <span
              className={cn(
                'text-foreground text-md font-semibold tabular-nums',
                item.tone === 'warning' && 'text-warning',
              )}
            >
              {item.count}
            </span>
            <span className="text-muted-foreground text-xs">{t(`${item.key}.cta`)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
