'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { ChartPeriodControl } from './chart.types';

/**
 * Segmented period picker for a ChartFrame header (7G · 30G · 6A …). Wraps the
 * `connected` ToggleGroup so the selected period reads on `--primary-soft`,
 * consistent with the product's other view-mode pickers. Single-select;
 * deselection (empty value) is ignored so a period is always active.
 *
 * @useWhen letting the user switch a chart's time window from its header
 */
export function ChartPeriodSelector({
  value,
  options,
  onValueChange,
  ariaLabel,
}: ChartPeriodControl): React.ReactElement {
  const t = useTranslations('common.chart');
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      size="sm"
      aria-label={ariaLabel ?? t('a11y.chart')}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="text-2xs">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
