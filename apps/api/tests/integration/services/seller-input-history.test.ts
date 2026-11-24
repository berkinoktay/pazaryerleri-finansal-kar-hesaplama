/**
 * Seller-input history triggers (same-day edit window, plan P1-02).
 *
 * trg_log_cost_link_removal writes one cost_link_removals row per DIRECT delete
 * of a cost link (a cascade from a deleted variant, profile, store or
 * organization is not logged). trg_log_variant_desi_change writes one
 * variant_desi_changes row per real change of either desi column. Both stamp
 * the transaction start instant as a UTC wall clock, the same expression as the
 * attached_at / effective_from defaults, so a replace in one transaction has
 * one instant.
 *
 * Writes go through raw SQL so no service is involved. Every comparison with
 * the transaction instant reads it as `timestamp(3)` inside that transaction
 * (the stored stamps round to the millisecond; an uncast read is truncated by
 * `new Date` and would be flaky). Serial values are only compared with each
 * other, never with an absolute number (see truncateAll in tests/helpers/db.ts).
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '@pazarsync/db';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

const ONE_DAY_MS = 86_400_000;

interface HistoryFixture {
  readonly organizationId: string;
  readonly storeId: string;
  readonly variantId: string;
  readonly profileA: string;
  readonly profileB: string;
}

async function seedFixture(): Promise<HistoryFixture> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const product = await createProduct(org.id, store.id);
  const variant = await createProductVariant(org.id, store.id, product.id);
  const profileA = await createCostProfile(org.id, { storeId: store.id });
  const profileB = await createCostProfile(org.id, { storeId: store.id });
  return {
    organizationId: org.id,
    storeId: store.id,
    variantId: variant.id,
    profileA: profileA.id,
    profileB: profileB.id,
  };
}

/** A link with an explicit, backdated attached_at (factories may backdate). */
async function attach(fixture: HistoryFixture, profileId: string, attachedAt: Date): Promise<void> {
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: fixture.organizationId,
      productVariantId: fixture.variantId,
      profileId,
      attachedAt,
    },
  });
}

