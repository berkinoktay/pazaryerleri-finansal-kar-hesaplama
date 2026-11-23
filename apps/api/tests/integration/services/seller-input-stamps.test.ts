/**
 * Seller-input stamps carry the database transaction instant (same-day edit
 * window, plan P1-01, notes B1).
 *
 * `product_variant_cost_profiles.attached_at` and
 * `cost_profile_versions.effective_from` are TIMESTAMP(3) without time zone.
 * Their default is the transaction start instant as a UTC wall clock
 * (`timezone('utc'::text, now())`), written by the database, so every stamp of
 * one writer transaction is the same instant and a writer whose transaction
 * straddles a business-day end can never stamp rows on both sides of it.
 *
 * Every case opens ONE transaction, sleeps first (so a client-side stamp taken
 * when the statement runs can never coincide with the transaction start), reads
 * the transaction instant inside it, and reads the rows back after commit.
 *
 * The instant is read as `timestamp(3)`: the stored columns round to the
 * millisecond, while an uncast value reaches Node with microseconds and is
 * truncated by `new Date`, so an uncast comparison would be flaky.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '@pazarsync/db';
import { getBusinessDayRange } from '@pazarsync/utils';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

const ONE_DAY_MS = 86_400_000;
const ONE_MINUTE_MS = 60_000;
// Europe/Istanbul is UTC+3 all year (no daylight saving since 2016).
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

const here = path.dirname(fileURLToPath(import.meta.url));
// The migration that added orders.seller_inputs_final_at and its hand-written backfill.
const SELLER_INPUT_MIGRATION = path.resolve(
  here,
  '../../../../../packages/db/prisma/migrations/20261123175419_seller_input_history/migration.sql',
);
const BACKFILL_SESSION_ZONES = ['UTC', 'Europe/Istanbul'] as const;

/** The backfill statement exactly as the migration ships it. */
function readBackfillStatement(): string {
  const sql = readFileSync(SELLER_INPUT_MIGRATION, 'utf8');
  const start = sql.indexOf('UPDATE "orders"');
  const end = sql.indexOf(';', start);
  if (start < 0 || end < 0) {
    throw new Error('the backfill UPDATE was not found in the seller_input_history migration');
  }
  return sql.slice(start, end + 1);
}

interface StampFixture {
  readonly organizationId: string;
  readonly variantIds: readonly [string, string];
  readonly profileId: string;
}

async function seedFixture(): Promise<StampFixture> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const product = await createProduct(org.id, store.id);
  const first = await createProductVariant(org.id, store.id, product.id);
  const second = await createProductVariant(org.id, store.id, product.id);
  const profile = await createCostProfile(org.id, { storeId: store.id });
  return { organizationId: org.id, variantIds: [first.id, second.id], profileId: profile.id };
}

/**
 * Sleeps inside the transaction, then returns its start instant as the UTC wall
 * clock rounded to the millisecond (the precision of the stamp columns).
 */
async function pauseThenReadTxNow(tx: Prisma.TransactionClient): Promise<Date> {
  await tx.$executeRaw`SELECT pg_sleep(0.05)`;
  const rows = await tx.$queryRaw<Array<{ tx_now: unknown }>>`
    SELECT timezone('utc', now())::timestamp(3) AS tx_now
  `;
  const txNow = rows[0]?.tx_now;
  if (!(txNow instanceof Date)) {
    throw new Error('could not read the transaction instant');
  }
  return txNow;
}

/** The second cost version of the fixture profile, written like the service writes it. */
function versionData(fixture: StampFixture): Prisma.CostProfileVersionUncheckedCreateInput {
  return {
    profileId: fixture.profileId,
    organizationId: fixture.organizationId,
    version: 2,
    name: 'stamp-probe',
    type: 'COGS',
    amountGross: '70.00',
    vatRate: '20',
    archivedAt: null,
    changedFields: ['amountGross'],
    changedBy: null,
  };
}

async function readLinkStamps(
  fixture: StampFixture,
  variantIds: readonly string[],
): Promise<string[]> {
  const links = await prisma.productVariantCostProfile.findMany({
    where: {
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      productVariantId: { in: [...variantIds] },
    },
    select: { attachedAt: true },
  });
  return links.map((link) => link.attachedAt.toISOString());
}

