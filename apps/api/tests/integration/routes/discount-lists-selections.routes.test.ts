// Integration tests for PATCH .../discount-lists/{listId}/selections.
//
// Selections toggle the `included` flag. Three modes: 'set' updates the given rows in one
// bulk statement scoped to the list (a foreign itemId is silently skipped), 'all' / 'none'
// flip the WHOLE list in a single updateMany. An empty 'set' payload is a 422.

import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

interface Seeded {
  accessToken: string;
  orgId: string;
  storeId: string;
  listId: string;
  item1: string;
  item2: string;
  item3: string;
}

async function seedListWithItems(): Promise<Seeded> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const list = await prisma.discountList.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'İndirim Seçim Testi',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
    },
  });
  const baseItem = {
    organizationId: org.id,
    storeId: store.id,
    listId: list.id,
    productTitle: 'Ürün',
    currentPrice: '100.00',
    included: false,
  };
  const item1 = await prisma.discountListItem.create({
    data: { ...baseItem, barcode: 'BC-1', sortOrder: 0 },
  });
  const item2 = await prisma.discountListItem.create({
    data: { ...baseItem, barcode: 'BC-2', sortOrder: 1 },
  });
  const item3 = await prisma.discountListItem.create({
    data: { ...baseItem, barcode: 'BC-3', sortOrder: 2 },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    listId: list.id,
    item1: item1.id,
    item2: item2.id,
    item3: item3.id,
  };
}

async function patchSelections(s: Seeded, body: unknown): Promise<Response> {
  return app.request(
    `/v1/organizations/${s.orgId}/stores/${s.storeId}/discount-lists/${s.listId}/selections`,
    {
      method: 'PATCH',
      headers: { Authorization: bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function includedById(listId: string): Promise<Map<string, boolean>> {
  const rows = await prisma.discountListItem.findMany({
    where: { listId },
    select: { id: true, included: true },
  });
  return new Map(rows.map((r) => [r.id, r.included]));
}

describe('PATCH .../discount-lists/{listId}/selections', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it("mode 'set' updates the given rows (updated: 2) and persists included", async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      mode: 'set',
      selections: [
        { itemId: s.item1, included: true },
        { itemId: s.item2, included: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);

    const included = await includedById(s.listId);
    expect(included.get(s.item1)).toBe(true);
    expect(included.get(s.item2)).toBe(true);
    expect(included.get(s.item3)).toBe(false);
  });

  it("mode 'set' silently skips an itemId from another list (updated: 1)", async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, {
      mode: 'set',
      selections: [
        { itemId: s.item1, included: true },
        { itemId: crypto.randomUUID(), included: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);

    const included = await includedById(s.listId);
    expect(included.get(s.item1)).toBe(true);
    expect(included.get(s.item2)).toBe(false);
  });

  it("mode 'all' includes every item", async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, { mode: 'all' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(3);

    const included = await includedById(s.listId);
    expect([...included.values()].every((v) => v === true)).toBe(true);
  });

  it("mode 'none' excludes every item", async () => {
    const s = await seedListWithItems();
    // Start with one included so 'none' has something to clear.
    await prisma.discountListItem.update({
      where: { id: s.item1 },
      data: { included: true },
    });

    const res = await patchSelections(s, { mode: 'none' });
    expect(res.status).toBe(200);

    const included = await includedById(s.listId);
    expect([...included.values()].every((v) => v === false)).toBe(true);
  });

  it("mode 'set' with empty selections is 422 SELECTIONS_REQUIRED", async () => {
    const s = await seedListWithItems();
    const res = await patchSelections(s, { mode: 'set', selections: [] });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'SELECTIONS_REQUIRED')).toBe(true);
  });
});
