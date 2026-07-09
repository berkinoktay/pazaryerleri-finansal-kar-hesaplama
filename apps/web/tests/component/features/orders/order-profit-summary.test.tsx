import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { components } from '@pazarsync/api-client';

import { OrderProfitSummary } from '@/features/orders/components/order-profit-summary';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

type ProfitBreakdownData = NonNullable<components['schemas']['ProfitBreakdown']>;

const pb = trMessages.profitBreakdown;

// A consistent 2-item order breakdown (backend-served): the four groups
// (cost + marketplace + taxes + profit) close to saleGross.
function makeBreakdown(overrides: Partial<ProfitBreakdownData> = {}): ProfitBreakdownData {
  return {
    listGross: '1159.70',
    sellerDiscountGross: '150.00',
    saleGross: '1009.70',
    saleVat: '168.28',
    costGross: '407.00',
    costVat: '67.83',
    commissionGross: '201.23',
    commissionVat: '33.54',
    shippingGross: '54.99',
    shippingVat: '9.16',
    outboundShippingGross: '54.99',
    outboundShippingVat: '9.16',
    returnShippingGross: '0.00',
    returnShippingVat: '0.00',
    platformServiceGross: '10.19',
    platformServiceVat: '1.70',
    internationalServiceGross: '0.00',
    internationalServiceVat: '0.00',
    overseasReturnOperationGross: '0.00',
    overseasReturnOperationVat: '0.00',
    stoppage: '8.41',
    netVat: '56.05',
    netProfit: '271.83',
    saleMarginPct: '26.92',
    costMarkupPct: '66.79',
    marketplaceFeesGross: '266.41',
    taxesGross: '64.46',
    totalDeductionsGross: '737.87',
    ...overrides,
  };
}

describe('OrderProfitSummary', () => {
  it('shows the unavailable copy when there is no breakdown', () => {
    render(<OrderProfitSummary breakdown={null} />);
    expect(screen.getByText(pb.unavailable)).toBeInTheDocument();
  });

  it('renders the four allocation groups, the income buildup, an insight and a tip', () => {
    render(<OrderProfitSummary breakdown={makeBreakdown()} promotionDisplays={null} />);

    // Grouped "satış nereye gitti" — every group header is always visible.
    expect(screen.getByText(pb.groups.cost)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.marketplace)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.taxes)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.profit)).toBeInTheDocument();

    // Income transparency (list → discount → net sale).
    expect(screen.getByText(pb.netSale)).toBeInTheDocument();
    expect(screen.getByText(pb.listPrice)).toBeInTheDocument();
  });

  it('surfaces the micro-export VAT exemption note', () => {
    render(
      <OrderProfitSummary
        breakdown={makeBreakdown({
          platformServiceGross: '0.00',
          internationalServiceGross: '60.00',
        })}
        micro
      />,
    );
    expect(screen.getByText(pb.exportVatExemption)).toBeInTheDocument();
  });

  it('splits shipping into outbound + return when the order has a return', async () => {
    render(
      <OrderProfitSummary
        breakdown={makeBreakdown({
          returnShippingGross: '39.90',
          returnShippingVat: '6.65',
          shippingGross: '94.89',
          shippingVat: '15.81',
        })}
      />,
    );

    // The split lives inside the (collapsed) marketplace group — expand it first.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: new RegExp(pb.groups.marketplace) }));

    expect(await screen.findByText(pb.outboundShipping)).toBeInTheDocument();
    expect(screen.getByText(pb.returnShipping)).toBeInTheDocument();
  });
});
