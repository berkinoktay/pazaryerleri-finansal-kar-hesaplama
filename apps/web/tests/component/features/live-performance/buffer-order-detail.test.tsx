import { describe, expect, it } from 'vitest';

import type { BufferDetailLine } from '@/features/live-performance/api/get-buffer-detail.api';
import { BufferOrderDetail } from '@/features/live-performance/components/buffer-order-detail';

import trMessages from '../../../../messages/tr.json';
import { http, HttpResponse, server } from '../../../helpers/msw';
import { render, screen, within } from '../../../helpers/render';

// Turkish copy comes from the catalog so this file stays ASCII.
const buffer = trMessages.livePerformance.orderDetail.buffer;
const unmatchedBadge = trMessages.common.unmatchedBadge;

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const STORE_ID = '00000000-0000-0000-0000-000000000002';
const BUFFER_ID = '00000000-0000-0000-0000-0000000000b1';
const URL = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/live-performance/buffer/${BUFFER_ID}`;

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

function serveDetail(lines: BufferDetailLine[]): void {
  server.use(
    http.get(URL, () =>
      HttpResponse.json({
        platformOrderNumber: 'TY-1',
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleGross: '400.00',
        lines,
      }),
    ),
  );
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
  });
});
