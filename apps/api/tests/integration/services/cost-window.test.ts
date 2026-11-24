import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { hadCostWithinOrderDay, stampCostWindowExclusions } from '@pazarsync/order-sync';
import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  COST_FIXTURE_EPOCH,
  createCostProfile,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { backdateSellerInputHistory } from '../../helpers/seller-input-history';

// The cost-window helper (Berkin 2026-11-03): true iff every non-cancelled item
// had a cost in force when the order's business day ended (plan PR-3b: attached by
// then, and the version in force then is not an archive version). The day end is the
// order day's closing midnight and the rule is inclusive, so that boundary instant
// itself counts (plan decision 1) -- a cost attached one minute earlier counts and
// one minute later does not. See packages/order-sync/src/cost-window.ts.

// A past business day, far enough back that the test never straddles midnight.
const ORDER_DATE = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const DAY_END = getBusinessDayRange(ORDER_DATE).end;
const ONE_MINUTE_MS = 60 * 1000;

async function createVariant(orgId: string, storeId: string, barcode: string): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Cost Window Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
    },
  });
  return variant.id;
}

// Attach a cost profile to a variant with an explicit link `attachedAt` and an
// explicit first-version `effectiveFrom`, so each test can position both timestamps
// relative to the order's day end.
async function attachCost(params: {
  orgId: string;
  storeId: string;
  variantId: string;
  attachedAt: Date;
  versionEffectiveFrom: Date;
}): Promise<string> {
  const profile = await createCostProfile(params.orgId, {
    storeId: params.storeId,
    amountGross: '40.00',
    seedVersion: false,
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: params.orgId,
      productVariantId: params.variantId,
      profileId: profile.id,
      attachedAt: params.attachedAt,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: params.orgId,
      version: 1,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      changedFields: [],
      effectiveFrom: params.versionEffectiveFrom,
    },
  });
  return profile.id;
}

// Append an archive (archived: true) or restore (archived: false) version to a
// profile the way the cost-profile service does: the next version number, with
// `archivedAt` and `effectiveFrom` both set to the archive instant (null archivedAt
// for a restore), and the profile row stamped to match.
async function appendArchiveVersion(params: {
  orgId: string;
  profileId: string;
  version: number;
  at: Date;
  archived: boolean;
}): Promise<void> {
  const profile = await prisma.costProfile.update({
    where: { id: params.profileId },
    data: { archivedAt: params.archived ? params.at : null },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: params.profileId,
      organizationId: params.orgId,
      version: params.version,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      archivedAt: params.archived ? params.at : null,
      changedFields: ['archivedAt'],
      effectiveFrom: params.at,
    },
  });
}

