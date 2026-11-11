// Data-cleanup migration test (Phase 4C fix A).
//
// Trendyol stamps shipmentPackageId 0 on a package it has not created yet, so
// intake keyed every such Awaiting order onto platform_order_id '0' and the
// distinct order numbers collided onto one row. Intake now skips these packages;
// this migration removes the rows written before the fix. The test seeds the
// collision shape (a Trendyol order '0' with a profit statement, a buffer row
// '0', and a normal Trendyol order), runs the migration SQL, and asserts only
// the '0' Trendyol rows (and their cascaded profit statement) are gone while the
// normal order survives. A non-Trendyol store's '0' row must be left untouched.
//
// Runs against the isolated test DB (vitest.config.ts remaps DATABASE_URL and
// wires no globalSetup for this package). The migration SQL is read from the
// migration folder so the test pins the shipped SQL, not a copy.

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/index';
import { ProfitStatementView, ProfitStatus } from '../src/enums';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../prisma/migrations');
const MIGRATION_SUFFIX = '_drop_trendyol_orders_without_package_id';

function loadMigrationSql(): string {
  const folder = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith(MIGRATION_SUFFIX));
  if (folder === undefined) {
    throw new Error(
      `Could not find a migration folder ending with "${MIGRATION_SUFFIX}" in ${MIGRATIONS_DIR}.`,
    );
  }
  return readFileSync(resolve(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf-8');
}

interface SeededStore {
  orgId: string;
  storeId: string;
}

async function seedStore(platform: 'TRENDYOL' | 'HEPSIBURADA'): Promise<SeededStore> {
  const org = await prisma.organization.create({
    data: { name: `Mig Org ${randomUUID().slice(0, 8)}`, slug: `mig-${randomUUID().slice(0, 8)}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: `Mig Store ${platform}`,
      platform,
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      credentials: 'test-blob',
    },
  });
  return { orgId: org.id, storeId: store.id };
}

async function seedOrder(
  store: SeededStore,
  platformOrderId: string,
  status: 'PENDING' | 'DELIVERED' = 'PENDING',
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: store.orgId,
      storeId: store.storeId,
      platformOrderId,
      orderDate: new Date(),
      status,
    },
  });
  return order.id;
}

async function seedProfitStatement(store: SeededStore, orderId: string): Promise<string> {
  const stmt = await prisma.orderProfitStatement.create({
    data: {
      organizationId: store.orgId,
      storeId: store.storeId,
      orderId,
      view: ProfitStatementView.BEST_KNOWN,
      status: ProfitStatus.EXCLUDED,
      saleGross: '100.00',
      costGross: '0.00',
      vatOutput: '0.00',
      vatInput: '0.00',
      vatNet: '0.00',
      vatEffective: '0.00',
      stoppageGross: '0.00',
      stoppageIncluded: false,
      issues: [],
      settingsSnapshot: {},
      engineVersion: 1,
      contentHash: `hash-${randomUUID().slice(0, 8)}`,
      computedAt: new Date(),
    },
  });
  return stmt.id;
}

async function seedBuffer(store: SeededStore, platformOrderId: string): Promise<string> {
  const row = await prisma.livePerformanceBuffer.create({
    data: {
      organizationId: store.orgId,
      storeId: store.storeId,
      orderDate: new Date(),
      platformOrderId,
      platformOrderNumber: `ord-${randomUUID().slice(0, 8)}`,
      rawPayload: { test: true },
      mappedOrder: { lines: [] },
      status: 'PENDING',
    },
  });
  return row.id;
}

describe('migration: drop Trendyol orders without a package id', () => {
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    // Org delete cascades to its stores/orders/buffer/statements — keeps the
    // shared test DB clean for the next package run.
    for (const orgId of createdOrgIds) {
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });

  it("deletes a Trendyol order '0' + its profit statement + its buffer row, keeps the normal order", async () => {
    const trendyol = await seedStore('TRENDYOL');
    createdOrgIds.push(trendyol.orgId);

    const zeroOrderId = await seedOrder(trendyol, '0');
    const statementId = await seedProfitStatement(trendyol, zeroOrderId);
    const zeroBufferId = await seedBuffer(trendyol, '0');

    const normalOrderId = await seedOrder(
      trendyol,
      `real-${randomUUID().slice(0, 8)}`,
      'DELIVERED',
    );

    await prisma.$executeRawUnsafe(loadMigrationSql());

    // The '0' order and everything cascading from it are gone.
    expect(await prisma.order.findUnique({ where: { id: zeroOrderId } })).toBeNull();
    expect(await prisma.orderProfitStatement.findUnique({ where: { id: statementId } })).toBeNull();
    expect(
      await prisma.livePerformanceBuffer.findUnique({ where: { id: zeroBufferId } }),
    ).toBeNull();

    // The normal order with a real package id is untouched.
    const normal = await prisma.order.findUnique({ where: { id: normalOrderId } });
    expect(normal).not.toBeNull();
    expect(normal?.platformOrderId).not.toBe('0');
  });

  it("leaves a non-Trendyol store's '0' order and buffer row untouched", async () => {
    const hb = await seedStore('HEPSIBURADA');
    createdOrgIds.push(hb.orgId);

    const hbOrderId = await seedOrder(hb, '0');
    const hbBufferId = await seedBuffer(hb, '0');

    await prisma.$executeRawUnsafe(loadMigrationSql());

    // The migration scopes its delete to TRENDYOL, so the Hepsiburada rows stay.
    expect(await prisma.order.findUnique({ where: { id: hbOrderId } })).not.toBeNull();
    expect(
      await prisma.livePerformanceBuffer.findUnique({ where: { id: hbBufferId } }),
    ).not.toBeNull();
  });
});
