import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TariffCurrentCell } from '@/features/campaigns/components/tariff-current-cell';
import { EM_DASH } from '@/lib/format-percent';

import { render, screen } from '../helpers/render';
import trMessages from '../../messages/tr.json';

const OPEN_LABEL = trMessages.profitBadge.open;
const UNKNOWN_LABEL = trMessages.commissionTariffsPage.table.priceUnknown;
const UNKNOWN_HINT = trMessages.commissionTariffsPage.table.priceUnknownHint;
const COMMISSION_LABEL = trMessages.commissionTariffsPage.table.currentCommission;
const CALCULATED_LABEL = trMessages.commissionTariffsPage.table.calculatedProfit;

type CellProps = React.ComponentProps<typeof TariffCurrentCell>;

// A known price, a commission line and a calculated profit: every slot of the cell
// is filled, so each test only overrides what it is about.
const BASE_PROPS: CellProps = {
  price: '780.00',
  commissionPct: '19',
  commissionLabel: COMMISSION_LABEL,
  calculatedLabel: CALCULATED_LABEL,
  netProfit: '50.00',
  marginPct: '6.25',
  scale: null,
  onOpenBreakdown: () => {},
  minWidth: 'current',
};

function renderCell(overrides: Partial<CellProps> = {}) {
  return render(<TariffCurrentCell {...BASE_PROPS} {...overrides} />);
}

describe('TariffCurrentCell', () => {
  it('prints the price through formatCurrency when it is a string', () => {
    renderCell({ unknownPriceLabel: UNKNOWN_LABEL });
    // tr-TR currency formatting of '780.00' (comma decimal).
    expect(screen.getByText(/780,00/)).toBeInTheDocument();
    // The unknown label is only for a null price.
    expect(screen.queryByText(UNKNOWN_LABEL)).toBeNull();
  });

  it('shows the unknown label and the hint, and no currency amount, when the price is null', () => {
    // A null profit too, so the badge prints no amount and any currency on screen
    // could only come from the hero.
    const { container } = renderCell({
      price: null,
      netProfit: null,
      marginPct: null,
      unknownPriceLabel: UNKNOWN_LABEL,
      unknownPriceHint: <span>{UNKNOWN_HINT}</span>,
    });
    expect(screen.getByText(UNKNOWN_LABEL)).toBeInTheDocument();
    expect(screen.getByText(UNKNOWN_HINT)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('₺');
    expect(container).not.toHaveTextContent(/0,00/);
  });

  it('falls back to an em dash when the price is null and no label is given', () => {
    // A known profit keeps the badge from printing its own em dash, so the only
    // one on screen is the hero's.
    renderCell({ price: null });
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    expect(screen.queryByText(/780,00/)).toBeNull();
  });

  it('keeps the commission line and the profit badge when the price is null', async () => {
    const onOpenBreakdown = vi.fn();
    const { user } = renderCell({
      price: null,
      unknownPriceLabel: UNKNOWN_LABEL,
      onOpenBreakdown,
    });
    // Commission line, tr-TR percent formatting of the "19" percent string.
    expect(screen.getByText(new RegExp(`${COMMISSION_LABEL} %19`))).toBeInTheDocument();
    expect(screen.getByText(CALCULATED_LABEL)).toBeInTheDocument();
    const badge = screen.getByRole('button', { name: OPEN_LABEL });
    expect(badge).toHaveTextContent(/50,00/);
    await user.click(badge);
    expect(onOpenBreakdown).toHaveBeenCalledTimes(1);
  });
});
