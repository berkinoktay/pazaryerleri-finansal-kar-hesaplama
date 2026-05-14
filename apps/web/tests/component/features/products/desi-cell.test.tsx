import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { DesiCell } from '@/features/products/components/desi-cell';
import type { VariantSummary } from '@/features/products/api/list-products.api';

import { render } from '../../../helpers/render';

function makeVariant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    id: 'v-1',
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
    ...overrides,
  };
}

describe('DesiCell', () => {
  it('renders the empty-state "Desi ekle" pill when no value exists', () => {
    render(<DesiCell variant={makeVariant()} />);
    expect(screen.getByRole('button', { name: /Desi ekle/i })).toBeInTheDocument();
  });

  it('renders the synced value plain (no override) when isOverridden is false', () => {
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '1.20',
          syncedDimensionalWeight: '1.20',
          isDimensionalWeightOverridden: false,
        })}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('1.20');
    // No override badge (the bullet) — assert by absence of the override aria-label.
    expect(btn).not.toHaveAccessibleName(/sen tarafından/i);
  });

  it('renders the override value with the override marker when isOverridden is true', () => {
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '5.00',
          syncedDimensionalWeight: '1.20',
          isDimensionalWeightOverridden: true,
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: /sen tarafından/i });
    expect(btn).toHaveTextContent('5.00');
  });

  it('calls onClick when the cell is clicked', async () => {
    const onClick = vi.fn();
    const { user } = render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '1.20',
          syncedDimensionalWeight: '1.20',
          isDimensionalWeightOverridden: false,
        })}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
