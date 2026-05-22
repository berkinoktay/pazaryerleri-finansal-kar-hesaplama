/**
 * PR-7 commit 1 — Settlement + OtherFinancials API client unit tests.
 *
 * Pure network-adapter tests: pagination, sparse-field tolerance, TR-localized
 * response handling, 15-day window enforcement, retry/error paths. No DB,
 * no dispatcher logic (PR-7 commit 2 onward).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSettlements,
  fetchOtherFinancials,
  type TrendyolCredentials,
  type TrendyolFinancialResponse,
  type TrendyolFinancialTransaction,
} from '@pazarsync/marketplace';
import { MarketplaceUnreachable, RateLimitedError } from '@pazarsync/sync-core';

const BASE_URL = 'https://stage.trendyol.test';
const SUPPLIER_ID = '2738';
const CREDENTIALS: TrendyolCredentials = {
  supplierId: SUPPLIER_ID,
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/**
 * Sale transaction fixture (research §3.1). Note `transactionType` value is
 * the TR-localized "Satış" — Trendyol returns Turkish labels even though
 * the query param is English. Sparse-field tolerance: paymentOrderId /
 * paymentDate start NULL and Trendyol stamps them on PaymentOrder cycle.
 */
function makeSale(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: '725041340',
    transactionDate: 1613397671561,
    barcode: '8681385952874',
    transactionType: 'Satış',
    receiptId: 48376618,
    description: 'Satış',
    debt: 0,
    credit: 449.99,
    paymentPeriod: 30,
    commissionRate: 15,
    commissionAmount: 67.4985,
    commissionInvoiceSerialNumber: 'DCF2026001708462',
    sellerRevenue: 382.4915,
    orderNumber: '501915861',
    paymentOrderId: null,
    paymentDate: null,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: 1720107451532,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: 1111111111,
    ...overrides,
  };
}

/**
 * PaymentOrder transaction fixture (research §4.2). Period-level — all
 * order-level fields null. `id` field is string but equals paymentOrderId.
 */
function makePaymentOrder(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: '1639160',
    transactionDate: 1613062815995,
    barcode: null,
    transactionType: 'Ödeme',
    receiptId: null,
    description: '<sellerId> - 1639160 - TRENDYOL Marketplace Ödeme',
    debt: 8754732.06,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: 1639160,
    paymentDate: 1613062815995,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
    ...overrides,
  };
}

function makeResponse(args: {
  page: number;
  size: number;
  totalElements: number;
  content: TrendyolFinancialTransaction[];
}): TrendyolFinancialResponse {
  return {
    totalElements: args.totalElements,
    totalPages: Math.ceil(args.totalElements / args.size),
    page: args.page,
    size: args.size,
    content: args.content,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── fetchSettlements ─────────────────────────────────────────────────────

describe('fetchSettlements — happy path & pagination', () => {
  it('yields single page Sale transactions', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makeResponse({
          page: 0,
          size: 1000,
          totalElements: 1,
          content: [makeSale()],
        }),
      ),
    );

    const transactions: TrendyolFinancialTransaction[] = [];
    for await (const tx of fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    })) {
      transactions.push(tx);
    }
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.transactionType).toBe('Satış'); // TR-localized response value
    expect(transactions[0]!.shipmentPackageId).toBe(1111111111);
  });

  it('tolerates sparse paymentOrderId on first Sale arrival', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makeResponse({
          page: 0,
          size: 1000,
          totalElements: 1,
          content: [makeSale({ paymentOrderId: null, paymentDate: null })],
        }),
      ),
    );

    const transactions: TrendyolFinancialTransaction[] = [];
    for await (const tx of fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    })) {
      transactions.push(tx);
    }
    expect(transactions[0]!.paymentOrderId).toBeNull();
    expect(transactions[0]!.paymentDate).toBeNull();
  });

  it('iterates multiple pages until totalElements reached', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makeResponse({
            page: 0,
            size: 1000,
            totalElements: 3,
            content: [makeSale({ id: '1' }), makeSale({ id: '2' })],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makeResponse({
            page: 1,
            size: 1000,
            totalElements: 3,
            content: [makeSale({ id: '3' })],
          }),
        ),
      );

    const transactions: TrendyolFinancialTransaction[] = [];
    for await (const tx of fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    })) {
      transactions.push(tx);
    }
    expect(transactions.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('stops on empty content[]', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeResponse({ page: 0, size: 1000, totalElements: 0, content: [] })),
    );

    const transactions: TrendyolFinancialTransaction[] = [];
    for await (const tx of fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    })) {
      transactions.push(tx);
    }
    expect(transactions).toHaveLength(0);
  });

  it('builds URL with /settlements path + transactionType + window', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeResponse({ page: 0, size: 1000, totalElements: 0, content: [] })),
    );

    const gen = fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Discount',
    });
    await gen.next();

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain(`/sellers/${SUPPLIER_ID}/settlements`);
    expect(calledUrl).toContain('transactionType=Discount');
    expect(calledUrl).toContain(`startDate=${new Date('2026-05-01T00:00:00Z').getTime()}`);
    expect(calledUrl).toContain(`endDate=${new Date('2026-05-10T00:00:00Z').getTime()}`);
    expect(calledUrl).toContain('size=1000');
    expect(calledUrl).toContain('page=0');
  });
});

