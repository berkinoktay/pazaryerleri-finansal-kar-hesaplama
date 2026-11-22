'use client';

import { useTranslations } from 'next-intl';

import { profitBlockerMessage, type ProfitBlocker } from '../lib/profit-blocker-message';

/**
 * The seller-facing sentence for each profit blocker, in the API's order. Two
 * blockers that read the same sentence (two missing fee definitions, say) show it
 * once; a blocker without a sentence (`profitBlockerMessage` returns null) is skipped.
 */
export function useProfitBlockerReasons(blockers: readonly ProfitBlocker[]): string[] {
  const t = useTranslations('profitBlockers');
  const unknownCarrier = t('unknownCarrier');

  const reasons: string[] = [];
  for (const blocker of blockers) {
    const message = profitBlockerMessage(blocker, unknownCarrier);
    if (message === null) continue;
    const text = t(message.key, message.values);
    if (!reasons.includes(text)) reasons.push(text);
  }
  return reasons;
}
