// fetchClaims pagination/retry + mapTrendyolClaim mapping — PR-13.
//
// The wire fixture mirrors the REAL stage capture from the 2026-06-10
// probe (claims-kesif research doc): the official doc's sample JSON is
// malformed, so these shapes are the source of truth. Status terminality
// and the per-UNIT claimItems contract are locked here as regression
// guards for the sync worker.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchClaims,
  isTerminalClaimItemStatus,
  mapTrendyolClaim,
  type TrendyolClaim,
  type TrendyolClaimItemWire,
} from '../../src/trendyol/claims';

const CREDS = { supplierId: '2738', apiKey: 'k', apiSecret: 's' };
const BASE = 'https://stage.test';

function claimItem(over: Partial<TrendyolClaimItemWire> = {}): TrendyolClaimItemWire {
  return {
    id: '7a0243f7-1994-405d-9299-93cd8d03a731',
    orderLineItemId: 56927600,
    customerClaimItemReason: { id: 401, name: 'Vazgeçtim', externalReasonId: 25, code: 'ABANDON' },
    trendyolClaimItemReason: { id: 401, name: 'Vazgeçtim', externalReasonId: 25, code: 'ABANDON' },
    claimItemStatus: { name: 'Accepted' },
    note: '',
    customerNote: 'İade kodu olmadan iade',
    resolved: true,
    autoAccepted: null,
    acceptedBySeller: true,
    acceptDetail: 'SUPPLIER',
    autoApproveDate: 1776174490958,
    ...over,
  };
}

function claim(over: Partial<TrendyolClaim> = {}): TrendyolClaim {
  return {
    id: 'd5ee3431-a0ba-4242-83d4-d834c12e3931',
    claimId: 'd5ee3431-a0ba-4242-83d4-d834c12e3931',
    orderNumber: '950608199',
    orderDate: 1776001121040,
    claimDate: 1776001429229,
    lastModifiedDate: 1780340474859,
    customerFirstName: 'Test Müşteri',
    customerLastName: 'Test Müşteri',
    cargoTrackingNumber: 7330000166478931,
    cargoProviderName: 'Trendyol Express Marketplace',
    orderShipmentPackageId: 91982454,
    orderOutboundPackageId: 91982453,
    items: [
      {
        orderLine: {
          id: 10230838,
          barcode: '5135827461750',
          productName: 'Joel on Software Varyantlı',
          merchantSku: '47fcoA6gDz1d',
          productColor: 'Beyaz',
          productSize: 'M',
          price: 1750,
          vatBaseAmount: 0,
          vatRate: 0,
          salesCampaignId: 1893951626,
          productCategory: '[TDG] Bot & Bootie',
        },
        claimItems: [claimItem()],
      },
    ],
    ...over,
  };
}

