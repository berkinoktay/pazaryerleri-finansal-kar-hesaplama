import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { DesiCell } from '@/features/products/components/desi-cell';

import trMessages from '../../../../messages/tr.json';
import {
  MISSING_DESI_FIELDS,
  makeVariantSummary as makeVariant,
} from '../../../helpers/product-fixtures';
import { render } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const desiCell = trMessages.products.desiCell;

describe('DesiCell', () => {
  it('shows the "Desi gir" call to action for a variant the backend flags as missing desi', () => {
    // The wire shape of a variant Trendyol sent no desi for: effective and
    // synced are null, no override, and the backend's missing flag is set.
    render(<DesiCell variant={makeVariant(MISSING_DESI_FIELDS)} />);
    expect(screen.getByRole('button', { name: desiCell.addDesi })).toBeInTheDocument();
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

  it('renders a stored synced desi of 0 as a real value, not as missing desi', () => {
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: '0',
          syncedDimensionalWeight: '0',
          isDimensionalWeightOverridden: false,
          isDimensionalWeightMissing: false,
        })}
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('0');
    expect(screen.queryByRole('button', { name: desiCell.addDesi })).toBeNull();
  });

  it('shows the call to action for an empty desi the backend does not flag (a digital variant)', () => {
    // A digital variant needs no desi, so the backend does not flag it missing;
    // with no value to show, the call to action is still the honest rendering.
    render(
      <DesiCell
        variant={makeVariant({
          dimensionalWeight: null,
          syncedDimensionalWeight: null,
          isDimensionalWeightOverridden: false,
          isDimensionalWeightMissing: false,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: desiCell.addDesi })).toBeInTheDocument();
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
