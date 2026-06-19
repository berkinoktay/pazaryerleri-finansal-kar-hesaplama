'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface UnmatchedVariantBadgeProps {
  className?: string;
  /**
   * Backend-türevli: barkod, satıcının Trendyol onaylı kataloğunda KESİN yok
   * (CatalogBarcodeMiss.vendorMissing). Kalıcı bir boşluk — kendiliğinden
   * çözülmez, satıcının ürünü elle eklemesi gerekir. `false`/verilmediğinde
   * satır yalnızca normal katalog-onarım eşleşmesini bekler.
   */
  vendorMissing?: boolean;
}

/**
 * Eşleşmemiş satır için durum rozeti. İki ayrık hal:
 *
 *  - Varsayılan ("eşleşme bekliyor"): variant-resolution tick'i / eager onarım
 *    bağladığında rozet kendiliğinden düşer — bu yüzden ton 'warning', kalıcı
 *    değil, eyleme-çağıran geçici bir sinyaldir.
 *  - vendorMissing ("Trendyol kataloğunda yok"): barkod onaylı katalogda KESİN
 *    yok; kendiliğinden çözülmez. Bilgilendirici (eyleme-çağıran-şimdi değil),
 *    bu yüzden daha sakin 'info' tonu + neden tooltip'i.
 *
 * patterns'a terfi (spec 2026-06-12 PR-4): tüketiciler LP today-products,
 * buffer Sheet satırları ve sipariş kalemleri (WET+1).
 */
export function UnmatchedVariantBadge({
  className,
  vendorMissing = false,
}: UnmatchedVariantBadgeProps): React.ReactElement {
  const t = useTranslations('common');

  if (vendorMissing) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge tone="info" size="sm" className={className}>
            {t('vendorMissingBadge')}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{t('vendorMissingTooltip')}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge tone="warning" size="sm" className={className}>
      {t('unmatchedBadge')}
    </Badge>
  );
}
