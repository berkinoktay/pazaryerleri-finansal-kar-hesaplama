import { describe, expect, it } from 'vitest';

import { NetProfitCell } from '@/features/products/components/net-profit-cell';
import type { NetProfitPopoverData } from '@/features/products/components/net-profit-popover';

import { render, screen } from '../../../helpers/render';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HAPPY_DATA: NetProfitPopoverData = {
  status: 'OK',
  salePrice: '199.00',
  currentCostTry: '75.50',
  commissionAmount: '13.93',
  commissionRate: '7.00',
  estimatedShippingNet: '35.16',
  shippingCarrierCode: 'SENDEOMP',
  shippingTariffApplied: 'BAREM',
  netProfit: '74.41',
  storeSettingsHref: '/stores/s1/settings',
  variantEditHref: '/products/p1/variants/v1',
};

function makeData(overrides: Partial<NetProfitPopoverData>): NetProfitPopoverData {
  return { ...HAPPY_DATA, ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NetProfitCell', () => {
  it('OK: renders net profit number with success styling', () => {
    render(<NetProfitCell data={HAPPY_DATA} />);
    // Currency formatter outputs comma-separated tr-TR — assert on the
    // numeric body rather than the exact "₺74,41" symbol order.
    expect(screen.getByText(/74,41/)).toBeInTheDocument();
  });

  it('OK: clicking the cell opens the popover with the breakdown', async () => {
    const { user } = render(<NetProfitCell data={HAPPY_DATA} />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('Kar Detayı')).toBeInTheDocument();
    // Sale price row
    expect(screen.getByText(/199/)).toBeInTheDocument();
    // Shipping row with carrier+lane chip in the label
    expect(screen.getByText(/Kargo.*SENDEOMP.*Barem/)).toBeInTheDocument();
    // Commission with rate
    expect(screen.getByText(/Komisyon.*%7\.00/)).toBeInTheDocument();
  });

  it('NO_DESI: shows em dash and yellow warning icon', () => {
    render(<NetProfitCell data={makeData({ status: 'NO_DESI', netProfit: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
  });

  it('NO_DESI: clicking opens popover with "Ürüne desi ekle" CTA linking to variant edit', async () => {
    const { user } = render(
      <NetProfitCell data={makeData({ status: 'NO_DESI', netProfit: null })} />,
    );
    await user.click(screen.getByRole('button'));
    const cta = await screen.findByText(/Ürüne desi ekle/);
    expect(cta).toBeInTheDocument();
    // CTA is a real link pointing at the variant edit path.
    const link = cta.closest('a');
    expect(link).toHaveAttribute('href', '/products/p1/variants/v1');
  });

  it('NO_CARRIER: shows em dash and warning icon, CTA points to store settings', async () => {
    const { user } = render(
      <NetProfitCell data={makeData({ status: 'NO_CARRIER', netProfit: null })} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    const cta = await screen.findByText(/Mağaza ayarlarına git/);
    expect(cta.closest('a')).toHaveAttribute('href', '/stores/s1/settings');
  });

  it('OWN_CONTRACT_EMPTY: shows gray dot and disabled (non-link) CTA chip', async () => {
    const { user } = render(
      <NetProfitCell data={makeData({ status: 'OWN_CONTRACT_EMPTY', netProfit: null })} />,
    );
    expect(screen.getByText('●')).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    const cta = await screen.findByText(/Excel ile yükle/);
    // The disabled state renders as a <span> chip, not a Link.
    expect(cta.closest('a')).toBeNull();
  });

  it('DESI_OVERFLOW: renders dash and red warning icon; CTA points to store settings', async () => {
    const { user } = render(
      <NetProfitCell data={makeData({ status: 'DESI_OVERFLOW', netProfit: null })} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    const cta = await screen.findByText(/Kargo firmanızı değiştirin/);
    expect(cta.closest('a')).toHaveAttribute('href', '/stores/s1/settings');
  });
});
