// Claims handler integration test — PR-13.
//
// Dependency-injects a mock fetchClaims generator so the test owns what
// Trendyol "returns" (wire shapes mirror the 2026-06-10 stage capture).
// Covers: happy-path write with item linking, idempotent re-scan, the
// WaitingInAction → Accepted resolved transition, the orderNumber
// fallback match, the unmatched skip, and the cross-tenant safety
// invariant (a claim never attaches to another store's order).

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials, syncLog } from '@pazarsync/sync-core';
import type { FetchClaimsOpts, TrendyolClaim } from '@pazarsync/marketplace';

import { processClaimsChunk, type ClaimsFetchers } from '../../src/handlers/claims';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const OUTBOUND_PACKAGE_ID = 91_982_453;
const ORDER_NUMBER = '950608199';
const PLATFORM_LINE_ID = 10_230_838n;
const CLAIM_ID = 'd5ee3431-a0ba-4242-83d4-d834c12e3931';

interface BuiltCtx {
  storeId: string;
  organizationId: string;
  orderId: string;
  orderItemId: string;
  syncLogId: string;
}

/**
 * Seeds FeeDefinition rows needed by estimateReturnOnClaim + applyEstimateOnOrderCreate
 * (called via the backstop trigger added in Task 7). Without these, any claim scan
 * that transitions items to Accepted throws FeeDefinitionNotFoundError inside the
 * transaction and counts as `failed` rather than `written`.
 */
async function seedFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.createMany({
    data: [
      {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE',
        displayName: 'Platform Hizmet Bedeli',
        calculationKind: 'FIXED',
        fixedAmountNet: new Decimal('9.16'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'STOPPAGE',
        displayName: 'E-ticaret Stopaji',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: new Decimal('0.01'),
        defaultVatRate: new Decimal('0.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'SHIPPING',
        displayName: 'Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'RETURN_SHIPPING',
        displayName: 'Iade Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
    ],
  });
}

async function buildScenario(): Promise<BuiltCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  // FeeDefinitions required by the Task-7 backstop trigger: when a scan transitions
  // items to Accepted, estimateReturnOnClaim (and applyEstimateOnOrderCreate) resolve
  // fee definitions. Without these, the upsert transaction throws and the claim is
  // counted as `failed` rather than `written`.
  await seedFeeDefinitions();

  const credentials = encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Claims Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '2738',
      credentials,
      status: 'ACTIVE',
    },
  });

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: OUTBOUND_PACKAGE_ID.toString(),
      platformOrderNumber: ORDER_NUMBER,
      orderDate: new Date(),
      status: 'DELIVERED',
      // GROSS CONVENTION (2026-06-16, Bölüm E Task 20): saleGross/saleVat.
      saleGross: new Decimal('120.00'),
      saleVat: new Decimal('20.00'),
    },
  });

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      quantity: 3,
      // GROSS CONVENTION (2026-06-16): lineListGross/lineSaleGross; commissionGross replaces
      // grossCommissionAmountNet (12.00 gross = 10.00 net × 1.20). saleVatRate replaces unitVatRate.
      lineListGross: new Decimal('120.00'),
      lineSaleGross: new Decimal('120.00'),
      saleVatRate: new Decimal('20.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('12.00'),
      platformLineId: PLATFORM_LINE_ID,
    },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'CLAIMS',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: 'worker-test',
      lastTickAt: new Date(),
      progressCurrent: 0,
    },
  });

  return {
    storeId: store.id,
    organizationId: org.id,
    orderId: order.id,
    orderItemId: orderItem.id,
    syncLogId: syncLog.id,
  };
}

// ─── Wire claim builders (stage-capture shapes) ──────────────────────────

