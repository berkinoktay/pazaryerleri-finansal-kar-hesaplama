/**
 * Integration tests for loadSellerInputsAt (same-day edit window, plans P1-06 and
 * P1-07): a variant's cost links and desi rebuilt at an order's business-day end T
 * from the live rows and the two trigger-written history logs.
 *
 * Cost links at T = the live links plus every removed link with
 * attached_at <= T < detached_at, one entry per profile. T here is yesterday's end
 * (today's start), so a delete or an UPDATE done now is stamped by the trigger after
 * T; a stamp at or before T is written by inserting the log row directly.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@pazarsync/db';
import { SnapshotDesiSource } from '@pazarsync/db/enums';
import { getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  chooseOrderCostVersion,
  isCostLinkInForce,
} from '../../core/seller-costs/cost-profile-in-force';
import { loadSellerInputsAt, resolveDesiAtDayEnd, type SellerInputsAt } from '../seller-inputs-at';
import { deferred, delay } from './helpers/concurrency';
import {
  COST_FIXTURE_EPOCH,
  createAdditionalStore,
  ensureDbReachable,
  truncateAll,
} from './helpers/melontik-parcel';

const ONE_DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BARRIER_POLL_WINDOW_MS = 10_000;

/** Yesterday's Istanbul business-day end (= today's start): a closed day's T. */
function closedDayEnd(): Date {
  return getBusinessDayRange(new Date(Date.now() - ONE_DAY_MS)).end;
}

/** Today's Istanbul business-day end: an open day's T. */
function openDayEnd(): Date {
  return getBusinessDayRange(new Date()).end;
}

function shift(instant: Date, ms: number): Date {
  return new Date(instant.getTime() + ms);
}

interface Tenant {
  readonly organizationId: string;
  readonly storeId: string;
}

async function createTenant(): Promise<Tenant> {
  const org = await prisma.organization.create({
    data: { name: 'Seller Inputs Org', slug: `seller-inputs-${randomUUID().slice(0, 8)}` },
  });
  const storeId = await createAdditionalStore({ organizationId: org.id, name: 'Seller Inputs' });
  return { organizationId: org.id, storeId };
}

