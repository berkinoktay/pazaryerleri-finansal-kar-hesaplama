import { describe, expect, it } from 'vitest';

import { DiscountCommissionCell } from '@/features/campaigns/components/discount-commission-cell';
import type {
  DiscountCommissionBand,
  DiscountScenario,
} from '@/features/campaigns/lib/adapt-discount-list';

import trMessages from '../../../../messages/tr.json';
import { render, screen, within } from '../../../helpers/render';

const cc = trMessages.discountsPage.commissionColumn;
const cb = trMessages.discountsPage.commissionBands;

// A three-band ladder, top-down (open above / windowed / open below). The band whose rate
// equals the discounted scenario's rate is the ACTIVE one the popover must highlight.
const BANDS: readonly DiscountCommissionBand[] = [
  { lowerLimit: '200', upperLimit: null, commissionPct: '10' },
  { lowerLimit: '100', upperLimit: '199.99', commissionPct: '15' },
  { lowerLimit: null, upperLimit: '99.99', commissionPct: '20' },
];

function scenario(overrides: Partial<DiscountScenario> = {}): DiscountScenario {
  return {
    price: '150.00',
    commissionPct: '15',
    commissionSource: 'band',
    netProfit: '20.00',
    marginPct: '13.33',
    ...overrides,
  };
}

function renderCell(props: Partial<React.ComponentProps<typeof DiscountCommissionCell>> = {}) {
  return render(
    <DiscountCommissionCell
      current={scenario({ price: '250.00', commissionPct: '15' })}
      discounted={scenario()}
      tariffName="Temmuz Tarifesi"
      periodLabel="21 - 28 Temmuz"
      commissionBands={BANDS}
      {...props}
    />,
  );
}

describe('DiscountCommissionCell', () => {
  it('opens the bands ladder and highlights the active band for a band source', async () => {
    const { user } = renderCell();

    // The whole cell is the single popover trigger (a real <button>).
    await user.click(screen.getByRole('button'));

    const popover = within(await screen.findByRole('dialog'));
    expect(popover.getByText(cb.title)).toBeInTheDocument();

    // The active band (rate 15 == discounted rate) gets the solid primary full-row highlight;
    // no other row does.
    const highlighted = popover
      .getAllByRole('listitem')
      .filter((li) => li.className.includes('bg-primary'));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveTextContent('%15,00');
  });

  it('renders a product source as plain, non-interactive text with no popover trigger', () => {
    // Even WITH a ladder present, a product-sourced rate must NOT be interactive — this guards
    // the `source === 'band'` gate on showBandsPopover.
    renderCell({
      discounted: scenario({ commissionPct: '18', commissionSource: 'product' }),
      current: scenario({ price: '250.00', commissionPct: '18', commissionSource: 'product' }),
    });

    expect(screen.getByText('%18,00')).toBeInTheDocument();
    const sourceLabel = screen.getByText(cc.source.product);
    expect(sourceLabel.className).not.toContain('decoration-dotted');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the current → discounted transition with the arrow and muted pre-jump rate', () => {
    // A lower price can land in another commission band: current rate 10 → discounted rate 15.
    // No ladder (bands null) → plain cell, so the only svg is the transition arrow.
    const { container } = renderCell({
      current: scenario({ price: '250.00', commissionPct: '10' }),
      discounted: scenario({ commissionPct: '15' }),
      commissionBands: null,
    });

    const preJump = screen.getByText('%10,00');
    expect(preJump.className).toContain('text-muted-foreground');
    expect(screen.getByText('%15,00')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
