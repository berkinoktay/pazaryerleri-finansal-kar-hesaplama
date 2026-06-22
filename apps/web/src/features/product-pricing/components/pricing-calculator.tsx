'use client';

import type Decimal from 'decimal.js';
import { formatCurrency } from '@pazarsync/utils';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Currency } from '@/components/patterns/currency';
import { MoneyInput } from '@/components/patterns/money-input';
import { PercentageInput } from '@/components/patterns/percentage-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import type { ProductPriceQuote, QuoteInput } from '../api/quote-product-pricing.api';
import type { ProductPricingItem } from '../api/list-product-pricing.api';
import { useQuoteProductPricing } from '../hooks/use-quote-product-pricing';
import { useUpdatePrice } from '../hooks/use-update-price';
import { formatPercentDisplay } from '../lib/format-percent';

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
  /**
   * Whether the caller's role may write prices to the marketplace (OWNER/ADMIN).
   * UX gating only — the backend enforces the same rule and 403s a MEMBER/VIEWER.
   * Defaults to `true` so the calculator works standalone (and the backend stays
   * the source of truth); the dashboard call sites pass the real capability.
   */
  canWritePrice?: boolean;
}

/**
 * Reverse-pricing calculator. Shell-agnostic: it renders the same content
 * whether mounted inline (desktop row-expand) or inside a Sheet (mobile), so it
 * contains NO Sheet/Dialog and NO product header (the desktop row sits above it;
 * the mobile Sheet shows the product in its own header). Layout is a two-column
 * grid (current state │ target); the result spans full width below.
 *
 * Frontend renders only — it performs NO money/percent math. Current numbers
 * come from the row (`item`); the solved price, signed price delta, and
 * breakdown come from the quote response; the typed value is forwarded to the
 * API as a string. A `calculable:false` quote is normal data — each `reason`
 * maps to a localized message.
 */