async function deleteLink(
  db: Prisma.TransactionClient,
  fixture: HistoryFixture,
  profileId: string,
): Promise<void> {
  await db.$executeRaw`
    DELETE FROM product_variant_cost_profiles
     WHERE organization_id = ${fixture.organizationId}::uuid
       AND product_variant_id = ${fixture.variantId}::uuid
       AND profile_id = ${profileId}::uuid
  `;
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

async function setOverride(fixture: HistoryFixture, value: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE product_variants
       SET dimensional_weight_override = ${value}::numeric
     WHERE organization_id = ${fixture.organizationId}::uuid
       AND id = ${fixture.variantId}::uuid
  `;
}

async function setSynced(fixture: HistoryFixture, value: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE product_variants
       SET synced_dimensional_weight = ${value}::numeric
     WHERE organization_id = ${fixture.organizationId}::uuid
       AND id = ${fixture.variantId}::uuid
  `;
}

async function removals(organizationId: string) {
  return prisma.costLinkRemoval.findMany({
    where: { organizationId },
    orderBy: { id: 'asc' },
  });
}

async function desiChanges(fixture: HistoryFixture) {
  return prisma.variantDesiChange.findMany({
    where: { organizationId: fixture.organizationId, productVariantId: fixture.variantId },
    orderBy: { seq: 'asc' },
  });
}

/** Decimal-or-null as a fixed two-decimal string (desi precision), for readable diffs. */
function desi(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

describe('seller-input history triggers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("deleting a link writes one removal row with the link's attached_at", async () => {
    const fixture = await seedFixture();
    const attachedAt = new Date(Date.now() - ONE_DAY_MS);
    await attach(fixture, fixture.profileA, attachedAt);

    const txNow = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await deleteLink(tx, fixture, fixture.profileA);
      return instant;
    });

    const rows = await removals(fixture.organizationId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.productVariantId).toBe(fixture.variantId);
    expect(row?.profileId).toBe(fixture.profileA);
    expect(row?.attachedAt.toISOString()).toBe(attachedAt.toISOString());
    expect(row?.detachedAt.toISOString()).toBe(txNow.toISOString());
  });

  it('replace in one transaction: removal detached_at equals the new link attached_at', async () => {
    const fixture = await seedFixture();
    await attach(fixture, fixture.profileA, new Date(Date.now() - ONE_DAY_MS));

    const { txNow, versionId } = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await deleteLink(tx, fixture, fixture.profileA);
      await tx.productVariantCostProfile.createMany({
        data: [
          {
            organizationId: fixture.organizationId,
            productVariantId: fixture.variantId,
            profileId: fixture.profileB,
          },
        ],
        skipDuplicates: true,
      });
      const version = await tx.costProfileVersion.create({
        data: {
          profileId: fixture.profileB,
          organizationId: fixture.organizationId,
          version: 2,
          name: 'replace-probe',
          type: 'COGS',
          amountGross: '75.00',
          vatRate: '20',
          archivedAt: null,
          changedFields: ['amountGross'],
          changedBy: null,
        },
      });
      return { txNow: instant, versionId: version.id };
    });

    const rows = await removals(fixture.organizationId);
    expect(rows).toHaveLength(1);
    const linkB = await prisma.productVariantCostProfile.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        productVariantId: fixture.variantId,
        profileId: fixture.profileB,
      },
      select: { attachedAt: true },
    });
    const version = await prisma.costProfileVersion.findFirstOrThrow({
      where: { id: versionId, organizationId: fixture.organizationId },
      select: { effectiveFrom: true },
    });
    const instant = txNow.toISOString();
    expect(rows[0]?.detachedAt.toISOString()).toBe(instant);
    expect(linkB.attachedAt.toISOString()).toBe(instant);
    expect(version.effectiveFrom.toISOString()).toBe(instant);
  });

  it('changing the override writes one change row with old and new of both columns', async () => {
    const fixture = await seedFixture();

    const txNow = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await tx.$executeRaw`
        UPDATE product_variants
           SET dimensional_weight_override = 2.50
         WHERE organization_id = ${fixture.organizationId}::uuid
           AND id = ${fixture.variantId}::uuid
      `;
      return instant;
    });

    const rows = await desiChanges(fixture);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.storeId).toBe(fixture.storeId);
    expect(row?.overrideChanged).toBe(true);
    expect(row?.syncedChanged).toBe(false);
    expect(desi(row?.oldOverride ?? null)).toBeNull();
    expect(desi(row?.newOverride ?? null)).toBe('2.50');
    // createProductVariant leaves the synced column at its default 0; it is unchanged.
    expect(desi(row?.oldSynced ?? null)).toBe('0.00');
    expect(desi(row?.newSynced ?? null)).toBe('0.00');
    expect(row?.changedAt.toISOString()).toBe(txNow.toISOString());
  });

  it('changing the synced desi writes one change row', async () => {
    const fixture = await seedFixture();

    await setSynced(fixture, '3.00');

    const rows = await desiChanges(fixture);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.syncedChanged).toBe(true);
    expect(row?.overrideChanged).toBe(false);
    // createProductVariant leaves the synced column at its default 0.
    expect(desi(row?.oldSynced ?? null)).toBe('0.00');
    expect(desi(row?.newSynced ?? null)).toBe('3.00');
    expect(desi(row?.oldOverride ?? null)).toBeNull();
    expect(desi(row?.newOverride ?? null)).toBeNull();
  });

  it('clearing a value writes a row with new = null', async () => {
    const fixture = await seedFixture();
    await setOverride(fixture, '2.50');

    await setOverride(fixture, null);

    const rows = await desiChanges(fixture);
    expect(rows).toHaveLength(2);
    const cleared = rows[1];
    expect(cleared?.overrideChanged).toBe(true);
    expect(cleared?.syncedChanged).toBe(false);
    expect(desi(cleared?.oldOverride ?? null)).toBe('2.50');
    expect(desi(cleared?.newOverride ?? null)).toBeNull();
  });

  it('two changes of one variant get ascending seq', async () => {
    const fixture = await seedFixture();

    await setOverride(fixture, '1.00');
    await setOverride(fixture, '2.00');

    const rows = await desiChanges(fixture);
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(desi(first?.newOverride ?? null)).toBe('1.00');
    expect(desi(second?.newOverride ?? null)).toBe('2.00');
    expect((second?.seq ?? 0n) > (first?.seq ?? 0n)).toBe(true);
  });

  it('an update that sets the same values writes nothing', async () => {
    const fixture = await seedFixture();

    // Both columns are named in the SET list, both keep their value (override
    // NULL, synced 0).
    await prisma.$executeRaw`
      UPDATE product_variants
         SET dimensional_weight_override = NULL,
             synced_dimensional_weight = 0
       WHERE organization_id = ${fixture.organizationId}::uuid
         AND id = ${fixture.variantId}::uuid
    `;
    expect(await desiChanges(fixture)).toHaveLength(0);

    // Positive control: a real change in the same test is logged.
    await setOverride(fixture, '1.50');
    expect(await desiChanges(fixture)).toHaveLength(1);
  });

  it('an update of another column (sale_price) writes nothing', async () => {
    const fixture = await seedFixture();

    await prisma.$executeRaw`
      UPDATE product_variants
         SET sale_price = 150.00
       WHERE organization_id = ${fixture.organizationId}::uuid
         AND id = ${fixture.variantId}::uuid
    `;
    expect(await desiChanges(fixture)).toHaveLength(0);

    // Positive control: a real desi change in the same test is logged.
    await setSynced(fixture, '2.00');
    expect(await desiChanges(fixture)).toHaveLength(1);
  });

  it("stamps are UTC under SET LOCAL TIME ZONE 'Europe/Istanbul'", async () => {
    const fixture = await seedFixture();
    await attach(fixture, fixture.profileA, new Date(Date.now() - ONE_DAY_MS));

    const txNow = await prisma.$transaction(async (tx) => {
      const instant = await pauseThenReadTxNow(tx);
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
      await deleteLink(tx, fixture, fixture.profileA);
      await tx.$executeRaw`
        UPDATE product_variants
           SET dimensional_weight_override = 5.00
         WHERE organization_id = ${fixture.organizationId}::uuid
           AND id = ${fixture.variantId}::uuid
      `;
      return instant;
    });

    const removalRows = await removals(fixture.organizationId);
    const changeRows = await desiChanges(fixture);
    expect(removalRows).toHaveLength(1);
    expect(changeRows).toHaveLength(1);
    expect(removalRows[0]?.detachedAt.toISOString()).toBe(txNow.toISOString());
    expect(changeRows[0]?.changedAt.toISOString()).toBe(txNow.toISOString());
  });

  describe('a cascaded link delete is not logged', () => {
    /**
     * Two links on the fixture variant; the link to profile A is deleted
     * directly (logged, the positive control), the link to profile B stays for
     * the parent delete to cascade.
     */
    async function seedWithOneDirectRemoval(): Promise<HistoryFixture> {
      const fixture = await seedFixture();
      const earlier = new Date(Date.now() - ONE_DAY_MS);
      await attach(fixture, fixture.profileA, earlier);
      await attach(fixture, fixture.profileB, earlier);
      await deleteLink(prisma, fixture, fixture.profileA);
      const rows = await removals(fixture.organizationId);
      expect(rows.map((row) => row.profileId)).toEqual([fixture.profileA]);
      return fixture;
    }

    async function remainingLinks(fixture: HistoryFixture): Promise<number> {
      return prisma.productVariantCostProfile.count({
        where: { organizationId: fixture.organizationId, profileId: fixture.profileB },
      });
    }

    it('deleting the variant', async () => {
      const fixture = await seedWithOneDirectRemoval();

      await prisma.$executeRaw`
        DELETE FROM product_variants
         WHERE organization_id = ${fixture.organizationId}::uuid
           AND id = ${fixture.variantId}::uuid
      `;

      expect(await remainingLinks(fixture)).toBe(0);
      const rows = await removals(fixture.organizationId);
      expect(rows.map((row) => row.profileId)).toEqual([fixture.profileA]);
    });

    it('deleting the cost profile', async () => {
      const fixture = await seedWithOneDirectRemoval();

      await prisma.$executeRaw`
        DELETE FROM cost_profiles
         WHERE organization_id = ${fixture.organizationId}::uuid
           AND id = ${fixture.profileB}::uuid
      `;

      expect(await remainingLinks(fixture)).toBe(0);
      const rows = await removals(fixture.organizationId);
      expect(rows.map((row) => row.profileId)).toEqual([fixture.profileA]);
    });

    it('deleting the store', async () => {
      const fixture = await seedWithOneDirectRemoval();

      await prisma.$executeRaw`
        DELETE FROM stores
         WHERE organization_id = ${fixture.organizationId}::uuid
           AND id = ${fixture.storeId}::uuid
      `;

      expect(await remainingLinks(fixture)).toBe(0);
      const rows = await removals(fixture.organizationId);
      expect(rows.map((row) => row.profileId)).toEqual([fixture.profileA]);
    });

    it('deleting the organization', async () => {
      const fixture = await seedWithOneDirectRemoval();

      await prisma.$executeRaw`
        DELETE FROM organizations WHERE id = ${fixture.organizationId}::uuid
      `;

      expect(await remainingLinks(fixture)).toBe(0);
      // The direct removal row goes with its organization.
      expect(await removals(fixture.organizationId)).toHaveLength(0);
    });
  });
});
