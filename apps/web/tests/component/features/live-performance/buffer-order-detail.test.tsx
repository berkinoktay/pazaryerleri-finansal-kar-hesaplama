import { describe, expect, it } from 'vitest';

import type { BufferDetailLine } from '@/features/live-performance/api/get-buffer-detail.api';
import { BufferOrderDetail } from '@/features/live-performance/components/buffer-order-detail';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen, waitFor, within } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const buffer = trMessages.livePerformance.orderDetail.buffer;
const unmatchedBadge = trMessages.common.unmatchedBadge;
const desiPopover = trMessages.products.desiCell.popover;

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const BUFFER_ID = '00000000-0000-0000-0000-0000000000b1';
const API = 'http://localhost:3001/v1';
const URL = `${API}/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/buffer/${BUFFER_ID}`;

// One store profile the cost popover can attach (mirrors cost-cell-popover.test.tsx).
const PACKAGING_PROFILE = {
  id: 'profile-uuid-002',
  organizationId: ORG_ID,
  storeId: STORE_ID,
  name: 'Paketleme',
  type: 'PACKAGING',
  amountGross: '10.00',
  vatRate: 18,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

// A resolved line with a cost profile and a desi: nothing missing.
function makeLine(overrides: Partial<BufferDetailLine>): BufferDetailLine {
  return {
    barcode: 'BC-0',
    productName: 'Product',
    thumbUrl: null,
    variantId: 'v-0',
    stockCode: null,
    quantity: 1,
    lineSaleGross: '100.00',
    isCostMissing: false,
    dimensionalWeight: '1.5',
    syncedDimensionalWeight: '1.5',
    isDimensionalWeightOverridden: false,
    isDimensionalWeightMissing: false,
    ...overrides,
  };
}

const MISSING_DESI = {
  dimensionalWeight: null,
  syncedDimensionalWeight: null,
  isDimensionalWeightOverridden: false,
  isDimensionalWeightMissing: true,
} satisfies Partial<BufferDetailLine>;

// Serves the buffer detail and counts the GETs, so a refresh is observable.
function serveDetail(lines: BufferDetailLine[]): { gets: () => number } {
  let gets = 0;
  server.use(
    http.get(URL, () => {
      gets += 1;
      return HttpResponse.json({
        platformOrderNumber: 'TY-1',
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '400.00',
        lines,
      });
    }),
  );
  return { gets: () => gets };
}

async function findRow(productName: string): Promise<HTMLElement> {
  const row = (await screen.findByText(productName)).closest('tr');
  if (!(row instanceof HTMLElement)) throw new Error(`row "${productName}" not found`);
  return row;
}

function renderDetail() {
  return render(<BufferOrderDetail orgId={ORG_ID} storeId={STORE_ID} bufferId={BUFFER_ID} />);
}

describe('BufferOrderDetail', () => {
  it('shows only the missing actions per line', async () => {
    serveDetail([
      makeLine({
        barcode: 'BC-1',
        productName: 'Cost Only',
        variantId: 'v-1',
        isCostMissing: true,
      }),
      makeLine({ barcode: 'BC-2', productName: 'Desi Only', variantId: 'v-2', ...MISSING_DESI }),
      makeLine({
        barcode: 'BC-3',
        productName: 'Both Missing',
        variantId: 'v-3',
        isCostMissing: true,
        ...MISSING_DESI,
      }),
      makeLine({ barcode: 'BC-4', productName: 'Complete', variantId: 'v-4' }),
    ]);

    renderDetail();

    const costOnly = await findRow('Cost Only');
    expect(within(costOnly).getByRole('button', { name: buffer.addCost })).toBeInTheDocument();
    expect(within(costOnly).queryByRole('button', { name: buffer.addDesi })).toBeNull();
    expect(within(costOnly).queryByText(buffer.lineReady)).toBeNull();

    const desiOnly = await findRow('Desi Only');
    expect(within(desiOnly).getByRole('button', { name: buffer.addDesi })).toBeInTheDocument();
    expect(within(desiOnly).queryByRole('button', { name: buffer.addCost })).toBeNull();
    expect(within(desiOnly).queryByText(buffer.lineReady)).toBeNull();

    const both = await findRow('Both Missing');
    expect(within(both).getByRole('button', { name: buffer.addCost })).toBeInTheDocument();
    expect(within(both).getByRole('button', { name: buffer.addDesi })).toBeInTheDocument();
    expect(within(both).queryByText(buffer.lineReady)).toBeNull();

    const complete = await findRow('Complete');
    expect(within(complete).getByText(buffer.lineReady)).toBeInTheDocument();
    expect(within(complete).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows only the unmatched badge on an unresolved line', async () => {
    serveDetail([
      makeLine({
        barcode: 'GHOST-1',
        productName: 'Ghost',
        variantId: null,
        // The backend flags an unresolved line as cost-missing; desi fields are empty.
        isCostMissing: true,
        dimensionalWeight: null,
        syncedDimensionalWeight: null,
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: false,
      }),
    ]);

    renderDetail();

    const ghost = await findRow('Ghost');
    expect(within(ghost).getByText(unmatchedBadge)).toBeInTheDocument();
    expect(within(ghost).queryAllByRole('button')).toHaveLength(0);
    expect(within(ghost).queryByText(buffer.lineReady)).toBeNull();
    // An unresolved line still holds the order, so the pending notice stays.
    expect(screen.getByText(buffer.pendingNotice)).toBeInTheDocument();
    expect(screen.queryByText(buffer.readyNotice)).toBeNull();
  });

  it('shows the ready notice when no line is missing', async () => {
    serveDetail([
      makeLine({ barcode: 'BC-1', productName: 'First', variantId: 'v-1' }),
      makeLine({ barcode: 'BC-2', productName: 'Second', variantId: 'v-2' }),
    ]);

    renderDetail();

    expect(await screen.findByText(buffer.readyNotice)).toBeInTheDocument();
    expect(screen.queryByText(buffer.pendingNotice)).toBeNull();
  });

  it('keeps the pending notice while any line is missing', async () => {
    serveDetail([
      makeLine({ barcode: 'BC-1', productName: 'First', variantId: 'v-1' }),
      makeLine({ barcode: 'BC-2', productName: 'Second', variantId: 'v-2', ...MISSING_DESI }),
    ]);

    renderDetail();

    expect(await screen.findByText(buffer.pendingNotice)).toBeInTheDocument();
    expect(screen.queryByText(buffer.readyNotice)).toBeNull();
  });

  it('keeps the pending notice when a line is unmatched even if no gap is flagged', async () => {
    serveDetail([
      makeLine({ barcode: 'BC-1', productName: 'Complete', variantId: 'v-1' }),
      // A race between the API's two queries can deliver an unmatched line with
      // no cost or desi gap flagged; an unmatched line still holds the order.
      makeLine({
        barcode: 'GHOST-1',
        productName: 'Ghost',
        variantId: null,
        isCostMissing: false,
        dimensionalWeight: null,
        syncedDimensionalWeight: null,
        isDimensionalWeightOverridden: false,
        isDimensionalWeightMissing: false,
      }),
    ]);

    renderDetail();

    expect(await screen.findByText(buffer.pendingNotice)).toBeInTheDocument();
    expect(screen.queryByText(buffer.readyNotice)).toBeNull();
  });

  it('shows a neutral notice instead of an error when the entry is gone', async () => {
    // The worker promoted the order and deleted the buffer entry.
    server.use(
      http.get(URL, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            code: 'NOT_FOUND',
            detail: 'BufferEntry not found',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(buffer.noLongerWaiting)).toBeInTheDocument();
    expect(screen.queryByText(buffer.loadError)).toBeNull();
  });

  it('shows the neutral notice when the entry is promoted away after the last input', async () => {
    // First load: only the desi is missing. After the save the worker promotes the
    // order and deletes the entry, so the refetch answers 404 over the stale data.
    let gets = 0;
    server.use(
      http.get(URL, () => {
        gets += 1;
        if (gets > 1) {
          return HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Not Found',
              status: 404,
              code: 'NOT_FOUND',
              detail: 'BufferEntry not found',
            },
            { status: 404, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({
          platformOrderNumber: 'TY-1',
          orderDate: '2026-06-05T08:00:00.000Z',
          status: 'PENDING',
          saleGross: '100.00',
          lines: [makeLine({ barcode: 'BC-1', productName: 'Desi Only', ...MISSING_DESI })],
        });
      }),
      http.patch(
        `${API}/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/v-0/dimensional-weight`,
        () =>
          HttpResponse.json({
            id: 'v-0',
            dimensionalWeight: '1.5',
            syncedDimensionalWeight: null,
            isDimensionalWeightOverridden: true,
            isDimensionalWeightMissing: false,
          }),
      ),
    );

    const { user } = renderDetail();

    const row = await findRow('Desi Only');
    await user.click(within(row).getByRole('button', { name: buffer.addDesi }));
    await user.type(screen.getByLabelText(desiPopover.title), '1,5');
    await user.click(screen.getByRole('button', { name: desiPopover.save }));

    expect(await screen.findByText(buffer.noLongerWaiting)).toBeInTheDocument();
    expect(screen.queryByText(buffer.loadError)).toBeNull();
  });

  it('shows the load error for any other failure', async () => {
    server.use(
      http.get(URL, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            code: 'INTERNAL_ERROR',
            detail: 'boom',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByText(buffer.loadError)).toBeInTheDocument();
    expect(screen.queryByText(buffer.noLongerWaiting)).toBeNull();
  });

  it('refreshes the buffer detail after a desi save', async () => {
    // The order still waits on its cost, so no realtime event would refresh it.
    const detail = serveDetail([
      makeLine({
        barcode: 'BC-1',
        productName: 'Both Missing',
        variantId: 'v-1',
        isCostMissing: true,
        ...MISSING_DESI,
      }),
    ]);
    server.use(
      http.patch(
        `${API}/organizations/${ORG_ID}/stores/${STORE_ID}/products/variants/v-1/dimensional-weight`,
        () =>
          HttpResponse.json({
            id: 'v-1',
            dimensionalWeight: '1.5',
            syncedDimensionalWeight: null,
            isDimensionalWeightOverridden: true,
            isDimensionalWeightMissing: false,
          }),
      ),
    );

    const { user } = renderDetail();

    const row = await findRow('Both Missing');
    expect(detail.gets()).toBe(1);
    await user.click(within(row).getByRole('button', { name: buffer.addDesi }));
    await user.type(screen.getByLabelText(desiPopover.title), '1,5');
    await user.click(screen.getByRole('button', { name: desiPopover.save }));

    await waitFor(() => expect(detail.gets()).toBe(2));
  });

  it('refreshes the buffer detail after attaching a cost', async () => {
    const detail = serveDetail([
      makeLine({
        barcode: 'BC-1',
        productName: 'Both Missing',
        variantId: 'v-1',
        isCostMissing: true,
        ...MISSING_DESI,
      }),
    ]);
    server.use(
      http.get(`${API}/organizations/${ORG_ID}/variants/v-1/cost-profiles`, () =>
        HttpResponse.json({ data: [] }),
      ),
      http.get(`${API}/organizations/${ORG_ID}/cost-profiles`, () =>
        HttpResponse.json({
          data: [PACKAGING_PROFILE],
          meta: { nextCursor: null, hasMore: false },
        }),
      ),
      http.post(`${API}/organizations/${ORG_ID}/cost-profile-attachments/attach`, () =>
        HttpResponse.json({ attached: 1 }),
      ),
    );

    const { user } = renderDetail();

    const row = await findRow('Both Missing');
    expect(detail.gets()).toBe(1);
    await user.click(within(row).getByRole('button', { name: buffer.addCost }));
    await user.click(await screen.findByRole('option', { name: /Paketleme/ }));

    await waitFor(() => expect(detail.gets()).toBe(2));
  });
});
