import { describe, expect, it, vi } from 'vitest';

import { PricingCalculator } from '@/features/product-pricing/components/pricing-calculator';
import type { ProductPricingItem } from '@/features/product-pricing/api/list-product-pricing.api';

import { render, screen, waitFor } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

// ─── Sonner mock ─────────────────────────────────────────────────────────────
// PricingCalculator calls toast.info for the fake "Kaydet" / "Tüm Varyantlar"
// actions. We mock sonner so we can assert on those calls without needing a
// real DOM-attached Toaster component.

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, error: vi.fn(), success: vi.fn() } }));

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const VARIANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const QUOTE_ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/product-pricing/quote`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fully calculable item — all three status fields are OK. */
const calculableItem: ProductPricingItem = {
  variantId: VARIANT_ID,
  sku: 'NK-AIR-42-WHT',
  barcode: '8680000000001',
  productName: 'Nike Air Max 90',
  salePrice: '1299.90',
  costStatus: 'OK',
  shippingEstimateStatus: 'OK',
  commissionStatus: 'OK',
  calculable: true,
  netProfit: '234.56',
  saleMarginPct: '18.05',
  costMarkupPct: '22.05',
  imageUrl: null,
  cost: '600.00',
  categoryId: '12345',
  categoryName: 'Ayakkabı',
  brandId: '67890',
  brandName: 'Nike',
};

/** Mock quote response when the target is reachable. */
const calculableBreakdown = {
  listGross: '1000.00',
  sellerDiscountGross: '0.00',
  saleGross: '1000.00',
  saleVat: '153.90',
  costGross: '600.00',
  costVat: '92.34',
  commissionGross: '150.00',
  commissionVat: '23.09',
  shippingGross: '40.00',
  shippingVat: '6.15',
  platformServiceGross: '0.00',
  platformServiceVat: '0.00',
  stoppage: '10.00',
  netVat: '32.32',
  netProfit: '200.00',
  saleMarginPct: '20.00',
  costMarkupPct: '33.33',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PricingCalculator', () => {
  it('shows the new price hero when the quote returns calculable:true', async () => {
    server.use(
      http.post(QUOTE_ENDPOINT, () =>
        HttpResponse.json({
          variantId: VARIANT_ID,
          calculable: true,
          price: '1000.00',
          priceDelta: '254.90',
          breakdown: calculableBreakdown,
        }),
      ),
    );

    const { user } = render(
      <PricingCalculator
        item={calculableItem}
        orgId={ORG_ID}
        storeId={STORE_ID}
        onClose={vi.fn()}
      />,
    );

    // The margin toggle is already active by default; type a target value.
    // PercentageInput renders with aria-label="Hedef değer" (from tr.json valuePlaceholder).
    const valueInput = screen.getByRole('textbox', { name: /Hedef değer/i });
    await user.type(valueInput, '20');

    // Click "Hesapla"
    await user.click(screen.getByRole('button', { name: /Hesapla/i }));

    // The new-price StatCard should render the formatted price.
    // "Yeni satış fiyatı" is the label from result.newPrice in tr.json.
    await waitFor(() => {
      expect(screen.getByText('Yeni satış fiyatı')).toBeInTheDocument();
    });
    // The signed delta line renders the current-price reference beside the new
    // price (priceDelta comes from the backend; the frontend does no math). The
    // colon is unique to this reference — the "Mevcut durum" card label has none.
    expect(screen.getByText(/Mevcut:/)).toBeInTheDocument();
  });

  it('shows the reason message and hides the new-price hero when calculable:false', async () => {
    server.use(
      http.post(QUOTE_ENDPOINT, () =>
        HttpResponse.json({
          variantId: VARIANT_ID,
          calculable: false,
          reason: 'NO_COST',
        }),
      ),
    );

    const { user } = render(
      <PricingCalculator
        item={calculableItem}
        orgId={ORG_ID}
        storeId={STORE_ID}
        onClose={vi.fn()}
      />,
    );

    const valueInput = screen.getByRole('textbox', { name: /Hedef değer/i });
    await user.type(valueInput, '30');
    await user.click(screen.getByRole('button', { name: /Hesapla/i }));

    // reason.noCost from tr.json — contains "maliyet"
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    // The status alert contains the noCost message
    expect(screen.getByRole('status').textContent).toMatch(/maliyet/i);

    // The new-price label must NOT appear
    expect(screen.queryByText('Yeni satış fiyatı')).not.toBeInTheDocument();
  });

  it('calls toast.info when "Kaydet" is clicked', async () => {
    toastInfo.mockReset();

    const { user } = render(
      <PricingCalculator
        item={calculableItem}
        orgId={ORG_ID}
        storeId={STORE_ID}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Kaydet/i }));
    expect(toastInfo).toHaveBeenCalled();
  });

  it('calls onClose when the "İptal" button is clicked', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <PricingCalculator
        item={calculableItem}
        orgId={ORG_ID}
        storeId={STORE_ID}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: /İptal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
