'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

// Spec'te ProfitBreakdown component'i nullable (field opsiyonel) → NonNullable ile
// obje tipini al (keyof'un çalışması için); null'ı prop seviyesinde geri ekliyoruz.
type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;

/** Sipariş düzeyindeki promosyon gösterimi (spec ekleme #3). */
type PromotionDisplay = NonNullable<
  NonNullable<components['schemas']['OrderDetail']>['promotionDisplays']
>[number];

export interface ProfitBreakdownCardProps {
  /** Backend-hesaplı kâr dökümü; null = profit-excluded / maliyet eksik. */
  breakdown: ProfitBreakdownData | null;
  /** Son kâr satırı etiketi; varsayılan "Tahmini kâr". Settled yüzeyde "Fiili kâr" geçilir. */
  profitLabel?: string;
  /**
   * Sipariş düzeyindeki promosyon isimleri + brüt tutarları (spec ekleme #3).
   * Breakdown'a değil siparişe ait; varsa satıcı-indirimi satırının yanında
   * promosyon adları gösterilir. null/boş → promosyon satırı çizilmez.
   */
  promotionDisplays?: PromotionDisplay[] | null;
  /**
   * Mikro ihracat siparişi mi (Trendyol `Order.micro`). true ise: başlıkta "Mikro
   * İhracat" rozeti + satış altında "KDV %0 — İhracat istisnası" notu. Uluslararası
   * Hizmet / Yurt Dışı İade Operasyon ücret satırları zaten tutar varken kendiliğinden
   * görünür (breakdown alanları), bu flag yalnız bağlam/etiket içindir.
   */
  micro?: boolean;
  className?: string;
}

// Düşülen kalemler — config-driven, sıra = Berkin'in otoritatif formülü:
// Satış − Maliyet − Komisyon − Kargo − PSF − Stopaj − Net KDV = Kâr.
// Stopaj ayrı bir düşülen brüt terim (backend `stoppage`; KDV-siz, Net KDV'ye
// katlanmaz). Çoğu siparişte '0.00' (yalnız teslim sonrası kesilir) → sıfırken
// satır gizlenir (gürültü yok); değer varken görünür olur ki Σ kâra kapansın.
// Kargo (gidiş/iade) bu iki grubun ARASINDA koşullu render edilir: iade yoksa tek düz
// "Kargo" satırı, iade varsa "Toplam kargo bedeli" collapsible (Net KDV deseniyle aynı).
const DEDUCTION_ROWS_PRE_SHIPPING = [
  { key: 'cost', amount: 'costGross' },
  { key: 'commission', amount: 'commissionGross' },
] as const satisfies ReadonlyArray<{ key: string; amount: keyof ProfitBreakdownData }>;
const DEDUCTION_ROWS_POST_SHIPPING = [
  { key: 'platformService', amount: 'platformServiceGross' },
] as const satisfies ReadonlyArray<{ key: string; amount: keyof ProfitBreakdownData }>;

