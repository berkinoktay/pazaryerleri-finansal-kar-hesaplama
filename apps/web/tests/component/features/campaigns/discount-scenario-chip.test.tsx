import { describe, expect, it } from 'vitest';

import { DiscountScenarioChip } from '@/features/campaigns/components/discount-scenario-chip';
import type { DiscountBasketScenario } from '@/features/campaigns/lib/adapt-discount-list';

import trMessages from '../../../../messages/tr.json';
import { render, screen, within } from '../../../helpers/render';

const sc = trMessages.discountsPage.scenario;

// A basket-scoped scenario: two units satisfy the condition. basketPaidTotal / assumedQuantity
// (150 / 2 = 75) equals the row's displayed unit price, matching the backend invariant.
const SCENARIO: NonNullable<DiscountBasketScenario> = {
  assumedQuantity: 2,
  basketTotal: '200.00',
  basketPaidTotal: '150.00',
  basketDiscountTotal: '50.00',
  orderNetProfit: '30.00',
};

const UNIT_PRICE = '75.00';

/** next-intl interpolates `{qty}`; the test builds the same string to match the accessible name. */
function withQty(template: string, qty: number): string {
  return template.replace('{qty}', String(qty));
}

describe('DiscountScenarioChip', () => {
  it('renders the "×N adet" chip and opens the settlement scenario popover on click', async () => {
    const { user } = render(<DiscountScenarioChip scenario={SCENARIO} unitPrice={UNIT_PRICE} />);

    // The chip shows the assumed quantity ("×2 adet").
    expect(screen.getByText(withQty(sc.chip, 2))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: withQty(sc.chipAria, 2) }));

    const popover = within(await screen.findByRole('dialog'));
    // Four labelled rows: assumed basket, basket discount, paid total, settlement-basis unit.
    expect(popover.getByText(withQty(sc.assumedBasket, 2))).toBeInTheDocument();
    expect(popover.getByText(sc.basketDiscount)).toBeInTheDocument();
    expect(popover.getByText(sc.paidTotal)).toBeInTheDocument();
    expect(popover.getByText(sc.unitSettlement)).toBeInTheDocument();
    // ...plus the proportional-distribution note at the bottom.
    expect(popover.getByText(sc.distributionNote)).toBeInTheDocument();
  });

  it('renders nothing for a null scenario (NET)', () => {
    const { container } = render(<DiscountScenarioChip scenario={null} unitPrice={UNIT_PRICE} />);
    expect(container).toBeEmptyDOMElement();
  });
});
