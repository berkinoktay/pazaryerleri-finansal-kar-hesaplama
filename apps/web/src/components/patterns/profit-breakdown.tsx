'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// Spec'te ProfitBreakdown component'i nullable (field opsiyonel) → NonNullable ile
// obje tipini al (keyof'un çalışması için); null'ı prop seviyesinde geri ekliyoruz.
type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;

export interface ProfitBreakdownCardProps {
  /** Backend-hesaplı kâr dökümü; null = profit-excluded / maliyet eksik. */
  breakdown: ProfitBreakdownData | null;
  /** Son kâr satırı etiketi; varsayılan "Tahmini kâr". Settled yüzeyde "Fiili kâr" geçilir. */
  profitLabel?: string;
  className?: string;
}

// Düşülen kalemler — config-driven, sıra = Berkin'in otoritatif formülü.
// (Stopaj kalemi GROSS dökümünde ayrı satır olarak servis edilmiyor — backend
//  ProfitBreakdown'da stoppage alanı yok; düşülen toplamlar/Net KDV içinde.)
const DEDUCTION_ROWS = [
  { key: 'cost', amount: 'costGross' },
  { key: 'commission', amount: 'commissionGross' },
  { key: 'shipping', amount: 'shippingGross' },
  { key: 'platformService', amount: 'platformServiceGross' },
] as const satisfies ReadonlyArray<{ key: string; amount: keyof ProfitBreakdownData }>;

// Net KDV kırılımı: Satış KDV (+) − diğer KDV'ler (−) = Net KDV.
const VAT_ROWS = [
  { key: 'saleVat', amount: 'saleVat', positive: true },
  { key: 'costVat', amount: 'costVat', positive: false },
  { key: 'commissionVat', amount: 'commissionVat', positive: false },
  { key: 'shippingVat', amount: 'shippingVat', positive: false },
  { key: 'platformServiceVat', amount: 'platformServiceVat', positive: false },
] as const satisfies ReadonlyArray<{
  key: string;
  amount: keyof ProfitBreakdownData;
  positive: boolean;
}>;

/**
 * Kâr dökümü kartı — Berkin'in otoritatif formülünü ekrana koyar:
 * Satış − Maliyet − Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr.
 *
 * **Tüm değerler backend-hesaplı** (`buildProfitBreakdown` + persist netVat);
 * bu bileşen HİÇBİR finansal türetme yapmaz (feedback_no_frontend_financial_calculation)
 * — eksi işaretleri salt gösterim glyph'i, aritmetik değil. Kârın gösterildiği her
 * yüzeyde (order detail, live-performance, karlılık) aynı şekilde kullanılır.
 */
export function ProfitBreakdownCard({
  breakdown,
  profitLabel,
  className,
}: ProfitBreakdownCardProps): React.ReactElement {
  const t = useTranslations('profitBreakdown');
  const finalProfitLabel = profitLabel ?? t('estimatedProfit');

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {breakdown === null ? (
          <p className="text-muted-foreground text-sm">{t('unavailable')}</p>
        ) : (
          <dl className="gap-2xs flex flex-col text-sm">
            {/* Satıcı indirimi varsa şeffaflık: Liste → İndirim → Net satış (denetim #1).
                İndirim yoksa ('0.00') tek "Satış" satırı. String karşılaştırma = aritmetik DEĞİL. */}
            {breakdown.sellerDiscountGross !== '0.00' ? (
              <>
                <BreakdownRow label={t('listPrice')}>
                  <Currency value={breakdown.listGross} />
                </BreakdownRow>
                <BreakdownRow label={t('sellerDiscount')}>
                  <SignedAmount value={breakdown.sellerDiscountGross} positive={false} />
                </BreakdownRow>
                <BreakdownRow label={t('netSale')} emphasis>
                  <Currency value={breakdown.saleGross} />
                </BreakdownRow>
              </>
            ) : (
              <BreakdownRow label={t('sale')}>
                <Currency value={breakdown.saleGross} />
              </BreakdownRow>
            )}

            {DEDUCTION_ROWS.map((row) => (
              <BreakdownRow key={row.key} label={t(row.key)}>
                <SignedAmount value={breakdown[row.amount]} positive={false} />
              </BreakdownRow>
            ))}

            <Collapsible>
              <div className="gap-sm flex items-center justify-between">
                <CollapsibleTrigger className="gap-3xs text-muted-foreground hover:text-foreground group flex items-center transition-colors">
                  <span>{t('netVat')}</span>
                  <ArrowDown01Icon className="size-icon-xs transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <SignedAmount value={breakdown.netVat} positive={false} />
              </div>
              <CollapsibleContent className="gap-3xs pt-3xs pl-sm mt-3xs flex flex-col border-l">
                {VAT_ROWS.map((row) => (
                  <BreakdownRow key={row.key} label={t(row.key)} muted>
                    <SignedAmount value={breakdown[row.amount]} positive={row.positive} />
                  </BreakdownRow>
                ))}
                <BreakdownRow label={t('netVatResult')} muted>
                  <SignedAmount value={breakdown.netVat} positive={false} />
                </BreakdownRow>
              </CollapsibleContent>
            </Collapsible>

            <div className="pt-xs mt-3xs gap-2xs flex flex-col border-t">
              <BreakdownRow label={finalProfitLabel} emphasis>
                <Currency value={breakdown.netProfit} emphasis />
              </BreakdownRow>
              {/* Marj backend-hesaplı (saleMarginPct); '—' payda 0 (satış brüt 0).
                  String'i biz formatlamıyoruz — yüzde glyph'i salt gösterim. */}
              <BreakdownRow label={t('margin')} muted>
                <span className="tabular-nums">
                  {breakdown.saleMarginPct === null ? '—' : `${breakdown.saleMarginPct}%`}
                </span>
              </BreakdownRow>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  label,
  children,
  muted = false,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  emphasis?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn(muted && 'text-muted-foreground', emphasis && 'font-semibold')}>{label}</dt>
      <dd className={cn('tabular-nums', emphasis && 'font-semibold')}>{children}</dd>
    </div>
  );
}

/**
 * Gösterim amaçlı işaretli tutar. Değer backend'den İŞARETLİ gelebilir (Net KDV
 * negatif olabilir — input KDV > output). İşareti STRING'den türetiyoruz, hiçbir
 * aritmetik yapmıyoruz (no-frontend-financial-calculation): magnitude'u Currency'ye
 * verip Intl'in kendi eksisini basmasını engelliyoruz (yoksa "−" + "-₺" = çift-eksi),
 * glyph'i biz koyuyoruz.
 *
 * `positive=true` (örn. Satış KDV) artı-yönlü satır, `false` deduction satırı.
 * Negatif served değer yönü TERS çevirir: negatif Net KDV satıcı LEHİNEdir (+).
 */
function SignedAmount({
  value,
  positive,
}: {
  value: string;
  positive: boolean;
}): React.ReactElement {
  const isNegative = value.startsWith('-');
  const magnitude = isNegative ? value.slice(1) : value;
  const showMinus = positive ? isNegative : !isNegative;
  return (
    <span className="tabular-nums">
      {showMinus ? '−' : '+'}
      <Currency value={magnitude} />
    </span>
  );
}
