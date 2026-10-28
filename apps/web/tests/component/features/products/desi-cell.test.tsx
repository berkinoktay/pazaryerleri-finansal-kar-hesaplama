import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { DesiCell } from '@/features/products/components/desi-cell';

import trMessages from '../../../../messages/tr.json';
import { makeVariantSummary as makeVariant } from '../../../helpers/product-fixtures';
import { render } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const desiCell = trMessages.products.desiCell;

describe('DesiCell', () => {
  it('shows the "Desi gir" call to action for a variant the backend flags as missing desi', () => {
    // The wire shape of a variant Trendyol sent no desi for: effective and
    // synced are "0", no override, and the backend's missing flag is set.
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '0',
          syncedDimensionalWeight: '0',
          isDimensionalWeightOverridden: false,
          isDimensionalWeightMissing: true,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: desiCell.addDesi })).toBeInTheDocument();
    // The "0" placeholder value is not shown next to the call to action.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders the synced value in Turkish format without the override marker', () => {
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
    expect(btn).toHaveTextContent('1,2');
    expect(btn).not.toHaveAccessibleName(desiCell.overrideAria);
    expect(screen.queryByRole('button', { name: desiCell.addDesi })).toBeNull();
  });

  it('renders an override with the override marker in Turkish format', () => {
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '5.00',
          syncedDimensionalWeight: '1.20',
          isDimensionalWeightOverridden: true,
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: desiCell.overrideAria });
    expect(btn).toHaveTextContent('5');
    expect(btn).not.toHaveTextContent('5.00');
  });

  it('treats an explicit override of 0 as a real value, not as missing desi', () => {
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '0',
          syncedDimensionalWeight: '0',
          isDimensionalWeightOverridden: true,
          isDimensionalWeightMissing: false,
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: desiCell.overrideAria });
    expect(btn).toHaveTextContent('0');
    expect(screen.queryByRole('button', { name: desiCell.addDesi })).toBeNull();
  });

  it('follows the backend flag instead of re-deriving the rule from the values', () => {
    // The cell renders what the flag says: with the flag off, a 0 is shown as
    // a number even though the values alone would read as missing desi.
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '0',
          syncedDimensionalWeight: '0',
          isDimensionalWeightMissing: false,
        })}
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('0');
    expect(screen.queryByRole('button', { name: desiCell.addDesi })).toBeNull();
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
