// Pins the real shape of a unique-constraint violation (P2002) as Prisma 7 with the
// pg driver adapter reports it, against the actual `@@unique([storeId, weekStartsAt])`
// on `commission_tariffs`. The import services rely on `isUniqueViolationOn` to turn a
// concurrent duplicate-week upload into DUPLICATE_TARIFF_WEEK instead of a 409 that
// leaks column names, so the helper must be proven against what the database really
// emits rather than against a hand-built fake.
//
// The duplicate insert runs inside an interactive transaction because that is where
// the import services hit it: the week pre-check passes for two concurrent uploads and
// the second `tx.commissionTariff.create` inside `$transaction` is the one that fails.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { isUniqueViolationOn } from '../../../src/lib/map-transaction-error';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isUniqueViolationOn against a real tariff-week unique violation', () => {
  let orgId: string;
  let storeId: string;

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    const org = await createOrganization();
    const store = await createStore(org.id, { name: 'Tariff Week Store' });
    orgId = org.id;
    storeId = store.id;
  });

  async function captureDuplicateWeekError(): Promise<unknown> {
    const weekStartsAt = new Date(Date.now() + 7 * DAY_MS);
    await prisma.commissionTariff.create({
      data: { organizationId: orgId, storeId, name: 'First', weekStartsAt },
    });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.commissionTariff.create({
          data: { organizationId: orgId, storeId, name: 'Second', weekStartsAt },
        });
      });
    } catch (err) {
      return err;
    }
    throw new Error('expected the second insert to violate the unique constraint');
  }

  it('recognises the week_starts_at column in the violation', async () => {
    const err = await captureDuplicateWeekError();
    expect(isUniqueViolationOn(err, 'week_starts_at')).toBe(true);
  });

  it('does not match a column outside the violated constraint', async () => {
    const err = await captureDuplicateWeekError();
    expect(isUniqueViolationOn(err, 'name')).toBe(false);
  });
});
