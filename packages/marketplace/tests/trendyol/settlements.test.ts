// fetchSettlements scan-summary behaviour against a stubbed global fetch. The
// generators now RETURN a FinancialScanSummary ({ totalElements, yielded }) on
// every exit path so the cron can tell a complete scan (every element yielded)
// from a short one. Request-mocking mirrors cargo-invoice.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSettlements,
  isCompleteFinancialScan,
  type FinancialScanSummary,
  type TrendyolFinancialTransaction,
} from '../../src/trendyol/settlements';

const CREDS = { supplierId: '1125805', apiKey: 'k', apiSecret: 's' };
const BASE = 'https://stage.test';
const START = new Date('2026-10-01T00:00:00.000Z');
const END = new Date('2026-10-10T00:00:00.000Z');

function row(id: string): TrendyolFinancialTransaction {
  return {
    id,
    transactionDate: Date.parse('2026-10-05T00:00:00.000Z'),
    barcode: null,
    transactionType: 'Satış',
    receiptId: null,
    description: null,
    debt: 0,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: null,
    paymentDate: null,
    sellerId: 1,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'TR',
    orderDate: null,
    affiliate: '',
    shipmentPackageId: null,
  };
}

function pageResponse(args: {
  page: number;
  totalPages: number;
  totalElements: number;
  content: TrendyolFinancialTransaction[];
}): Response {
  return new Response(
    JSON.stringify({
      page: args.page,
      size: 1000,
      totalPages: args.totalPages,
      totalElements: args.totalElements,
      content: args.content,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Drains the generator, keeping both the yielded rows and its return summary. */
async function drain(
  generator: AsyncGenerator<TrendyolFinancialTransaction, FinancialScanSummary>,
): Promise<{ rows: TrendyolFinancialTransaction[]; summary: FinancialScanSummary }> {
  const rows: TrendyolFinancialTransaction[] = [];
  let next = await generator.next();
  while (next.done !== true) {
    rows.push(next.value);
    next = await generator.next();
  }
  return { rows, summary: next.value };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSettlements scan summary', () => {
  it('returns a complete summary when every element was yielded', async () => {
    // totalElements 3 spread over two pages (2 then 1): the second page is only
    // fetched because the first did not reach the total.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 2, totalElements: 3, content: [row('a'), row('b')] }),
      )
      .mockResolvedValueOnce(
        pageResponse({ page: 1, totalPages: 2, totalElements: 3, content: [row('c')] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { rows, summary } = await drain(
      fetchSettlements({
        baseUrl: BASE,
        credentials: CREDS,
        transactionType: 'Sale',
        startDate: START,
        endDate: END,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(summary).toEqual({ totalElements: 3, yielded: 3 });
    expect(isCompleteFinancialScan(summary)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns an incomplete summary when a page comes back empty before totalElements', async () => {
    // First page reports totalElements 5 but carries only 2 rows; the second page
    // comes back empty, so the scan ends short of the total.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 3, totalElements: 5, content: [row('a'), row('b')] }),
      )
      .mockResolvedValueOnce(
        pageResponse({ page: 1, totalPages: 3, totalElements: 5, content: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { rows, summary } = await drain(
      fetchSettlements({
        baseUrl: BASE,
        credentials: CREDS,
        transactionType: 'Sale',
        startDate: START,
        endDate: END,
      }),
    );

    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(summary).toEqual({ totalElements: 5, yielded: 2 });
    expect(isCompleteFinancialScan(summary)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
