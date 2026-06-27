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

// İlk iki sebep kullanıcı için aynı: "maliyet zamanında girilmedi" → warning tonu.
// Eski sipariş nötr (tarihsel, satıcının yapacağı bir şey yok).
const REASON_TONE = {
  COST_DEADLINE_MISSED: 'warning',
  LATE_UNCOSTED_ARRIVAL: 'warning',
  LEGACY_BACKFILL: 'neutral',
} as const satisfies Record<ProfitExclusionReason, NonNullable<BadgeProps['tone']>>;

export interface ExcludedReasonCellProps {
  reason: ProfitExclusionReason;
}

export function ExcludedReasonCell({ reason }: ExcludedReasonCellProps): React.ReactElement {
  const t = useTranslations('exclusionReasons');

  // Literal-anahtarlı haritalar: next-intl tipli `t` dinamik anahtarı reddeder,
  // bu yüzden üçünü de kurup enum değeriyle indeksliyoruz (ucuz, exhaustive).
  const labelMap = {
    COST_DEADLINE_MISSED: t('COST_DEADLINE_MISSED.label'),
    LATE_UNCOSTED_ARRIVAL: t('LATE_UNCOSTED_ARRIVAL.label'),
    LEGACY_BACKFILL: t('LEGACY_BACKFILL.label'),
  } satisfies Record<ProfitExclusionReason, string>;
  const detailMap = {
    COST_DEADLINE_MISSED: t('COST_DEADLINE_MISSED.detail'),
    LATE_UNCOSTED_ARRIVAL: t('LATE_UNCOSTED_ARRIVAL.detail'),
    LEGACY_BACKFILL: t('LEGACY_BACKFILL.detail'),
  } satisfies Record<ProfitExclusionReason, string>;

  return (
    <span className="gap-2xs inline-flex items-center">
      <MappedBadge value={reason} toneMap={REASON_TONE} labelMap={labelMap} />
      <InfoHint label={labelMap[reason]}>{detailMap[reason]}</InfoHint>
    </span>
  );
}
