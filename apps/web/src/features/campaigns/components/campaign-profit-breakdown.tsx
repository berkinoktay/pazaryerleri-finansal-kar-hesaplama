'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import { ImageCell } from '@/components/patterns/image-cell';
import {
  AllocationBar,
  AllocationGroupCollapsible,
  AllocationGroupHeader,
  AllocationLine,
  AllocationSectionLabel,
} from '@/components/patterns/profit-allocation';
import { SignedAmount } from '@/components/patterns/signed-amount';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  buildProfitAllocation,
  type ProfitAllocationSegment,
  type ProfitGroupKey,
} from '@/lib/build-profit-allocation';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';

import { ProfitDelta } from './profit-delta';

type QuoteBreakdownData = NonNullable<components['schemas']['QuoteBreakdown']>;

export interface CampaignProfitBreakdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title (per-vertical wording). */
  title: string;
  productTitle: string;
  /** Product image URL (barcode-matched); null/undefined renders the icon fallback. */
  imageUrl?: string | null;
  /** Product code shown under the title (stok kodu / barkod); optional. */
  stockCode?: string | null;
  /** Backend estimate breakdown — null before the first fetch or when uncalculable. */
  breakdown: QuoteBreakdownData | null;
  /** Applied commission percent (e.g. "19.00"); shown in the what-if context line. */
  commissionPct?: string | null;
  /** Resolved not-calculable reason text (the caller maps its vertical's enum). */
  reasonText?: string | null;
  /** True while the estimate request is in flight. */
  loading: boolean;
  /** Profit eyebrow label; defaults to "Tahmini kâr". */
  profitLabel?: string;
  /** Current-scenario net profit — the "do nothing" baseline for the "Güncele göre" delta. */
  currentNetProfit?: string | null;
}

const segmentOf = (
  segments: ProfitAllocationSegment[],
  key: ProfitGroupKey,
): ProfitAllocationSegment => segments.find((s) => s.key === key) ?? segments[0];

/**
 * Premium what-if profit dialog for the campaign pages (komisyon / Plus / avantaj /
 * flaş). Opened from a scenario's profit badge, it answers "bu fiyata satarsam ne
 * kazanırım?": the product, the target sale price + applied commission, the estimated
 * profit (margin-tinted) with margin / oran / "güncele göre" delta, and the full
 * "satış nereye gitti" allocation — every value the profit is built from, each with
 * its share.
 *
 * Every figure is backend-computed (the estimate engine + `serializeBreakdown`'s group
 * totals). This renders — it never sums money: `SignedAmount` glyphs are display only,
 * the shares come from {@link buildProfitAllocation} (a presentation ratio), and the
 * delta is display math on two already-computed profits (see {@link ProfitDelta}).
 */
