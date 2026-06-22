'use client';

import type Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Currency } from '@/components/patterns/currency';
import { MoneyInput } from '@/components/patterns/money-input';
import { PercentageInput } from '@/components/patterns/percentage-input';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { ProductPriceQuote, QuoteInput } from '../api/quote-product-pricing.api';
import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { useQuoteProductPricing } from '../hooks/use-quote-product-pricing';

import { QuoteBreakdown } from './quote-breakdown';

type TargetType = QuoteInput['target']['type'];
type QuoteReason = NonNullable<ProductPriceQuote['reason']>;

/** Default target — the most common seller intent is a margin %. */
const DEFAULT_TARGET: TargetType = 'margin';

/** Targets whose value is a percentage (drives PercentageInput vs MoneyInput). */
const PERCENT_TARGETS = new Set<TargetType>(['margin', 'markup']);

export interface PricingCalculatorProps {
  item: ProductPricingItem;
  orgId: string;
  storeId: string;
  onClose: () => void;
}

/**
 * Reverse-pricing calculator. Shell-agnostic: it renders the same content
 * whether mounted inline (desktop row-expand) or inside a Sheet (mobile),
 * so it contains NO Sheet/Dialog of its own — and NO product header either,
 * since the desktop row sits directly above it (and the mobile Sheet shows
 * the product in its own header). Layout is a two-column grid (current state
 * │ target) that collapses to one column on narrow viewports; the result
 * spans full width below.
 *
 * Frontend renders only — it performs NO money/percent math. The current
 * numbers come straight from the row (`item`), the solved price + breakdown
 * come from the quote response, and the value the user types is forwarded to
 * the API as a string (`.toString()`). A `calculable:false` quote is normal
 * data (not an error): each `reason` maps to a localized message.
 */
export function PricingCalculator({
  item,
  orgId,
  storeId,
  onClose,
}: PricingCalculatorProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel');

  const [targetType, setTargetType] = React.useState<TargetType>(DEFAULT_TARGET);
  const [value, setValue] = React.useState<Decimal | null>(null);

  const quoteMutation = useQuoteProductPricing(orgId, storeId);
  const quote = quoteMutation.data ?? null;

  const isPercentTarget = PERCENT_TARGETS.has(targetType);

  // Changing the target or value invalidates a previous result (stale guard):
  // the displayed numbers must never lag behind the inputs the user sees.
  const handleTargetTypeChange = (next: string): void => {
    // Radix emits '' when the active item is toggled off; ignore — single
    // selection must always keep one target active.
    if (next === '') return;
    if (next !== 'margin' && next !== 'markup' && next !== 'profit') return;
    setTargetType(next);
    setValue(null);
    quoteMutation.reset();
  };

  const handleValueChange = (next: Decimal | null): void => {
    setValue(next);
    if (quoteMutation.data !== undefined) quoteMutation.reset();
  };

  const handleCalculate = (): void => {
    if (value === null) return;
    quoteMutation.mutate({
      variantId: item.variantId,
      target: { type: targetType, value: value.toString() },
    });
  };

  const comingSoon = (): void => {
    toast.info(t('actions.comingSoon'));
  };

  const supportingMetrics = [
    { id: 'cost', label: t('currentSummary.cost'), value: <NullableMoney value={item.cost} /> },
    {
      id: 'netProfit',
      label: t('currentSummary.netProfit'),
      value: <NullableMoney value={item.netProfit} />,
    },
    {
      id: 'margin',
      label: t('currentSummary.margin'),
      value: <NullablePercent value={item.saleMarginPct} />,
    },
    {
      id: 'markup',
      label: t('currentSummary.markup'),
      value: <NullablePercent value={item.costMarkupPct} />,
    },
  ];

  return (
    <div className="gap-md flex flex-col">
      {/* Two-column grid: current state │ target. Collapses to one column on
          narrow viewports (mobile Sheet is always one column). */}
      <div className="gap-md grid grid-cols-1 lg:grid-cols-2">
        {/* Left — current state (from the row, no fetch) */}
        <Card className="gap-md p-lg flex flex-col">
          <SectionLabel>{t('currentSummary.label')}</SectionLabel>
          {/* Anchor — the current sale price, mirroring the result's new-price
              hero so the seller reads current → new at a glance. */}
          <div className="gap-3xs flex flex-col">
            <span className="text-muted-foreground text-xs">{t('currentSummary.salePrice')}</span>
            <Currency value={item.salePrice} emphasis className="text-foreground text-2xl" />
          </div>
          {/* Supporting metrics as a clean 2×2 mini-stat grid — no ledger
              divider lines; label over value, generous rhythm. */}
          <div className="gap-md grid grid-cols-2">
            {supportingMetrics.map((metric) => (
              <div key={metric.id} className="gap-3xs flex flex-col">
                <span className="text-muted-foreground text-2xs">{metric.label}</span>
                <div className="text-foreground text-sm font-medium tabular-nums">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right — target selector + value input */}
        <Card className="gap-sm p-lg flex flex-col">
          <SectionLabel>{t('target.label')}</SectionLabel>
          <ToggleGroup
            type="single"
            value={targetType}
            onValueChange={handleTargetTypeChange}
            aria-label={t('target.label')}
            className="w-full"
          >
            <ToggleGroupItem value="margin" className="flex-1 text-xs">
              {t('target.margin')}
            </ToggleGroupItem>
            <ToggleGroupItem value="markup" className="flex-1 text-xs">
              {t('target.markup')}
            </ToggleGroupItem>
            <ToggleGroupItem value="profit" className="flex-1 text-xs">
              {t('target.profit')}
            </ToggleGroupItem>
          </ToggleGroup>

          {isPercentTarget ? (
            <PercentageInput
              value={value}
              onChange={handleValueChange}
              aria-label={t('valuePlaceholder')}
              placeholder={t('valuePlaceholder')}
            />
          ) : (
            <MoneyInput
              value={value}
              onChange={handleValueChange}
              aria-label={t('valuePlaceholder')}
              placeholder={t('valuePlaceholder')}
            />
          )}

          <Button
            onClick={handleCalculate}
            loading={quoteMutation.isPending}
            disabled={value === null}
            className="mt-auto w-full"
          >
            {t('calculate')}
          </Button>
        </Card>
      </div>

      {/* Result — full width below the grid */}
      {quote !== null ? <QuoteResult quote={quote} currentSalePrice={item.salePrice} /> : null}

      {/* Actions */}
      <footer className="gap-sm flex flex-wrap justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button variant="outline" onClick={comingSoon}>
          {t('actions.allVariants')}
        </Button>
        <Button onClick={comingSoon}>{t('actions.save')}</Button>
      </footer>
    </div>
  );
}

const EMPTY_VALUE = '—';

/** Small uppercase eyebrow used as a card section heading. */
function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

/** Money value from the row; null (uncostable / not calculable) renders a muted dash. */
function NullableMoney({ value }: { value: string | null }): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim tabular-nums">{EMPTY_VALUE}</span>;
  }
  return <Currency value={value} />;
}

