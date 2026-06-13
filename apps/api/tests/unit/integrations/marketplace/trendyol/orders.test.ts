import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchShipmentPackages,
  mapTrendyolShipmentPackage,
  type TrendyolCredentials,
  type TrendyolOrdersResponse,
  type TrendyolShipmentPackage,
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

function makePackage(overrides: Partial<TrendyolShipmentPackage> = {}): TrendyolShipmentPackage {
  return {
    orderNumber: '11101228439',
    shipmentPackageId: 3734026895,
    status: 'Delivered',
    orderDate: 1715000000000,
    lastModifiedDate: 1715500000000,
    agreedDeliveryDate: 1715400000000,
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    lines: [
      {
        lineId: 1,
        barcode: 'EAN13-001',
        quantity: 1,
        lineUnitPrice: 120, // KDV dahil
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [
      { status: 'Created', createdDate: 1715000000000 },
      { status: 'Delivered', createdDate: 1715450000000 },
    ],
    ...overrides,
  };
}

function makeOrdersResponse(args: {
  page: number;
  size: number;
  totalElements: number;
  content: TrendyolShipmentPackage[];
}): TrendyolOrdersResponse {
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
  vi.useRealTimers();
});

// ─── Mapper unit tests (pure function) ─────────────────────────────────

describe('mapTrendyolShipmentPackage — KDV split arithmetic', () => {
  it('per-line %20 VAT: lineUnitPrice 120 → net 100 + KDV 20', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[0]!.unitVatAmount).toString()).toBe('20');
    expect(new Decimal(mapped.lines[0]!.unitVatRate).toString()).toBe('20');
  });

  it('per-line %1 VAT: lineUnitPrice 101 → net 100 + KDV 1', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 101,
            lineGrossAmount: 101,
            vatRate: 1,
            commission: 5,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[0]!.unitVatAmount).toString()).toBe('1');
  });

  it('per-line %10 VAT: lineUnitPrice 110 → net 100 + KDV 10', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 110,
            lineGrossAmount: 110,
            vatRate: 10,
            commission: 8,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[0]!.unitVatAmount).toString()).toBe('10');
  });

  it('commission split: 120 × 10% / 1.20 → 10 net + 2 KDV', () => {
    // lineGrossAmount = 120, commission = 10% → grossCommissionGross = 12.
    // KDV %20 sabit → net 10, KDV 2.
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.grossCommissionAmountNet).toString()).toBe('10');
    expect(new Decimal(mapped.lines[0]!.grossCommissionVatAmount).toString()).toBe('2');
  });

  it('seller discount split: 24 lineSellerDiscount @ %20 → 20 net + 4 KDV', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            lineSellerDiscount: 24,
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.sellerDiscountNet).toString()).toBe('20');
    expect(new Decimal(mapped.lines[0]!.sellerDiscountVatAmount).toString()).toBe('4');
  });

  it('quantity > 1 — package aggregate multiplies per quantity', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 3,
            lineUnitPrice: 120,
            lineGrossAmount: 360, // 3 × 120
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    // saleSubtotalNet = 3 × 100 = 300
    expect(new Decimal(mapped.saleSubtotalNet).toString()).toBe('300');
    expect(new Decimal(mapped.saleVatTotal).toString()).toBe('60'); // 3 × 20
  });

  it('multi-line different VAT rates aggregate correctly', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120, // 100 net + 20 KDV %20
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
          },
          {
            lineId: 2,
            barcode: 'B-2',
            quantity: 1,
            lineUnitPrice: 101, // 100 net + 1 KDV %1
            lineGrossAmount: 101,
            vatRate: 1,
            commission: 5,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.saleSubtotalNet).toString()).toBe('200');
    expect(new Decimal(mapped.saleVatTotal).toString()).toBe('21'); // 20 + 1
  });

  it('lineSellerDiscount undefined → sellerDiscountNet/VatAmount 0', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.sellerDiscountNet).toString()).toBe('0');
    expect(new Decimal(mapped.lines[0]!.sellerDiscountVatAmount).toString()).toBe('0');
  });

  it('commission undefined → grossCommission 0', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
          },
        ],
      }),
    );
    expect(new Decimal(mapped.lines[0]!.grossCommissionAmountNet).toString()).toBe('0');
    expect(new Decimal(mapped.lines[0]!.grossCommissionVatAmount).toString()).toBe('0');
    expect(new Decimal(mapped.lines[0]!.commissionRate).toString()).toBe('0');
  });
});

