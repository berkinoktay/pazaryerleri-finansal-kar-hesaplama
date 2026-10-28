import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { DesiCell } from '@/features/products/components/desi-cell';

import { makeVariantSummary as makeVariant } from '../../../helpers/product-fixtures';
import { render } from '../../../helpers/render';

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