describe('hadCostWithinOrderDay', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('counts a cost attached before the end of the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-OK');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  it('counts a cost attached exactly at the end of the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-EXACT');
    // Both the link attach and the version effective-from land EXACTLY on the day
    // end. The rule is inclusive, so the boundary instant itself still counts (plan
    // decision 1: the day end is inclusive).
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: DAY_END,
      versionEffectiveFrom: DAY_END,
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  it('ignores a cost attached after the end of the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-LATE');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('ignores a profile whose first version starts after the order day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-VER');
    // The link itself is attached in time, but the profile's only version becomes
    // effective after the order day -- so no priced version was in force in time.
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('treats an unresolved variant as missing a cost', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: null, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('skips cancelled items', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    // The order's only item is cancelled and carries no cost; a cancelled line
    // needs no cost, so with nothing left to check the window is satisfied.
    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: null, isCancelled: true }],
    });
    expect(result).toBe(true);
  });

  it('requires a timely cost on every item, not just one', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const costedVariantId = await createVariant(org.id, store.id, 'EAN13-CW-BOTH-A');
    const uncostedVariantId = await createVariant(org.id, store.id, 'EAN13-CW-BOTH-B');
    // Only the first variant is costed in time; the second never gets a cost. A
    // single uncosted non-cancelled item fails the whole window.
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId: costedVariantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [
        { productVariantId: costedVariantId, isCancelled: false },
        { productVariantId: uncostedVariantId, isCancelled: false },
      ],
    });
    expect(result).toBe(false);
  });

  it('accepts a variant whose second profile was attached in time', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-TWO');
    // The first profile was attached (and made effective) too late; a second,
    // distinct profile was attached in time. One link in force is enough -- a
    // variant is covered when any of its links passes, so the late one does not spoil it.
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
    });
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  it('ignores a cost link of another organization or store', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-ISO');

    // A timely cost link that references THIS order's variant id but belongs to a
    // DIFFERENT organization + store. Built directly (the attach service would
    // reject a cross-store/-org attach); without the tenant filter it would cover
    // the variant, so the org_id/store_id scoping must drop it and leave the
    // variant uncosted.
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);
    const otherProfile = await createCostProfile(otherOrg.id, {
      storeId: otherStore.id,
      amountGross: '40.00',
      seedVersion: false,
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: otherOrg.id,
        productVariantId: variantId,
        profileId: otherProfile.id,
        attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: otherProfile.id,
        organizationId: otherOrg.id,
        version: 1,
        name: otherProfile.name,
        type: otherProfile.type,
        amountGross: otherProfile.amountGross,
        vatRate: otherProfile.vatRate,
        changedFields: [],
        effectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      },
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  // Plan PR-3b (Berkin 2026-11-23): an archived profile is ignored by every later
  // order. The link counts only when, at the order's day end, the version in force
  // is not an archive version.
  it('ignores a link whose profile was archived before the order day ended', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-ARCH-IN');
    const profileId = await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: COST_FIXTURE_EPOCH,
      versionEffectiveFrom: COST_FIXTURE_EPOCH,
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 2,
      at: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      archived: true,
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);
  });

  it('counts a link whose profile was archived after the order day ended', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-ARCH-OUT');
    const profileId = await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: COST_FIXTURE_EPOCH,
      versionEffectiveFrom: COST_FIXTURE_EPOCH,
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 2,
      at: new Date(DAY_END.getTime() + ONE_MINUTE_MS),
      archived: true,
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  it('counts a profile archived and restored before the day end', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-RESTORED');
    const profileId = await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: COST_FIXTURE_EPOCH,
      versionEffectiveFrom: COST_FIXTURE_EPOCH,
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 2,
      at: new Date(DAY_END.getTime() - 2 * ONE_MINUTE_MS),
      archived: true,
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 3,
      at: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      archived: false,
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(true);
  });

  // Same-day edit window (plan PR-1, P1-08): the window reads the links in force at
  // the day end, rebuilt from the removal log, so a detach stamped after the day end
  // does not take back a cost the order's day had.
  it('hadCostWithinOrderDay is true for a link detached after T', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-DETACHED');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
      versionEffectiveFrom: new Date(DAY_END.getTime() - ONE_MINUTE_MS),
    });
    // Detached now: the removal is stamped after the order's day end.
    await prisma.productVariantCostProfile.deleteMany({
      where: { organizationId: org.id, productVariantId: variantId },
    });

    const params = {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    };
    expect(await hadCostWithinOrderDay(prisma, params)).toBe(true);

    // Control: the same removal stamped before the day end leaves no cost at it.
    await backdateSellerInputHistory(org.id, new Date(DAY_END.getTime() - ONE_MINUTE_MS / 2));
    expect(await hadCostWithinOrderDay(prisma, params)).toBe(false);
  });

  it("another organization's link for the same variant id never counts", async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-CW-FOREIGN');

    // Three foreign rows that are fully in force (attached and effective long before
    // the order, never archived) and point at THIS order's variant id, built directly
    // (the attach service would reject them): a link of another organization, a link
    // stamped with this organization but pointing at the other organization's profile,
    // and a link stamped with the other organization whose profile is this
    // organization's. The tenant filters (link and profile organization) are the only
    // reason none may count; the last one is dropped by the link filter alone.
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);
    const otherProfile = await createCostProfile(otherOrg.id, {
      storeId: otherStore.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: otherOrg.id,
        productVariantId: variantId,
        profileId: otherProfile.id,
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });
    const otherOrgSecondProfile = await createCostProfile(otherOrg.id, {
      storeId: otherStore.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: variantId,
        profileId: otherOrgSecondProfile.id,
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });
    const ownProfile = await createCostProfile(org.id, {
      storeId: store.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: otherOrg.id,
        productVariantId: variantId,
        profileId: ownProfile.id,
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });

    const result = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: variantId, isCancelled: false }],
    });
    expect(result).toBe(false);

    // A variant row in THIS store stamped with the other organization (the database
    // allows it), carrying a link and a profile of this organization: only the
    // variant's organization filter drops it. Its own single-item call, because the
    // check needs every item covered and a second item would mask the result.
    const foreignStampedVariantId = await createVariant(
      otherOrg.id,
      store.id,
      'EAN13-CW-FOREIGN-STAMP',
    );
    const stampedProfile = await createCostProfile(org.id, {
      storeId: store.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: foreignStampedVariantId,
        profileId: stampedProfile.id,
        attachedAt: COST_FIXTURE_EPOCH,
      },
    });

    const stampedResult = await hadCostWithinOrderDay(prisma, {
      organizationId: org.id,
      storeId: store.id,
      orderDate: ORDER_DATE,
      items: [{ productVariantId: foreignStampedVariantId, isCancelled: false }],
    });
    expect(stampedResult).toBe(false);
  });
});

