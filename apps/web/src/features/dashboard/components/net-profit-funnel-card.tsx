'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import type { FunnelStep } from '@/features/dashboard/api/dashboard.api';

export interface NetProfitFunnelCardProps {
  steps: readonly FunnelStep[] | undefined;
}

const STEP_LABEL_KEY = {
  revenue: 'dashboard.funnel.revenue',
  'minus-shipping': 'dashboard.funnel.minusShipping',
  'minus-marketplace': 'dashboard.funnel.minusMarketplace',
  'minus-cost': 'dashboard.funnel.minusCost',
  net: 'dashboard.funnel.net',
} as const satisfies Record<FunnelStep['key'], string>;

// Color scale: saturated success at the top, fading to muted as value drains.
// Single-purpose visual gradient; doesn't fit a semantic token slot, kept inline.
const FILL = [
  'oklch(70% 0.18 145)',
  'oklch(75% 0.16 145)',
  'oklch(80% 0.13 145)',
  'oklch(85% 0.10 145)',
  'oklch(90% 0.06 145)',
] as const;

/**
 * 5-step funnel from gross revenue to net profit, drawn with CSS clip-path
 * trapezoids on plain divs (no SVG, no charting funnel plugin). Each row's
 * top edge spans the step's normalized width; the bottom edge spans the
 * next step's width, so the trapezoid visually narrows as value drains
 * through shipping, commission, and product cost.
 */
export function NetProfitFunnelCard({ steps }: NetProfitFunnelCardProps): React.ReactElement {
  const t = useTranslations();
  const data = steps ?? [];

  if (data.length === 0) {
    return (
      <Card className="gap-md p-lg flex flex-col">
        <header className="flex items-center justify-between">
          <h2 className="text-foreground text-base font-semibold">
            {t('dashboard.section.funnel')}
          </h2>
        </header>
        <div className="text-muted-foreground py-lg text-center text-sm">—</div>
      </Card>
    );
  }

  const max = data.reduce((m, s) => (s.amount.gt(m) ? s.amount : m), new Decimal(0));
  const widths = data.map((s) =>
    max.isZero() ? 0 : Number(s.amount.abs().div(max).mul(100).toFixed(1)),
  );

  return (
    <Card className="gap-md p-lg flex flex-col">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-semibold">{t('dashboard.section.funnel')}</h2>
      </header>
      <div className="gap-2xs flex flex-col">
        {data.map((step, i) => {
          const w = widths[i] ?? 0;
          const wNext = widths[i + 1] ?? w;
          const trapezoid =
            `polygon(${(100 - w) / 2}% 0, ${100 - (100 - w) / 2}% 0, ` +
            `${100 - (100 - wNext) / 2}% 100%, ${(100 - wNext) / 2}% 100%)`;
          return (
            <div key={step.key} className="gap-md grid grid-cols-[1fr_auto] items-center">
              <div
                className="h-9"
                style={{
                  // runtime-dynamic: trapezoid geometry derived from per-step value
                  clipPath: trapezoid,
                  WebkitClipPath: trapezoid,
                  background: FILL[i] ?? FILL[FILL.length - 1],
                }}
                aria-hidden="true"
              />
              <div className="flex flex-col text-sm">
                <span className="text-muted-foreground text-2xs uppercase">
                  {t(STEP_LABEL_KEY[step.key])}
                </span>
                <Currency value={step.amount} className="text-foreground font-semibold" />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
