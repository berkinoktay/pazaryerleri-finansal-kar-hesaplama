import { describe, expect, it } from 'vitest';

import type { VariantSummary } from '@/features/products/api/list-products.api';
import { DesiCell } from '@/features/products/components/desi-cell';
import { DesiCellPopover } from '@/features/products/components/desi-cell-popover';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import { MISSING_DESI_FIELDS, makeVariantSummary } from '../../../helpers/product-fixtures';
import { render, screen, waitFor } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const desiCell = trMessages.products.desiCell;
const popover = desiCell.popover;
const syncedHint = (value: string): string => popover.syncedHint.replace('{value}', value);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const VARIANT_ID = '00000000-0000-0000-0000-0000000000a1';
const PATCH_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/${VARIANT_ID}/dimensional-weight`;

const MISSING_VARIANT = makeVariantSummary({ id: VARIANT_ID, ...MISSING_DESI_FIELDS });

const OVERRIDDEN_VARIANT = makeVariantSummary({
  id: VARIANT_ID,
  dimensionalWeight: '5.00',
  syncedDimensionalWeight: '1.20',
  isDimensionalWeightOverridden: true,
  isDimensionalWeightMissing: false,
});

// Records every PATCH body; answers like the backend would for a set value.
function capturePatches(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch(PATCH_URL, async ({ request }) => {
      const body: unknown = await request.json();
      bodies.push(body);
      return HttpResponse.json({
        id: VARIANT_ID,
        dimensionalWeight: '1.5',
        syncedDimensionalWeight: null,
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      });
    }),
  );
  return bodies;
}

// Mirrors the products table: the popover trigger wraps the cell.
function renderPopover(variant: VariantSummary) {
  return render(
    <DesiCellPopover orgId={ORG_ID} storeId={STORE_ID} variant={variant}>
      <span>
        <DesiCell variant={variant} />
      </span>
    </DesiCellPopover>,
  );
}

describe('DesiCellPopover', () => {
  it('opens a missing-desi variant with an empty input and the "no Trendyol desi" note', async () => {
    const { user } = renderPopover(MISSING_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));

    expect(screen.getByLabelText(popover.title)).toHaveValue('');
    expect(screen.getByText(popover.syncedMissing)).toBeInTheDocument();
    expect(screen.queryByText(syncedHint('0'))).toBeNull();
  });

  it('pre-fills the override in Turkish format and shows the synced value hint when Trendyol has a desi', async () => {
    const { user } = renderPopover(OVERRIDDEN_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.overrideAria }));

    expect(screen.getByLabelText(popover.title)).toHaveValue('5');
    expect(screen.getByText(syncedHint('1,2'))).toBeInTheDocument();
    expect(screen.queryByText(popover.syncedMissing)).toBeNull();
  });

  it('hides the synced value hint while the input equals it, and shows it once the input differs', async () => {
    // A Trendyol desi with no override opens pre-filled as "1,2" against the
    // wire value "1.20": the comparison is by value, not by string.
    const { user } = renderPopover(
      makeVariantSummary({
        id: VARIANT_ID,
        dimensionalWeight: '1.20',
        syncedDimensionalWeight: '1.20',
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: false,
      }),
    );
    await user.click(screen.getByRole('button', { name: '1,2' }));

    const input = screen.getByLabelText(popover.title);
    expect(input).toHaveValue('1,2');
    expect(screen.queryByText(syncedHint('1,2'))).toBeNull();

    await user.clear(input);
    await user.type(input, '3');
    expect(screen.getByText(syncedHint('1,2'))).toBeInTheDocument();
  });

  it('shows the "no Trendyol desi" note for an override of 0 when Trendyol has no desi', async () => {
    const { user } = renderPopover(
      makeVariantSummary({
        id: VARIANT_ID,
        dimensionalWeight: '0',
        syncedDimensionalWeight: null,
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      }),
    );
    await user.click(screen.getByRole('button', { name: desiCell.overrideAria }));

    expect(screen.getByLabelText(popover.title)).toHaveValue('0');
    expect(screen.getByText(popover.syncedMissing)).toBeInTheDocument();
  });

  it('treats a stored synced desi of 0 as a real value: pre-filled "0", hint instead of the note', async () => {
    const { user } = renderPopover(
      makeVariantSummary({
        id: VARIANT_ID,
        dimensionalWeight: '0',
        syncedDimensionalWeight: '0',
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: false,
      }),
    );
    await user.click(screen.getByRole('button', { name: '0' }));

    const input = screen.getByLabelText(popover.title);
    expect(input).toHaveValue('0');
    expect(screen.queryByText(popover.syncedMissing)).toBeNull();
    // The input equals the Trendyol value, so the hint is hidden until it differs.
    expect(screen.queryByText(syncedHint('0'))).toBeNull();

    await user.clear(input);
    await user.type(input, '2');
    expect(screen.getByText(syncedHint('0'))).toBeInTheDocument();
  });

  it('saves "1,5" as the dot string "1.5" and closes', async () => {
    const bodies = capturePatches();
    const { user } = renderPopover(MISSING_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    await user.type(screen.getByLabelText(popover.title), '1,5');
    await user.click(screen.getByRole('button', { name: popover.save }));

    await waitFor(() => expect(bodies).toEqual([{ dimensionalWeight: '1.5' }]));
    await waitFor(() => expect(screen.queryByLabelText(popover.title)).toBeNull());
  });

  it.each([
    ['abc', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['1,555', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['1.234,5', 'INVALID_DIMENSIONAL_WEIGHT_FORMAT'],
    ['-1', 'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL'],
    ['1000', 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE'],
  ] as const)('shows the %s error inline and sends no request', async (raw, code) => {
    const bodies = capturePatches();
    const { user } = renderPopover(MISSING_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    await user.type(screen.getByLabelText(popover.title), raw);
    await user.click(screen.getByRole('button', { name: popover.save }));

    expect(await screen.findByText(popover.errors[code])).toBeInTheDocument();
    expect(screen.getByLabelText(popover.title)).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toEqual([]);
  });

  it('clears the override with null when the input is emptied', async () => {
    const bodies = capturePatches();
    const { user } = renderPopover(OVERRIDDEN_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.overrideAria }));
    await user.clear(screen.getByLabelText(popover.title));
    await user.click(screen.getByRole('button', { name: popover.save }));

    await waitFor(() => expect(bodies).toEqual([{ dimensionalWeight: null }]));
  });

  it('offers the reset action only for an override, and it sends null', async () => {
    const bodies = capturePatches();
    const first = renderPopover(MISSING_VARIANT);
    await first.user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    expect(screen.queryByRole('button', { name: popover.reset })).toBeNull();
    first.unmount();

    const { user } = renderPopover(OVERRIDDEN_VARIANT);
    await user.click(screen.getByRole('button', { name: desiCell.overrideAria }));
    await user.click(screen.getByRole('button', { name: popover.reset }));

    await waitFor(() => expect(bodies).toEqual([{ dimensionalWeight: null }]));
  });
});
