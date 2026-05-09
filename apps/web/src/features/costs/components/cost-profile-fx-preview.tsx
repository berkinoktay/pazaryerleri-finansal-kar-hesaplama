'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { computeCurrentCostTry } from '../lib/compute-current-cost-try';

interface CostProfileFxPreviewProps {
  /** Amount entered in the form (string, may be partial/invalid). */
  amount: string;
  /** Selected currency. */
  currency: 'TRY' | 'USD' | 'EUR';
  /** Selected FX rate mode. */
  fxRateMode: 'AUTO' | 'MANUAL';
  /** Manual FX rate entered in the form, or null. */
  manualFxRate: string | null;
  /** Latest AUTO FX rate from TCMB cron for the selected currency, or null. */
  autoFxRate: string | null;
  /** Human-readable source label e.g. "TCMB · 9 May 2026". */
  fxRateSource: string | null;
}

/**
 * Live FX conversion preview shown below the amount input.
 *
 * Shows: "{native amount} × {rate} ({source}) = {TRY result}"
 * When rate is unavailable, shows a "loading" placeholder.
 * Hidden for TRY-native profiles (no conversion needed).
 *
 * Pure display: no fetching, no side effects. All data flows in via props.
 */
export function CostProfileFxPreview({
  amount,
  currency,
  fxRateMode,
  manualFxRate,
  autoFxRate,
  fxRateSource,
}: CostProfileFxPreviewProps): React.ReactElement | null {
  const t = useTranslations('costs.form.fxPreview');

  // TRY-native: no preview needed
  if (currency === 'TRY') return null;

  const fxRate = fxRateMode === 'MANUAL' ? manualFxRate : autoFxRate;

  let tryResult: string | null = null;
  try {
    const decimal = computeCurrentCostTry({
      amount: amount.length > 0 && amount !== '.' ? amount : '0',
      currency,
      fxRateMode,
      manualFxRate,
      fxRate: autoFxRate,
    });
    if (decimal !== null) {
      tryResult = decimal.toFixed(2);
    }
  } catch {
    // Partial input (e.g. "10.") — silently skip
  }

  if (fxRate === null || tryResult === null) {
    return <p className="text-muted-foreground text-xs">{t('noRate')}</p>;
  }

  const rateDisplay = new Intl.NumberFormat('tr-TR', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
  }).format(Number(fxRate));

  const resultDisplay = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(tryResult));

  return (
    <div className="text-muted-foreground gap-3xs flex flex-wrap items-baseline text-xs">
      <span className="font-medium">{t('label')}:</span>
      <span>
        {amount || '0'}&nbsp;{currency}&nbsp;×&nbsp;{rateDisplay}
        {fxRateSource !== null ? (
          <span className="text-muted-foreground/70 ml-1">({fxRateSource})</span>
        ) : null}
        &nbsp;=&nbsp;
        <span className="text-foreground font-semibold tabular-nums">₺{resultDisplay}</span>
      </span>
    </div>
  );
}
