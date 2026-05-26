import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CostCell } from '@/features/products/components/cost-cell';
import type { VariantSummary } from '@/features/products/api/list-products.api';
import { TooltipProvider } from '@/components/ui/tooltip';

import { render, screen } from '../../../helpers/render';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeVariant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: 'variant-uuid-001',
    platformVariantId: '10010',
    barcode: 'BC-0001',
    stockCode: 'STK-A',
    size: 'M',
    salePrice: '100.00',
    listPrice: '100.00',
    vatRate: 20,
    costPrice: null,
    quantity: 5,
    deliveryDuration: 1,
    isRushDelivery: false,
    fastDeliveryOptions: [],
    productUrl: null,
    locationBasedDelivery: 'DISABLED',
    status: 'onSale',
    currentCostTry: null,
    profileCount: 0,
    costStatus: 'NO_PROFILES',
    dimensionalWeight: null,
    syncedDimensionalWeight: null,
    isDimensionalWeightOverridden: false,
    estimatedShippingNet: null,
    shippingCarrierCode: null,
    shippingTariffApplied: null,
    shippingEstimateStatus: 'NO_DESI',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CostCell', () => {
  it('state 0: renders add-cost placeholder when profileCount is 0', () => {
    const variant = makeVariant({ profileCount: 0, currentCostTry: null });
    render(<CostCell variant={variant} />);
    // The "+" is a PlusSignIcon; the label is the translation of products.costCell.addCost.
    expect(screen.getByRole('button', { name: 'Maliyet ekle' })).toBeInTheDocument();
  });

  it('state 0: placeholder is a button element', () => {
    const variant = makeVariant({ profileCount: 0, currentCostTry: null });
    render(<CostCell variant={variant} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
  });

  it('state 0: onClick fires when placeholder is clicked', async () => {
    const handleClick = vi.fn();
    const variant = makeVariant({ profileCount: 0, currentCostTry: null });
    const { user } = render(<CostCell variant={variant} onClick={handleClick} />);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('state 1: shows currency amount alone (no count chip) when profileCount is 1', () => {
    const variant = makeVariant({
      profileCount: 1,
      currentCostTry: '45.75',
      costStatus: 'OK',
    });
    render(<CostCell variant={variant} />);
    // formatCurrency(45.75) = "₺45,75"
    expect(screen.getByText(/45/)).toBeInTheDocument();
    // By design a single profile shows no count chip — a "1" pill would be noise.
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('state many: shows currency amount + count chip with the number when profileCount > 1', () => {
    const variant = makeVariant({
      profileCount: 3,
      currentCostTry: '120.00',
      costStatus: 'OK',
    });
    render(<CostCell variant={variant} />);
    expect(screen.getByText(/120/)).toBeInTheDocument();
    // The chip shows the raw count number, not "3 profil".
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('state many: wraps in Tooltip when profileNames is provided (does not crash)', () => {
    // Tooltip content is only rendered in the DOM after hover, which relies
    // on Radix UI's pointer-events simulation not supported in happy-dom.
    // We assert the cell renders without errors and the button is present.
    const variant = makeVariant({
      profileCount: 2,
      currentCostTry: '80.00',
      costStatus: 'OK',
    });
    const profileNames = ['COGS Profil', 'Paketleme'];
    render(
      <TooltipProvider>
        <CostCell variant={variant} profileNames={profileNames} />
      </TooltipProvider>,
    );
    // The cell renders as a button (the TooltipTrigger asChild passes through)
    expect(screen.getByRole('button')).toBeInTheDocument();
    // Currency amount is visible in the button
    expect(screen.getByText(/80/)).toBeInTheDocument();
    // Count chip shows the raw count number, not "2 profil".
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('no tooltip when profileNames is empty', () => {
    const variant = makeVariant({
      profileCount: 1,
      currentCostTry: '50.00',
      costStatus: 'OK',
    });
    render(<CostCell variant={variant} profileNames={[]} />);
    // Button exists, no tooltip wrapper
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