// Net KDV kırılımı: Satış KDV (+) − diğer KDV'ler (−) = Net KDV.
// Kargo KDV de gidiş/iade için aynı şekilde aralarında koşullu render edilir.
const VAT_ROWS_PRE_SHIPPING = [
  { key: 'saleVat', amount: 'saleVat', positive: true },
  { key: 'costVat', amount: 'costVat', positive: false },
  { key: 'commissionVat', amount: 'commissionVat', positive: false },
] as const satisfies ReadonlyArray<{
  key: string;
  amount: keyof ProfitBreakdownData;
  positive: boolean;
}>;
const VAT_ROWS_POST_SHIPPING = [
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
  promotionDisplays,
  micro = false,
  className,
}: ProfitBreakdownCardProps): React.ReactElement {
  const t = useTranslations('profitBreakdown');
  const finalProfitLabel = profitLabel ?? t('estimatedProfit');
  const promotions = promotionDisplays ?? [];

  return (
    <Card className={className}>
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
                {/* Promosyon adları (spec ekleme #3): backend yakaladıysa indirimin
                    hangi promosyondan geldiğini satıcı görür. Tutar backend-servisli. */}
                {promotions.length > 0 ? (
                  <div className="gap-3xs pl-sm flex flex-col border-l">
                    <span className="text-muted-foreground text-2xs">{t('promotions')}</span>
                    {promotions.map((promo, index) => (
                      <BreakdownRow
                        key={`${promo.displayName}-${index}`}
                        label={promo.displayName}
                        muted
                      >
                        <SignedAmount value={promo.amountGross} positive={false} />
                      </BreakdownRow>
                    ))}
                  </div>
                ) : null}
                <BreakdownRow label={t('netSale')} emphasis>
                  <Currency value={breakdown.saleGross} />
                </BreakdownRow>
              </>
            ) : (
              <BreakdownRow label={t('sale')}>
                <Currency value={breakdown.saleGross} />
              </BreakdownRow>
            )}

            {/* Mikro ihracat: satış KDV %0 (ihracat istisnası 3065/11-1-a). Net KDV
                collapsible'ında "Satış KDV: 0,00" satırı kalır; bu not satırın neden
                sıfır olduğunu satışın hemen altında görünür kılar (collapse açmadan). */}
            {micro ? (
              <p className="text-muted-foreground text-2xs">{t('exportVatExemption')}</p>
            ) : null}

            {DEDUCTION_ROWS_PRE_SHIPPING.map((row) => (
              <BreakdownRow key={row.key} label={t(row.key)}>
                <SignedAmount value={breakdown[row.amount]} positive={false} />
              </BreakdownRow>
            ))}

            {/* Kargo: iade yoksa tek düz "Kargo" satırı; iade varsa "Toplam kargo
                bedeli" collapsible → Gidiş + İade alt satırları (Net KDV deseniyle aynı).
                Koşul string karşılaştırma = aritmetik DEĞİL. */}
            {breakdown.returnShippingGross === '0.00' ? (
              <BreakdownRow label={t('shipping')}>
                <SignedAmount value={breakdown.shippingGross} positive={false} />
              </BreakdownRow>
            ) : (
              <Collapsible>
                <div className="gap-sm flex items-center justify-between">
                  {/* asChild: the trigger IS this inline label+chevron group — no
                      base full-width/padding styling and no auto-injected chevron
                      (the manual size-icon-xs one below is the single affordance). */}
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="gap-3xs text-muted-foreground hover:text-foreground group flex items-center transition-colors"
                    >
                      <span>{t('shippingTotal')}</span>
                      <ArrowDown01Icon className="size-icon-xs transition-transform group-data-[state=open]:rotate-180" />
                    </button>
                  </CollapsibleTrigger>
                  <SignedAmount value={breakdown.shippingGross} positive={false} />
                </div>
                <CollapsibleContent className="gap-3xs pt-3xs pl-sm mt-3xs flex flex-col border-l">
                  <BreakdownRow label={t('outboundShipping')} muted>
                    <SignedAmount value={breakdown.outboundShippingGross} positive={false} />
                  </BreakdownRow>
                  <BreakdownRow label={t('returnShipping')} muted>
                    <SignedAmount value={breakdown.returnShippingGross} positive={false} />
                  </BreakdownRow>
                </CollapsibleContent>
              </Collapsible>
            )}

            {DEDUCTION_ROWS_POST_SHIPPING.map((row) => (
              <BreakdownRow key={row.key} label={t(row.key)}>
                <SignedAmount value={breakdown[row.amount]} positive={false} />
              </BreakdownRow>
            ))}

            {/* Mikro ihracat ücretleri (Trendyol): yalnız tutar varken görünür
                (normal siparişte '0.00' → gizli, stopaj deseniyle aynı koşullu render).
                Uluslararası Hizmet Bedeli PSF yerine; Yurt Dışı İade Operasyon Bedeli
                iadede satış reverse etmeden kesilen düz ücret. String karşılaştırma =
                aritmetik DEĞİL (no-frontend-financial-calculation). */}
            {breakdown.internationalServiceGross !== '0.00' ? (
              <BreakdownRow label={t('internationalService')}>
                <SignedAmount value={breakdown.internationalServiceGross} positive={false} />
              </BreakdownRow>
            ) : null}
            {breakdown.overseasReturnOperationGross !== '0.00' ? (
              <BreakdownRow label={t('overseasReturnOperation')}>
                <SignedAmount value={breakdown.overseasReturnOperationGross} positive={false} />
              </BreakdownRow>
            ) : null}

            {/* Stopaj: ayrı düşülen brüt terim (KDV-siz). Çoğu siparişte '0.00'
                (teslim öncesi kesilmez) → sıfırken gizle. String karşılaştırma =
                aritmetik DEĞİL (no-frontend-financial-calculation). */}
            {breakdown.stoppage !== '0.00' ? (
              <BreakdownRow label={t('stoppage')}>
                <SignedAmount value={breakdown.stoppage} positive={false} />
              </BreakdownRow>
            ) : null}

            <Collapsible>
              <div className="gap-sm flex items-center justify-between">
                {/* asChild: inline label+chevron group only — avoids the auto
                    chevron (duplicate) + base button styling. */}
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="gap-3xs text-muted-foreground hover:text-foreground group flex items-center transition-colors"
                  >
                    <span>{t('netVat')}</span>
                    <ArrowDown01Icon className="size-icon-xs transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <SignedAmount value={breakdown.netVat} positive={false} />
              </div>
              <CollapsibleContent className="gap-3xs pt-3xs pl-sm mt-3xs flex flex-col border-l">
                {VAT_ROWS_PRE_SHIPPING.map((row) => (
                  <BreakdownRow key={row.key} label={t(row.key)} muted>
                    <SignedAmount value={breakdown[row.amount]} positive={row.positive} />
                  </BreakdownRow>
                ))}

                {/* Kargo KDV: iade yoksa tek satır; iade varsa Gidiş + İade iki düz satır
                    (iç içe collapsible YOK; bileşen toplamı = shippingVat, backend invariant). */}
                {breakdown.returnShippingGross === '0.00' ? (
                  <BreakdownRow label={t('shippingVat')} muted>
                    <SignedAmount value={breakdown.shippingVat} positive={false} />
                  </BreakdownRow>
                ) : (
                  <>
                    <BreakdownRow label={t('outboundShippingVat')} muted>
                      <SignedAmount value={breakdown.outboundShippingVat} positive={false} />
                    </BreakdownRow>
                    <BreakdownRow label={t('returnShippingVat')} muted>
                      <SignedAmount value={breakdown.returnShippingVat} positive={false} />
                    </BreakdownRow>
                  </>
                )}

                {VAT_ROWS_POST_SHIPPING.map((row) => (
                  <BreakdownRow key={row.key} label={t(row.key)} muted>
                    <SignedAmount value={breakdown[row.amount]} positive={row.positive} />
                  </BreakdownRow>
                ))}

                {/* Mikro ihracat ücret KDV'leri: yalnız sıfırdan farklıyken (Net KDV'ye
                    girer — computeProfit debitVat'a katar; gösterilmezse Σ netVat'a kapanmaz).
                    Uluslararası hizmet bedeli KDV'lidir; yurt dışı iade bedeli şu an KDV-siz
                    (data-driven değişirse kendiliğinden görünür). */}
                {breakdown.internationalServiceVat !== '0.00' ? (
                  <BreakdownRow label={t('internationalServiceVat')} muted>
                    <SignedAmount value={breakdown.internationalServiceVat} positive={false} />
                  </BreakdownRow>
                ) : null}
                {breakdown.overseasReturnOperationVat !== '0.00' ? (
                  <BreakdownRow label={t('overseasReturnOperationVat')} muted>
                    <SignedAmount value={breakdown.overseasReturnOperationVat} positive={false} />
                  </BreakdownRow>
                ) : null}
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
    // whitespace-nowrap: işaret glyph'i (−/+) değerden ayrı satıra KAYMASIN
    // (dar kolonda "−" tek başına alt satıra düşüp "—" gibi görünüyordu).
    <span className="whitespace-nowrap tabular-nums">
      {showMinus ? '−' : '+'}
      <Currency value={magnitude} />
    </span>
  );
}