describe('fetchSettlements — 15-day window enforcement', () => {
  it('throws RangeError when window exceeds 15 days', async () => {
    // Async generator body is lazy — assertWindow throws on first .next().
    await expect(
      fetchSettlements({
        baseUrl: BASE_URL,
        credentials: CREDENTIALS,
        startDate: new Date('2026-05-01T00:00:00Z'),
        endDate: new Date('2026-05-20T00:00:00Z'), // 19 days
        transactionType: 'Sale',
      }).next(),
    ).rejects.toThrow(/window exceeds Trendyol max 15 days/);
  });

  it('throws RangeError when startDate > endDate', async () => {
    await expect(
      fetchSettlements({
        baseUrl: BASE_URL,
        credentials: CREDENTIALS,
        startDate: new Date('2026-05-10T00:00:00Z'),
        endDate: new Date('2026-05-01T00:00:00Z'),
        transactionType: 'Sale',
      }).next(),
    ).rejects.toThrow(/startDate.*must be <= endDate/);
  });
});

// ─── fetchOtherFinancials ─────────────────────────────────────────────────

describe('fetchOtherFinancials — period-level rows', () => {
  it('parses PaymentOrder rows with null order-level fields', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makeResponse({
          page: 0,
          size: 1000,
          totalElements: 1,
          content: [makePaymentOrder()],
        }),
      ),
    );

    const transactions: TrendyolFinancialTransaction[] = [];
    for await (const tx of fetchOtherFinancials({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'PaymentOrder',
    })) {
      transactions.push(tx);
    }
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.transactionType).toBe('Ödeme');
    expect(transactions[0]!.barcode).toBeNull();
    expect(transactions[0]!.orderNumber).toBeNull();
    expect(transactions[0]!.shipmentPackageId).toBeNull();
    expect(transactions[0]!.paymentOrderId).toBe(1639160);
  });

  it('builds URL with /otherfinancials path + subType filter', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeResponse({ page: 0, size: 1000, totalElements: 0, content: [] })),
    );

    const gen = fetchOtherFinancials({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'DeductionInvoices',
      transactionSubType: 'PlatformServiceFee',
    });
    await gen.next();

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain(`/sellers/${SUPPLIER_ID}/otherfinancials`);
    expect(calledUrl).toContain('transactionType=DeductionInvoices');
    expect(calledUrl).toContain('transactionSubType=PlatformServiceFee');
  });

  it('omits transactionSubType when not supplied', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeResponse({ page: 0, size: 1000, totalElements: 0, content: [] })),
    );

    const gen = fetchOtherFinancials({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Stoppage',
    });
    await gen.next();

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).not.toContain('transactionSubType');
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────

describe('fetchSettlements — error paths', () => {
  it('throws RateLimitedError after retries exhausted on persistent 429', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limit', { status: 429 }));

    const gen = fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    });
    await expect(gen.next()).rejects.toBeInstanceOf(RateLimitedError);
  }, 30_000);

  it('throws MarketplaceUnreachable on persistent network error', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    const gen = fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
    });
    await expect(gen.next()).rejects.toBeInstanceOf(MarketplaceUnreachable);
  }, 30_000);

  it('aborts when AbortSignal is triggered before request', async () => {
    const controller = new AbortController();
    controller.abort();

    const gen = fetchSettlements({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-10T00:00:00Z'),
      transactionType: 'Sale',
      signal: controller.signal,
    });
    await expect(gen.next()).rejects.toThrow(/Abort/i);
  });
});
