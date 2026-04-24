'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { parseAsStringEnum, useQueryState } from 'nuqs';

import { cn } from '@/lib/utils';

export const PERIOD_PRESETS = [
  { key: 'last-30d' as const },
  { key: 'this-month' as const },
  { key: 'last-7d' as const },
  { key: 'this-quarter' as const },
  { key: 'custom' as const },
] as const;

export type PeriodKey = (typeof PERIOD_PRESETS)[number]['key'];

const PERIOD_KEYS = PERIOD_PRESETS.map((p) => p.key);

/**
 * Vertical list of period presets for the Dashboard ContextRail middle.
 * Active preset is bound to the `?period=…` URL param via nuqs; switching
 * a preset updates the URL so any subscribed hook (e.g. useDashboardMetrics)
 * refetches with the new range. Defaults to `last-30d` when no param is set.
 */
export function PeriodPresetList(): React.ReactElement {
  const t = useTranslations('periodPresets');
  const [period, setPeriod] = useQueryState(
    'period',
    parseAsStringEnum<PeriodKey>(PERIOD_KEYS).withDefault('last-30d'),
  );

  return (
    <div className="gap-2xs flex flex-col">
      <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
        {t('heading')}
      </span>
      <div className="gap-3xs flex flex-col">
        {PERIOD_PRESETS.map(({ key }) => {
          const isActive = period === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                void setPeriod(key);
              }}
              className={cn(
                'gap-xs px-xs py-3xs duration-fast flex items-center rounded-md text-left text-sm transition-colors',
                'hover:bg-muted',
                'focus-visible:outline-none',
                isActive ? 'bg-accent text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {t(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
