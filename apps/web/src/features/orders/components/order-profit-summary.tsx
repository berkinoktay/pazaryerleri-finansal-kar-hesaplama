'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import {
  AllocationBar,
  AllocationGroupCollapsible,
  AllocationGroupHeader,
  AllocationLine,
  AllocationSectionLabel,
} from '@/components/patterns/profit-allocation';
import { SignedAmount } from '@/components/patterns/signed-amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  buildProfitAllocation,
  type ProfitAllocationSegment,
  type ProfitGroupKey,
} from '@/lib/build-profit-allocation';

type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;
type PromotionDisplay = NonNullable<
  NonNullable<components['schemas']['OrderDetail']>['promotionDisplays']
>[number];

export interface OrderProfitSummaryProps {
  breakdown: ProfitBreakdownData | null;
  promotionDisplays?: PromotionDisplay[] | null;
  micro?: boolean;
}

/**
 * "Kâr dökümü" — kârın hikâyesini sıfırdan kurgulayan içerik (eski satır defteri
 * DEĞİL): gelir kurgusu → "satış nereye gitti" gruplu tahsis (grup payı %) →
 * öneriler. Kâr hesabındaki HER değer eksiksiz ulaşılabilir; her grubun ne kadar
 * yer kapladığı payla görünür.
 *
 * **Hiçbir finansal değer türetilmez**: grup toplamları backend'den (`buildProfitAllocation`
 * yalnız gösterim payını türetir), işaretler string'den (`SignedAmount`).
 */
export function OrderProfitSummary({
  breakdown,
  promotionDisplays,
  micro = false,
}: OrderProfitSummaryProps): React.ReactElement {
  const t = useTranslations('profitBreakdown');
  const formatter = useFormatter();
  const promotions = promotionDisplays ?? [];

  const pct = (percent: number): string => formatter.number(percent / 100, 'percentInt');
  const segmentOf = (
    segments: ProfitAllocationSegment[],
    key: ProfitGroupKey,
  ): ProfitAllocationSegment => segments.find((s) => s.key === key) ?? segments[0];

  const allocation = breakdown === null ? null : buildProfitAllocation(breakdown);
  const hasReturn = breakdown !== null && breakdown.returnShippingGross !== '0.00';

  return (
    <Card>
      <CardHeader>
        <div className="gap-xs flex flex-wrap items-center">
          <CardTitle>{t('title')}</CardTitle>
          {micro ? (
            <Badge tone="neutral" size="sm">
              {t('microExport')}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="gap-lg flex flex-col">
        {breakdown === null || allocation === null ? (
          <p className="text-muted-foreground text-sm">{t('unavailable')}</p>
        ) : (
          <>
            {/* ── Gelir: net satışın kurgusu (tüm gelir değerleri görünür) ── */}
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
                    {promotions.length > 0 ? (
                      <div className="gap-3xs pl-sm border-border-muted ml-3xs flex flex-col border-l">
                        {promotions.map((promo, index) => (
                          <AllocationLine
                            key={`${promo.displayName}-${index}`}
                            label={promo.displayName}
                            muted
                          >
                            <SignedAmount value={promo.amountGross} positive={false} />
                          </AllocationLine>
                        ))}
                      </div>
                    ) : null}
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
                {micro ? (
                  <p className="text-muted-foreground text-2xs">{t('exportVatExemption')}</p>
                ) : null}
              </dl>
            </section>

            {/* ── Satış nereye gitti: gruplu tahsis (bar + açılır gruplar) ── */}
            <section>
              <AllocationSectionLabel
                label={t('allocationTitle')}
                total={<Currency value={breakdown.saleGross} />}
              />
              {allocation.barRenderable ? (
                <AllocationBar segments={allocation.segments} label={t('allocationTitle')} />
              ) : null}

              <div className="mt-md flex flex-col">
                {/* Ürün maliyeti — yaprak (ürün kırılımı Ürünler bölümünde) */}
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
                  {hasReturn ? (
                    <>
                      <AllocationLine label={t('shippingTotal')}>
                        <SignedAmount value={breakdown.shippingGross} positive={false} />
                      </AllocationLine>
                      <div className="gap-3xs pl-sm border-border-muted ml-3xs flex flex-col border-l">
                        <AllocationLine label={t('outboundShipping')} muted>
                          <SignedAmount value={breakdown.outboundShippingGross} positive={false} />
                        </AllocationLine>
                        <AllocationLine label={t('returnShipping')} muted>
                          <SignedAmount value={breakdown.returnShippingGross} positive={false} />
                        </AllocationLine>
                      </div>
                    </>
                  ) : (
                    <AllocationLine label={t('shipping')}>
                      <SignedAmount value={breakdown.shippingGross} positive={false} />
                    </AllocationLine>
                  )}
                  {breakdown.platformServiceGross !== '0.00' ? (
                    <AllocationLine label={t('platformService')}>
                      <SignedAmount value={breakdown.platformServiceGross} positive={false} />
                    </AllocationLine>
                  ) : null}
                  {breakdown.internationalServiceGross !== '0.00' ? (
                    <AllocationLine label={t('internationalService')}>
                      <SignedAmount value={breakdown.internationalServiceGross} positive={false} />
                    </AllocationLine>
                  ) : null}
                  {breakdown.overseasReturnOperationGross !== '0.00' ? (
                    <AllocationLine label={t('overseasReturnOperation')}>
                      <SignedAmount
                        value={breakdown.overseasReturnOperationGross}
                        positive={false}
                      />
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
                    {hasReturn ? (
                      <>
                        <AllocationLine label={t('outboundShippingVat')} muted>
                          <SignedAmount value={breakdown.outboundShippingVat} positive={false} />
                        </AllocationLine>
                        <AllocationLine label={t('returnShippingVat')} muted>
                          <SignedAmount value={breakdown.returnShippingVat} positive={false} />
                        </AllocationLine>
                      </>
                    ) : (
                      <AllocationLine label={t('shippingVat')} muted>
                        <SignedAmount value={breakdown.shippingVat} positive={false} />
                      </AllocationLine>
                    )}
                    {breakdown.platformServiceVat !== '0.00' ? (
                      <AllocationLine label={t('platformServiceVat')} muted>
                        <SignedAmount value={breakdown.platformServiceVat} positive={false} />
                      </AllocationLine>
                    ) : null}
                    {breakdown.internationalServiceVat !== '0.00' ? (
                      <AllocationLine label={t('internationalServiceVat')} muted>
                        <SignedAmount value={breakdown.internationalServiceVat} positive={false} />
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
      </CardContent>
    </Card>
  );
}
