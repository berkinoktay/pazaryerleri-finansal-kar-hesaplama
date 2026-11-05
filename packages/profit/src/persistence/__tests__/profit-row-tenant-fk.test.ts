/**
 * Table-level constraint tests for the composite tenant foreign keys added in
 * Phase 4C, Gorev 2. profit_lines and order_profit_statements bind
 * (order_id, organization_id, store_id) to the order's own triple, so Postgres
 * rejects a profit row whose tenant differs from its order's -- defense in depth
 * for the absolute tenant-isolation invariant, below the app org/store filters
 * and RLS. A valid row (matching the order's tenant) still inserts.
 *
 * Runs against the isolated test DB (vitest.config.ts remaps DATABASE_URL).
 * Requires `supabase start` + a schema-synced test DB before running.
 */

import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@pazarsync/db';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import { ensureDbReachable, seedMelontikParcel, truncateAll } from './helpers/melontik-parcel';

/** Asserts the operation rejects with a Prisma foreign-key violation (P2003). */
async function expectForeignKeyViolation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      expect(error.code).toBe('P2003');
      return;
    }
    throw error;
  }
  throw new Error('expected a foreign key violation, but the insert succeeded');
}

describe('profit row composite tenant foreign keys', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("rejects a profit line whose organization differs from its order's", async () => {
    const parcel = await seedMelontikParcel();

    await expectForeignKeyViolation(
      prisma.profitLine.create({
        data: {
          // A different organization than the order's, same store -- no orders row
          // carries this (id, organization_id, store_id) triple, so the composite FK fails.
          organizationId: randomUUID(),
          storeId: parcel.storeId,
          orderId: parcel.orderId,
          type: ProfitLineType.SHIPPING,
          level: ProfitLineLevel.PARCEL,
          certainty: ProfitLineCertainty.ESTIMATE,
          source: ProfitLineSource.RULE,
          amountGross: '0',
          amountVat: '0',
          inputs: {},
          engineVersion: PROFIT_ENGINE_VERSION,
        },
      }),
    );

    // No orphan line landed under the order.
    expect(await prisma.profitLine.count({ where: { orderId: parcel.orderId } })).toBe(0);
  });

  it("rejects a statement whose store differs from its order's", async () => {
    const parcel = await seedMelontikParcel();

    await expectForeignKeyViolation(
      prisma.orderProfitStatement.create({
        data: {
          organizationId: parcel.organizationId,
          // A different store than the order's, same organization -- again no matching triple.
          storeId: randomUUID(),
          orderId: parcel.orderId,
          view: ProfitStatementView.BEST_KNOWN,
          status: ProfitStatus.ESTIMATED,
          reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
          saleGross: '0',
          costGross: '0',
          vatOutput: '0',
          vatInput: '0',
          vatNet: '0',
          vatEffective: '0',
          stoppageGross: '0',
          stoppageIncluded: false,
          netProfit: null,
          issues: [],
          settingsSnapshot: {},
          engineVersion: PROFIT_ENGINE_VERSION,
          contentHash: 'test',
          computedAt: new Date(),
        },
      }),
    );

    expect(await prisma.orderProfitStatement.count({ where: { orderId: parcel.orderId } })).toBe(0);
  });

  it("accepts a profit line and statement that carry the order's own tenant", async () => {
    const parcel = await seedMelontikParcel();

    const line = await prisma.profitLine.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderId: parcel.orderId,
        type: ProfitLineType.SHIPPING,
        level: ProfitLineLevel.PARCEL,
        certainty: ProfitLineCertainty.ESTIMATE,
        source: ProfitLineSource.RULE,
        amountGross: '0',
        amountVat: '0',
        inputs: {},
        engineVersion: PROFIT_ENGINE_VERSION,
      },
    });
    const statement = await prisma.orderProfitStatement.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        orderId: parcel.orderId,
        view: ProfitStatementView.BEST_KNOWN,
        status: ProfitStatus.ESTIMATED,
        reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
        saleGross: '0',
        costGross: '0',
        vatOutput: '0',
        vatInput: '0',
        vatNet: '0',
        vatEffective: '0',
        stoppageGross: '0',
        stoppageIncluded: false,
        netProfit: null,
        issues: [],
        settingsSnapshot: {},
        engineVersion: PROFIT_ENGINE_VERSION,
        contentHash: 'test',
        computedAt: new Date(),
      },
    });

    expect(line.orderId).toBe(parcel.orderId);
    expect(statement.orderId).toBe(parcel.orderId);
  });
});