/** Percent value from the row; null renders a muted dash. */
function NullablePercent({ value }: { value: string | null }): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim tabular-nums">{EMPTY_VALUE}</span>;
  }
  return <span className="text-foreground tabular-nums">{value}%</span>;
}

/**
 * Maps each non-calculable quote reason to its i18n key (literal types so
 * next-intl accepts them as message keys). Exhaustive over QuoteReason — a
 * new enum member breaks the build here.
 */
const REASON_KEY = {
  NO_COST: 'reason.noCost',
  NOT_CALCULABLE: 'reason.notCalculable',
  UNREACHABLE_TARGET: 'reason.unreachable',
  NOT_PRICE_SENSITIVE: 'reason.notPriceSensitive',
} as const satisfies Record<QuoteReason, string>;

/**
 * Result block. `calculable:true` → a full-width card with the hero new price +
 * new margin/markup stats + full breakdown + a muted reference to the current
 * price (NO delta — frontend money math is forbidden). `calculable:false` → a
 * warning keyed by reason.
 */
function QuoteResult({
  quote,
  currentSalePrice,
}: {
  quote: ProductPriceQuote;
  currentSalePrice: string;
}): React.ReactElement {
  const t = useTranslations('features.productPricing.panel');

  if (!quote.calculable || quote.price === undefined || quote.breakdown === undefined) {
    // `reason` is always present on a calculable:false response per the schema;
    // fall back to NOT_CALCULABLE defensively so the user always sees a message.
    const reason: QuoteReason = quote.reason ?? 'NOT_CALCULABLE';
    return (
      <Alert tone="warning" size="md" role="status">
        <AlertDescription>{t(REASON_KEY[reason])}</AlertDescription>
      </Alert>
    );
  }

  const { breakdown } = quote;

  return (
    <Card className="gap-md p-lg flex flex-col">
      <SectionLabel>{t('result.label')}</SectionLabel>
      <StatGroup>
        <StatCard emphasis label={t('result.newPrice')} value={<Currency value={quote.price} />} />
        <StatCard
          label={t('result.newMargin')}
          value={breakdown.saleMarginPct !== null ? `${breakdown.saleMarginPct}%` : EMPTY_VALUE}
        />
        <StatCard
          label={t('result.newMarkup')}
          value={breakdown.costMarkupPct !== null ? `${breakdown.costMarkupPct}%` : EMPTY_VALUE}
        />
      </StatGroup>

      <QuoteBreakdown breakdown={breakdown} />

      <p className="text-2xs text-muted-foreground tabular-nums">
        {t.rich('result.currentPrice', {
          price: () => <Currency value={currentSalePrice} />,
        })}
      </p>
    </Card>
  );
}
