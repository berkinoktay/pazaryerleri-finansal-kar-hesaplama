'use client';

import Decimal from 'decimal.js';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { CostBreakdownEntry } from '@/features/dashboard/api/dashboard.api';
import { cn } from '@/lib/utils';

export interface CostBreakdownCardProps {
  entries: readonly CostBreakdownEntry[] | undefined;
}

type CategoryKey = CostBreakdownEntry['key'];

const CATEGORY_LABEL_KEY = {
  product: 'dashboard.cost.product',
  commission: 'dashboard.cost.commission',
  shipping: 'dashboard.cost.shipping',
  service: 'dashboard.cost.service',
  intl: 'dashboard.cost.intl',
  withholding: 'dashboard.cost.withholding',
  vat: 'dashboard.cost.vat',
  other: 'dashboard.cost.other',
} as const satisfies Record<CategoryKey, string>;

const CATEGORY_COLOR = {
  product: 'var(--color-chart-1)',
  commission: 'var(--color-chart-2)',
  shipping: 'var(--color-chart-3)',
  service: 'var(--color-chart-4)',
  intl: 'var(--color-chart-5)',
  withholding: 'var(--color-chart-6)',
  vat: 'var(--color-chart-7)',
  other: 'var(--color-chart-8)',
} as const satisfies Record<CategoryKey, string>;

/**
 * Donut chart + 8-category legend for the dashboard's "maliyet dağılımı"
 * (cost breakdown) card. Mirrors Melontik's pattern — pie segments by
 * absolute amount, total in the header, the full legend grid below so
 * zero-amount categories still get acknowledged.
 *
 * The donut intentionally drops zero/negative entries (`amount <= 0`) so
 * empty slices don't pollute the chart geometry; the legend grid keeps
 * them visible because operators want to confirm a category is still
 * tracked even when it contributed nothing this period.
 */
export function CostBreakdownCard({ entries }: CostBreakdownCardProps): React.ReactElement {
  const t = useTranslations();
  const data = entries ?? [];

  const chartData = data
    .filter((entry) => entry.amount.gt(0))
    .map((entry) => ({
      key: entry.key,
      amount: Number(entry.amount.abs().toFixed(2)),
    }));

  const chartConfig = Object.fromEntries(
    data.map((entry) => [
      entry.key,
      { label: t(CATEGORY_LABEL_KEY[entry.key]), color: CATEGORY_COLOR[entry.key] },
    ]),
  ) satisfies ChartConfig;

  const total = data.reduce((sum, entry) => sum.add(entry.amount.abs()), new Decimal(0));

  return (
    <Card className="gap-lg p-lg flex flex-col">
      <header className="gap-sm flex items-baseline justify-between">
        <h2 className="text-foreground text-base font-semibold">
          {t('dashboard.section.costBreakdown')}
        </h2>
        <span className="text-2xs text-muted-foreground gap-3xs flex items-baseline tracking-wide uppercase">
          <span>{t('dashboard.cost.total')}</span>
          <span>·</span>
          <Currency
            value={total}
            className="text-foreground font-semibold tracking-normal normal-case"
          />
        </span>
      </header>

      <div className="gap-lg flex flex-col items-center md:flex-row md:items-center">
        <ChartContainer
          config={chartConfig}
          className="max-w-input-narrow md:w-input-narrow aspect-square w-full shrink-0"
        >
          <PieChart>
            <Pie
              data={chartData}
              dataKey="amount"
              nameKey="key"
              innerRadius={60}
              outerRadius={90}
              strokeWidth={0}
            >
              {chartData.map((slice) => (
                <Cell key={slice.key} fill={CATEGORY_COLOR[slice.key]} />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              content={(props) => (
                <CostBreakdownTooltip active={props.active === true} payload={props.payload} />
              )}
            />
          </PieChart>
        </ChartContainer>

        <div className="gap-md grid w-full grid-cols-2 sm:grid-cols-4">
          {data.map((entry) => (
            <div key={entry.key} className="gap-3xs flex flex-col">
              <span className="gap-3xs text-2xs text-muted-foreground flex items-center tracking-wide uppercase">
                <span
                  className="size-2 shrink-0 rounded-sm"
                  // runtime-dynamic: legend swatch color varies by category key
                  style={{ backgroundColor: CATEGORY_COLOR[entry.key] }}
                />
                {t(CATEGORY_LABEL_KEY[entry.key])}
              </span>
              <Currency value={entry.amount} className="text-foreground text-base font-semibold" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

interface CostBreakdownTooltipProps {
  active: boolean;
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown }>;
}

function CostBreakdownTooltip({
  active,
  payload,
}: CostBreakdownTooltipProps): React.ReactElement | null {
  const t = useTranslations();
  const format = useFormatter();
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  if (!entry) return null;
  const rawName = typeof entry.name === 'string' ? entry.name : undefined;
  if (rawName === undefined || !isCategoryKey(rawName)) return null;
  const key: CategoryKey = rawName;
  const value = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
  return (
    <div
      className={cn(
        'border-border bg-popover px-sm py-xs text-2xs text-popover-foreground gap-xs flex items-center rounded-md border shadow-md',
      )}
    >
      <span
        className="size-2 shrink-0 rounded-sm"
        // runtime-dynamic: tooltip swatch color varies by category key
        style={{ backgroundColor: CATEGORY_COLOR[key] }}
      />
      <span className="text-muted-foreground">{t(CATEGORY_LABEL_KEY[key])}</span>
      <span className="text-foreground ml-auto font-semibold tabular-nums">
        {format.number(value, 'currency')}
      </span>
    </div>
  );
}

function isCategoryKey(value: string): value is CategoryKey {
  return value in CATEGORY_LABEL_KEY;
}
