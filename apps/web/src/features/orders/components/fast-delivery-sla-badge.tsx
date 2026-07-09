'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SlaKey = 'onTime' | 'late' | 'pending';

const SLA_TONE: Record<SlaKey, 'success' | 'destructive' | 'info'> = {
  onTime: 'success',
  late: 'destructive',
  pending: 'info',
};

export interface FastDeliverySlaBadgeProps {
  /** "Bugün Kargoda" siparişi mi (SLA yalnız bunlarda anlamlı). */
  fastDelivery: boolean;
  /** SLA sonucu: true zamanında (avantaj korundu), false geç (kayıp), null teslim bekliyor. */
  deliveredOnTime: boolean | null;
}

/**
 * Hızlı teslimat (Bugün Kargoda) SLA sonucu — siparişler tablosunda. Sadece
 * `fastDelivery` siparişlerde görünür; kargoya zamanında verilmezse avantaj
 * (indirimli PSF) kaybolur, rozet bunu bir bakışta gösterir. Tooltip avantaj
 * durumunu açıklar. `fastDelivery=false` → hiçbir şey çizmez.
 */
export function FastDeliverySlaBadge({
  fastDelivery,
  deliveredOnTime,
}: FastDeliverySlaBadgeProps): React.ReactElement | null {
  const t = useTranslations('ordersPage.table');
  if (!fastDelivery) return null;

  const key: SlaKey =
    deliveredOnTime === true ? 'onTime' : deliveredOnTime === false ? 'late' : 'pending';
  // Literal anahtarlar (next-intl deep-namespace + template-literal birleşiminde
  // "union too complex" verir; switch ile her t() literal kalır).
  const label =
    key === 'onTime'
      ? t('sla.onTime.label')
      : key === 'late'
        ? t('sla.late.label')
        : t('sla.pending.label');
  const hint =
    key === 'onTime'
      ? t('sla.onTime.hint')
      : key === 'late'
        ? t('sla.late.hint')
        : t('sla.pending.hint');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Badge tone={SLA_TONE[key]} size="sm">
            {label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-tooltip">{hint}</TooltipContent>
    </Tooltip>
  );
}