describe('seller-input stamps use the database transaction instant', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a cost version created by the service write shape carries the transaction instant', async () => {
    const fixture = await seedFixture();

    const { txNow, versionId } = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      const version = await tx.costProfileVersion.create({ data: versionData(fixture) });
      return { txNow: instant, versionId: version.id };
    });

    const stored = await prisma.costProfileVersion.findFirstOrThrow({
      where: { id: versionId, organizationId: fixture.organizationId },
      select: { effectiveFrom: true },
    });
    expect(stored.effectiveFrom.toISOString()).toBe(txNow.toISOString());
  });

  it('links created with createMany carry the transaction instant', async () => {
    const fixture = await seedFixture();

    const txNow = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await tx.productVariantCostProfile.createMany({
        data: fixture.variantIds.map((productVariantId) => ({
          organizationId: fixture.organizationId,
          productVariantId,
          profileId: fixture.profileId,
        })),
        skipDuplicates: true,
      });
      return instant;
    });

    const stamps = await readLinkStamps(fixture, fixture.variantIds);
    expect(stamps).toEqual([txNow.toISOString(), txNow.toISOString()]);
  });

  it('a single link create carries the transaction instant', async () => {
    const fixture = await seedFixture();
    const [variantId] = fixture.variantIds;

    const txNow = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await tx.productVariantCostProfile.create({
        data: {
          organizationId: fixture.organizationId,
          productVariantId: variantId,
          profileId: fixture.profileId,
        },
      });
      return instant;
    });

    expect(await readLinkStamps(fixture, [variantId])).toEqual([txNow.toISOString()]);
  });

  it('one transaction stamps every seller-input row with the same database instant', async () => {
    const fixture = await seedFixture();

    const { txNow, versionId } = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      const version = await tx.costProfileVersion.create({ data: versionData(fixture) });
      await tx.productVariantCostProfile.createMany({
        data: fixture.variantIds.map((productVariantId) => ({
          organizationId: fixture.organizationId,
          productVariantId,
          profileId: fixture.profileId,
        })),
        skipDuplicates: true,
      });
      return { txNow: instant, versionId: version.id };
    });

    const version = await prisma.costProfileVersion.findFirstOrThrow({
      where: { id: versionId, organizationId: fixture.organizationId },
      select: { effectiveFrom: true },
    });
    const linkStamps = await readLinkStamps(fixture, fixture.variantIds);

    expect(version.effectiveFrom.toISOString()).toBe(txNow.toISOString());
    expect(linkStamps).toEqual([txNow.toISOString(), txNow.toISOString()]);
  });

  it('an explicit stamp still wins', async () => {
    const fixture = await seedFixture();
    const [backdatedVariantId, defaultVariantId] = fixture.variantIds;
    const explicit = new Date(Date.now() - ONE_DAY_MS);

    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: fixture.organizationId,
        productVariantId: backdatedVariantId,
        profileId: fixture.profileId,
        attachedAt: explicit,
      },
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: fixture.organizationId,
        productVariantId: defaultVariantId,
        profileId: fixture.profileId,
      },
    });

    expect(await readLinkStamps(fixture, [backdatedVariantId])).toEqual([explicit.toISOString()]);
    // Positive control: a link written without a stamp does not carry the explicit value.
    const [defaultStamp] = await readLinkStamps(fixture, [defaultVariantId]);
    expect(defaultStamp).toBeDefined();
    expect(defaultStamp).not.toBe(explicit.toISOString());
  });

  it('stamps are UTC whatever the session time zone', async () => {
    const fixture = await seedFixture();
    const [variantId] = fixture.variantIds;

    const { txNow, localNow } = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
      const rows = await tx.$queryRaw<Array<{ local_now: unknown }>>`
        SELECT now()::timestamp(3) AS local_now
      `;
      const local = rows[0]?.local_now;
      if (!(local instanceof Date)) {
        throw new Error('could not read the session-local transaction instant');
      }
      await tx.productVariantCostProfile.create({
        data: {
          organizationId: fixture.organizationId,
          productVariantId: variantId,
          profileId: fixture.profileId,
        },
      });
      return { txNow: instant, localNow: local };
    });

    // Positive control: the session really ran on Istanbul time.
    expect(localNow.getTime() - txNow.getTime()).toBe(ISTANBUL_OFFSET_MS);
    expect(await readLinkStamps(fixture, [variantId])).toEqual([txNow.toISOString()]);
  });
});

// The integration database is built by `prisma db push`, so the migration's
// backfill never runs on data there. This runs the shipped statement verbatim
// in this worker's clone, around the Istanbul start of the day of the
// transaction's own clock, in a UTC and an Istanbul session.
describe('the seller_input_history backfill', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it.each(BACKFILL_SESSION_ZONES)(
    'makes exactly the orders dated before the Istanbul day start final (%s session)',
    async (zone) => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const backfill = readBackfillStatement();

      const { txNow, ids } = await prisma.$transaction(async (tx) => {
        const instant = await pauseThenReadTxNow(tx);
        // The orders are dated from the transaction's clock (not Node's), so
        // the day start the statement computes from now() is the same one.
        const dayStart = getBusinessDayRange(instant).start.getTime();
        const dated = async (offsetMs: number): Promise<string> => {
          const order = await tx.order.create({
            data: {
              organizationId: org.id,
              storeId: store.id,
              platformOrderId: `backfill-${String(offsetMs)}`,
              orderDate: new Date(dayStart + offsetMs),
              status: 'DELIVERED',
            },
          });
          return order.id;
        };
        const before = await dated(-ONE_MINUTE_MS);
        const atStart = await dated(0);
        const after = await dated(ONE_MINUTE_MS);
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        await tx.$executeRawUnsafe(backfill);
        return { txNow: instant, ids: { before, atStart, after } };
      });

      const markerOf = async (id: string): Promise<string | null> => {
        const order = await prisma.order.findFirstOrThrow({
          where: { id, organizationId: org.id },
          select: { sellerInputsFinalAt: true },
        });
        return order.sellerInputsFinalAt?.toISOString() ?? null;
      };
      // Positive control: the order a minute before the day start is marked,
      // with the transaction instant as a UTC wall clock.
      expect(await markerOf(ids.before)).toBe(txNow.toISOString());
      expect(await markerOf(ids.atStart)).toBeNull();
      expect(await markerOf(ids.after)).toBeNull();
    },
  );
});
