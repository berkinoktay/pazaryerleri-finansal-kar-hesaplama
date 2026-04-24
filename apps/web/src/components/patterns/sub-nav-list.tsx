'use client';

import { type MessageKeys, type Messages, type NestedKeyOf, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/** Any leaf key in the i18n messages tree — same constraint next-intl applies to `t()`. */
type AnyMessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

export type SubNavTone = 'default' | 'warning' | 'info';

export interface SubNavItem {
  key: string;
  labelKey: AnyMessageKey;
  href: string;
  count?: number;
  tone?: SubNavTone;
}

export interface SubNavListProps {
  /** i18n key for the optional heading shown above the list. */
  headingKey?: AnyMessageKey;
  /** Current pathname + query, used to compute active state. */
  currentHref: string;
  items: readonly SubNavItem[];
}

const TONE_CLASS: Record<SubNavTone, string> = {
  default: 'bg-muted text-muted-foreground',
  warning: 'bg-warning-surface text-warning',
  info: 'bg-info-surface text-info',
};

/**
 * Generic sub-navigation list with optional count badges and tone hints.
 * Designed for the ContextRail middle slot — slim, vertical, indigo
 * border-left accent on the active item.
 */
export function SubNavList({
  headingKey,
  currentHref,
  items,
}: SubNavListProps): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="gap-3xs flex flex-col">
      {headingKey ? (
        <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
          {t(headingKey)}
        </span>
      ) : null}
      <ul className="gap-3xs flex flex-col">
        {items.map((item) => {
          const isActive = currentHref === item.href;
          const tone = item.tone ?? 'default';
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'gap-xs px-xs py-3xs duration-fast flex items-center justify-between rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  'focus-visible:outline-none',
                  isActive
                    ? 'bg-muted text-foreground border-primary border-l-2 font-medium'
                    : 'text-muted-foreground',
                )}
              >
                <span>{t(item.labelKey)}</span>
                {item.count !== undefined ? (
                  <span
                    className={cn(
                      'text-2xs px-xs py-3xs rounded-full font-medium tabular-nums',
                      TONE_CLASS[tone],
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
