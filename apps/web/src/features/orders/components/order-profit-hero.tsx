'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import { Card, CardContent } from '@/components/ui/card';
import { formatPercentDisplay } from '@/lib/format-percent';
import { useMarginColoring } from '@/lib/margin-coloring-context';
import { marginColorStyle } from '@/lib/margin-color-style';

import { type ReconciliationStatusValue } from '../lib/orders-filter-parsers';

import { ReconciliationStatusBadge } from './reconciliation-status-badge';

type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;

export interface OrderProfitHeroProps {
  breakdown: ProfitBreakdownData | null;
  /** Settlement progression — küçük bir rozet olarak hero köşesinde. */
  reconciliationStatus?: ReconciliationStatusValue;
}

/**
 * Sonuç başlığı — kâr sheet'inin lider bloğu: backend-hesaplı net kâr (marj
 * rampasıyla renkli) + iki etiketli metrik (Kâr marjı = kâr/satış · Kâr oranı =
 * kâr/maliyet). Tüm değerler backend'den; yüzde biçimi salt gösterim.
 */
export function OrderProfitHero({
  breakdown,
  reconciliationStatus,
}: OrderProfitHeroProps): React.ReactElement {
  const t = useTranslations('profitBreakdown');
  const scale = useMarginColoring();

  if (breakdown === null) {
    return (
      <Card>
        <CardContent className="p-lg">
          <p className="text-muted-foreground text-sm">{t('unavailable')}</p>
        </CardContent>
      </Card>
    );
  }

  const marginColor = marginColorStyle(breakdown.saleMarginPct, scale);

  return (
    <Card>
      <CardContent className="p-lg gap-lg flex flex-col">
        <div className="gap-md flex items-start justify-between">
          <div className="gap-2xs flex min-w-0 flex-col">
            <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
              {t('estimatedProfit')}
            </span>
            {/* runtime-dynamic: net kâr rengi marj rampasından (kullanıcı ölçeği) */}
            <Currency
              value={breakdown.netProfit}
              className="text-4xl leading-none font-semibold tracking-tight"
              style={marginColor}
            />
          </div>
          {reconciliationStatus !== undefined ? (
            <ReconciliationStatusBadge status={reconciliationStatus} className="shrink-0" />
          ) : null}
        </div>
        <div className="gap-2xl flex flex-wrap">
          <HeroStat
            label={t('margin')}
            value={formatPercentDisplay(breakdown.saleMarginPct)}
            style={marginColor}
          />
          {breakdown.costMarkupPct !== null ? (
            <HeroStat label={t('roi')} value={formatPercentDisplay(breakdown.costMarkupPct)} />
          ) : null}
        </div>
      </CardContent>
    </Card>
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