function makeWireClaim(over: Partial<TrendyolClaim> = {}): TrendyolClaim {
  return {
    id: CLAIM_ID,
    claimId: CLAIM_ID,
    orderNumber: ORDER_NUMBER,
    orderDate: 1776001121040,
    claimDate: 1776001429229,
    lastModifiedDate: 1780340474859,
    customerFirstName: 'Test Müşteri',
    customerLastName: 'Test Müşteri',
    cargoTrackingNumber: 7330000166478931,
    cargoProviderName: 'Trendyol Express Marketplace',
    orderShipmentPackageId: 91982454,
    orderOutboundPackageId: OUTBOUND_PACKAGE_ID,
    items: [
      {
        orderLine: { id: Number(PLATFORM_LINE_ID), barcode: '5135827461750' },
        claimItems: [
          {
            id: 'unit-1',
            orderLineItemId: 56927600,
            customerClaimItemReason: {
              id: 401,
              name: 'Vazgeçtim',
              externalReasonId: 25,
              code: 'ABANDON',
            },
            claimItemStatus: { name: 'WaitingInAction' },
            resolved: false,
            acceptedBySeller: false,
          },
          {
            id: 'unit-2',
            orderLineItemId: 56927597,
            customerClaimItemReason: {
              id: 401,
              name: 'Vazgeçtim',
              externalReasonId: 25,
              code: 'ABANDON',
            },
            claimItemStatus: { name: 'WaitingInAction' },
            resolved: false,
            acceptedBySeller: false,
          },
        ],
      },
    ],
    ...over,
  };
}

function makeMockFetchers(claims: TrendyolClaim[]): ClaimsFetchers {
  return {
    fetchClaims: async function* (_opts: FetchClaimsOpts): AsyncGenerator<TrendyolClaim, void> {
      for (const c of claims) yield c;
    },
  };
}

