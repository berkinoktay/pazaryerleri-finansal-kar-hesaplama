import { useQuery } from '@tanstack/react-query';
import { delay } from 'msw';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ListProductsResponse } from '@/features/products/api/list-products.api';
import { ParentRowDesiCell } from '@/features/products/components/parent-row-desi-cell';
import { productKeys } from '@/features/products/query-keys';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import {
  MISSING_DESI_FIELDS,
  makeProductWithVariants,
  makeVariantSummary,
} from '../../../helpers/product-fixtures';
import { render, screen, waitFor } from '../../../helpers/render';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

// Turkish copy comes from the catalog so this file stays ASCII.
const desiCell = trMessages.products.desiCell;
const parentDesi = trMessages.products.parentDesi;
const bulkDesi = trMessages.products.bulkDesi;
const withCount = (template: string, count: number): string =>
  template.replace('{count}', String(count));

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const BULK_URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/dimensional-weight`;

// A two-variant product where Trendyol sent no desi for either variant.
const PRODUCT = makeProductWithVariants({
  id: '00000000-0000-0000-0000-0000000000p1',
  variants: [
    makeVariantSummary({ id: '00000000-0000-0000-0000-0000000000a1', ...MISSING_DESI_FIELDS }),
    makeVariantSummary({ id: '00000000-0000-0000-0000-0000000000a2', ...MISSING_DESI_FIELDS }),
  ],
});
const VARIANT_IDS = PRODUCT.variants.map((variant) => variant.id);

function captureBulkPatches(options: { delayMs?: number } = {}): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch(BULK_URL, async ({ request }) => {
      const body: unknown = await request.json();
      bodies.push(body);
      if (options.delayMs !== undefined) await delay(options.delayMs);
      return HttpResponse.json({ updated: VARIANT_IDS.length });
    }),
  );
  return bodies;
}

function renderCell() {
  return render(<ParentRowDesiCell orgId={ORG_ID} storeId={STORE_ID} product={PRODUCT} />);
}

const LIST_KEY = productKeys.list(ORG_ID, STORE_ID, {
  page: 1,
  perPage: 25,
  sort: '-platformCreatedAt',
});
const LIST: ListProductsResponse = {
  data: [PRODUCT],
  pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
};

// Reads the product from the products-list cache, as the products page does:
// the bulk hook's optimistic update rewrites it the moment "apply" is pressed,
// which fills in the desi range while the save is still in flight.
function CachedParentRow(): React.ReactElement | null {
  const { data } = useQuery({ queryKey: LIST_KEY, queryFn: () => LIST, staleTime: Infinity });
  const product = data?.data[0];
  if (product === undefined) return null;
  return <ParentRowDesiCell orgId={ORG_ID} storeId={STORE_ID} product={product} />;
}

describe('ParentRowDesiCell', () => {
  it('applies one Turkish-typed desi to every variant of the product and closes', async () => {
    toastSuccess.mockReset();
    const bodies = captureBulkPatches();
    const { user } = renderCell();

    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    expect(screen.getByText(parentDesi.title)).toBeInTheDocument();
    expect(screen.getByText(withCount(parentDesi.description, 2))).toBeInTheDocument();

    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '2,5');
    await user.click(screen.getByRole('button', { name: withCount(bulkDesi.apply, 2) }));

    await waitFor(() =>
      expect(bodies).toEqual([{ variantIds: VARIANT_IDS, dimensionalWeight: '2.5' }]),
    );
    await waitFor(() => expect(screen.queryByText(parentDesi.title)).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith(
      withCount(bulkDesi.toast.applied, 2).replace('{value}', '2,5'),
    );
  });

  it('keeps the popover until the save is confirmed when the optimistic update fills in the range', async () => {
    toastSuccess.mockReset();
    captureBulkPatches({ delayMs: 50 });
    const { user } = render(<CachedParentRow />);

    await user.click(await screen.findByRole('button', { name: desiCell.addDesi }));
    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '2,5');
    await user.click(screen.getByRole('button', { name: withCount(bulkDesi.apply, 2) }));

    // The save is still in flight: the popover stays open instead of being
    // replaced by the optimistic range.
    expect(screen.getByText(parentDesi.title)).toBeInTheDocument();
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        withCount(bulkDesi.toast.applied, 2).replace('{value}', '2,5'),
      ),
    );
    await waitFor(() => expect(screen.queryByText(parentDesi.title)).toBeNull());
  });

  it('shows the known range instead of the call to action when a variant has a desi', () => {
    render(
      <ParentRowDesiCell
        orgId={ORG_ID}
        storeId={STORE_ID}
        product={makeProductWithVariants({
          variants: [
            makeVariantSummary({ id: 'v-1', dimensionalWeight: '1.50' }),
            makeVariantSummary({ id: 'v-2', dimensionalWeight: '3' }),
            makeVariantSummary({ id: 'v-3', ...MISSING_DESI_FIELDS }),
          ],
        })}
      />,
    );
    expect(screen.getByText('1,5 – 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: desiCell.addDesi })).toBeNull();
  });

  it('offers no "reset all" action: no variant has an entered desi to remove', async () => {
    const { user } = renderCell();
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));

    expect(screen.queryByRole('button', { name: bulkDesi.clearAll })).toBeNull();
  });

  it('shows the inline error for an invalid value and sends no request', async () => {
    const bodies = captureBulkPatches();
    const { user } = renderCell();
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));

    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '1.500');
    await user.click(screen.getByRole('button', { name: withCount(bulkDesi.apply, 2) }));

    expect(
      await screen.findByText(bulkDesi.errors.INVALID_DIMENSIONAL_WEIGHT_FORMAT),
    ).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('starts empty again when reopened after a cancelled attempt', async () => {
    const { user } = renderCell();
    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    await user.type(screen.getByLabelText(bulkDesi.fieldLabel), '3');
    await user.click(screen.getByRole('button', { name: bulkDesi.cancel }));
    await waitFor(() => expect(screen.queryByText(parentDesi.title)).toBeNull());

    await user.click(screen.getByRole('button', { name: desiCell.addDesi }));
    expect(screen.getByLabelText(bulkDesi.fieldLabel)).toHaveValue('');
  });

  it('returns focus to the call to action when the popover closes', async () => {
    const { user } = renderCell();
    const cta = screen.getByRole('button', { name: desiCell.addDesi });
    await user.click(cta);
    expect(cta).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: bulkDesi.cancel }));
    await waitFor(() => expect(cta).toHaveFocus());
  });
});