// The backfill (Faz 3E, Task 4): stamp the cost-window exclusion on a store's
// EXISTING orders. A past-day, final (seller inputs made final by the day-close pass),
// non-cancelled, not-yet-excluded order whose cost missed its business day is stamped COST_DEADLINE_MISSED -- or LATE_UNCOSTED_ARRIVAL
// when our first record of it (created_at) is itself after the day closed -- and
// enqueued for a MANUAL recompute. dryRun returns the counts and writes nothing.
// See packages/order-sync/src/cost-window.ts (stampCostWindowExclusions).

const IN_TIME = new Date(DAY_END.getTime() - ONE_MINUTE_MS);
const TOO_LATE = new Date(DAY_END.getTime() + ONE_MINUTE_MS);
// The seller-input marker of a past-day order the day-close pass already made final
// (same-day edit window, plan PR-1, NB8): the backfill decides final orders only.
const FINAL_AT = new Date(DAY_END.getTime() + 2 * ONE_MINUTE_MS);

// Create a past-day order (orderDate ORDER_DATE) with a single line carrying the
// given variant, then force its created_at so the reason split is deterministic.
// The order is final (FINAL_AT) unless `sellerInputsFinalAt` says otherwise.
async function createPastDayOrder(params: {
  orgId: string;
  storeId: string;
  variantId: string | null;
  createdAt: Date;
  orderDate?: Date;
  status?: 'DELIVERED' | 'CANCELLED';
  sellerInputsFinalAt?: Date | null;
}): Promise<string> {
  const order = await createOrder(params.orgId, params.storeId, {
    orderDate: params.orderDate ?? ORDER_DATE,
    status: params.status ?? 'DELIVERED',
    sellerInputsFinalAt:
      params.sellerInputsFinalAt === undefined ? FINAL_AT : params.sellerInputsFinalAt,
  });
  await createOrderItem(order.id, params.orgId, { productVariantId: params.variantId });
  await prisma.order.update({ where: { id: order.id }, data: { createdAt: params.createdAt } });
  return order.id;
}

function runStamp(params: {
  organizationId: string;
  storeId: string;
  now?: Date;
  dryRun?: boolean;
}): Promise<{ readonly costDeadlineMissed: number; readonly lateUncostedArrival: number }> {
  return prisma.$transaction((tx) =>
    stampCostWindowExclusions(tx, {
      organizationId: params.organizationId,
      storeId: params.storeId,
      now: params.now ?? new Date(),
      dryRun: params.dryRun ?? false,
    }),
  );
}

