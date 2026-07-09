import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { components } from '@pazarsync/api-client';

import { CampaignProfitBreakdown } from '@/features/campaigns/components/campaign-profit-breakdown';

import trMessages from '../../../../messages/tr.json';
import { render, screen } from '../../../helpers/render';

type QuoteBreakdownData = NonNullable<components['schemas']['QuoteBreakdown']>;

const pb = trMessages.profitBreakdown;

// A self-consistent single-item estimate: the four groups (cost + marketplace +
// taxes + profit) close to saleGross, exactly as serializeBreakdown emits them.
function makeBreakdown(overrides: Partial<QuoteBreakdownData> = {}): QuoteBreakdownData {
  return {
    listGross: '500.00',
    sellerDiscountGross: '50.00',
    saleGross: '450.00',
    saleVat: '75.00',
    costGross: '180.00',
    costVat: '30.00',
    commissionGross: '85.50',
    commissionVat: '14.25',
    shippingGross: '34.70',
    shippingVat: '5.78',
    platformServiceGross: '0.00',
    platformServiceVat: '0.00',
    stoppage: '5.00',
    netVat: '42.20',
    netProfit: '132.60',
    saleMarginPct: '29.47',
    costMarkupPct: '73.67',
    marketplaceFeesGross: '90.20',
    taxesGross: '47.20',
    totalDeductionsGross: '317.40',
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof CampaignProfitBreakdown>> = {}) {
  return render(
    <CampaignProfitBreakdown
      open
      onOpenChange={() => {}}
      title={pb.title}
      productTitle="Test Ürün"
      stockCode="STK-123"
      breakdown={makeBreakdown()}
      commissionPct="19.00"
      loading={false}
      currentNetProfit="108.50"
      {...props}
    />,
  );
}

describe('CampaignProfitBreakdown', () => {
  it('renders the what-if header: sale price, profit eyebrow, margin and roi', () => {
    renderDialog();
    expect(screen.getByText(pb.salePrice)).toBeInTheDocument();
    expect(screen.getByText(pb.estimatedProfit)).toBeInTheDocument();
    expect(screen.getByText(pb.margin)).toBeInTheDocument();
    expect(screen.getByText(pb.roi)).toBeInTheDocument();
  });

  it('surfaces the "vs current" delta against the baseline profit', () => {
    renderDialog();
    expect(screen.getByText(new RegExp(pb.vsCurrent))).toBeInTheDocument();
  });

  it('renders the income buildup and all four allocation groups', () => {
    renderDialog();
    expect(screen.getByText(pb.netSale)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.cost)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.marketplace)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.taxes)).toBeInTheDocument();
    expect(screen.getByText(pb.groups.profit)).toBeInTheDocument();
  });

  it('reveals the marketplace line items when the group is expanded', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: new RegExp(pb.groups.marketplace) }));
    // "Kargo" only lives inside the (collapsed) marketplace group.
    expect(await screen.findByText(pb.shipping)).toBeInTheDocument();
  });

  it('shows the resolved reason when the item is not calculable', () => {
    renderDialog({ breakdown: null, reasonText: 'Ürün maliyeti girilmemiş' });
    expect(screen.getByText('Ürün maliyeti girilmemiş')).toBeInTheDocument();
  });

  it('falls back to the generic not-calculable copy without a reason', () => {
    renderDialog({ breakdown: null, reasonText: null });
    expect(screen.getByText(pb.notCalculable)).toBeInTheDocument();
  });

  it('renders a busy skeleton while the estimate is loading', () => {
    renderDialog({ loading: true, breakdown: null });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy');
  });
});