async function runChunk(syncLogId: string, claims: TrendyolClaim[]) {
  const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
  return processClaimsChunk(
    { syncLog, cursor: null, workerId: 'worker-test' },
    makeMockFetchers(claims),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('processClaimsChunk', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes the claim + per-unit items, links order items, denormalizes org from the order', async () => {
    const ctx = await buildScenario();

    const result = await runChunk(ctx.syncLogId, [makeWireClaim()]);
    expect(result).toEqual({ kind: 'done', finalCount: 1 });

    const claim = await prisma.orderClaim.findUniqueOrThrow({
      where: { orderId_trendyolClaimId: { orderId: ctx.orderId, trendyolClaimId: CLAIM_ID } },
      include: { items: true },
    });
    expect(claim.organizationId).toBe(ctx.organizationId);
    expect(claim.claimDate).toEqual(new Date(1776001429229));
    expect(claim.cargoTrackingNumber).toBe(7330000166478931n);
    expect(claim.cargoProviderName).toBe('Trendyol Express Marketplace');
    expect(claim.resolved).toBe(false);
    // #298: store_id denormalized from the parent order; package ids live in
    // indexed columns — the settlement Return bridge reads these, so a
    // missing stamp would silently break refund matching.
    expect(claim.storeId).toBe(ctx.storeId);
    expect(claim.orderShipmentPackageId).toBe('91982454');
    expect(claim.orderOutboundPackageId).toBe(OUTBOUND_PACKAGE_ID.toString());

    expect(claim.items).toHaveLength(2);
    for (const item of claim.items) {
      expect(item.orderItemId).toBe(ctx.orderItemId);
      expect(item.reasonCode).toBe('ABANDON');
      expect(item.reasonName).toBe('Vazgeçtim');
      expect(item.status).toBe('WaitingInAction');
      expect(item.resolved).toBe(false);
    }

    // externalRef carries the non-PII audit ref only — no customer names
    // anywhere in the row.
    expect(JSON.stringify(claim.externalRef)).not.toContain('Müşteri');
    expect(claim.externalRef).toMatchObject({
      orderOutboundPackageId: OUTBOUND_PACKAGE_ID.toString(),
      orderShipmentPackageId: '91982454',
    });
  });

  it('re-scan is idempotent; a status transition to Accepted resolves claim + items', async () => {
    const ctx = await buildScenario();

    await runChunk(ctx.syncLogId, [makeWireClaim()]);
    await runChunk(ctx.syncLogId, [makeWireClaim()]);

    expect(await prisma.orderClaim.count()).toBe(1);
    expect(await prisma.orderClaimItem.count()).toBe(2);

    // Tick 3: both units accepted (one by 48h auto-accept).
    const accepted = makeWireClaim();
    for (const group of accepted.items ?? []) {
      for (const ci of group.claimItems) {
        ci.claimItemStatus = { name: 'Accepted' };
        ci.resolved = true;
        ci.acceptedBySeller = true;
        ci.autoApproveDate = 1776174490958;
      }
    }
    await runChunk(ctx.syncLogId, [accepted]);

    const claim = await prisma.orderClaim.findUniqueOrThrow({
      where: { orderId_trendyolClaimId: { orderId: ctx.orderId, trendyolClaimId: CLAIM_ID } },
      include: { items: true },
    });
    expect(claim.resolved).toBe(true);
    expect(claim.items).toHaveLength(2);
    for (const item of claim.items) {
      expect(item.status).toBe('Accepted');
      expect(item.resolved).toBe(true);
      expect(item.acceptedBySeller).toBe(true);
      expect(item.autoApproveDate).toEqual(new Date(1776174490958));
    }
  });

  it('falls back to a single orderNumber match when orderOutboundPackageId is absent', async () => {
    const ctx = await buildScenario();

    const result = await runChunk(ctx.syncLogId, [
      makeWireClaim({ orderOutboundPackageId: undefined }),
    ]);
    expect(result).toEqual({ kind: 'done', finalCount: 1 });

    const claim = await prisma.orderClaim.findFirst({ where: { trendyolClaimId: CLAIM_ID } });
    expect(claim?.orderId).toBe(ctx.orderId);
  });

  it('skips an unmatched claim without failing the cycle (retry on next scan)', async () => {
    const ctx = await buildScenario();

    const result = await runChunk(ctx.syncLogId, [
      makeWireClaim({
        id: randomUUID(),
        orderNumber: 'NO-SUCH-ORDER',
        orderOutboundPackageId: 999_999_999,
      }),
      makeWireClaim(), // the matched one still lands
    ]);

    expect(result).toEqual({ kind: 'done', finalCount: 1 });
    expect(await prisma.orderClaim.count()).toBe(1);
  });

  it("TENANT SAFETY: never attaches a claim to another store's order with the same identifiers", async () => {
    const ctx = await buildScenario();

    // A sibling org+store whose order shares BOTH match keys.
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Sibling Store',
        platform: 'TRENDYOL',
        environment: 'SANDBOX',
        externalAccountId: '999999',
        credentials: encryptCredentials({ supplierId: '999999', apiKey: 'k', apiSecret: 's' }),
        status: 'ACTIVE',
      },
    });
    const otherOrder = await prisma.order.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        platformOrderId: OUTBOUND_PACKAGE_ID.toString(),
        platformOrderNumber: ORDER_NUMBER,
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('120.00'),
        saleVat: new Decimal('20.00'),
      },
    });

    await runChunk(ctx.syncLogId, [makeWireClaim()]);

    // The claim landed on ctx's order — never on the sibling store's.
    const claims = await prisma.orderClaim.findMany();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.orderId).toBe(ctx.orderId);
    expect(claims[0]?.organizationId).toBe(ctx.organizationId);
    expect(await prisma.orderClaim.count({ where: { orderId: otherOrder.id } })).toBe(0);
  });

  it('keeps items writable when the order item has no platformLineId (pre-PR-8 rows)', async () => {
    const ctx = await buildScenario();
    await prisma.orderItem.update({
      where: { id: ctx.orderItemId },
      data: { platformLineId: null },
    });

    await runChunk(ctx.syncLogId, [makeWireClaim()]);

    const items = await prisma.orderClaimItem.findMany();
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.orderItemId).toBeNull();
      expect(item.status).toBe('WaitingInAction');
    }
  });

  it('a STALE outbound id never falls back to an orderNumber sibling — unmatched instead', async () => {
    const ctx = await buildScenario();

    // Outbound id is PRESENT but its package is not synced yet; a same-
    // numbered candidate exists. The fallback gate must refuse the
    // sibling write and report unmatched (next scan retries naturally).
    const result = await runChunk(ctx.syncLogId, [
      makeWireClaim({ orderOutboundPackageId: 999_999_999 }),
    ]);

    expect(result).toEqual({ kind: 'done', finalCount: 0 });
    expect(await prisma.orderClaim.count()).toBe(0);
  });

  it('an id-less claim with TWO same-numbered candidates (split shipment) stays unmatched', async () => {
    const ctx = await buildScenario();
    await prisma.order.create({
      data: {
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        platformOrderId: '91982999',
        platformOrderNumber: ORDER_NUMBER,
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('60.00'),
        saleVat: new Decimal('10.00'),
      },
    });

    const result = await runChunk(ctx.syncLogId, [
      makeWireClaim({ orderOutboundPackageId: undefined }),
    ]);

    expect(result).toEqual({ kind: 'done', finalCount: 0 });
    expect(await prisma.orderClaim.count()).toBe(0);
  });

  it('TENANT SAFETY (fallback path): an id-less claim matching only a sibling store stays unmatched', async () => {
    const ctx = await buildScenario();

    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Sibling Store',
        platform: 'TRENDYOL',
        environment: 'SANDBOX',
        externalAccountId: '999998',
        credentials: encryptCredentials({ supplierId: '999998', apiKey: 'k', apiSecret: 's' }),
        status: 'ACTIVE',
      },
    });
    await prisma.order.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        platformOrderId: '88880001',
        platformOrderNumber: 'SIBLING-ONLY',
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('120.00'),
        saleVat: new Decimal('20.00'),
      },
    });

    // ctx's own store has no order numbered SIBLING-ONLY; only the
    // sibling org does. Dropping the storeId filter from the fallback
    // query would turn this test red.
    const result = await runChunk(ctx.syncLogId, [
      makeWireClaim({ orderOutboundPackageId: undefined, orderNumber: 'SIBLING-ONLY' }),
    ]);

    expect(result).toEqual({ kind: 'done', finalCount: 0 });
    expect(await prisma.orderClaim.count()).toBe(0);
  });

  it('re-anchors an existing claim row when the same Trendyol claim matches a different order', async () => {
    const ctx = await buildScenario();

    // Tick 1: claim lands on ctx's order.
    await runChunk(ctx.syncLogId, [makeWireClaim()]);

    // The real package materializes later as a SEPARATE order row of the
    // same store (split sibling) and Trendyol's claim now points at it.
    const siblingOrder = await prisma.order.create({
      data: {
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        platformOrderId: '91982999',
        platformOrderNumber: ORDER_NUMBER,
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('60.00'),
        saleVat: new Decimal('10.00'),
      },
    });

    await runChunk(ctx.syncLogId, [makeWireClaim({ orderOutboundPackageId: 91_982_999 })]);

    // Moved, not duplicated; stale item links re-resolved against the
    // new order (which has no matching platformLineId → null).
    const claims = await prisma.orderClaim.findMany({ include: { items: true } });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.orderId).toBe(siblingOrder.id);
    expect(claims[0]?.items).toHaveLength(2);
    for (const item of claims[0]?.items ?? []) {
      expect(item.orderItemId).toBeNull();
    }
  });

  it('a malformed wire claim is isolated — the healthy claim still lands', async () => {
    const ctx = await buildScenario();

    const malformed = makeWireClaim({ id: randomUUID(), orderNumber: 'OTHER' });
    for (const group of malformed.items ?? []) {
      for (const ci of group.claimItems) {
        // Simulate a wire drift the types cannot promise away.
        Reflect.deleteProperty(ci, 'claimItemStatus');
      }
    }

    const result = await runChunk(ctx.syncLogId, [malformed, makeWireClaim()]);

    expect(result).toEqual({ kind: 'done', finalCount: 1 });
    const claims = await prisma.orderClaim.findMany();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.trendyolClaimId).toBe(CLAIM_ID);
  });

  it('throws when EVERY claim in the window fails (systemic failure must not look COMPLETED)', async () => {
    const ctx = await buildScenario();

    const malformed = makeWireClaim();
    for (const group of malformed.items ?? []) {
      for (const ci of group.claimItems) {
        Reflect.deleteProperty(ci, 'claimItemStatus');
      }
    }

    await expect(runChunk(ctx.syncLogId, [malformed])).rejects.toThrow();
    expect(await prisma.orderClaim.count()).toBe(0);
  });

  it('an itemless re-scan never regresses resolved true → false', async () => {
    const ctx = await buildScenario();

    const accepted = makeWireClaim();
    for (const group of accepted.items ?? []) {
      for (const ci of group.claimItems) {
        ci.claimItemStatus = { name: 'Accepted' };
        ci.resolved = true;
      }
    }
    await runChunk(ctx.syncLogId, [accepted]);

    await runChunk(ctx.syncLogId, [makeWireClaim({ items: [] })]);

    const claim = await prisma.orderClaim.findFirstOrThrow({
      where: { trendyolClaimId: CLAIM_ID },
    });
    expect(claim.resolved).toBe(true);
  });

  it('LOG PII GUARD: unmatched warn logs never carry customer names', async () => {
    const ctx = await buildScenario();
    const warnSpy = vi.spyOn(syncLog, 'warn');
    const errorSpy = vi.spyOn(syncLog, 'error');

    await runChunk(ctx.syncLogId, [
      makeWireClaim({
        id: randomUUID(),
        orderNumber: 'NO-SUCH-ORDER',
        orderOutboundPackageId: 999_999_999,
      }),
    ]);

    for (const call of [...warnSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain('Müşteri');
    }
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