describe('stampCostWindowExclusions', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('stamps a past-day order whose cost came after its day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-MISS');
    // Cost attached after the day end -> the window was missed. We had the order in
    // time (created_at before the day end), so the reason is COST_DEADLINE_MISSED.
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: TOO_LATE,
      versionEffectiveFrom: TOO_LATE,
    });
    const orderId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: IN_TIME,
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    const queued = await prisma.profitRecomputeRequest.findUnique({ where: { orderId } });
    expect(queued?.reason).toBe(ProfitRecomputeReason.MANUAL);
  });

  // Same-day edit window (plan PR-1, NB8): a non-final order's seller inputs still follow
  // its day, and its exclusion belongs to the day-close pass behind the settled cutoff.
  // The backfill compares with the app clock, so it must not decide such an order.
  it('the backfill never stamps or counts a non-final order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // A resolved but never-costed variant: both orders below miss the cost window.
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-NONFINAL');
    const nonFinalId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: IN_TIME,
      sellerInputsFinalAt: null,
    });
    // Positive control: the final twin of the same shape is stamped.
    const finalId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: IN_TIME,
    });

    const dryRun = await runStamp({ organizationId: org.id, storeId: store.id, dryRun: true });
    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(dryRun).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    const nonFinal = await prisma.order.findUniqueOrThrow({ where: { id: nonFinalId } });
    expect(nonFinal.profitExcludedAt).toBeNull();
    expect(nonFinal.sellerInputsFinalAt).toBeNull();
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: nonFinalId } }),
    ).toBeNull();
    const final = await prisma.order.findUniqueOrThrow({ where: { id: finalId } });
    expect(final.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  // A final order's captured cost list is frozen (same-day edit window, plan PR-1): a
  // captured cost proves the window was not missed. The links alone read a same-day
  // archive after the capture as "no cost at the day end".
  it('the backfill never stamps an order whose captured cost list is non-empty, even if its only profile was archived before the day ended', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-CAPTURED');
    const profileId = await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: COST_FIXTURE_EPOCH,
      versionEffectiveFrom: COST_FIXTURE_EPOCH,
    });
    const pinned = await prisma.costProfileVersion.findFirstOrThrow({
      where: { profileId, organizationId: org.id, version: 1 },
      select: { id: true },
    });
    const beforeArchive = new Date(DAY_END.getTime() - 2 * ONE_MINUTE_MS);

    // Captured in time with the profile's cost, then the only profile is archived
    // later the same day.
    const capturedId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: beforeArchive,
    });
    await prisma.orderItem.updateMany({
      where: { orderId: capturedId, organizationId: org.id },
      data: { snapshotCostProfileVersionIds: [pinned.id], snapshotIsDigital: false },
    });
    // Twin: the same order shape with an empty captured list is still judged from the
    // live links, so the guard cannot pass by skipping every order.
    const uncapturedId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: beforeArchive,
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 2,
      at: IN_TIME,
      archived: true,
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    const captured = await prisma.order.findUniqueOrThrow({ where: { id: capturedId } });
    expect(captured.profitExcludedAt).toBeNull();
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: capturedId } }),
    ).toBeNull();
    const uncaptured = await prisma.order.findUniqueOrThrow({ where: { id: uncapturedId } });
    expect(uncaptured.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  // A digital line ships no cargo (no desi needed) but still needs a cost, so its
  // captured cost list proves the window the same way a physical line's does.
  it('the backfill never stamps an all-digital order whose captured cost list is non-empty, even if its only profile was archived before the day ended', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-DIGITAL');
    await prisma.productVariant.updateMany({
      where: { id: variantId, organizationId: org.id },
      data: { isDigital: true },
    });
    const profileId = await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId,
      attachedAt: COST_FIXTURE_EPOCH,
      versionEffectiveFrom: COST_FIXTURE_EPOCH,
    });
    const pinned = await prisma.costProfileVersion.findFirstOrThrow({
      where: { profileId, organizationId: org.id, version: 1 },
      select: { id: true },
    });
    const beforeArchive = new Date(DAY_END.getTime() - 2 * ONE_MINUTE_MS);

    // Captured in time with the profile's cost, then the only profile is archived
    // later the same day.
    const capturedId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: beforeArchive,
    });
    await prisma.orderItem.updateMany({
      where: { orderId: capturedId, organizationId: org.id },
      data: { snapshotCostProfileVersionIds: [pinned.id], snapshotIsDigital: true },
    });
    // Control: a digital line with an empty captured list is not exempt from cost, so
    // it is still judged from the live links and stamped.
    const uncapturedId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: beforeArchive,
    });
    await prisma.orderItem.updateMany({
      where: { orderId: uncapturedId, organizationId: org.id },
      data: { snapshotCostProfileVersionIds: [], snapshotIsDigital: true },
    });
    await appendArchiveVersion({
      orgId: org.id,
      profileId,
      version: 2,
      at: IN_TIME,
      archived: true,
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    const captured = await prisma.order.findUniqueOrThrow({ where: { id: capturedId } });
    expect(captured.profitExcludedAt).toBeNull();
    expect(
      await prisma.profitRecomputeRequest.findUnique({ where: { orderId: capturedId } }),
    ).toBeNull();
    const uncaptured = await prisma.order.findUniqueOrThrow({ where: { id: uncapturedId } });
    expect(uncaptured.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('stamps a late arrival as LATE_UNCOSTED_ARRIVAL', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // A resolved but never-costed variant, and our first record of the order lands
    // after its business day closed -> LATE_UNCOSTED_ARRIVAL.
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-LATE');
    const orderId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: TOO_LATE,
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 0, lateUncostedArrival: 1 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    const queued = await prisma.profitRecomputeRequest.findUnique({ where: { orderId } });
    expect(queued?.reason).toBe(ProfitRecomputeReason.MANUAL);
  });

  it('leaves a timely costed, a cancelled and an already excluded order alone', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    // (1) Timely costed -> the window is satisfied, so it stays in profit.
    const timelyVariant = await createVariant(org.id, store.id, 'EAN13-BF-OK');
    await attachCost({
      orgId: org.id,
      storeId: store.id,
      variantId: timelyVariant,
      attachedAt: IN_TIME,
      versionEffectiveFrom: IN_TIME,
    });
    const timelyId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId: timelyVariant,
      createdAt: IN_TIME,
    });

    // (2) Cancelled + uncosted -> carries no payout, never excluded.
    const cancelledVariant = await createVariant(org.id, store.id, 'EAN13-BF-CANCEL');
    const cancelledId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId: cancelledVariant,
      createdAt: IN_TIME,
      status: 'CANCELLED',
    });

    // (3) Already excluded -> filtered out by the profit_excluded_at IS NULL guard (it is
    // final, so that guard alone keeps it out).
    const excluded = await createOrder(org.id, store.id, {
      orderDate: ORDER_DATE,
      sellerInputsFinalAt: FINAL_AT,
    });
    await prisma.order.update({
      where: { id: excluded.id },
      data: {
        profitExcludedAt: new Date(DAY_END.getTime() - 2 * ONE_MINUTE_MS),
        profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL',
      },
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 0, lateUncostedArrival: 0 });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: timelyId } })).profitExcludedAt,
    ).toBeNull();
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: cancelledId } })).profitExcludedAt,
    ).toBeNull();
    // The pre-excluded order kept its original reason (no re-stamp).
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: excluded.id } })).profitExclusionReason,
    ).toBe('LATE_UNCOSTED_ARRIVAL');
    expect(await prisma.profitRecomputeRequest.count({ where: { storeId: store.id } })).toBe(0);
  });

  it("leaves today's orders alone", async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Uncosted, but its business day is today -> the window is still open, so it is
    // not a backfill candidate. The order carries a final marker on purpose, so the
    // past-day filter alone keeps it out.
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-TODAY');
    const orderId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: new Date(),
      orderDate: new Date(),
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id });

    expect(result).toEqual({ costDeadlineMissed: 0, lateUncostedArrival: 0 });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).profitExcludedAt,
    ).toBeNull();
    expect(await prisma.profitRecomputeRequest.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('writes nothing in dry-run mode', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const variantId = await createVariant(org.id, store.id, 'EAN13-BF-DRY');
    const orderId = await createPastDayOrder({
      orgId: org.id,
      storeId: store.id,
      variantId,
      createdAt: IN_TIME,
    });

    const result = await runStamp({ organizationId: org.id, storeId: store.id, dryRun: true });

    // The count reflects what a real run would stamp, but nothing is written.
    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).profitExcludedAt,
    ).toBeNull();
    expect(await prisma.profitRecomputeRequest.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('never touches another store or organization', async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // One missed past-day order in each store/org, all identical in shape.
    const targetVariant = await createVariant(orgA.id, storeA.id, 'EAN13-BF-TARGET');
    const targetId = await createPastDayOrder({
      orgId: orgA.id,
      storeId: storeA.id,
      variantId: targetVariant,
      createdAt: IN_TIME,
    });
    const siblingVariant = await createVariant(orgA.id, storeA2.id, 'EAN13-BF-SIBLING');
    const siblingId = await createPastDayOrder({
      orgId: orgA.id,
      storeId: storeA2.id,
      variantId: siblingVariant,
      createdAt: IN_TIME,
    });
    const otherVariant = await createVariant(orgB.id, storeB.id, 'EAN13-BF-OTHER');
    const otherId = await createPastDayOrder({
      orgId: orgB.id,
      storeId: storeB.id,
      variantId: otherVariant,
      createdAt: IN_TIME,
    });

    const result = await runStamp({ organizationId: orgA.id, storeId: storeA.id });

    // Only storeA's order is counted and stamped.
    expect(result).toEqual({ costDeadlineMissed: 1, lateUncostedArrival: 0 });
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: targetId } })).profitExcludedAt,
    ).not.toBeNull();
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: siblingId } })).profitExcludedAt,
    ).toBeNull();
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: otherId } })).profitExcludedAt,
    ).toBeNull();
  });
});
