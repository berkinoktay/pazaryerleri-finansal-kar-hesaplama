import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import { createBufferEntry, createOrganization, createStore } from '../../helpers/factories';

describe('live_performance_buffer schema', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('round-trips a row with all fields', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const created = await prisma.livePerformanceBuffer.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        orderDate: new Date('2026-05-27T00:00:00Z'),
        platformOrderId: 'pkg-123',
        platformOrderNumber: 'ord-456',
        rawPayload: { trendyolFoo: 'bar' },
        mappedOrder: { lines: [{ barcode: '8690000000001', quantity: 1 }] },
        status: 'PENDING',
        attempts: 0,
      },
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe('PENDING');
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it('enforces composite unique (storeId, platformOrderId)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id, { platformOrderId: 'pkg-unique' });

    await expect(
      createBufferEntry(org.id, store.id, { platformOrderId: 'pkg-unique' }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it('cascades DELETE on store removal', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id);

    await prisma.store.delete({ where: { id: store.id } });

    const remaining = await prisma.livePerformanceBuffer.count({
      where: { storeId: store.id },
    });
    expect(remaining).toBe(0);
  });

  it('updated_at advances on UPDATE (Prisma @updatedAt, no DB trigger)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const created = await createBufferEntry(org.id, store.id);

    const before = await prisma.livePerformanceBuffer.findUniqueOrThrow({
      where: { id: created.id },
      select: { updatedAt: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await prisma.livePerformanceBuffer.update({
      where: { id: created.id },
      data: { status: 'PROMOTING' },
    });

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({
      where: { id: created.id },
      select: { updatedAt: true },
    });

    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });
});
