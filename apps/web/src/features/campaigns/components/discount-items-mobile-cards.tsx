'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { ProductImageCell } from '@/components/patterns/product-image-cell';
import { ProfitBadge } from '@/components/patterns/profit-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useMarginColoring } from '@/lib/margin-coloring-context';

import { useDiscountReasonEmptyLabel } from '../hooks/use-discount-reason-label';
import type { DiscountRow, DiscountScenarioPresentation } from '../lib/adapt-discount-list';
import { useCampaignAccess } from '../lib/campaign-access-context';
import { DiscountCommissionCell } from './discount-commission-cell';
import type { DiscountScenarioKey } from './discount-items-table';
import { ProfitDelta } from './profit-delta';

export interface DiscountItemsMobileCardsProps {
  rows: readonly DiscountRow[];
  /**
   * The list's discounted-section layout: `UNIT` shows the discounted unit price, `ORDER` reframes
   * to the whole campaign order (customer-paid basket + order-level profit). Backend-decided; keeps
   * full parity with the desktop table.
   */
  presentation: DiscountScenarioPresentation;
  /** The client's EPHEMERAL local selection — drives each card checkbox's checked state. */
  selectedIds: ReadonlySet<string>;
  /** Detail-level commission tariff NAME feeding the bands — the band tooltip's first part. */
  commissionTariffName: string | null;
  /** Detail-level commission tariff PERIOD label — the band tooltip's second part. */
  commissionPeriodLabel: string | null;
  selectionsPending: boolean;
  onToggleInclude: (itemId: string, included: boolean) => void;
  onOpenBreakdown: (row: DiscountRow, scenario: DiscountScenarioKey) => void;
}

/**
 * Mobile layout for the İndirimler detail — one card per product as a TOP-TO-BOTTOM flow so
 * nothing competes horizontally. Full data parity with the desktop table: the participation
 * checkbox + identity on top, then the CURRENT and DISCOUNTED price scenarios (price + clickable
 * profit badge, with the "güncele göre" delta under the discounted badge). Shown below the `md`
 * breakpoint; the desktop table is hidden there.
 */
export function DiscountItemsMobileCards({
  rows,
  presentation,
  selectedIds,
  commissionTariffName,
  commissionPeriodLabel,
  selectionsPending,
  onToggleInclude,
  onOpenBreakdown,
}: DiscountItemsMobileCardsProps): React.ReactElement {
  const t = useTranslations('discountsPage.table');
  const tScenario = useTranslations('discountsPage.scenario');
  const reasonEmptyLabel = useDiscountReasonEmptyLabel();
  const scale = useMarginColoring();
  // A member who cannot write still sees each participation checkbox, but cannot tick it.
  const { canWrite } = useCampaignAccess();
  // ORDER lists reframe the discounted section to the whole campaign order; UNIT keeps the unit.
  const discountedHeader = presentation === 'ORDER' ? t('campaignOrder') : t('discountedPrice');

  return (
    <div className="gap-sm flex flex-col">
      {rows.map((row) => {
        const meta = [row.brand, row.color, row.modelCode]
          .filter((value): value is string => value !== null && value !== '')
          .join(' · ');
        const emptyLabel = reasonEmptyLabel(row.reason);
        return (
          <div
            key={row.id}
            className="border-border bg-card gap-md p-md flex flex-col rounded-lg border"
          >
            {/* Identity — checkbox + image + title/meta. */}
            <div className="gap-sm flex min-w-0 items-start">
              <Checkbox
                checked={selectedIds.has(row.id)}
                disabled={selectionsPending || !canWrite}
                aria-label={t('includeRow')}
                onCheckedChange={(next) => onToggleInclude(row.id, next === true)}
                className="mt-3xs cursor-pointer"
              />
              <ProductImageCell url={row.imageUrl} alt={row.productTitle} size="xl" fit="contain" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{row.productTitle}</div>
                <div className="text-2xs text-muted-foreground mt-3xs tabular-nums">
                  {meta !== '' ? <span>{meta}</span> : null}
                  {meta !== '' ? <span> · </span> : null}
                  <span>{row.barcode}</span>
                </div>
              </div>
            </div>

            {/* Current baseline. */}
            <div className="border-border pt-md gap-2xs flex flex-col border-t">
              <span className="text-2xs text-muted-foreground font-medium">
                {t('currentPrice')}
              </span>
              <div className="gap-sm flex items-center justify-between">
                <Currency value={row.current.price} className="text-sm font-medium" />
                <ProfitBadge
                  value={row.current.netProfit}
                  marginPct={row.current.marginPct}
                  scale={scale}
                  onOpen={() => onOpenBreakdown(row, 'current')}
                  emptyLabel={emptyLabel}
                />
              </div>
            </div>

            {/* Discounted scenario — ORDER reframes to the whole campaign order (customer-paid
                basket + order-level profit + "kampanyasız N adede göre" delta); UNIT keeps the
                discounted unit price + "güncele göre" delta. Full parity with the desktop table. */}
            <div className="border-border pt-md gap-2xs flex flex-col border-t">
              <span className="text-2xs text-muted-foreground font-medium">{discountedHeader}</span>
              {presentation === 'ORDER' && row.scenario !== null ? (
                <>
                  <div className="gap-sm flex items-center justify-between">
                    <div className="gap-2xs flex items-baseline">
                      <Currency
                        value={row.scenario.basketPaidTotal}
                        className="text-sm font-medium"
                      />
                      <span className="text-2xs text-muted-foreground">
                        {tScenario('rowQty', { qty: row.scenario.assumedQuantity })}
                      </span>
                    </div>
                    <ProfitBadge
                      value={row.scenario.orderNetProfit}
                      marginPct={row.scenario.orderMarginPct}
                      scale={scale}
                      onOpen={() => onOpenBreakdown(row, 'discounted')}
                      emptyLabel={emptyLabel}
                    />
                  </div>
                  <ProfitDelta
                    optionNetProfit={row.scenario.orderNetProfit}
                    currentNetProfit={row.scenario.currentOrderNetProfit}
                    label={tScenario('vsWithoutCampaign', { qty: row.scenario.assumedQuantity })}
                  />
                </>
              ) : (
                <>
                  <div className="gap-sm flex items-center justify-between">
                    <Currency value={row.discounted.price} className="text-sm font-medium" />
                    <ProfitBadge
                      value={row.discounted.netProfit}
                      marginPct={row.discounted.marginPct}
                      scale={scale}
                      onOpen={() => onOpenBreakdown(row, 'discounted')}
                      emptyLabel={emptyLabel}
                    />
                  </div>
                  <ProfitDelta
                    optionNetProfit={row.discounted.netProfit}
                    currentNetProfit={row.current.netProfit}
                    label={t('delta')}
                  />
                </>
              )}
            </div>

            {/* Commission — the rate used on the discounted price, with the band-jump transition. */}
            <div className="border-border pt-md gap-2xs flex flex-col border-t">
              <span className="text-2xs text-muted-foreground font-medium">{t('commission')}</span>
              <DiscountCommissionCell
                current={row.current}
                discounted={row.discounted}
                tariffName={commissionTariffName}
                periodLabel={commissionPeriodLabel}
                commissionBands={row.commissionBands}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
