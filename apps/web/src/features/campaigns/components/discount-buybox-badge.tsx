'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MappedBadge } from '@/components/patterns/mapped-badge';
import { type ToneKey } from '@/lib/variants';

import { BUYBOX_LOSER, BUYBOX_WINNER } from '../lib/discount-selection';

const DASH = '—';

/** Normalized buybox ownership for the badge — winner (won) / loser (lost). */
type BuyboxState = 'winner' | 'loser';

const BUYBOX_TONE: Record<BuyboxState, ToneKey> = {
  winner: 'success',
  loser: 'warning',
};

export interface DiscountBuyboxBadgeProps {
  /** Raw buybox label from the Trendyol file (e.g. "Kazanan" / "Kaybeden"), or null when absent. */
  status: string | null;
}

/**
 * Buybox ownership chip for an İndirimler row. The file carries a Turkish ownership label; a
 * winner reads as a success-soft chip, a loser as a warning-soft chip, and anything else (null
 * or an unrecognized value) as a mute em-dash so the column stays quiet when the file omits it.
 */
export function DiscountBuyboxBadge({ status }: DiscountBuyboxBadgeProps): React.ReactElement {
  const t = useTranslations('discountsPage.table');

  const state: BuyboxState | null =
    status === BUYBOX_WINNER ? 'winner' : status === BUYBOX_LOSER ? 'loser' : null;

  if (state === null) {
    return <span className="text-muted-foreground text-sm">{DASH}</span>;
  }

  const labelMap: Record<BuyboxState, string> = {
    winner: t('buyboxWinner'),
    loser: t('buyboxLoser'),
  };

  return <MappedBadge value={state} toneMap={BUYBOX_TONE} labelMap={labelMap} size="sm" />;
}
