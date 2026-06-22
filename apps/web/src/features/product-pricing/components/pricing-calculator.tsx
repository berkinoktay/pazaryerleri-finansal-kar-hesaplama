'use client';

import type Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { Currency } from '@/components/patterns/currency';
import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';
import { ImageCell } from '@/components/patterns/image-cell';
import { MoneyInput } from '@/components/patterns/money-input';
import { PercentageInput } from '@/components/patterns/percentage-input';
import { StatCard } from '@/components/patterns/stat-card';
import { StatGroup } from '@/components/patterns/stat-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { ProductPriceQuote, QuoteInput } from '../api/quote-product-pricing.api';
import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { useQuoteProductPricing } from '../hooks/use-quote-product-pricing';

import { LabeledIdentifier } from './labeled-identifier';
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
 * so it contains NO Sheet/Dialog of its own.
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
  const tIdentifiers = useTranslations('features.productPricing.identifiers');

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

  const currentRows: DefinitionListItem[] = [
    {
      id: 'salePrice',
      term: t('currentSummary.salePrice'),
      description: <Currency value={item.salePrice} />,
    },
    {
      id: 'cost',
      term: t('currentSummary.cost'),
      description: <NullableMoney value={item.cost} />,
    },
    {
      id: 'netProfit',
      term: t('currentSummary.netProfit'),
      description: <NullableMoney value={item.netProfit} />,
    },
    {
      id: 'margin',
      term: t('currentSummary.margin'),
      description: <NullablePercent value={item.saleMarginPct} />,
    },
    {
      id: 'markup',
      term: t('currentSummary.markup'),
      description: <NullablePercent value={item.costMarkupPct} />,
    },
  ];

  return (
    <div className="gap-lg flex flex-col">
      {/* 1. Header — image + name + identifiers */}
      <header className="gap-sm flex items-center">
        <ImageCell src={item.imageUrl} alt={item.productName} size="lg" />
        <div className="gap-3xs flex min-w-0 flex-col">
          <h2 className="text-foreground line-clamp-2 text-sm font-semibold">{item.productName}</h2>
          <div className="gap-x-sm gap-y-3xs flex min-w-0 flex-wrap items-baseline">
            <LabeledIdentifier label={tIdentifiers('sku')} value={item.sku} />
            <LabeledIdentifier label={tIdentifiers('barcode')} value={item.barcode} />
          </div>
        </div>
      </header>

      {/* 2. Current summary (from the row — no fetch) */}
      <section className="gap-xs flex flex-col">
        <h3 className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          {t('currentSummary.label')}
        </h3>
        <DefinitionList items={currentRows} layout="inline" dividers dense alignRight />
        {!item.calculable ? (
          <Alert tone="warning" size="sm">
            <AlertDescription>
              {item.cost === null ? t('reason.noCost') : t('reason.notCalculable')}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      {/* 3. Target selector + value input */}
      <section className="gap-sm flex flex-col">
        <h3 className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          {t('target.label')}
        </h3>
        <ToggleGroup
          type="single"
          value={targetType}
          onValueChange={handleTargetTypeChange}
          aria-label={t('target.label')}
          className="w-full"
        >
          <ToggleGroupItem value="margin" className="flex-1">
            {t('target.margin')}
          </ToggleGroupItem>
          <ToggleGroupItem value="markup" className="flex-1">
            {t('target.markup')}
          </ToggleGroupItem>
          <ToggleGroupItem value="profit" className="flex-1">
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
          className="w-full"
        >
          {t('calculate')}
        </Button>
      </section>

      {/* 4. Result */}
      {quote !== null ? <QuoteResult quote={quote} currentSalePrice={item.salePrice} /> : null}

      {/* 5. Actions */}
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
 * Result block. `calculable:true` → hero new price + new margin/markup stats +
 * full breakdown + a muted reference to the current price (NO delta — frontend
 * money math is forbidden). `calculable:false` → a warning keyed by reason.
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
    <section className="gap-md flex flex-col">
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
    </section>
  );
}
