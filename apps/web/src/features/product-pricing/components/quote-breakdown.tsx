'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';
import { cn } from '@/lib/utils';

import type { QuoteBreakdown } from '../api/quote-product-pricing.api';

export interface QuoteBreakdownProps {
  breakdown: QuoteBreakdown;
  className?: string;
}

/**
 * Gösterim amaçlı işaretli tutar. Aritmetik YOK — değeri aynen Currency'ye
 * iletir, önüne salt glyph olarak "−" koyar (feedback_no_frontend_financial_calculation).
 * `positive=false` olan satırlar (Maliyet, Komisyon …) her zaman "−" ile başlar.
 * Net KDV backend'den işaretli string gelebilir; `positive=true` ise orijinal
 * işareti korur (negatif Net KDV satıcı lehine → "+" glyph uygun, Currency bunu
 * zaten basmaz).
 */
function DeductionAmount({ value }: { value: string }): React.ReactElement {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {'−'}
      <Currency value={value} />
    </span>
  );
}

/**
 * Net KDV: backend'den gelen değer işaretlidir (negatif → lehte).
 * Magnitude'u Currency'ye verip önüne uygun glyph koyar — hata payını sıfıra
 * indirir çünkü aritmetik yoktur.
 */
function NetVatAmount({ value }: { value: string }): React.ReactElement {
  const isNegative = value.startsWith('-');
  const magnitude = isNegative ? value.slice(1) : value;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {isNegative ? '+' : '−'}
      <Currency value={magnitude} />
    </span>
  );
}

/**
 * QuoteBreakdown renderer — yalın definition-list tabanlı kâr kırılımı.
 *
 * Props olarak `QuoteBreakdown` alır; tüm değerler backend'den GROSS (KDV-dahil)
 * decimal string'tir. Frontend hiçbir para aritmetiği YAPMAZ; salt görüntüler.
 * `ProfitBreakdownCard`'ı KULLANMAZ çünkü `QuoteBreakdown` şekli farklıdır
 * (`returnShipping*`, `outboundShipping*`, `promotionDisplays` içermez).
 */
export function QuoteBreakdown({ breakdown, className }: QuoteBreakdownProps): React.ReactElement {
  const t = useTranslations('features.productPricing.panel.breakdown');

  const isProfit = !breakdown.netProfit.startsWith('-');

  const mainRows: DefinitionListItem[] = [
    {
      id: 'saleGross',
      term: t('sale'),
      description: <Currency value={breakdown.saleGross} />,
      hint:
        breakdown.sellerDiscountGross !== '0.00' && breakdown.sellerDiscountGross !== '0'
          ? `${t('list')} ${breakdown.listGross} − ${t('sellerDiscount')} ${breakdown.sellerDiscountGross}`
          : undefined,
    },
    {
      id: 'costGross',
      term: t('cost'),
      description: <DeductionAmount value={breakdown.costGross} />,
    },
    {
      id: 'commissionGross',
      term: t('commission'),
      description: <DeductionAmount value={breakdown.commissionGross} />,
    },
    {
      id: 'shippingGross',
      term: t('shipping'),
      description: <DeductionAmount value={breakdown.shippingGross} />,
    },
    {
      id: 'platformServiceGross',
      term: t('platformService'),
      description: <DeductionAmount value={breakdown.platformServiceGross} />,
    },
    {
      id: 'stoppage',
      term: t('stoppage'),
      description: <DeductionAmount value={breakdown.stoppage} />,
    },
    {
      id: 'netVat',
      term: t('netVat'),
      description: <NetVatAmount value={breakdown.netVat} />,
    },
  ];

  const footerRows: DefinitionListItem[] = [
    {
      id: 'saleMarginPct',
      term: t('margin'),
      description:
        breakdown.saleMarginPct !== null ? (
          <span className="tabular-nums">{breakdown.saleMarginPct}%</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'costMarkupPct',
      term: t('markup'),
      description:
        breakdown.costMarkupPct !== null ? (
          <span className="tabular-nums">{breakdown.costMarkupPct}%</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className={cn('gap-sm flex flex-col', className)}>
      {/* Satış − kalemler */}
      <DefinitionList items={mainRows} layout="inline" dividers dense alignRight />

      {/* Net Kâr — vurgulu ayrı satır */}
      <div
        className={cn(
          'border-border px-sm py-xs flex items-center justify-between rounded-md border',
          isProfit ? 'bg-success-surface' : 'bg-destructive-surface',
        )}
      >
        <span className="text-sm font-semibold">{t('netProfit')}</span>
        <Currency
          value={breakdown.netProfit}
          emphasis
          className={cn(isProfit ? 'text-success' : 'text-destructive')}
        />
      </div>

      {/* Marj / Oran footer metrikleri */}
      <DefinitionList
        items={footerRows}
        layout="inline"
        dense
        alignRight
        className="text-muted-foreground"
      />
    </div>
  );
}
