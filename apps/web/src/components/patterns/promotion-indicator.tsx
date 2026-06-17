'use client';

import { SaleTag01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Sipariş düzeyindeki promosyon gösterimi (spec ekleme #3) — wire şekli. */
type PromotionDisplay = NonNullable<
  NonNullable<components['schemas']['OrderListItem']>['promotionDisplays']
>[number];

export interface PromotionIndicatorProps {
  /**
   * Backend'in sipariş alımında yakaladığı promosyon adları + brüt tutarları.
   * null/boş → hiçbir şey çizilmez (indirimsiz sipariş). Tutarlar backend-servisli;
   * bu bileşen yalnız render eder, hiçbir finansal değer türetmez.
   */
  promotions: PromotionDisplay[] | null | undefined;
}

/**
 * Yoğun listelerde indirimli siparişi işaretleyen, gürültü yapmayan rozet:
 * küçük bir etiket-ikonu + hover/odak ile promosyon adlarını ve brüt tutarlarını
 * gösteren tooltip. Sipariş listesinde ve canlı-performans satırlarında aynı
 * şekilde kullanılır; promosyon yoksa hiçbir şey çizmez (satır temiz kalır).
 *
 * Detaydaki kâr dökümü (profit-breakdown) promosyonları satır satır gösterir;
 * burada amaç dar bir tablo hücresine sığan TEK işaret — detaylar tooltip'te.
 */
export function PromotionIndicator({
  promotions,
}: PromotionIndicatorProps): React.ReactElement | null {
  const t = useTranslations('promotionIndicator');

  if (promotions === null || promotions === undefined || promotions.length === 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          tone="info"
          variant="surface"
          size="sm"
          leadingIcon={<SaleTag01Icon />}
          className="cursor-help align-middle"
          aria-label={t('label')}
        >
          {t('label')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-tooltip px-sm py-xs">
        <span className="text-foreground mb-3xs block font-semibold">{t('title')}</span>
        <ul className="gap-3xs flex flex-col">
          {promotions.map((promo, index) => (
            <li
              key={`${promo.displayName}-${index}`}
              className="gap-sm text-muted-foreground flex items-center justify-between font-normal"
            >
              <span>{promo.displayName}</span>
              <span className="text-foreground tabular-nums">
                −<Currency value={promo.amountGross} />
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
