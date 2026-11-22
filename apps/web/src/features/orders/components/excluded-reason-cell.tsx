'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { ProfitExclusionReason } from '@pazarsync/db/enums';

import { InfoHint } from '@/components/patterns/info-hint';
import { MappedBadge } from '@/components/patterns/mapped-badge';
import type { BadgeProps } from '@/components/ui/badge';

/**
 * "Kâr Hesabı Dışı" sekmesindeki satır hücresi: siparişin neden kâr hesabına
 * dahil edilmediğini kısa bir rozet + üzerine-gelince tek cümlelik sade açıklama
 * olarak gösterir. Sebep backend'de saklı (`Order.profitExclusionReason`); burada
 * yalnız render edilir. Dışlama kalıcıdır (geri alınamaz) — bu yüzden aksiyon yok,
 * salt bilgilendirme. Aynı sebep kopyası detaydaki banner'da da kullanılır
 * (`exclusionReasons` namespace, tek kaynak). Dil her düzeyde kullanıcıya göre
 * sade tutulur (teknik ayrıntı yok).
 */

// The cost and desi reasons describe an input the seller did not enter in time: warning tone.
// An old order is neutral (historical, nothing for the seller to do).
const REASON_TONE = {
  COST_DEADLINE_MISSED: 'warning',
  LATE_UNCOSTED_ARRIVAL: 'warning',
  LEGACY_BACKFILL: 'neutral',
  DESI_DEADLINE_MISSED: 'warning',
  LATE_DESILESS_ARRIVAL: 'warning',
} as const satisfies Record<ProfitExclusionReason, NonNullable<BadgeProps['tone']>>;

export interface ExcludedReasonCellProps {
  reason: ProfitExclusionReason;
}

export function ExcludedReasonCell({ reason }: ExcludedReasonCellProps): React.ReactElement {
  const t = useTranslations('exclusionReasons');

  // Literal-keyed maps: next-intl's typed `t` rejects a dynamic key, so every label is
  // built here and indexed by the enum value (cheap and exhaustive).
  const labelMap = {
    COST_DEADLINE_MISSED: t('COST_DEADLINE_MISSED.label'),
    LATE_UNCOSTED_ARRIVAL: t('LATE_UNCOSTED_ARRIVAL.label'),
    LEGACY_BACKFILL: t('LEGACY_BACKFILL.label'),
    DESI_DEADLINE_MISSED: t('DESI_DEADLINE_MISSED.label'),
    LATE_DESILESS_ARRIVAL: t('LATE_DESILESS_ARRIVAL.label'),
  } satisfies Record<ProfitExclusionReason, string>;
  const detailMap = {
    COST_DEADLINE_MISSED: t('COST_DEADLINE_MISSED.detail'),
    LATE_UNCOSTED_ARRIVAL: t('LATE_UNCOSTED_ARRIVAL.detail'),
    LEGACY_BACKFILL: t('LEGACY_BACKFILL.detail'),
    DESI_DEADLINE_MISSED: t('DESI_DEADLINE_MISSED.detail'),
    LATE_DESILESS_ARRIVAL: t('LATE_DESILESS_ARRIVAL.detail'),
  } satisfies Record<ProfitExclusionReason, string>;

  return (
    <span className="gap-2xs inline-flex items-center">
      <MappedBadge value={reason} toneMap={REASON_TONE} labelMap={labelMap} />
      <InfoHint label={labelMap[reason]}>{detailMap[reason]}</InfoHint>
    </span>
  );
}