export function PricingCalculator({
  item,
  orgId,
  storeId,
  onClose,
  canWritePrice = true,
}: PricingCalculatorProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel');

  const [targetType, setTargetType] = React.useState<TargetType>(DEFAULT_TARGET);
  const [value, setValue] = React.useState<Decimal | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const quoteMutation = useQuoteProductPricing(orgId, storeId);
  const quote = quoteMutation.data ?? null;

  const updatePriceMutation = useUpdatePrice(orgId, storeId);

  // A solved, writable price exists only when the quote is calculable and
  // carries a concrete price. The save action gates on this — never on the math
  // (the frontend does no money math; it reads the solved string from the quote).
  const solvedPrice = quote?.calculable === true ? quote.price : undefined;
  const canSave = canWritePrice && solvedPrice !== undefined;

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

  const handleConfirmWrite = async (): Promise<void> => {
    if (solvedPrice === undefined) return;
    await updatePriceMutation.mutateAsync({
      orgId,
      storeId,
      variantId: item.variantId,
      salePrice: solvedPrice,
    });
  };

  const supportingMetrics: { id: string; label: string; value: React.ReactNode }[] = [
    { id: 'cost', label: t('currentSummary.cost'), value: <NullableMoney value={item.cost} /> },
    {
      id: 'netProfit',
      label: t('currentSummary.netProfit'),
      value: <NullableMoney value={item.netProfit} />,
    },
    {
      id: 'margin',
      label: t('currentSummary.margin'),
      value: formatPercentDisplay(item.saleMarginPct),
    },
    {
      id: 'markup',
      label: t('currentSummary.markup'),
      value: formatPercentDisplay(item.costMarkupPct),
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
              <MiniStat key={metric.id} label={metric.label} value={metric.value} />
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
        <Button onClick={() => setConfirmOpen(true)} disabled={!canSave}>
          {t('actions.save')}
        </Button>
      </footer>

      {/* Live, irreversible marketplace write — guarded by a destructive confirm.
          Only mounted once a writable price is solved so the body always has a
          concrete current → new pair to show. */}
      {solvedPrice !== undefined ? (
        <ConfirmWriteDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          currentSalePrice={item.salePrice}
          newSalePrice={solvedPrice}
          loading={updatePriceMutation.isPending}
          onConfirm={handleConfirmWrite}
        />
      ) : null}
    </div>
  );
}

/**
 * Confirmation gate for the live Trendyol price write. Built on the shared
 * `ConfirmDialog` (controlled, `tone='destructive'`, async `onConfirm` that the
 * dialog awaits and keeps open on rejection). The body shows the signed
 * current → new transition and the irreversibility / one-change-per-day warning
 * so the seller confirms with full context.
 */
function ConfirmWriteDialog({
  open,
  onOpenChange,
  currentSalePrice,
  newSalePrice,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSalePrice: string;
  newSalePrice: string;
  loading: boolean;
  onConfirm: () => Promise<void>;
}): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.save');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="destructive"
      title={t('confirmTitle')}
      description={t('confirmBody', {
        current: formatCurrency(currentSalePrice),
        new: formatCurrency(newSalePrice),
      })}
      confirmLabel={t('confirmLabel')}
      loading={loading}
      onConfirm={onConfirm}
    >
      {/* Current → new transition + the irreversibility warning, given visual
          weight beyond the description line. */}
      <div className="gap-sm flex flex-col">
        <div className="gap-sm bg-surface-subtle px-md py-sm flex flex-wrap items-baseline rounded-md">
          <Currency value={currentSalePrice} className="text-muted-foreground text-base" />
          <span className="text-muted-foreground text-sm" aria-hidden="true">
            →
          </span>
          <Currency value={newSalePrice} emphasis className="text-foreground text-lg" />
        </div>
        <Alert tone="warning" size="md" role="alert">
          <AlertDescription>{t('warning')}</AlertDescription>
        </Alert>
      </div>
    </ConfirmDialog>
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

/** Label-over-value mini stat cell — used by the current-state 2×2 grid. */
function MiniStat({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <span className="text-muted-foreground text-2xs">{label}</span>
      <div className="text-foreground text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

/** Emphasised result stat — a small surface chip with a prominent value, so the
 *  newly-solved margin / markup read as results rather than dull asides. */
function ResultStat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="bg-surface-subtle gap-3xs px-md py-sm flex flex-col rounded-md">
      <span className="text-muted-foreground text-2xs">{label}</span>
      <span className="text-foreground text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Money value from the row; null (uncostable) renders a muted dash. */
function NullableMoney({ value }: { value: string | null }): React.ReactElement {
  if (value === null) {
    return <span className="text-muted-foreground-dim tabular-nums">{EMPTY_VALUE}</span>;
  }
  return <Currency value={value} />;
}

/** True when a signed money string is zero (`0`, `0.00`, `-0.00`). */
function isZeroAmount(amount: string): boolean {
  return /^-?0(\.0+)?$/.test(amount);
}

/**
 * Signed price change vs the current price + the current-price reference.
 * Direction/colour read from the sign character (no math): a drop is
 * `destructive`, a rise is `success`. The magnitude renders via `formatCurrency`
 * with an explicit ± glyph; the absolute delta value comes from the backend.
 */
function PriceDelta({
  delta,
  currentSalePrice,
}: {
  delta: string | undefined;
  currentSalePrice: string;
}): React.ReactElement {
  const t = useTranslations('features.productPricing.panel');
  const showDelta = delta !== undefined && !isZeroAmount(delta);
  const isDrop = delta !== undefined && delta.startsWith('-');
  const magnitude = isDrop ? delta.slice(1) : (delta ?? '0');

  return (
    <div className="gap-sm flex flex-wrap items-baseline">
      {showDelta ? (
        <span
          className={cn(
            'text-sm font-medium tabular-nums',
            isDrop ? 'text-destructive' : 'text-success',
          )}
        >
          {isDrop ? '−' : '+'}
          {formatCurrency(magnitude)}
        </span>
      ) : null}
      <span className="text-muted-foreground text-2xs tabular-nums">
        {t('result.currentPrice', { price: formatCurrency(currentSalePrice) })}
      </span>
    </div>
  );
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
 * Result block, mirroring the current-state card: a hero new sale price with a
 * signed delta + current-price reference, then new margin / markup mini-stats,
 * then the full breakdown. `calculable:false` → a warning keyed by reason.
 * NO duplicate margin/markup footer, NO frontend money math.
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
      {/* Hero — the answer: new sale price + signed delta + current reference. */}
      <div className="gap-3xs flex flex-col">
        <span className="text-muted-foreground text-xs">{t('result.newPrice')}</span>
        <div className="gap-sm flex flex-wrap items-baseline">
          <Currency value={quote.price} emphasis className="text-foreground text-3xl" />
          <PriceDelta delta={quote.priceDelta} currentSalePrice={currentSalePrice} />
        </div>
      </div>

      {/* New margin / markup — grouped, emphasised result chips (not the dull,
          far-apart spread of plain mini-stats). */}
      <div className="gap-sm flex flex-wrap">
        <ResultStat
          label={t('result.newMargin')}
          value={formatPercentDisplay(breakdown.saleMarginPct)}
        />
        <ResultStat
          label={t('result.newMarkup')}
          value={formatPercentDisplay(breakdown.costMarkupPct)}
        />
      </div>

      <QuoteBreakdown breakdown={breakdown} />
    </Card>
  );
}
