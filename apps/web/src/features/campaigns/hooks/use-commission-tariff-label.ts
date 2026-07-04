'use client';

import { useFormatter } from 'next-intl';
import * as React from 'react';

/**
 * Minimal shape the label needs: the week window plus a display-name fallback.
 * Any object carrying these fields works — a full `CommissionTariffListItem`
 * (picker / detail dropdown) or a flat `TariffListRow` (list table / summary) —
 * so every surface labels a tariff identically without a bespoke formatter.
 */
export interface CommissionTariffWeekLabelInput {
  weekStartsAt: string | null;
  weekEndsAt: string | null;
  name: string;
}

/**
 * Returns a formatter that labels a commission tariff BY ITS WEEK WINDOW
 * (`weekStartsAt – weekEndsAt`) so the seller reads the period, not an opaque
 * file name. Uses the Trendyol-style long stamp (`30 Temmuz 2026 08:00`, the
 * `dayTime` preset) so the boundary times (…08:00 / …07:59) are visible and match
 * the panel. When either boundary is null (dates unparseable) it falls back to the
 * tariff's display name.
 *
 * Shared by the Advantage upload dialog's commission-source picker, the detail
 * screen's commission-source header dropdown, and the tariff list's summary
 * strip, so every surface lists the store's commission tariffs identically.
 */
export function useCommissionTariffLabel(): (item: CommissionTariffWeekLabelInput) => string {
  const format = useFormatter();
  return React.useCallback(
    (item: CommissionTariffWeekLabelInput): string => {
      if (item.weekStartsAt === null || item.weekEndsAt === null) {
        return item.name;
      }
      const start = format.dateTime(new Date(item.weekStartsAt), 'dayTime');
      const end = format.dateTime(new Date(item.weekEndsAt), 'dayTime');
      return `${start} – ${end}`;
    },
    [format],
  );
}
