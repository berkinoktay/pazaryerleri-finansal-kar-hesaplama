// Pins the real shape of a foreign-key violation (P2003) as Prisma 7 with the pg
// driver adapter reports it, against the actual foreign key of
// `advantage_tariffs.commission_source_tariff_id`. The Advantage import checks the
// commission source before its transaction; a delete in between fails the insert in
// `persist`, and `isForeignKeyViolationOn` turns that failure into the same
// INVALID_COMMISSION_SOURCE field error the pre-check gives. The helper must be proven
// against what the database really emits rather than against a hand-built fake.
//
// Every insert runs inside an interactive transaction because that is where the import
// hits it: `persist` runs inside the import's `$transaction`.

import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { InvalidReferenceError, ValidationError } from '@/lib/errors';
import { isForeignKeyViolationOn } from '@/lib/map-transaction-error';
import type { ParentFields } from '@/workbooks/adapter';
import { trendyolAdvantageTariffFormat } from '@/workbooks/formats/trendyol/advantage-tariff.format';
import { advantageTariffAdapter } from '@/workbooks/verticals/advantage-tariff.adapter';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

// The same two names as COMMISSION_SOURCE_FOREIGN_KEY in
// src/workbooks/verticals/advantage-tariff.adapter.ts.
const COMMISSION_SOURCE_FOREIGN_KEY = {
  constraint: 'advantage_tariffs_commission_source_tariff_id_fkey',
  column: 'commission_source_tariff_id',
} as const;

describe('isForeignKeyViolationOn against a real commission source foreign key violation', () => {
  let orgId: string;
  let storeId: string;

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    const org = await createOrganization();
    const store = await createStore(org.id, { name: 'Commission Source Store' });
    orgId = org.id;
    storeId = store.id;
  });

  async function captureInsertError(data: {
    storeId: string;
    commissionSourceTariffId: string | null;
  }): Promise<unknown> {
    try {
      await prisma.$transaction((tx) =>
        tx.advantageTariff.create({
          data: { organizationId: orgId, name: 'FK probe', ...data },
        }),
      );
    } catch (err) {
      return err;
    }
    throw new Error('expected the insert to violate a foreign key');
  }

  function parentFields(): ParentFields {
    return {
      organizationId: orgId,
      storeId,
      name: 'FK list',
      sourceFilename: null,
      sourceFile: new Uint8Array([1, 2, 3]),
      sourceFormatId: trendyolAdvantageTariffFormat.id,
      createdBy: null,
    };
  }

  function persistWith(commissionSourceTariffId: string | null): Promise<{
    parentId: string;
    itemCount: number;
  }> {
    return prisma.$transaction((tx) =>
      advantageTariffAdapter.persist(tx, {
        parent: parentFields(),
        rows: [],
        variantIdByAnchor: new Map(),
        config: { commissionSourceTariffId },
        meta: undefined,
      }),
    );
  }

  it('recognises the commission source key in the violation', async () => {
    const err = await captureInsertError({ storeId, commissionSourceTariffId: randomUUID() });
    expect(isForeignKeyViolationOn(err, COMMISSION_SOURCE_FOREIGN_KEY)).toBe(true);
  });

  it('does not match a violation of another foreign key, which keeps its generic mapping', async () => {
    const err = await captureInsertError({
      storeId: randomUUID(),
      commissionSourceTariffId: null,
    });
    expect(isForeignKeyViolationOn(err, COMMISSION_SOURCE_FOREIGN_KEY)).toBe(false);
    expect(() => mapPrismaError(err)).toThrow(InvalidReferenceError);
  });

  it('persist answers a vanished commission source with the INVALID_COMMISSION_SOURCE field error', async () => {
    let caught: unknown;
    try {
      await persistWith(randomUUID());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    if (!(caught instanceof ValidationError)) return;
    expect(caught.issues).toEqual([
      { field: 'commissionSourceTariffId', code: 'INVALID_COMMISSION_SOURCE' },
    ]);
    expect(await prisma.advantageTariff.count({ where: { storeId } })).toBe(0);
  });

  it('persist stores the tariff when no commission source is named', async () => {
    const outcome = await persistWith(null);
    expect(outcome.itemCount).toBe(0);
    const stored = await prisma.advantageTariff.findFirst({
      where: { id: outcome.parentId, organizationId: orgId, storeId },
      select: { commissionSourceTariffId: true },
    });
    expect(stored).toEqual({ commissionSourceTariffId: null });
  });
});
