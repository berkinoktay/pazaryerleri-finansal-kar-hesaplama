// fetchAllCargoInvoiceItems — pagination + retry behaviour against a stubbed
// global fetch. The wire shape mirrors the prod capture in research
// 2026-06-09 (108-line invoice DDF2026013132324).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAllCargoInvoiceItems, type CargoInvoiceItem } from '../../src/trendyol/cargo-invoice';

const CREDS = { supplierId: '1125805', apiKey: 'k', apiSecret: 's' };
const BASE = 'https://stage.test';

function item(over: Partial<CargoInvoiceItem> = {}): CargoInvoiceItem {
  return {
    shipmentPackageType: 'Gönderi Kargo Bedeli',
    parcelUniqueId: 7330032270766345,
    orderNumber: '11180007214',
    amount: 93.05,
    desi: 1,
    ...over,
  };
}

function pageResponse(args: {
  page: number;
  totalPages: number;
  content: CargoInvoiceItem[];
}): Response {
  return new Response(
    JSON.stringify({
      page: args.page,
      size: 500,
      totalPages: args.totalPages,
      totalElements: args.content.length,
      content: args.content,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAllCargoInvoiceItems', () => {
  it('collects every page (cursorless page-based pagination)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 2, content: [item({ parcelUniqueId: 1 })] }),
      )
      .mockResolvedValueOnce(
        pageResponse({ page: 1, totalPages: 2, content: [item({ parcelUniqueId: 2 })] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchAllCargoInvoiceItems({
      baseUrl: BASE,
      credentials: CREDS,
      invoiceSerialNumber: 'DDF2026013132324',
    });

    expect(items.map((i) => i.parcelUniqueId)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain('/cargo-invoice/DDF2026013132324/items');
    expect(firstUrl).toContain('page=0');
    expect(firstUrl).toContain('size=500');
  });

  it('single page returns immediately', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageResponse({ page: 0, totalPages: 1, content: [item()] }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchAllCargoInvoiceItems({
      baseUrl: BASE,
      credentials: CREDS,
      invoiceSerialNumber: 'DDF1',
    });

    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('empty invoice returns an empty list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageResponse({ page: 0, totalPages: 0, content: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchAllCargoInvoiceItems({
      baseUrl: BASE,
      credentials: CREDS,
      invoiceSerialNumber: 'DDF-EMPTY',
    });

    expect(items).toEqual([]);
  });

  it('retries transient 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(pageResponse({ page: 0, totalPages: 1, content: [item()] }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchAllCargoInvoiceItems({
      baseUrl: BASE,
      credentials: CREDS,
      invoiceSerialNumber: 'DDF-RETRY',
      initialBackoffMs: 1,
    });

    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a domain error on 401 (no retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchAllCargoInvoiceItems({
        baseUrl: BASE,
        credentials: CREDS,
        invoiceSerialNumber: 'DDF-401',
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