describe('mapTrendyolShipmentPackage — sparse pricing tolerance (PR-A regression hotfix)', () => {
  // Trendyol stage occasionally returns lines with null/undefined pricing.
  // Webhook flow rejects via Zod (PR #197); sync flow must tolerate-and-log
  // so a single bad line doesn't poison the entire sync chunk.
  // Each test casts the partial line through `any` because TrendyolOrderLine
  // declares quantity/lineUnitPrice/etc. as TS-required — at runtime Trendyol
  // may still emit null/undefined.

  it('lineUnitPrice null is irrelevant — sale derives from lineGrossAmount (effectiveSale)', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ lineUnitPrice: null } as any),
          },
        ],
      }),
    );
    expect(mapped.lines).toHaveLength(1);
    // Denetim #1: satış artık lineGrossAmount'tan (effectiveSale), lineUnitPrice'tan DEĞİL.
    // lineUnitPrice null olsa da effectiveSale = 120 − 0 = 120 → net 100, KDV 20.
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[0]!.unitVatAmount).toString()).toBe('20');
    // commission still uses lineGrossAmount=120 (non-null)
    expect(new Decimal(mapped.lines[0]!.grossCommissionAmountNet).toString()).toBe('10');
  });

  it('lineGrossAmount null → grossCommission AND sale both 0 (gross is the sole sparse trigger)', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 120,
            vatRate: 20,
            commission: 10,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ lineGrossAmount: null } as any),
          },
        ],
      }),
    );
    expect(mapped.lines).toHaveLength(1);
    // commission = 0 because lineGrossAmount is 0 (sparse)
    expect(new Decimal(mapped.lines[0]!.grossCommissionAmountNet).toString()).toBe('0');
    expect(new Decimal(mapped.lines[0]!.grossCommissionVatAmount).toString()).toBe('0');
    // Denetim #1: satış da lineGrossAmount'tan türetildiği için 0 (lineUnitPrice artık kullanılmaz).
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('0');
  });

  it('vatRate null → vatRate = 0, no division by zero', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            quantity: 1,
            lineUnitPrice: 100,
            lineGrossAmount: 100,
            commission: 10,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ vatRate: null } as any),
          },
        ],
      }),
    );
    expect(mapped.lines).toHaveLength(1);
    expect(new Decimal(mapped.lines[0]!.unitVatRate).toString()).toBe('0');
    // vatMultiplier = 1 → unitPriceNet equals unitPriceGross
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[0]!.unitVatAmount).toString()).toBe('0');
  });

  it('quantity null → quantity 0, line effectively skipped from package aggregate', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          {
            lineId: 1,
            barcode: 'B-1',
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ quantity: null } as any),
          },
        ],
      }),
    );
    expect(mapped.lines).toHaveLength(1);
    expect(mapped.lines[0]!.quantity).toBe(0);
    // saleSubtotalNet = qty × unitPriceNet = 0 × 100 = 0
    expect(new Decimal(mapped.saleSubtotalNet).toString()).toBe('0');
    expect(new Decimal(mapped.saleVatTotal).toString()).toBe('0');
  });

  it('multi-line: 1 sparse + 1 valid → valid line aggregates correctly', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        lines: [
          // Sparse line — no lineGrossAmount (gross is the sale source post-denetim #1)
          {
            lineId: 1,
            barcode: 'B-sparse',
            quantity: 1,
            vatRate: 20,
            commission: 10,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({ lineUnitPrice: null, lineGrossAmount: null } as any),
          },
          // Valid line
          {
            lineId: 2,
            barcode: 'B-valid',
            quantity: 1,
            lineUnitPrice: 120,
            lineGrossAmount: 120,
            vatRate: 20,
            commission: 10,
          },
        ],
      }),
    );
    expect(mapped.lines).toHaveLength(2);
    // Sparse line: zeros
    expect(new Decimal(mapped.lines[0]!.unitPriceNet).toString()).toBe('0');
    // Valid line: 100 net + 20 vat
    expect(new Decimal(mapped.lines[1]!.unitPriceNet).toString()).toBe('100');
    expect(new Decimal(mapped.lines[1]!.unitVatAmount).toString()).toBe('20');
    // Package aggregate = sparse (0) + valid (100 net, 20 vat)
    expect(new Decimal(mapped.saleSubtotalNet).toString()).toBe('100');
    expect(new Decimal(mapped.saleVatTotal).toString()).toBe('20');
  });
});