/** A variant whose live desi columns are set at INSERT (no history row is written). */
async function createVariant(
  tenant: Tenant,
  desi: { readonly override?: string | null; readonly synced?: string | null } = {},
): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const product = await prisma.product.create({
    data: {
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${suffix}`,
      title: `Seller inputs ${suffix}`,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      barcode: `bc-${suffix}`,
      stockCode: `sk-${suffix}`,
      salePrice: '100',
      listPrice: '100',
      dimensionalWeightOverride: desi.override ?? null,
      syncedDimensionalWeight: desi.synced ?? null,
      isDigital: false,
    },
  });
  return variant.id;
}

/** A COGS profile with one version (effective far in the past unless given). */
async function createProfile(
  tenant: Tenant,
  params: { readonly amountGross: string; readonly effectiveFrom?: Date },
): Promise<string> {
  const name = `COGS ${randomUUID().slice(0, 8)}`;
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
      name,
      type: 'COGS',
      amountGross: params.amountGross,
      vatRate: '10',
    },
  });
  await addVersion(tenant, profile.id, {
    version: 1,
    amountGross: params.amountGross,
    effectiveFrom: params.effectiveFrom ?? COST_FIXTURE_EPOCH,
  });
  return profile.id;
}

/** Appends a version; with no `effectiveFrom` the database stamps the transaction instant. */
async function addVersion(
  tenant: Tenant,
  profileId: string,
  params: { readonly version: number; readonly amountGross: string; readonly effectiveFrom?: Date },
): Promise<void> {
  await prisma.costProfileVersion.create({
    data: {
      profileId,
      organizationId: tenant.organizationId,
      version: params.version,
      name: `v${params.version}`,
      type: 'COGS',
      amountGross: params.amountGross,
      vatRate: '10',
      changedFields: [],
      ...(params.effectiveFrom === undefined ? {} : { effectiveFrom: params.effectiveFrom }),
    },
  });
}

/** Links a profile; with no `attachedAt` the database stamps the transaction instant. */
async function link(
  tenant: Tenant,
  variantId: string,
  profileId: string,
  attachedAt?: Date,
): Promise<void> {
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: tenant.organizationId,
      productVariantId: variantId,
      profileId,
      ...(attachedAt === undefined ? {} : { attachedAt }),
    },
  });
}

/** A direct link delete (the trigger logs it, stamped now). */
async function detach(tenant: Tenant, variantId: string, profileId: string): Promise<void> {
  await prisma.productVariantCostProfile.deleteMany({
    where: { organizationId: tenant.organizationId, productVariantId: variantId, profileId },
  });
}

/** A removal log row written directly, for stamps a trigger cannot produce. */
async function insertRemoval(
  tenant: Tenant,
  params: {
    readonly variantId: string;
    readonly profileId: string;
    readonly attachedAt: Date;
    readonly detachedAt: Date;
  },
): Promise<void> {
  await prisma.costLinkRemoval.create({
    data: {
      organizationId: tenant.organizationId,
      productVariantId: params.variantId,
      profileId: params.profileId,
      attachedAt: params.attachedAt,
      detachedAt: params.detachedAt,
    },
  });
}

function profileIdsOf(inputs: SellerInputsAt | undefined): string[] | undefined {
  return inputs?.costProfiles.map((profile) => profile.profileId);
}

function linksOf(
  inputs: SellerInputsAt | undefined,
): Array<{ profileId: string; attachedAt: string }> | undefined {
  return inputs?.costProfiles.map((profile) => ({
    profileId: profile.profileId,
    attachedAt: profile.attachedAt.toISOString(),
  }));
}

/** A real desi UPDATE in its own transaction: the trigger logs it, stamped now (after T). */
async function updateDesi(
  tenant: Tenant,
  variantId: string,
  column: 'override' | 'synced',
  value: string | null,
): Promise<void> {
  if (column === 'override') {
    await prisma.$executeRaw`
      UPDATE product_variants SET dimensional_weight_override = ${value}::numeric
       WHERE organization_id = ${tenant.organizationId}::uuid AND id = ${variantId}::uuid`;
    return;
  }
  await prisma.$executeRaw`
    UPDATE product_variants SET synced_dimensional_weight = ${value}::numeric
     WHERE organization_id = ${tenant.organizationId}::uuid AND id = ${variantId}::uuid`;
}

interface ColumnChange {
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * A desi log row written directly, for stamps a trigger cannot produce (at or before
 * T, or out of sequence order). Rows get ascending seq in insertion order.
 */
async function insertDesiChange(
  tenant: Tenant,
  variantId: string,
  row: { readonly changedAt: Date; readonly override: ColumnChange; readonly synced: ColumnChange },
): Promise<void> {
  await prisma.variantDesiChange.create({
    data: {
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
      productVariantId: variantId,
      changedAt: row.changedAt,
      overrideChanged: row.override.from !== row.override.to,
      syncedChanged: row.synced.from !== row.synced.to,
      oldOverride: row.override.from,
      newOverride: row.override.to,
      oldSynced: row.synced.from,
      newSynced: row.synced.to,
    },
  });
}

interface DesiStrings {
  readonly override: string | null;
  readonly synced: string | null;
}

function desiStrings(inputs: SellerInputsAt | undefined): DesiStrings | undefined {
  if (inputs === undefined) return undefined;
  return {
    override: inputs.desi.override?.toString() ?? null,
    synced: inputs.desi.synced?.toString() ?? null,
  };
}

/** The reconstructed desi pair of one variant at `at`, as strings. */
async function desiAt(
  tenant: Tenant,
  variantId: string,
  at: Date,
  db: Prisma.TransactionClient = prisma,
): Promise<DesiStrings | undefined> {
  const result = await loadSellerInputsAt(db, {
    organizationId: tenant.organizationId,
    variantIds: [variantId],
    at,
  });
  return desiStrings(result.get(variantId));
}

/**
 * Polls pg_locks (outside both transactions) until a backend of this database waits
 * on a relation lock, or the window elapses or the waiter settles. True when a waiter
 * was seen.
 */
async function sawRelationLockWaiter(isSettled: () => boolean): Promise<boolean> {
  const deadline = Date.now() + BARRIER_POLL_WINDOW_MS;
  while (Date.now() < deadline && !isSettled()) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting
        FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.datname = current_database()
         AND l.locktype = 'relation'
         AND NOT l.granted`;
    if ((rows[0]?.waiting ?? 0) >= 1) return true;
    await delay(50);
  }
  return false;
}

describe('loadSellerInputsAt - cost links at T', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a link detached after T is still returned at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const profileId = await createProfile(tenant, { amountGross: '100' });
    await link(tenant, variantId, profileId, shift(T, -HOUR_MS));
    await detach(tenant, variantId, profileId);

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    expect(linksOf(result.get(variantId))).toEqual([
      { profileId, attachedAt: shift(T, -HOUR_MS).toISOString() },
    ]);
  });

  it('a link detached and re-attached after T is returned once, with the old attached_at', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const profileId = await createProfile(tenant, { amountGross: '100' });
    await link(tenant, variantId, profileId, shift(T, -HOUR_MS));
    await detach(tenant, variantId, profileId);
    await link(tenant, variantId, profileId); // re-attached now, after T

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    expect(linksOf(result.get(variantId))).toEqual([
      { profileId, attachedAt: shift(T, -HOUR_MS).toISOString() },
    ]);
  });

  it('a profile linked twice in history (two removals, both spanning T) is returned once', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const profileId = await createProfile(tenant, { amountGross: '100' });
    await link(tenant, variantId, profileId, shift(T, -2 * HOUR_MS));
    await detach(tenant, variantId, profileId);
    await link(tenant, variantId, profileId, shift(T, -HOUR_MS));
    await detach(tenant, variantId, profileId);
    expect(
      await prisma.costLinkRemoval.count({ where: { organizationId: tenant.organizationId } }),
    ).toBe(2);

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    // One entry, carrying the earliest attach of the removals that span T.
    expect(linksOf(result.get(variantId))).toEqual([
      { profileId, attachedAt: shift(T, -2 * HOUR_MS).toISOString() },
    ]);
  });

  it('a link detached exactly at T is not in force', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const detachedAtT = await createProfile(tenant, { amountGross: '100' });
    const detachedAfterT = await createProfile(tenant, { amountGross: '200' });
    await insertRemoval(tenant, {
      variantId,
      profileId: detachedAtT,
      attachedAt: shift(T, -HOUR_MS),
      detachedAt: T,
    });
    // Positive control: one millisecond later the link is still attached at T.
    await insertRemoval(tenant, {
      variantId,
      profileId: detachedAfterT,
      attachedAt: shift(T, -HOUR_MS),
      detachedAt: shift(T, 1),
    });

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    expect(profileIdsOf(result.get(variantId))).toEqual([detachedAfterT]);
  });

  it('a link attached after T is returned but not in force at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const attachedNow = await createProfile(tenant, { amountGross: '100' });
    const attachedAtT = await createProfile(tenant, { amountGross: '200' });
    await link(tenant, variantId, attachedNow); // database stamp: now, after T
    await link(tenant, variantId, attachedAtT, T); // positive control: stamped at T

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    const profiles = result.get(variantId)?.costProfiles ?? [];
    const late = profiles.find((profile) => profile.profileId === attachedNow);
    const onTime = profiles.find((profile) => profile.profileId === attachedAtT);
    expect(late).toBeDefined();
    expect(onTime).toBeDefined();
    if (late === undefined || onTime === undefined) return;
    expect(isCostLinkInForce(late, T)).toBe(false);
    expect(isCostLinkInForce(onTime, T)).toBe(true);
  });

  it('a version effective after T is not the priced one', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const editedNow = await createProfile(tenant, { amountGross: '100' });
    await addVersion(tenant, editedNow, { version: 2, amountGross: '120' }); // stamped now
    // Positive control: a version effective exactly at T prices the link at T.
    const editedAtT = await createProfile(tenant, { amountGross: '50' });
    await addVersion(tenant, editedAtT, { version: 2, amountGross: '60', effectiveFrom: T });
    await link(tenant, variantId, editedNow, shift(T, -HOUR_MS));
    await link(tenant, variantId, editedAtT, shift(T, -HOUR_MS));

    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });

    const profiles = result.get(variantId)?.costProfiles ?? [];
    const now = profiles.find((profile) => profile.profileId === editedNow);
    const atT = profiles.find((profile) => profile.profileId === editedAtT);
    expect(now).toBeDefined();
    expect(atT).toBeDefined();
    if (now === undefined || atT === undefined) return;
    expect(chooseOrderCostVersion(now, { at: T })?.amountGross.toString()).toBe('100');
    expect(chooseOrderCostVersion(atT, { at: T })?.amountGross.toString()).toBe('60');
  });

  it("another organization's variant returns nothing, and its removals are never read", async () => {
    const T = closedDayEnd();
    const own = await createTenant();
    const other = await createTenant();
    const ownVariant = await createVariant(own);
    const ownProfile = await createProfile(own, { amountGross: '100' });
    await link(own, ownVariant, ownProfile, shift(T, -HOUR_MS));
    const otherVariant = await createVariant(other);
    const otherProfile = await createProfile(other, { amountGross: '100' });
    await link(other, otherVariant, otherProfile, shift(T, -HOUR_MS));
    await detach(other, otherVariant, otherProfile); // a removal spanning T, in the other org

    const result = await loadSellerInputsAt(prisma, {
      organizationId: own.organizationId,
      variantIds: [ownVariant, otherVariant],
      at: T,
    });

    // Positive control: the caller's own variant in the same call.
    expect(profileIdsOf(result.get(ownVariant))).toEqual([ownProfile]);
    expect(result.has(otherVariant)).toBe(false);
    expect([...result.keys()]).toEqual([ownVariant]);
  });

  it('empty variantIds returns an empty map', async () => {
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);

    const empty = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [],
      at: closedDayEnd(),
    });
    // Positive control: the same organization with its variant id.
    const one = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: closedDayEnd(),
    });

    expect(empty.size).toBe(0);
    expect([...one.keys()]).toEqual([variantId]);
    expect(one.get(variantId)?.costProfiles).toEqual([]);
  });

  it('an open day equals the live links', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const kept = await createProfile(tenant, { amountGross: '100' });
    const removed = await createProfile(tenant, { amountGross: '200' });
    const attachedToday = await createProfile(tenant, { amountGross: '300' });
    await link(tenant, variantId, kept, shift(T, -HOUR_MS));
    await link(tenant, variantId, removed, shift(T, -HOUR_MS));
    await detach(tenant, variantId, removed); // detached today, before today's end
    await link(tenant, variantId, attachedToday);

    const live = await prisma.productVariantCostProfile.findMany({
      where: { organizationId: tenant.organizationId, productVariantId: variantId },
      select: { profileId: true, attachedAt: true },
    });
    const result = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: openDayEnd(),
    });

    const byProfile = (a: { profileId: string }, b: { profileId: string }): number =>
      a.profileId.localeCompare(b.profileId);
    expect(linksOf(result.get(variantId))?.sort(byProfile)).toEqual(
      live
        .map((row) => ({ profileId: row.profileId, attachedAt: row.attachedAt.toISOString() }))
        .sort(byProfile),
    );
    // Positive control: the live set is the two links still attached.
    expect(live.map((row) => row.profileId).sort()).toEqual([kept, attachedToday].sort());
  });

  it('a detach that commits while the loader waits is still seen at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant);
    const profileId = await createProfile(tenant, { amountGross: '100' });
    await link(tenant, variantId, profileId, shift(T, -HOUR_MS));

    const locked = deferred<void>();
    const release = deferred<void>();
    // Blocker B: locks the live link table, deletes the link (the trigger logs the
    // removal stamped now, after T), then holds both until released.
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE product_variant_cost_profiles IN ACCESS EXCLUSIVE MODE`;
        await tx.$executeRaw`
          DELETE FROM product_variant_cost_profiles
           WHERE organization_id = ${tenant.organizationId}::uuid
             AND product_variant_id = ${variantId}::uuid
             AND profile_id = ${profileId}::uuid`;
        locked.resolve();
        await release.promise;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    let loader: Promise<ReadonlyMap<string, SellerInputsAt>> | undefined;
    try {
      await locked.promise;
      let loaderSettled = false;
      loader = loadSellerInputsAt(prisma, {
        organizationId: tenant.organizationId,
        variantIds: [variantId],
        at: T,
      });
      void loader.then(
        () => {
          loaderSettled = true;
        },
        () => {
          loaderSettled = true;
        },
      );

      if (!(await sawRelationLockWaiter(() => loaderSettled))) {
        throw new Error(
          `the loader never waited on a relation lock (settled=${String(loaderSettled)}): ` +
            'the barrier did not engage',
        );
      }
      expect(loaderSettled).toBe(false);

      release.resolve();
      await blocker;
      const result = await loader;

      expect(profileIdsOf(result.get(variantId))).toEqual([profileId]);
    } finally {
      // Always release and drain both sides, so a failed assertion never leaks the
      // table lock or leaves a pending transaction behind.
      release.resolve();
      await blocker.catch(() => undefined);
      if (loader !== undefined) {
        await loader.catch(() => undefined);
      }
    }
  }, 20_000);
});

describe('loadSellerInputsAt - desi at T', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('override changed after T: the previous value at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '2', synced: '1' });
    await updateDesi(tenant, variantId, 'override', '5');

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: '2', synced: '1' });
  });

  it('override cleared after T: the previous value at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '2', synced: '1' });
    await updateDesi(tenant, variantId, 'override', null);

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: '2', synced: '1' });
  });

  it('override first entered after T: null at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: null, synced: '1' });
    await updateDesi(tenant, variantId, 'override', '3');

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: null, synced: '1' });
  });

  it("two changes after T: the earlier one's old value", async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '2', synced: '1' });
    await updateDesi(tenant, variantId, 'override', '5');
    await updateDesi(tenant, variantId, 'override', '7');

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: '2', synced: '1' });
  });

  it('synced desi changed after T (no override): the previous synced value at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: null, synced: '1' });
    await updateDesi(tenant, variantId, 'synced', '4');

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: null, synced: '1' });
  });

  it('stamp order beats sequence order, per column', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '5', synced: '3' });
    // seq 1: override null -> 5, stamped after T.
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, 1),
      override: { from: null, to: '5' },
      synced: { from: null, to: null },
    });
    // seq 2: synced null -> 3, stamped before T.
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, -100),
      override: { from: '5', to: '5' },
      synced: { from: null, to: '3' },
    });

    // A reconstruction from the lowest-sequence row's old values would answer synced: null.
    expect(await desiAt(tenant, variantId, T)).toEqual({ override: null, synced: '3' });
  });

  it('same column, crossed order', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '7', synced: null });
    // seq 1: 2 -> 5, stamped after T; seq 2: 5 -> 7, stamped before T.
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, 1),
      override: { from: '2', to: '5' },
      synced: { from: null, to: null },
    });
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, -100),
      override: { from: '5', to: '7' },
      synced: { from: null, to: null },
    });

    expect(await desiAt(tenant, variantId, T)).toEqual({ override: '7', synced: null });
  });

  it('among changes stamped before T the physically last one wins, whatever their stamps', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '9', synced: null });
    // Inverted stamps: seq 2 carries an earlier stamp than seq 1 (a transaction that
    // began earlier but wrote later under the variant's row lock).
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, -100),
      override: { from: '2', to: '5' },
      synced: { from: null, to: null },
    });
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, -200),
      override: { from: '5', to: '7' },
      synced: { from: null, to: null },
    });
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, 1),
      override: { from: '7', to: '9' },
      synced: { from: null, to: null },
    });

    // A changed_at DESC, seq DESC pick would answer 5.
    expect(await desiAt(tenant, variantId, T)).toEqual({ override: '7', synced: null });
    // Every row is after T - 250 ms: the old value of the first one.
    expect(await desiAt(tenant, variantId, shift(T, -250))).toEqual({
      override: '2',
      synced: null,
    });
  });

  it('a change stamped exactly at T applies', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const atT = await createVariant(tenant, { override: '5', synced: null });
    await insertDesiChange(tenant, atT, {
      changedAt: T,
      override: { from: '2', to: '5' },
      synced: { from: null, to: null },
    });
    // Positive control: one millisecond later the change does not apply at T.
    const afterT = await createVariant(tenant, { override: '5', synced: null });
    await insertDesiChange(tenant, afterT, {
      changedAt: shift(T, 1),
      override: { from: '2', to: '5' },
      synced: { from: null, to: null },
    });

    expect(await desiAt(tenant, atT, T)).toEqual({ override: '5', synced: null });
    expect(await desiAt(tenant, afterT, T)).toEqual({ override: '2', synced: null });
  });

  it('an open day equals the live row', async () => {
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '2', synced: '1' });
    await updateDesi(tenant, variantId, 'override', '5');
    await updateDesi(tenant, variantId, 'synced', '3');

    const live = await prisma.productVariant.findFirstOrThrow({
      where: { organizationId: tenant.organizationId, id: variantId },
      select: { dimensionalWeightOverride: true, syncedDimensionalWeight: true },
    });
    // Positive control: both updates landed and were logged.
    expect(live.dimensionalWeightOverride?.toString()).toBe('5');
    expect(live.syncedDimensionalWeight?.toString()).toBe('3');
    expect(
      await prisma.variantDesiChange.count({ where: { organizationId: tenant.organizationId } }),
    ).toBe(2);

    expect(await desiAt(tenant, variantId, openDayEnd())).toEqual({ override: '5', synced: '3' });
  });

  it("another organization's variant returns no desi", async () => {
    const own = await createTenant();
    const other = await createTenant();
    const ownVariant = await createVariant(own, { override: '4', synced: '1' });
    const otherVariant = await createVariant(other, { override: '2', synced: '1' });
    await updateDesi(other, otherVariant, 'override', '6');

    const result = await loadSellerInputsAt(prisma, {
      organizationId: own.organizationId,
      variantIds: [ownVariant, otherVariant],
      at: closedDayEnd(),
    });

    // Positive control: the caller's own variant in the same call.
    expect(desiStrings(result.get(ownVariant))).toEqual({ override: '4', synced: '1' });
    expect(result.has(otherVariant)).toBe(false);
  });

  it("the comparison is UTC under SET LOCAL TIME ZONE 'Europe/Istanbul'", async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '5', synced: '1' });
    // A desi change one hour after T (as a UTC wall clock): read in Istanbul time it
    // would land two hours before T and wrongly apply.
    await insertDesiChange(tenant, variantId, {
      changedAt: shift(T, HOUR_MS),
      override: { from: '2', to: '5' },
      synced: { from: '1', to: '1' },
    });
    // A link removed one hour after T: read in Istanbul time it would look detached before T.
    const profileId = await createProfile(tenant, { amountGross: '100' });
    await insertRemoval(tenant, {
      variantId,
      profileId,
      attachedAt: shift(T, -HOUR_MS),
      detachedAt: shift(T, HOUR_MS),
    });

    const inUtc = await loadSellerInputsAt(prisma, {
      organizationId: tenant.organizationId,
      variantIds: [variantId],
      at: T,
    });
    const inIstanbul = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
      // Positive control: the session zone took effect (local wall clock is UTC + 3 h).
      const rows = await tx.$queryRaw<Array<{ offset_hours: number }>>`
        SELECT (extract(epoch FROM (now()::timestamp - timezone('utc', now()))) / 3600)::int
          AS offset_hours`;
      expect(rows[0]?.offset_hours).toBe(3);
      return loadSellerInputsAt(tx, {
        organizationId: tenant.organizationId,
        variantIds: [variantId],
        at: T,
      });
    });

    for (const result of [inUtc, inIstanbul]) {
      expect(desiStrings(result.get(variantId))).toEqual({ override: '2', synced: '1' });
      expect(profileIdsOf(result.get(variantId))).toEqual([profileId]);
    }
  });

  it('a desi change that commits while the loader waits is still seen at T', async () => {
    const T = closedDayEnd();
    const tenant = await createTenant();
    const variantId = await createVariant(tenant, { override: '2', synced: '1' });

    const locked = deferred<void>();
    const release = deferred<void>();
    // Blocker B: locks the variant table and clears the override (the trigger logs the
    // change stamped now, after T), then holds both until released.
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE product_variants IN ACCESS EXCLUSIVE MODE`;
        await tx.$executeRaw`
          UPDATE product_variants SET dimensional_weight_override = NULL
           WHERE organization_id = ${tenant.organizationId}::uuid AND id = ${variantId}::uuid`;
        locked.resolve();
        await release.promise;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );

    let loader: Promise<ReadonlyMap<string, SellerInputsAt>> | undefined;
    try {
      await locked.promise;
      let loaderSettled = false;
      loader = loadSellerInputsAt(prisma, {
        organizationId: tenant.organizationId,
        variantIds: [variantId],
        at: T,
      });
      void loader.then(
        () => {
          loaderSettled = true;
        },
        () => {
          loaderSettled = true;
        },
      );

      // Positive control: the loader really waited on the lock.
      if (!(await sawRelationLockWaiter(() => loaderSettled))) {
        throw new Error(
          `the loader never waited on a relation lock (settled=${String(loaderSettled)}): ` +
            'the barrier did not engage',
        );
      }
      expect(loaderSettled).toBe(false);

      release.resolve();
      await blocker;
      const result = await loader;

      expect(desiStrings(result.get(variantId))).toEqual({ override: '2', synced: '1' });
    } finally {
      release.resolve();
      await blocker.catch(() => undefined);
      if (loader !== undefined) {
        await loader.catch(() => undefined);
      }
    }
  }, 20_000);
});