export function CampaignProfitBreakdown({
  open,
  onOpenChange,
  title,
  productTitle,
  imageUrl,
  stockCode,
  breakdown,
  commissionPct,
  reasonText,
  loading,
  profitLabel,
  currentNetProfit,
}: CampaignProfitBreakdownProps): React.ReactElement {
  const t = useTranslations('profitBreakdown');
  const tCommon = useTranslations('common');
  const formatter = useFormatter();
  const scale = useMarginColoring();

  const pct = (percent: number): string => formatter.number(percent / 100, 'percentInt');
  // Only derive the allocation when the dialog is actually open: a table mounts a
  // dozen of these (one per scenario cell) in the CLOSED state, and Radix renders no
  // content then, so computing it would be pure waste on every keystroke-driven
  // estimate refresh.
  const allocation = open && breakdown !== null ? buildProfitAllocation(breakdown) : null;
  const marginColor =
    open && breakdown !== null ? marginColorStyle(breakdown.saleMarginPct, scale) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="campaign-breakdown-modal flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="pr-3xs min-h-0 flex-1 overflow-y-auto">
          <div className="gap-lg flex flex-col">
            {/* ── Ürün kimliği ── */}
            <div className="gap-sm flex items-center">
              <ImageCell src={imageUrl} alt={productTitle} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{productTitle}</div>
                {stockCode != null && stockCode !== '' ? (
                  <div className="text-2xs text-muted-foreground truncate tabular-nums">
                    {stockCode}
                  </div>
                ) : null}
              </div>
            </div>

            {loading ? (
              <BreakdownSkeleton label={tCommon('loading')} />
            ) : breakdown === null || allocation === null ? (
              <p className="text-muted-foreground text-sm">{reasonText ?? t('notCalculable')}</p>
            ) : (
              <>
                {/* ── Sonuç: bu fiyata satarsam ── */}
                <div className="bg-muted p-md gap-md flex flex-col rounded-lg">
                  <div className="gap-x-md gap-y-3xs text-2xs text-muted-foreground flex flex-wrap">
                    <span>
                      {t('salePrice')}{' '}
                      <span className="text-foreground font-medium tabular-nums">
                        <Currency value={breakdown.saleGross} />
                      </span>
                    </span>
                    {commissionPct != null ? (
                      <span>
                        {t('commission')}{' '}
                        <span className="text-foreground font-medium tabular-nums">
                          {formatPercentDisplay(commissionPct)}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  <div className="gap-2xs flex flex-col">
                    <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
                      {profitLabel ?? t('estimatedProfit')}
                    </span>
                    {/* runtime-dynamic: net kâr rengi marj rampasından (kullanıcı ölçeği) */}
                    <Currency
                      value={breakdown.netProfit}
                      className="text-4xl leading-none font-semibold tracking-tight"
                      style={marginColor}
                    />
                    <ProfitDelta
                      optionNetProfit={breakdown.netProfit}
                      currentNetProfit={currentNetProfit ?? null}
                      label={t('vsCurrent')}
                      className="text-sm"
                    />
                  </div>

                  <div className="gap-xl flex flex-wrap">
                    <HeroStat
                      label={t('margin')}
                      value={formatPercentDisplay(breakdown.saleMarginPct)}
                      style={marginColor}
                    />
                    {breakdown.costMarkupPct !== null ? (
                      <HeroStat
                        label={t('roi')}
                        value={formatPercentDisplay(breakdown.costMarkupPct)}
                      />
                    ) : null}
                  </div>
                </div>

                {/* ── Gelir: net satışın kurgusu ── */}
                <section>
                  <AllocationSectionLabel label={t('incomeLabel')} />
                  <dl className="gap-3xs mt-sm flex flex-col text-sm">
                    {breakdown.sellerDiscountGross !== '0.00' ? (
                      <>
                        <AllocationLine label={t('listPrice')} muted>
                          <Currency value={breakdown.listGross} />
                        </AllocationLine>
                        <AllocationLine label={t('sellerDiscount')} muted>
                          <SignedAmount value={breakdown.sellerDiscountGross} positive={false} />
                        </AllocationLine>
                        <AllocationLine label={t('netSale')} emphasis>
                          <Currency value={breakdown.saleGross} />
                        </AllocationLine>
                      </>
                    ) : (
                      <AllocationLine label={t('sale')} emphasis>
                        <Currency value={breakdown.saleGross} />
                      </AllocationLine>
                    )}
                    <AllocationLine label={t('incomeSaleVat')} muted>
                      <Currency value={breakdown.saleVat} />
                    </AllocationLine>
                  </dl>
                </section>

                {/* ── Satış nereye gitti: gruplu tahsis ── */}
                <section>
                  <AllocationSectionLabel
                    label={t('allocationTitle')}
                    total={<Currency value={breakdown.saleGross} />}
                  />
                  {allocation.barRenderable ? (
                    <AllocationBar segments={allocation.segments} label={t('allocationTitle')} />
                  ) : null}

                  <div className="mt-md flex flex-col">
                    {/* Ürün maliyeti — yaprak */}
                    <AllocationGroupHeader
                      segment={segmentOf(allocation.segments, 'cost')}
                      name={t('groups.cost')}
                      pct={pct}
                    />
                    {/* Pazaryeri kesintileri — açılır */}
                    <AllocationGroupCollapsible
                      segment={segmentOf(allocation.segments, 'marketplace')}
                      name={t('groups.marketplace')}
                      pct={pct}
                    >
                      <AllocationLine label={t('commission')}>
                        <SignedAmount value={breakdown.commissionGross} positive={false} />
                      </AllocationLine>
                      <AllocationLine label={t('shipping')}>
                        <SignedAmount value={breakdown.shippingGross} positive={false} />
                      </AllocationLine>
                      {breakdown.platformServiceGross !== '0.00' ? (
                        <AllocationLine label={t('platformService')}>
                          <SignedAmount value={breakdown.platformServiceGross} positive={false} />
                        </AllocationLine>
                      ) : null}
                    </AllocationGroupCollapsible>
                    {/* Vergiler — açılır (stopaj + Net KDV tam mahsup) */}
                    <AllocationGroupCollapsible
                      segment={segmentOf(allocation.segments, 'taxes')}
                      name={t('groups.taxes')}
                      pct={pct}
                    >
                      {breakdown.stoppage !== '0.00' ? (
                        <AllocationLine label={t('stoppage')}>
                          <SignedAmount value={breakdown.stoppage} positive={false} />
                        </AllocationLine>
                      ) : null}
                      <AllocationLine label={t('netVat')}>
                        <SignedAmount value={breakdown.netVat} positive={false} />
                      </AllocationLine>
                      <div className="gap-3xs pl-sm border-border-muted ml-3xs flex flex-col border-l">
                        <AllocationLine label={t('saleVat')} muted>
                          <SignedAmount value={breakdown.saleVat} positive />
                        </AllocationLine>
                        <AllocationLine label={t('costVat')} muted>
                          <SignedAmount value={breakdown.costVat} positive={false} />
                        </AllocationLine>
                        <AllocationLine label={t('commissionVat')} muted>
                          <SignedAmount value={breakdown.commissionVat} positive={false} />
                        </AllocationLine>
                        <AllocationLine label={t('shippingVat')} muted>
                          <SignedAmount value={breakdown.shippingVat} positive={false} />
                        </AllocationLine>
                        {breakdown.platformServiceVat !== '0.00' ? (
                          <AllocationLine label={t('platformServiceVat')} muted>
                            <SignedAmount value={breakdown.platformServiceVat} positive={false} />
                          </AllocationLine>
                        ) : null}
                      </div>
                    </AllocationGroupCollapsible>
                    {/* Net kâr — yaprak (yeşil) */}
                    <AllocationGroupHeader
                      segment={segmentOf(allocation.segments, 'profit')}
                      name={t('groups.profit')}
                      pct={pct}
                      emphasize
                    />
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HeroStat({
  label,
  value,
  style,
}: {
  label: string;
  value: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </span>
      {/* runtime-dynamic: marj değeri marj rampasıyla renklenir (Kâr oranı nötr) */}
      <span className="text-xl font-semibold tracking-tight tabular-nums" style={style}>
        {value}
      </span>
    </div>
  );
}

/* Mirrors the loaded anatomy — hero panel + income + allocation — so the modal holds
   a stable height instead of jumping when the estimate lands. */
function BreakdownSkeleton({ label }: { label: string }): React.ReactElement {
  return (
    <div role="status" aria-busy aria-label={label} className="gap-lg flex flex-col">
      <div className="bg-muted p-md gap-md flex flex-col rounded-lg">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-32" />
        <div className="gap-xl flex">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="gap-2xs flex flex-col">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="gap-sm flex flex-col">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    </div>
  );
}
