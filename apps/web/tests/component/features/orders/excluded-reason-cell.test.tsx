import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { ProfitExclusionReason } from '@pazarsync/db/enums';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ExcludedReasonCell } from '@/features/orders/components/excluded-reason-cell';

import messages from '../../../../messages/tr.json';
import { FORMATS } from '../../../../src/i18n/formats';

function renderCell(reason: ProfitExclusionReason): RenderResult {
  return render(
    <NextIntlClientProvider
      locale="tr"
      messages={messages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      <TooltipProvider>
        <ExcludedReasonCell reason={reason} />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe('ExcludedReasonCell', () => {
  it('renders the short reason label for every reason', () => {
    // COST_DEADLINE_MISSED + LATE_UNCOSTED_ARRIVAL kullanıcı için aynı: "Maliyet
    // girilmedi" (sade dil). Aynı DOM'da çakışmasın diye her render izole (unmount).
    const cases: [ProfitExclusionReason, string][] = [
      ['COST_DEADLINE_MISSED', messages.exclusionReasons.COST_DEADLINE_MISSED.label],
      ['LATE_UNCOSTED_ARRIVAL', messages.exclusionReasons.LATE_UNCOSTED_ARRIVAL.label],
      ['LEGACY_BACKFILL', messages.exclusionReasons.LEGACY_BACKFILL.label],
    ];
    for (const [reason, label] of cases) {
      const { unmount } = renderCell(reason);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('reveals the plain-language reason in the tooltip on hover', async () => {
    const user = userEvent.setup();
    renderCell('COST_DEADLINE_MISSED');

    // İpucu açılmadan önce açıklama DOM'da değil (Radix unmount).
    expect(screen.queryByText(/kâr hesabına dahil edilmedi/)).not.toBeInTheDocument();

    await user.hover(screen.getByRole('button'));

    // Tek cümlelik sade açıklama tooltip içinde görünür (jargon/tarih yok).
    const detail = await screen.findAllByText(/kâr hesabına dahil edilmedi/);
    expect(detail.length).toBeGreaterThan(0);
  });
});