describe('resolveDesiAtDayEnd', () => {
  const desi = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

  it("the seller's override wins", () => {
    const resolved = resolveDesiAtDayEnd({ override: desi('2'), synced: desi('3') });
    expect(resolved.value?.toString()).toBe('2');
    expect(resolved.source).toBe(SnapshotDesiSource.OVERRIDE);
  });

  it('the synced desi when there is no override', () => {
    const resolved = resolveDesiAtDayEnd({ override: null, synced: desi('3') });
    expect(resolved.value?.toString()).toBe('3');
    expect(resolved.source).toBe(SnapshotDesiSource.SYNCED);
  });

  it('neither column: no value and no source', () => {
    expect(resolveDesiAtDayEnd({ override: null, synced: null })).toEqual({
      value: null,
      source: null,
    });
  });

  it('a desi of 0 is a value', () => {
    const synced = resolveDesiAtDayEnd({ override: null, synced: desi('0') });
    expect(synced.value?.toString()).toBe('0');
    expect(synced.source).toBe(SnapshotDesiSource.SYNCED);
    const override = resolveDesiAtDayEnd({ override: desi('0'), synced: desi('3') });
    expect(override.value?.toString()).toBe('0');
    expect(override.source).toBe(SnapshotDesiSource.OVERRIDE);
  });
});