describe('mapTrendyolShipmentPackage — status + dates', () => {
  it.each([
    ['Created', 'PENDING'],
    ['Picking', 'PROCESSING'],
    ['Invoiced', 'PROCESSING'],
    ['Shipped', 'SHIPPED'],
    ['UnDelivered', 'SHIPPED'],
    ['Delivered', 'DELIVERED'],
    ['Returned', 'RETURNED'],
    ['Cancelled', 'CANCELLED'],
    ['UnknownStatus', 'PROCESSING'], // defensive default
  ])('Trendyol status "%s" → DB enum "%s"', (input, expected) => {
    const mapped = mapTrendyolShipmentPackage(makePackage({ status: input }));
    expect(mapped.status).toBe(expected);
  });

  it('actualDeliveryDate derived from packageHistories[Delivered].createdDate', () => {
    const deliveredAtMs = 1715450000000;
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        status: 'Delivered',
        packageHistories: [
          { status: 'Created', createdDate: 1715000000000 },
          { status: 'Delivered', createdDate: deliveredAtMs },
        ],
      }),
    );
    expect(mapped.actualDeliveryDate?.getTime()).toBe(deliveredAtMs);
  });

  it('actualDeliveryDate null when no Delivered event', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({
        status: 'Picking',
        packageHistories: [{ status: 'Created', createdDate: 1715000000000 }],
      }),
    );
    expect(mapped.actualDeliveryDate).toBeNull();
  });

  it('actualDeliveryDate null when packageHistories omitted', () => {
    const mapped = mapTrendyolShipmentPackage(makePackage({ packageHistories: undefined }));
    expect(mapped.actualDeliveryDate).toBeNull();
  });

  it('agreedDeliveryDate undefined → null', () => {
    const mapped = mapTrendyolShipmentPackage(makePackage({ agreedDeliveryDate: undefined }));
    expect(mapped.agreedDeliveryDate).toBeNull();
  });

  it('platformOrderId = shipmentPackageId.toString(); platformOrderNumber = orderNumber', () => {
    const mapped = mapTrendyolShipmentPackage(
      makePackage({ shipmentPackageId: 7260001151141191, orderNumber: '11101228439' }),
    );
    expect(mapped.platformOrderId).toBe('7260001151141191');
    expect(mapped.platformOrderNumber).toBe('11101228439');
  });

  it('fastDelivery + micro pass through', () => {
    const mapped = mapTrendyolShipmentPackage(makePackage({ fastDelivery: true, micro: true }));
    expect(mapped.fastDelivery).toBe(true);
    expect(mapped.micro).toBe(true);
  });
});

// ─── Fetcher integration tests (HTTP mock via fetch spy) ─────────────────

describe('fetchShipmentPackages — happy path & pagination', () => {
  it('yields single page for small window', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 0,
          size: 200,
          totalElements: 1,
          content: [makePackage()],
        }),
      ),
    );

    const batches = [];
    for await (const page of fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    })) {
      batches.push(page);
    }
    expect(batches).toHaveLength(1);
    expect(batches[0]!.batch).toHaveLength(1);
    expect(batches[0]!.batch[0]!.platformOrderNumber).toBe('11101228439');
  });

  it('iterates multiple pages until totalElements reached', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makeOrdersResponse({
            page: 0,
            size: 200,
            totalElements: 3,
            content: [makePackage({ shipmentPackageId: 1 }), makePackage({ shipmentPackageId: 2 })],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makeOrdersResponse({
            page: 1,
            size: 200,
            totalElements: 3,
            content: [makePackage({ shipmentPackageId: 3 })],
          }),
        ),
      );

    const allOrders = [];
    for await (const page of fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    })) {
      allOrders.push(...page.batch);
    }
    expect(allOrders).toHaveLength(3);
    expect(allOrders.map((o) => o.platformOrderId)).toEqual(['1', '2', '3']);
  });

  it('stops on empty content[]', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeOrdersResponse({ page: 0, size: 200, totalElements: 0, content: [] })),
    );

    const batches = [];
    for await (const page of fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    })) {
      batches.push(page);
    }
    expect(batches).toHaveLength(0);
  });

  it('resumes from initialPage cursor', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makeOrdersResponse({
          page: 5,
          size: 200,
          totalElements: 1001,
          content: [makePackage({ shipmentPackageId: 1001 })],
        }),
      ),
    );

    const batches = [];
    for await (const page of fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
      initialPage: 5,
    })) {
      batches.push(page);
      break; // sadece ilk page check için
    }
    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('page=5');
  });

  it('builds URL with all required query params', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makeOrdersResponse({ page: 0, size: 200, totalElements: 0, content: [] })),
    );

    const gen = fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    });
    await gen.next();

    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('startDate=1715000000000');
    expect(calledUrl).toContain('endDate=1715600000000');
    expect(calledUrl).toContain('orderByField=PackageLastModifiedDate');
    expect(calledUrl).toContain('orderByDirection=DESC');
    expect(calledUrl).toContain('size=200');
    expect(calledUrl).toContain('page=0');
    expect(calledUrl).toContain(`/sellers/${SUPPLIER_ID}/orders`);
  });
});

describe('fetchShipmentPackages — error paths', () => {
  it('throws RateLimitedError after retries exhausted on persistent 429', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limit', { status: 429 }));

    const gen = fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    });
    await expect(gen.next()).rejects.toBeInstanceOf(RateLimitedError);
  }, 30_000);

  it('throws MarketplaceUnreachable on persistent network error', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    const gen = fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
    });
    await expect(gen.next()).rejects.toBeInstanceOf(MarketplaceUnreachable);
  }, 30_000);

  it('aborts when AbortSignal is triggered before request', async () => {
    const controller = new AbortController();
    controller.abort();

    const gen = fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: 1715000000000,
      endDate: 1715600000000,
      signal: controller.signal,
    });
    await expect(gen.next()).rejects.toThrow(/Abort/i);
  });
});