function pageResponse(args: {
  page: number;
  totalPages: number;
  totalElements: number;
  content: TrendyolClaim[];
}): Response {
  return new Response(JSON.stringify({ size: 200, ...args }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mapTrendyolClaim', () => {
  it('maps the stage-captured wire shape to the domain claim', () => {
    const mapped = mapTrendyolClaim(claim());

    expect(mapped.trendyolClaimId).toBe('d5ee3431-a0ba-4242-83d4-d834c12e3931');
    expect(mapped.orderNumber).toBe('950608199');
    expect(mapped.orderOutboundPackageId).toBe('91982453');
    expect(mapped.orderShipmentPackageId).toBe('91982454');
    expect(mapped.claimDate).toEqual(new Date(1776001429229));
    expect(mapped.lastModifiedDate).toEqual(new Date(1780340474859));
    expect(mapped.cargoTrackingNumber).toBe('7330000166478931');
    expect(mapped.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(mapped.items).toHaveLength(1);

    const item = mapped.items[0];
    expect(item?.trendyolClaimItemId).toBe('7a0243f7-1994-405d-9299-93cd8d03a731');
    expect(item?.orderLineId).toBe('10230838');
    expect(item?.reasonCode).toBe('ABANDON');
    expect(item?.reasonName).toBe('Vazgeçtim');
    expect(item?.status).toBe('Accepted');
    expect(item?.acceptedBySeller).toBe(true);
    expect(item?.autoApproveDate).toEqual(new Date(1776174490958));
    expect(item?.resolved).toBe(true);
  });

  it('drops PII — no customer names, no free-text notes survive mapping', () => {
    const mapped = mapTrendyolClaim(claim());
    const json = JSON.stringify(mapped);
    expect(json).not.toContain('Test Müşteri');
    expect(json).not.toContain('İade kodu olmadan iade');
    expect(Object.keys(mapped)).not.toContain('customerFirstName');
    expect(Object.keys(mapped)).not.toContain('customerLastName');
    const item = mapped.items[0];
    expect(Object.keys(item ?? {})).not.toContain('customerNote');
    expect(Object.keys(item ?? {})).not.toContain('note');
  });

  it('an empty-code customer reason does not shadow a populated Trendyol reason', () => {
    const mapped = mapTrendyolClaim(
      claim({
        items: [
          {
            orderLine: { id: 5 },
            claimItems: [
              claimItem({
                customerClaimItemReason: { id: 0, name: '', externalReasonId: 0, code: '' },
                trendyolClaimItemReason: {
                  id: 751,
                  name: 'Fraud',
                  externalReasonId: 0,
                  code: 'FRAUD',
                },
              }),
            ],
          },
        ],
      }),
    );
    expect(mapped.items[0]?.reasonCode).toBe('FRAUD');
    expect(mapped.items[0]?.reasonName).toBe('Fraud');
  });

  it('flattens multi-unit claim items (one row per unit, shared orderLineId)', () => {
    const mapped = mapTrendyolClaim(
      claim({
        items: [
          {
            orderLine: { id: 10230838 },
            claimItems: [
              claimItem({ id: 'u1', orderLineItemId: 56927600 }),
              claimItem({ id: 'u2', orderLineItemId: 56927597 }),
              claimItem({ id: 'u3', orderLineItemId: 56927601 }),
            ],
          },
        ],
      }),
    );

    expect(mapped.items.map((i) => i.trendyolClaimItemId)).toEqual(['u1', 'u2', 'u3']);
    expect(new Set(mapped.items.map((i) => i.orderLineId))).toEqual(new Set(['10230838']));
  });

  it('resolves only when EVERY item status is terminal', () => {
    const accepted = claimItem({ id: 'a', claimItemStatus: { name: 'Accepted' } });
    const waiting = claimItem({
      id: 'w',
      claimItemStatus: { name: 'WaitingInAction' },
      resolved: false,
    });
    const rejected = claimItem({ id: 'r', claimItemStatus: { name: 'Rejected' } });
    const cancelled = claimItem({ id: 'c', claimItemStatus: { name: 'Cancelled' } });

    const mixed = mapTrendyolClaim(
      claim({ items: [{ orderLine: { id: 1 }, claimItems: [accepted, waiting] }] }),
    );
    expect(mixed.resolved).toBe(false);

    const allTerminal = mapTrendyolClaim(
      claim({ items: [{ orderLine: { id: 1 }, claimItems: [accepted, rejected, cancelled] }] }),
    );
    expect(allTerminal.resolved).toBe(true);
  });

  it('an itemless claim is never resolved', () => {
    const mapped = mapTrendyolClaim(claim({ items: [] }));
    expect(mapped.resolved).toBe(false);
    expect(mapped.items).toEqual([]);
  });

  it('maps a claim with items:null without throwing (zero items, never resolved)', () => {
    const mapped = mapTrendyolClaim(claim({ items: null }));
    expect(mapped.items).toEqual([]);
    expect(mapped.resolved).toBe(false);
  });

  it('tolerates sparse fields with loose guards (JSONB-undefined lesson)', () => {
    const sparse = mapTrendyolClaim(
      claim({
        cargoTrackingNumber: null,
        cargoProviderName: null,
        orderOutboundPackageId: undefined,
        orderShipmentPackageId: undefined,
        lastModifiedDate: undefined,
        items: [
          {
            orderLine: { id: 5 },
            claimItems: [
              claimItem({
                id: 'sparse',
                customerClaimItemReason: null,
                trendyolClaimItemReason: undefined,
                acceptedBySeller: undefined,
                autoAccepted: undefined,
                autoApproveDate: undefined,
                resolved: undefined,
                claimItemStatus: { name: 'Created' },
              }),
            ],
          },
        ],
      }),
    );

    expect(sparse.cargoTrackingNumber).toBeNull();
    expect(sparse.orderOutboundPackageId).toBeNull();
    expect(sparse.lastModifiedDate).toBeNull();
    const item = sparse.items[0];
    expect(item?.reasonCode).toBe('UNKNOWN');
    expect(item?.reasonName).toBe('');
    expect(item?.acceptedBySeller).toBe(false);
    expect(item?.autoApproveDate).toBeNull();
    expect(item?.resolved).toBe(false);
  });

  it('falls back to the Trendyol reason when the customer reason is missing', () => {
    const mapped = mapTrendyolClaim(
      claim({
        items: [
          {
            orderLine: { id: 5 },
            claimItems: [
              claimItem({
                customerClaimItemReason: null,
                trendyolClaimItemReason: {
                  id: 751,
                  name: 'Fraud',
                  externalReasonId: 0,
                  code: 'FRAUD',
                },
              }),
            ],
          },
        ],
      }),
    );
    expect(mapped.items[0]?.reasonCode).toBe('FRAUD');
  });
});

describe('isTerminalClaimItemStatus', () => {
  it('classifies the full Trendyol lifecycle', () => {
    for (const terminal of ['Accepted', 'Rejected', 'Cancelled']) {
      expect(isTerminalClaimItemStatus(terminal)).toBe(true);
    }
    for (const inflight of [
      'Created',
      'WaitingInAction',
      'WaitingFraudCheck',
      'Unresolved',
      'InAnalysis',
    ]) {
      expect(isTerminalClaimItemStatus(inflight)).toBe(false);
    }
  });
});

describe('fetchClaims', () => {
  it('pages through with size=200 and date params, stops at totalElements', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({
          page: 0,
          totalPages: 2,
          totalElements: 2,
          content: [claim({ id: 'c1' })],
        }),
      )
      .mockResolvedValueOnce(
        pageResponse({
          page: 1,
          totalPages: 2,
          totalElements: 2,
          content: [claim({ id: 'c2' })],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const seen: string[] = [];
    const startDate = new Date('2026-04-11T00:00:00Z');
    const endDate = new Date('2026-06-10T00:00:00Z');
    for await (const c of fetchClaims({ baseUrl: BASE, credentials: CREDS, startDate, endDate })) {
      seen.push(c.id);
    }

    expect(seen).toEqual(['c1', 'c2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain('/integration/order/sellers/2738/claims');
    expect(firstUrl).toContain('size=200');
    expect(firstUrl).toContain(`startDate=${startDate.getTime()}`);
    expect(firstUrl).toContain(`endDate=${endDate.getTime()}`);
    expect(firstUrl).toContain('page=0');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('page=1');
  });

  it('empty window yields nothing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 0, totalElements: 0, content: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const seen: TrendyolClaim[] = [];
    for await (const c of fetchClaims({
      baseUrl: BASE,
      credentials: CREDS,
      startDate: new Date(0),
      endDate: new Date(1),
    })) {
      seen.push(c);
    }
    expect(seen).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finishes cleanly when Trendyol returns content:null (narrow window)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ page: 0, size: 200, totalPages: 0, totalElements: 0, content: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const seen: TrendyolClaim[] = [];
    for await (const c of fetchClaims({
      baseUrl: BASE,
      credentials: CREDS,
      startDate: new Date(0),
      endDate: new Date(1),
    })) {
      seen.push(c);
    }
    expect(seen).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes the optional claimItemStatus filter through', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 0, totalElements: 0, content: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    for await (const _ of fetchClaims({
      baseUrl: BASE,
      credentials: CREDS,
      startDate: new Date(0),
      endDate: new Date(1),
      claimItemStatus: 'Accepted',
    })) {
      // drain
    }
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('claimItemStatus=Accepted');
  });

  it('retries transient 429 then succeeds (shared fetchOnce contract)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(
        pageResponse({ page: 0, totalPages: 1, totalElements: 1, content: [claim()] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const seen: TrendyolClaim[] = [];
    for await (const c of fetchClaims({
      baseUrl: BASE,
      credentials: CREDS,
      startDate: new Date(0),
      endDate: new Date(1),
      initialBackoffMs: 1,
    })) {
      seen.push(c);
    }
    expect(seen).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a domain error on 401 (no retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const drain = async (): Promise<void> => {
      for await (const _ of fetchClaims({
        baseUrl: BASE,
        credentials: CREDS,
        startDate: new Date(0),
        endDate: new Date(1),
      })) {
        // drain
      }
    };
    await expect(drain()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
